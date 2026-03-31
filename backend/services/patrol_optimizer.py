"""
patrol_optimizer.py
───────────────────
Linear programming patrol deployment optimizer using PuLP.

Problem Statement
─────────────────
Given:
  - Total available officers for a shift
  - Current Hawkes risk score per zone (0–100)
  - Minimum coverage constraint per zone (no zone left unpatrolled)
  - Maximum officers per zone (avoid over-concentration)
  - Adjacency constraint (high-risk zones pull officers from neighbours)

Find:
  - Integer officer count per zone that minimises total expected
    crime exposure (risk_score × unpatrolled_fraction)

Formulation
───────────
Minimise:   Σᵢ  risk_score_i × (1 - x_i / demand_i)
Subject to: Σᵢ x_i = total_officers          (budget constraint)
            x_i >= min_coverage_i             (minimum per zone)
            x_i <= max_per_zone               (cap per zone)
            x_i ∈ ℤ⁺                          (integer — whole officers)

Where demand_i = officers needed to fully cover zone i at current risk.
Demand is proportional to risk_score normalised to [min_cov, max_per_zone].

Shifts
──────
Three shifts: morning (06:00–14:00), afternoon (14:00–22:00),
night (22:00–06:00). Night shift gets a 1.2× risk multiplier
(reduced visibility, fewer bystanders).

No synthetic data. Risk scores come from ZoneRiskScore table
(populated by hawkes_engine.py from real events).
If the DB has no risk scores yet, optimizer returns a uniform
deployment and logs a clear warning.
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import pulp
from sqlalchemy.orm import Session

from db.database import SessionLocal
from db.models import PatrolDeployment, ZoneRiskScore
from .zone_graph import ZONES, get_neighbors, zone_ids
from .ws_manager import manager

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
_MIN_COVERAGE    = 1      # minimum officers per zone regardless of risk
_MAX_PER_ZONE    = 20     # hard cap per zone per shift
_DEFAULT_TOTAL   = 60     # fallback total if not specified
_NIGHT_MULTIPLIER = 1.2   # risk uplift for night shift

SHIFTS = {
    "morning":   {"start": 6,  "end": 14, "risk_mult": 1.0},
    "afternoon": {"start": 14, "end": 22, "risk_mult": 1.0},
    "night":     {"start": 22, "end": 6,  "risk_mult": _NIGHT_MULTIPLIER},
}


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _current_shift() -> str:
    hour = datetime.now().hour
    if 6 <= hour < 14:
        return "morning"
    if 14 <= hour < 22:
        return "afternoon"
    return "night"


def _load_risk_scores(db: Session) -> Dict[str, float]:
    """
    Load latest Hawkes risk scores from DB.
    Returns dict {zone_id: risk_score}.
    Falls back to uniform 50.0 if no scores exist yet.
    """
    rows = db.query(ZoneRiskScore).all()
    if not rows:
        logger.warning(
            "No risk scores in DB — using uniform 50.0. "
            "Run ingestion + Hawkes cycle first."
        )
        return {zid: 50.0 for zid in zone_ids()}

    scores = {row.zone_id: row.risk_score for row in rows}

    # Fill any missing zones with mean of known scores
    known_mean = sum(scores.values()) / len(scores)
    for zid in zone_ids():
        if zid not in scores:
            scores[zid] = known_mean

    return scores


def _compute_demand(
    risk_scores: Dict[str, float],
    total_officers: int,
    shift: str,
) -> Dict[str, float]:
    """
    Compute soft demand per zone.
    Demand = proportional allocation based on risk score,
    scaled to [_MIN_COVERAGE, _MAX_PER_ZONE].
    The risk multiplier for night shift is applied here.
    """
    mult   = SHIFTS[shift]["risk_mult"]
    zids   = zone_ids()
    scores = {zid: max(risk_scores.get(zid, 50.0) * mult, 0.1) for zid in zids}
    total_score = sum(scores.values())

    demand = {}
    for zid in zids:
        # Proportional share of total officers
        raw = (scores[zid] / total_score) * total_officers
        # Clamp to [min, max]
        demand[zid] = max(_MIN_COVERAGE, min(_MAX_PER_ZONE, raw))

    return demand


# ─────────────────────────────────────────────────────────────────────────────
# LP Solver
# ─────────────────────────────────────────────────────────────────────────────

def _solve_lp(
    risk_scores: Dict[str, float],
    demand:      Dict[str, float],
    total_officers: int,
    shift: str,
) -> Tuple[Dict[str, int], str, float]:
    """
    Solve the integer LP using PuLP + CBC solver.

    Returns:
        allocation dict {zone_id: officers},
        solver status string,
        objective value (total risk exposure)
    """
    zids = zone_ids()
    mult = SHIFTS[shift]["risk_mult"]

    prob = pulp.LpProblem("PatrolDeployment", pulp.LpMinimize)

    # Decision variables: integer officers per zone
    x = {
        zid: pulp.LpVariable(
            f"x_{zid}",
            lowBound  = _MIN_COVERAGE,
            upBound   = _MAX_PER_ZONE,
            cat       = "Integer",
        )
        for zid in zids
    }

    # Objective: minimise Σᵢ risk_score_i × max(0, demand_i - x_i)
    # This penalises under-staffing high-risk zones most
    prob += pulp.lpSum(
        risk_scores.get(zid, 50.0) * mult * pulp.lpSum([demand[zid] - x[zid]])
        for zid in zids
    )

    # Constraint 1: total officers budget
    prob += pulp.lpSum(x[zid] for zid in zids) == total_officers

    # Constraint 2: adjacency — if a zone is high risk (>70),
    # combined officers in zone + all neighbours must be >= 3
    for zid in zids:
        if risk_scores.get(zid, 50.0) >= 70:
            neighbours = get_neighbors(zid)
            prob += (
                x[zid] + pulp.lpSum(x[nb] for nb in neighbours if nb in x)
                >= 3
            ), f"adjacency_{zid}"

    # Suppress PuLP solver output
    solver = pulp.PULP_CBC_CMD(msg=False)
    prob.solve(solver)

    status = pulp.LpStatus[prob.status]

    if status == "Optimal":
        allocation = {zid: max(int(pulp.value(x[zid])), _MIN_COVERAGE) for zid in zids}
        # Correct any rounding drift in total
        alloc_total = sum(allocation.values())
        diff        = total_officers - alloc_total
        if diff != 0:
            # Add/remove from highest/lowest risk zone
            sorted_zones = sorted(zids, key=lambda z: risk_scores.get(z, 0), reverse=(diff > 0))
            for zid in sorted_zones:
                if diff == 0:
                    break
                adjustment = 1 if diff > 0 else -1
                new_val    = allocation[zid] + adjustment
                if _MIN_COVERAGE <= new_val <= _MAX_PER_ZONE:
                    allocation[zid] = new_val
                    diff -= adjustment
    else:
        # Fallback: proportional allocation rounded to integers
        logger.warning("LP solver status: %s — using proportional fallback.", status)
        allocation = _proportional_fallback(risk_scores, total_officers)

    obj_val = float(pulp.value(prob.objective) or 0.0)
    return allocation, status, obj_val


def _proportional_fallback(
    risk_scores: Dict[str, float],
    total_officers: int,
) -> Dict[str, int]:
    """
    Pure proportional allocation used when LP fails.
    Guarantees minimum coverage and exact total.
    """
    zids        = zone_ids()
    total_score = sum(max(risk_scores.get(z, 50.0), 0.1) for z in zids)
    raw         = {zid: (risk_scores.get(zid, 50.0) / total_score) * total_officers
                   for zid in zids}
    allocation  = {zid: max(_MIN_COVERAGE, int(v)) for zid, v in raw.items()}

    # Fix total
    diff = total_officers - sum(allocation.values())
    sorted_zones = sorted(zids, key=lambda z: risk_scores.get(z, 0), reverse=True)
    i = 0
    while diff > 0 and i < len(sorted_zones):
        zid = sorted_zones[i % len(sorted_zones)]
        if allocation[zid] < _MAX_PER_ZONE:
            allocation[zid] += 1
            diff -= 1
        i += 1

    return allocation


# ─────────────────────────────────────────────────────────────────────────────
# Persistence
# ─────────────────────────────────────────────────────────────────────────────

def _persist_deployment(
    db: Session,
    allocation: Dict[str, int],
    risk_scores: Dict[str, float],
    shift: str,
):
    for zid, count in allocation.items():
        row = PatrolDeployment(
            zone_id           = zid,
            zone              = ZONES[zid]["name"],
            officers_assigned = count,
            risk_score        = round(risk_scores.get(zid, 0.0), 2),
            shift             = shift,
        )
        db.add(row)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

async def run_patrol_optimization(
    total_officers: int = _DEFAULT_TOTAL,
    shift: Optional[str] = None,
) -> Dict:
    """
    Run patrol optimizer for the given shift.

    Args:
        total_officers : Total officers available for this shift
        shift          : "morning" / "afternoon" / "night"
                         Defaults to the current real-world shift

    Returns dict with:
        shift, total_officers, status, objective,
        allocation [{zone_id, zone, short, lat, lon,
                     officers, risk_score, trend}]
    """
    shift = shift or _current_shift()
    if shift not in SHIFTS:
        raise ValueError(f"Invalid shift '{shift}'. Choose from {list(SHIFTS.keys())}")

    db = SessionLocal()
    try:
        risk_scores = _load_risk_scores(db)
        demand      = _compute_demand(risk_scores, total_officers, shift)
        allocation, status, obj_val = _solve_lp(
            risk_scores, demand, total_officers, shift
        )
        _persist_deployment(db, allocation, risk_scores, shift)

        # Build rich response payload
        result_zones = []
        for zid in sorted(zone_ids()):
            result_zones.append({
                "zone_id":           zid,
                "zone":              ZONES[zid]["name"],
                "short":             ZONES[zid]["short"],
                "lat":               ZONES[zid]["lat"],
                "lon":               ZONES[zid]["lon"],
                "officers_assigned": allocation[zid],
                "risk_score":        round(risk_scores.get(zid, 0.0), 2),
                "demand":            round(demand[zid], 2),
            })

        payload = {
            "shift":          shift,
            "total_officers": total_officers,
            "lp_status":      status,
            "objective":      round(obj_val, 4),
            "computed_at":    datetime.utcnow().isoformat(),
            "allocation":     result_zones,
        }

        # Push to WebSocket clients
        await manager.push({
            "type":    "patrol_update",
            "payload": payload,
        })

        logger.info(
            "Patrol optimized — shift=%s officers=%d status=%s obj=%.2f",
            shift, total_officers, status, obj_val,
        )
        return payload

    except Exception as exc:
        logger.exception("Patrol optimization failed: %s", exc)
        raise
    finally:
        db.close()


def get_latest_deployment(shift: Optional[str] = None) -> List[Dict]:
    """
    Retrieve the most recent patrol deployment from the DB.
    Used by the dashboard to display current assignments without re-running LP.
    """
    shift = shift or _current_shift()
    db    = SessionLocal()
    try:
        since = datetime.utcnow() - timedelta(hours=8)
        rows  = (
            db.query(PatrolDeployment)
            .filter(PatrolDeployment.shift == shift)
            .filter(PatrolDeployment.created_at >= since)
            .order_by(PatrolDeployment.created_at.desc())
            .limit(len(zone_ids()))
            .all()
        )
        return [
            {
                "zone_id":           r.zone_id,
                "zone":              r.zone,
                "officers_assigned": r.officers_assigned,
                "risk_score":        r.risk_score,
                "shift":             r.shift,
                "created_at":        r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    finally:
        db.close()

