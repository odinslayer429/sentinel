"""
routers/tactical.py
────────────────────
Tactical Force Allocation — production MVP

Endpoints:
  POST /api/tactical/deploy            — LP optimizer → per-zone officer count + patrol type + dispatch ETA
  GET  /api/tactical/deploy/latest     — last saved deployment (no re-run)
  POST /api/tactical/deploy/full       — deploy + Groq AI briefing in one call  ← showstopper
  POST /api/tactical/briefing          — legacy: manual zone input → AI briefing
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
import json
import logging
import asyncio

from services.gemini_service import generate
from services.patrol_optimizer import run_patrol_optimization, get_latest_deployment
from services.dispatch_ops import get_dispatch_recommendation

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tactical", tags=["Tactical Allocation AI"])


# ── Patrol type classifier ─────────────────────────────────────────────────────
def classify_patrol_type(officers: int, risk: float) -> dict:
    if risk >= 75 and officers >= 5:
        return {"type": "RAPID_RESPONSE",  "formation": "QRV + Fixed Picket"}
    elif risk >= 50:
        return {"type": "MOBILE_PATROL",   "formation": "2-officer vehicle rounds"}
    elif officers >= 4:
        return {"type": "BEAT_PATROL",     "formation": "Foot patrol + chowki"}
    else:
        return {"type": "MONITORING",      "formation": "Single officer check-ins"}


# ── Safe JSON parser ────────────────────────────────────────────────────────
def _safe_parse(raw: str) -> dict:
    s = raw.find('{')
    if s == -1:
        return {}
    depth = 0
    for i, ch in enumerate(raw[s:], start=s):
        if ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(raw[s:i + 1])
                except json.JSONDecodeError:
                    break
    e = raw.rfind('}')
    if e != -1 and e > s:
        try:
            return json.loads(raw[s:e + 1])
        except json.JSONDecodeError:
            pass
    return {}


# ── Zone enrichment ────────────────────────────────────────────────────────────
def _enrich_zones(allocation: list) -> list:
    for zone in allocation:
        zone["patrol_type"] = classify_patrol_type(
            zone["officers_assigned"], zone["risk_score"]
        )
        zone["dispatch"] = get_dispatch_recommendation(zone["zone_id"])
    return allocation


# ── Per-zone briefing (one flat JSON call per zone — reliable on small models) ──
async def _brief_one_zone(z: dict, scenario: str, day: str, shift: str) -> tuple:
    """
    Ask Groq for a briefing on a single zone.
    Returns (zone_id, briefing_dict).
    Flat JSON — no nesting — works reliably on llama-3.1-8b-instant.
    """
    prompt = f"""[SENTINEL_TACTICAL_AI — MUMBAI POLICE]
Zone: {z['zone_id']} ({z['zone']}) | Shift: {shift.upper()} | Scenario: {scenario} | Day: {day}
Officers: {z['officers_assigned']} | Risk: {z['risk_score']:.1f} | Type: {z['patrol_type']['type']}
Nearest unit: {z['dispatch']['unit_name']} ({z['dispatch']['eta_mins']} min ETA)

Return ONLY this flat JSON (no nesting, no markdown):
{{"strategic_rollout": "2 sentences. Real Mumbai street-level instruction for officers in {z['zone']}.", "shift_advice": "One line on which shift needs most strength here.", "priority_action": "Single most critical action in next 2 hours for {z['zone']}."}}"""

    try:
        raw = await generate(prompt)
        parsed = _safe_parse(raw)
        if parsed and "strategic_rollout" in parsed:
            return (z["zone_id"], parsed)
    except Exception as ex:
        logger.error("Zone brief failed %s: %s", z["zone_id"], ex)

    # Fallback — deterministic if AI fails
    return (z["zone_id"], {
        "strategic_rollout": f"Deploy {z['officers_assigned']} officers across {z['zone']}. Maintain {z['patrol_type']['formation']}.",
        "shift_advice": f"Night shift requires highest strength due to reduced visibility.",
        "priority_action": f"Establish contact with {z['dispatch']['unit_name']} ({z['dispatch']['eta_mins']} min ETA)."
    })


async def _brief_overall(zones: list, scenario: str, day: str, shift: str, total: int) -> str:
    """Single-sentence deployment order for the full shift."""
    zone_summary = ", ".join([f"{z['zone_id']}({z['risk_score']:.0f})" for z in zones])
    prompt = f"""[SENTINEL_TACTICAL_AI — MUMBAI POLICE]
