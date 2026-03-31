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
import re

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


# ── Safe JSON parser — finds first { ... last } slice, tries json.loads ────────
def _safe_parse(raw: str) -> dict:
    """
    Strips markdown fences, finds first { to last }, attempts json.loads.
    Does NOT walk brace depth (breaks on } inside string values).
    """
    # Strip markdown code fences
    text = re.sub(r'```(?:json)?', '', raw).strip()
    s = text.find('{')
    e = text.rfind('}')
    if s == -1 or e == -1 or e <= s:
        return {}
    try:
        return json.loads(text[s:e + 1])
    except json.JSONDecodeError:
        return {}


# ── Zone enrichment ────────────────────────────────────────────────────────────
def _enrich_zones(allocation: list) -> list:
    for zone in allocation:
        zone["patrol_type"] = classify_patrol_type(
            zone["officers_assigned"], zone["risk_score"]
        )
        zone["dispatch"] = get_dispatch_recommendation(zone["zone_id"])
    return allocation


# ── Per-zone briefing ─────────────────────────────────────────────────────
async def _brief_one_zone(z: dict, scenario: str, day: str, shift: str) -> tuple:
    prompt = f"""[SENTINEL_TACTICAL_AI — MUMBAI POLICE]
Zone: {z['zone_id']} ({z['zone']}) | Shift: {shift.upper()} | Scenario: {scenario} | Day: {day}
Officers: {z['officers_assigned']} | Risk: {z['risk_score']:.1f} | Type: {z['patrol_type']['type']}
Nearest unit: {z['dispatch']['unit_name']} ({z['dispatch']['eta_mins']} min ETA)

Respond with ONLY a JSON object on a single line. No markdown. No explanation. Example format:
{{"strategic_rollout": "Sentence one. Sentence two.", "shift_advice": "One line.", "priority_action": "One action."}}

Fill in for {z['zone']} using real Mumbai street names and landmarks."""

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
    result = await run_patrol_optimization(total_officers, shift)
    result["allocation"] = _enrich_zones(result["allocation"])

    top5 = sorted(result["allocation"], key=lambda z: z["risk_score"], reverse=True)[:5]
    shift_name = result["shift"]

    zone_tasks = [_brief_one_zone(z, scenario, day, shift_name) for z in top5]
    order_task = _brief_overall(top5, scenario, day, shift_name, total_officers)

    zone_results, deployment_order = await asyncio.gather(
        asyncio.gather(*zone_tasks),
        order_task,
    )

    result["briefing"] = {
        "deployment_order": deployment_order,
        "briefings": {zid: brief for zid, brief in zone_results},
    }
    return result


# ── Legacy briefing endpoint ───────────────────────────────────────────────────
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
