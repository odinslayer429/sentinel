"""
hawkes_engine.py
────────────────
Spatiotemporal Hawkes Process engine for real-time Mumbai crime risk scoring.

Theory
──────
A Hawkes process is a self-exciting point process where each event raises
the probability of future events. Extended here to be SPATIAL — crimes in
one zone excite adjacent zones weighted by inverse geographic distance.

The conditional intensity for zone i at time t:

    λᵢ(t) = μᵢ·W + Σⱼ Σ_{tₖʲ < t} αᵢⱼ · β · exp(-β(t - tₖʲ))

Where:
    μᵢ    = background rate for zone i (estimated from 30-day event history)
    W     = weather composite multiplier from weather_service.py
    αᵢⱼ   = spatial excitation weight (from zone_graph edge weight, 0 if not adjacent)
    β     = decay rate — how fast excitement fades (estimated per cycle via MLE)
    tₖʲ   = timestamp of k-th event in zone j

Risk score (0–100) = sigmoid-normalised λᵢ(t) relative to all zones this cycle.

State persistence
─────────────────
Hawkes parameters (μ per zone, α matrix, β) are estimated via MLE using
scipy.optimize on the last 7 days of events, then saved to ml/hawkes_state.json.
On startup we load this file so risk scoring is immediately meaningful —
no cold-start period.  State is re-estimated every 6 hours.

No synthetic data is used anywhere. If the DB has fewer than 10 events
(fresh install, first run) the engine returns neutral scores and logs a
clear warning.
"""

import json
import logging
import math
import os
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
from scipy.optimize import minimize
from sqlalchemy.orm import Session

from db.database import SessionLocal
from db.models import CrimeEvent, ZoneRiskScore
from .zone_graph import ZONES, ZONE_GRAPH, get_edge_weight, zone_ids
from .weather_service import get_weather_features

logger = logging.getLogger(__name__)

STATE_PATH = Path(__file__).parent.parent.parent / "ml" / "hawkes_state.json"
STATE_PATH.parent.mkdir(parents=True, exist_ok=True)

# ── Constants ─────────────────────────────────────────────────────────────────
_DECAY_INIT       = 0.5
_DECAY_MIN        = 0.05
_DECAY_MAX        = 5.0
_EXCITATION_INIT  = 0.3
_BG_RATE_FALLBACK = 0.1
_RE_ESTIMATE_HRS  = 6
_HISTORY_DAYS     = 7
_SCORE_WINDOW_HRS = 24


# ─────────────────────────────────────────────────────────────────────────────
# State container
# ─────────────────────────────────────────────────────────────────────────────