Shift: {shift.upper()} | Scenario: {scenario} | Day: {day} | Officers: {total}
High-risk zones: {zone_summary}

Write ONE authoritative deployment order paragraph for the shift commander.
Use real Mumbai landmarks (CST, Bandra, Dharavi, WEH, LBS Marg).
Max 80 words. Plain text only, no JSON."""
    try:
        return await generate(prompt)
    except:
        return f"Deploy {total} officers across priority zones. Maintain heightened vigilance."


# ── T1: Core LP deploy ────────────────────────────────────────────────────────
@router.post("/deploy")
async def deploy(total_officers: int = 60, shift: Optional[str] = None):
    result = await run_patrol_optimization(total_officers, shift)
    result["allocation"] = _enrich_zones(result["allocation"])
    return result


@router.get("/deploy/latest")
def latest_deployment(shift: Optional[str] = None):
    return get_latest_deployment(shift)


# ── T3: Full deploy + AI briefing — showstopper ─────────────────────────────
@router.post("/deploy/full")
async def deploy_full(
    total_officers: int = 60,
    shift: Optional[str] = None,
    scenario: str = "NORMAL",
    day: str = "TUESDAY",
):
    """
    1. LP optimizer → per-zone officers + patrol_type + dispatch ETA
    2. Parallel Groq calls (one per zone) → per-zone field briefing
    3. Single Groq call → overall deployment order
    Returns one unified payload.
    """
    result = await run_patrol_optimization(total_officers, shift)
    result["allocation"] = _enrich_zones(result["allocation"])

    top5 = sorted(result["allocation"], key=lambda z: z["risk_score"], reverse=True)[:5]
    shift_name = result["shift"]

    # Fire all zone briefs + overall order in parallel
    zone_tasks  = [_brief_one_zone(z, scenario, day, shift_name) for z in top5]
    order_task  = _brief_overall(top5, scenario, day, shift_name, total_officers)
    
    zone_results, deployment_order = await asyncio.gather(
        asyncio.gather(*zone_tasks),
        order_task,
    )

    briefings = {zone_id: brief for zone_id, brief in zone_results}

    result["briefing"] = {
        "deployment_order": deployment_order.strip(),
        "briefings": briefings,
    }
    return result


# ── Legacy: manual zone input → AI briefing ───────────────────────────────────
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
Zone: {z.zone_id} ({z.zone_name}) | Day: {req.day} | Scenario: {req.scenario}
Units: {z.units} | Risk: {z.risk_score:.2f}

Return ONLY flat JSON (no nesting, no markdown):
{{"strategic_rollout": "2 sentences.", "shift_advice": "One line.", "priority_action": "Next 2 hours."}}"""
        try:
            raw = await generate(prompt)
            parsed = _safe_parse(raw)
            if parsed and "strategic_rollout" in parsed:
                return (z.zone_id, parsed)
        except:
            pass
        return (z.zone_id, {"strategic_rollout": f"Patrol {z.zone_name}.", "shift_advice": "Night shift priority.", "priority_action": "Increase visibility."})

    zone_tasks = [_brief_legacy(z) for z in top5]
    order_prompt = f"One deployment order paragraph for {req.day} scenario {req.scenario}. Real Mumbai landmarks. Max 60 words. Plain text."

    zone_results, order = await asyncio.gather(
        asyncio.gather(*zone_tasks),
        generate(order_prompt),
    )

    return {
        "deployment_order": order.strip(),
        "briefings": {zid: brief for zid, brief in zone_results},
    }
