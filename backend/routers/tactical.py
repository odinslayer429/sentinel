"""
routers/tactical.py
──────────────────
Tactical Force Allocation — production MVP

Endpoints:
  POST /api/tactical/deploy            — LP optimizer → per-zone officer count + patrol type + dispatch ETA
  GET  /api/tactical/deploy/latest     — last saved deployment (no re-run)
  POST /api/tactical/deploy/full       — deploy + Groq AI briefing in one call  ← showstopper
  POST /api/tactical/deploy/commit     — deploy/full + auto-creates DispatchTasks for high-risk zones  ← T4
  POST /api/tactical/briefing          — legacy: manual zone input → AI briefing
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
import json
import logging
import asyncio
import re
from datetime import datetime

from services.gemini_service import generate
from services.patrol_optimizer import run_patrol_optimization, get_latest_deployment
from services.dispatch_ops import get_dispatch_recommendation
from db.database import SessionLocal
from db.models import Alert, DispatchTask

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tactical", tags=["Tactical Allocation AI"])


# ── Patrol type classifier ────────────────────────────────────────────────────
def classify_patrol_type(officers: int, risk: float) -> dict:
    if risk >= 75 and officers >= 5:
        return {"type": "RAPID_RESPONSE",  "formation": "QRV + Fixed Picket"}
    elif risk >= 50:
        return {"type": "MOBILE_PATROL",   "formation": "2-officer vehicle rounds"}
    elif officers >= 4:
        return {"type": "BEAT_PATROL",     "formation": "Foot patrol + chowki"}
    else:
        return {"type": "MONITORING",      "formation": "Single officer check-ins"}


# ── Safe JSON parser ──────────────────────────────────────────────────────
def _safe_parse(raw: str) -> dict:
    text = re.sub(r'```(?:json)?', '', raw).strip()
    s = text.find('{')
    e = text.rfind('}')
    if s == -1 or e == -1 or e <= s:
        return {}
    try:
        return json.loads(text[s:e + 1])
    except json.JSONDecodeError:
        return {}


# ── Zone enrichment ────────────────────────────────────────────────────────
def _enrich_zones(allocation: list) -> list:
    for zone in allocation:
        zone["patrol_type"] = classify_patrol_type(
            zone["officers_assigned"], zone["risk_score"]
        )
        zone["dispatch"] = get_dispatch_recommendation(zone["zone_id"])
    return allocation


# ── T4: Auto-create Alert + DispatchTask for high-risk zones ─────────────────
def _commit_dispatch_tasks(allocation: list, shift: str, briefings: dict) -> list:
    db = SessionLocal()
    task_ids = []
    try:
        for zone in allocation:
            if zone["risk_score"] < 50:
                continue

            severity = "CRITICAL" if zone["risk_score"] >= 75 else "HIGH"
            briefing = briefings.get(zone["zone_id"], {})
            priority = briefing.get("priority_action", "Monitor zone activity.")
            formation = zone["patrol_type"]["formation"]

            alert = Alert(
                title=f"[TACTICAL] {zone['zone']} — {zone['patrol_type']['type']}",
                message=(
                    f"Shift: {shift.upper()} | Officers: {zone['officers_assigned']} | "
                    f"Formation: {formation} | Priority: {priority}"
                ),
                severity=severity,
                zone_id=zone["zone_id"],
                zone=zone["zone"],
                is_active=True,
            )
            db.add(alert)
            db.flush()

            task = DispatchTask(
                alert_id=alert.id,
                user_id=1,
                status="PENDING",
                notes=(
                    f"AUTO-DEPLOYED | {zone['patrol_type']['type']} | "
                    f"{zone['officers_assigned']} officers | "
                    f"Nearest: {zone['dispatch']['unit_name']} "
                    f"({zone['dispatch']['eta_mins']} min) | "
                    f"Action: {priority}"
                ),
            )
            db.add(task)
            db.flush()
            task_ids.append(task.id)

        db.commit()
        logger.info("Committed %d dispatch tasks for shift=%s", len(task_ids), shift)
    except Exception as exc:
        db.rollback()
        logger.error("Failed to commit dispatch tasks: %s", exc)
    finally:
        db.close()
    return task_ids


# ── Per-zone AI briefing ───────────────────────────────────────────────────
async def _brief_one_zone(z: dict, scenario: str, day: str, shift: str) -> tuple:
    prompt = f"""[SENTINEL_TACTICAL_AI — MUMBAI POLICE]
Zone: {z['zone_id']} ({z['zone']}) | Shift: {shift.upper()} | Scenario: {scenario} | Day: {day}
Officers: {z['officers_assigned']} | Risk: {z['risk_score']:.1f} | Type: {z['patrol_type']['type']}
Nearest unit: {z['dispatch']['unit_name']} ({z['dispatch']['eta_mins']} min ETA)

Respond with ONLY a JSON object on a single line. No markdown. No explanation:
{{"strategic_rollout": "Sentence one. Sentence two.", "shift_advice": "One line.", "priority_action": "One action."}}

Use real Mumbai street names and landmarks for {z['zone']}."""

    try:
        raw = await generate(prompt)
        parsed = _safe_parse(raw)
        if parsed and "strategic_rollout" in parsed:
            return (z["zone_id"], parsed)
        logger.warning("Parse miss %s | raw: %s", z["zone_id"], raw[:300])
    except Exception as ex:
        logger.error("Zone brief failed %s: %s", z["zone_id"], ex)

    return (z["zone_id"], {
        "strategic_rollout": f"Deploy {z['officers_assigned']} officers across {z['zone']}. Maintain {z['patrol_type']['formation']}.",
        "shift_advice": "Night shift requires highest strength due to reduced visibility.",
        "priority_action": f"Establish contact with {z['dispatch']['unit_name']} — ETA {z['dispatch']['eta_mins']} min."
    })


async def _brief_overall(zones: list, scenario: str, day: str, shift: str, total: int) -> str:
    zone_summary = ", ".join([f"{z['zone_id']}({z['risk_score']:.0f})" for z in zones])
    prompt = f"""[SENTINEL_TACTICAL_AI — MUMBAI POLICE]