class HawkesState:
    def __init__(self):
        self.beta: float = _DECAY_INIT
        self.mu: Dict[str, float] = {zid: _BG_RATE_FALLBACK for zid in zone_ids()}
        self.alpha: Dict[str, Dict[str, float]] = self._init_alpha()
        self.event_times: Dict[str, List[float]] = defaultdict(list)
        self.last_estimated: Optional[datetime] = None

    def _init_alpha(self) -> Dict[str, Dict[str, float]]:
        alpha: Dict[str, Dict[str, float]] = {}
        for zid in zone_ids():
            alpha[zid] = {}
            for neighbor in ZONE_GRAPH.neighbors(zid):
                w = get_edge_weight(zid, neighbor)
                alpha[zid][neighbor] = round(_EXCITATION_INIT * w * 10, 4)
            alpha[zid][zid] = _EXCITATION_INIT
        return alpha

    def to_dict(self) -> dict:
        return {
            "beta":           self.beta,
            "mu":             self.mu,
            "alpha":          self.alpha,
            "last_estimated": self.last_estimated.isoformat() if self.last_estimated else None,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "HawkesState":
        state = cls()
        state.beta           = d.get("beta", _DECAY_INIT)
        state.mu             = d.get("mu", state.mu)
        state.alpha          = d.get("alpha", state.alpha)
        last_est             = d.get("last_estimated")
        state.last_estimated = datetime.fromisoformat(last_est) if last_est else None
        return state


_state = HawkesState()


# ─────────────────────────────────────────────────────────────────────────────
# Persistence
# ─────────────────────────────────────────────────────────────────────────────

def _save_state():
    try:
        with open(STATE_PATH, "w") as f:
            json.dump(_state.to_dict(), f, indent=2)
    except Exception as exc:
        logger.warning("Could not save Hawkes state: %s", exc)


def _load_state():
    global _state
    if not STATE_PATH.exists():
        logger.info("No hawkes_state.json — using defaults.")
        return
    try:
        with open(STATE_PATH) as f:
            d = json.load(f)
        _state = HawkesState.from_dict(d)
        logger.info("Hawkes state loaded.")
    except Exception as exc:
        logger.warning("Could not load Hawkes state (%s) — using defaults.", exc)
        _state = HawkesState()


# ─────────────────────────────────────────────────────────────────────────────
# MLE parameter estimation
# ─────────────────────────────────────────────────────────────────────────────

def _compute_log_likelihood(
    beta: float,
    alpha_self: float,
    mu_arr: np.ndarray,
    event_times_per_zone: Dict[str, np.ndarray],
    T: float,
) -> float:
    """
    Log-likelihood for the Hawkes process.
    L = Σᵢ [ Σₖ log λᵢ(tₖ) - ∫₀ᵀ λᵢ(t) dt ]
    """
    zids = zone_ids()
    ll = 0.0
    for idx, zid in enumerate(zids):
        times = event_times_per_zone.get(zid, np.array([]))
        mu_i  = max(mu_arr[idx], 1e-8)
        if len(times) == 0:
            ll -= mu_i * T
            continue
        for k, tk in enumerate(times):
            past_times = times[:k]
            kernel_sum = 0.0
            if len(past_times) > 0:
                diffs = tk - past_times
                kernel_sum = alpha_self * beta * float(np.sum(np.exp(-beta * diffs)))
            lam_k = mu_i + kernel_sum
            if lam_k <= 0:
                return -1e10
            ll += math.log(lam_k)
        integrals = 1.0 - np.exp(-beta * (T - times))
        ll -= mu_i * T + alpha_self * float(np.sum(integrals))
    return ll


def _estimate_parameters(event_times_per_zone: Dict[str, np.ndarray], T: float):
    zids    = zone_ids()
    mu_init = np.array([
        max(len(event_times_per_zone.get(zid, [])) / max(T, 1.0), _BG_RATE_FALLBACK)
        for zid in zids
    ])
    for idx, zid in enumerate(zone_ids()):
        _state.mu[zid] = float(mu_init[idx])

    def neg_ll(params):
        beta_p, alpha_p = params
        if beta_p <= 0 or alpha_p < 0:
            return 1e10
        return -_compute_log_likelihood(beta_p, alpha_p, mu_init,
                                        event_times_per_zone, T)

    result = minimize(
        neg_ll,
        x0      = [_state.beta, _EXCITATION_INIT],
        method  = "L-BFGS-B",
        bounds  = [(_DECAY_MIN, _DECAY_MAX), (0.0, 2.0)],
        options = {"maxiter": 200, "ftol": 1e-9},
    )
    if result.success or result.fun < 1e9:
        new_beta, new_alpha = result.x
        _state.beta = float(new_beta)
        for zid in zone_ids():
            _state.alpha[zid][zid] = float(new_alpha)
        logger.info("MLE — β=%.4f  α=%.4f", _state.beta, new_alpha)
    else:
        logger.warning("MLE did not converge — keeping previous parameters.")


# ─────────────────────────────────────────────────────────────────────────────
# Intensity evaluation
# ─────────────────────────────────────────────────────────────────────────────

def _compute_intensity(zone_id: str, t_now: float, weather_mult: float) -> float:
    """λᵢ(t) = μᵢ·W + Σⱼ αᵢⱼ · β · Σₖ exp(-β(t - tₖʲ))"""
    mu_i = _state.mu.get(zone_id, _BG_RATE_FALLBACK) * weather_mult
    lam  = mu_i
    beta = _state.beta
    for src_zone, alpha_ij in _state.alpha.get(zone_id, {}).items():
        if alpha_ij == 0:
            continue
        times = _state.event_times.get(src_zone, [])
        if not times:
            continue
        arr   = np.array(times)
        diffs = t_now - arr
        diffs = diffs[diffs > 0]
        if len(diffs) == 0:
            continue
        lam += alpha_ij * beta * float(np.sum(np.exp(-beta * diffs)))
    return max(lam, 0.0)


def _normalise_to_score(intensities: Dict[str, float]) -> Dict[str, float]:
    """Sigmoid normalisation → [0, 100]."""
    values = np.array(list(intensities.values()), dtype=float)
    if values.max() == 0:
        return {k: 0.0 for k in intensities}
    mean = values.mean()
    std  = values.std() if values.std() > 0 else 1.0
    z    = (values - mean) / std
    sig  = 1.0 / (1.0 + np.exp(-z))
    scores = sig * 100.0
    return {zid: round(float(s), 2) for zid, s in zip(intensities.keys(), scores)}


# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────

def _load_recent_events(db: Session, hours: int) -> List[CrimeEvent]:
    since = datetime.utcnow() - timedelta(hours=hours)
    return (
        db.query(CrimeEvent)
        .filter(CrimeEvent.ingested_at >= since)
        .filter(CrimeEvent.zone_id.isnot(None))
        .order_by(CrimeEvent.ingested_at.asc())
        .all()
    )


def _event_counts(events: List[CrimeEvent]) -> Dict[str, Dict[str, int]]:
    now  = datetime.utcnow()
    cuts = {
        "1h":  now - timedelta(hours=1),
        "6h":  now - timedelta(hours=6),
        "24h": now - timedelta(hours=24),
    }
    counts: Dict[str, Dict[str, int]] = {
        zid: {"1h": 0, "6h": 0, "24h": 0} for zid in zone_ids()
    }
    for e in events:
        if not e.zone_id or not e.ingested_at:
            continue
        for window, cut in cuts.items():
            if e.ingested_at >= cut:
                counts[e.zone_id][window] += 1
    return counts


def _dominant_crime_type(events: List[CrimeEvent], zone_id: str) -> Optional[str]:
    freq: Dict[str, int] = defaultdict(int)
    for e in events:
        if e.zone_id != zone_id:
            continue
        try:
            for ct in json.loads(e.crime_types or "[]"):
                freq[ct] += 1
        except Exception:
            pass
    return max(freq, key=freq.get) if freq else None


def _upsert_zone_score(db, zone_id, intensity, risk_score,
                       trend, dominant, counts, weather_mult):
    row = db.query(ZoneRiskScore).filter_by(zone_id=zone_id).first()
    if row is None:
        row = ZoneRiskScore(zone_id=zone_id, zone_name=ZONES[zone_id]["name"])
        db.add(row)
    row.hawkes_intensity    = round(intensity, 6)
    row.risk_score          = risk_score
    row.trend               = trend
    row.dominant_crime_type = dominant
    row.event_count_1h      = counts["1h"]
    row.event_count_6h      = counts["6h"]
    row.event_count_24h     = counts["24h"]
    row.weather_multiplier  = weather_mult
    row.computed_at         = datetime.utcnow()
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def startup_load():
    """Call once from main.py lifespan."""
    _load_state()


async def run_hawkes_cycle():
    """Called after every RSS ingestion cycle."""
    db = SessionLocal()
    try:
        events = _load_recent_events(db, hours=_HISTORY_DAYS * 24)

        if len(events) < 10:
            logger.warning(
                "Hawkes: only %d zone-mapped events in DB. "
                "Scores not meaningful yet — waiting for real data.", len(events)
            )
            return

        _state.event_times.clear()
        for e in events:
            if e.zone_id and e.ingested_at:
                _state.event_times[e.zone_id].append(e.ingested_at.timestamp())

        weather = await get_weather_features()
        w_mult  = weather.composite_risk_multiplier

        should_reestimate = (
            _state.last_estimated is None or
            (datetime.utcnow() - _state.last_estimated).total_seconds() > _RE_ESTIMATE_HRS * 3600
        )
        if should_reestimate and len(events) >= 30:
            min_ts = min(e.ingested_at.timestamp() for e in events)
            max_ts = max(e.ingested_at.timestamp() for e in events)
            T      = (max_ts - min_ts) / 3600
            event_times_np = {
                zid: np.array(sorted(ts / 3600 for ts in times))
                for zid, times in _state.event_times.items() if times
            }
            _estimate_parameters(event_times_np, T)
            _state.last_estimated = datetime.utcnow()
            _save_state()

        t_now       = datetime.utcnow().timestamp()
        intensities = {zid: _compute_intensity(zid, t_now, w_mult) for zid in zone_ids()}
        scores      = _normalise_to_score(intensities)

        prev_scores = {row.zone_id: row.risk_score or 0.0
                       for row in db.query(ZoneRiskScore).all()}
        counts_map  = _event_counts(events)

        zone_payloads = []
        for zid in zone_ids():
            delta    = scores[zid] - prev_scores.get(zid, scores[zid])
            trend    = "rising" if delta > 2 else "falling" if delta < -2 else "stable"
            dominant = _dominant_crime_type(events, zid)
            _upsert_zone_score(db, zid, intensities[zid], scores[zid],
                               trend, dominant, counts_map[zid], w_mult)
            zone_payloads.append({
                "zone_id":          zid,
                "zone_name":        ZONES[zid]["name"],
                "short":            ZONES[zid]["short"],
                "lat":              ZONES[zid]["lat"],
                "lon":              ZONES[zid]["lon"],
                "risk_score":       scores[zid],
                "hawkes_intensity": round(intensities[zid], 6),
                "trend":            trend,
                "dominant_crime":   dominant,
                "event_count_1h":   counts_map[zid]["1h"],
                "event_count_6h":   counts_map[zid]["6h"],
                "event_count_24h":  counts_map[zid]["24h"],
                "weather_mult":     w_mult,
            })

        from .ws_manager import manager
        await manager.push({
            "type":    "zone_scores",
            "zones":   zone_payloads,
            "weather": weather.to_dict(),
        })

        unprocessed_ids = [e.id for e in events if not e.is_processed]
        if unprocessed_ids:
            db.query(CrimeEvent).filter(
                CrimeEvent.id.in_(unprocessed_ids)
            ).update({"is_processed": True}, synchronize_session=False)
            db.commit()

        logger.info(
            "Hawkes done — top: %s (%.1f) | β=%.3f | weather=%.3f",
            max(scores, key=scores.get), max(scores.values()),
            _state.beta, w_mult,
        )

        # Run Predictive V2 (XGBoost + SHAP)
        from .predictive_v2 import train_and_predict
        await train_and_predict()

    except Exception as exc:
        logger.exception("Hawkes cycle failed: %s", exc)
    finally:
        db.close()