Shift: {shift.upper()} | Scenario: {scenario} | Day: {day} | Officers: {total}
High-risk zones: {zone_summary}

Write ONE authoritative deployment order paragraph (max 80 words) for the shift commander.
Use real Mumbai landmarks: CST, Bandra station, Dharavi, WEH, LBS Marg.
Plain text only — no JSON, no bullet points."""
    try:
        return (await generate(prompt)).strip()
    except:
        return f"Deploy {total} officers across priority zones. Maintain heightened vigilance."


# ── Shared deploy + brief logic ──────────────────────────────────────────────
async def _run_full_deploy(total_officers: int, shift: Optional[str], scenario: str, day: str) -> dict:
    # Normalise shift to lowercase — patrol_optimizer keys are lowercase
    shift_norm = shift.lower() if shift else None
    result = await run_patrol_optimization(total_officers, shift_norm)
    result["allocation"] = _enrich_zones(result["allocation"])

    top5 = sorted(result["allocation"], key=lambda z: z["risk_score"], reverse=True)[:5]
    shift_name = result["shift"]

    zone_results, deployment_order = await asyncio.gather(
        asyncio.gather(*[_brief_one_zone(z, scenario, day, shift_name) for z in top5]),
        _brief_overall(top5, scenario, day, shift_name, total_officers),
    )

    briefings = {zid: brief for zid, brief in zone_results}
    result["briefing"] = {
        "deployment_order": deployment_order,
        "briefings": briefings,
    }
    return result, briefings


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.post("/deploy")
async def deploy(total_officers: int = 60, shift: Optional[str] = None):
    """LP optimizer only — no AI briefing."""
    shift_norm = shift.lower() if shift else None
    result = await run_patrol_optimization(total_officers, shift_norm)
    result["allocation"] = _enrich_zones(result["allocation"])
    return result


@router.get("/deploy/latest")
def latest_deployment(shift: Optional[str] = None):
    """Last saved deployment from DB — no recompute."""
    shift_norm = shift.lower() if shift else None
    return get_latest_deployment(shift_norm)


@router.post("/deploy/full")
async def deploy_full(
    total_officers: int = 60,
    shift: Optional[str] = None,
    scenario: str = "NORMAL",
    day: str = "TUESDAY",
):
    """LP + patrol_type + dispatch ETA + AI briefing. No DB writes."""
    result, _ = await _run_full_deploy(total_officers, shift, scenario, day)
    return result


@router.post("/deploy/commit")
async def deploy_commit(
    total_officers: int = 60,
    shift: Optional[str] = None,
    scenario: str = "NORMAL",
    day: str = "TUESDAY",
):
    """
    Full deploy + AI briefing + auto-creates Alert + DispatchTask
    for every high-risk zone (risk >= 50). Returns task IDs.
    """
    result, briefings = await _run_full_deploy(total_officers, shift, scenario, day)
    task_ids = _commit_dispatch_tasks(
        result["allocation"], result["shift"], briefings
    )
    result["dispatch_tasks_created"] = task_ids
    result["committed_at"] = datetime.utcnow().isoformat()
    return result


# ── Legacy briefing endpoint ────────────────────────────────────────────────────
class ZoneInput(BaseModel):
    zone_id: str
    zone_name: str
    units: int
    status: str
    z_score: float
    risk_score: float

class BriefingRequest(BaseModel):
    zones: List[ZoneInput] = []
    scenario: str = "NORMAL"
    day: str = "MONDAY"

@router.post("/briefing")
async def get_tactical_briefing(req: BriefingRequest):
    if not req.zones:
        return {"deployment_order": "No active zones for briefing.", "briefings": {}}

    top5 = sorted(req.zones, key=lambda z: z.risk_score, reverse=True)[:5]

    async def _brief_legacy(z: ZoneInput) -> tuple:
        prompt = f"""[SENTINEL_TACTICAL_AI — MUMBAI POLICE]
Zone: {z.zone_id} ({z.zone_name}) | Day: {req.day} | Scenario: {req.scenario} | Units: {z.units} | Risk: {z.risk_score:.2f}
Respond with ONLY a JSON object on one line. No markdown:
{{"strategic_rollout": "2 sentences.", "shift_advice": "One line.", "priority_action": "Next 2 hours."}}"""
        try:
            raw = await generate(prompt)
            parsed = _safe_parse(raw)
            if parsed and "strategic_rollout" in parsed:
                return (z.zone_id, parsed)
        except:
            pass
        return (z.zone_id, {"strategic_rollout": f"Patrol {z.zone_name}.", "shift_advice": "Night shift priority.", "priority_action": "Increase visibility."})

    order_prompt = f"One deployment order paragraph for {req.day}, scenario {req.scenario}. Real Mumbai landmarks. Max 60 words. Plain text."
    zone_results, order = await asyncio.gather(
        asyncio.gather(*[_brief_legacy(z) for z in top5]),
        generate(order_prompt),
    )
    return {
        "deployment_order": order.strip(),
        "briefings": {zid: brief for zid, brief in zone_results},
    }
