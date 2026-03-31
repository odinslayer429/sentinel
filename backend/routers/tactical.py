"""
routers/tactical.py
────────────────────
Tactical Force Allocation — production MVP

Endpoints:
  POST /api/tactical/deploy            — LP optimizer → per-zone officer count + patrol type + dispatch ETA
  GET  /api/tactical/deploy/latest     — last saved deployment (no re-run)
  POST /api/tactical/deploy/full       — deploy + Gemini AI briefing in one call  ← showstopper
  POST /api/tactical/briefing          — legacy: manual zone input → AI briefing
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
import json
import logging

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


# ── Safe JSON parser — handles Gemini truncation ──────────────────────────────
def _safe_parse(raw: str) -> dict:
    """
    Extracts the outermost valid JSON object from raw string.
    Handles truncated Gemini responses by walking brace depth.
    """
    s = raw.find('{')
    if s == -1:
        return {}
    depth = 0
    for i, ch in enumerate(raw[s:], start=s):
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(raw[s:i + 1])
                except json.JSONDecodeError:
                    break
    # Last-resort: try rfind closing brace
    e = raw.rfind('}')
    if e != -1 and e > s:
        try:
            return json.loads(raw[s:e + 1])
        except json.JSONDecodeError:
            pass
    return {}


# ── Zone enrichment helper ────────────────────────────────────────────────────
def _enrich_zones(allocation: list) -> list:
    for zone in allocation:
        zone["patrol_type"] = classify_patrol_type(
            zone["officers_assigned"], zone["risk_score"]
        )
        zone["dispatch"] = get_dispatch_recommendation(zone["zone_id"])
    return allocation


# ── T1: Core LP deploy ────────────────────────────────────────────────────────
@router.post("/deploy")
async def deploy(total_officers: int = 60, shift: Optional[str] = None):
    """
    Runs PuLP integer LP optimizer.
    Returns per-zone: officers_assigned, risk_score, patrol_type, dispatch ETA.
    """
    result = await run_patrol_optimization(total_officers, shift)
    result["allocation"] = _enrich_zones(result["allocation"])
    return result


# ── Latest saved deployment (no recompute) ───────────────────────────────────
@router.get("/deploy/latest")
def latest_deployment(shift: Optional[str] = None):
    """Returns the most recent persisted deployment from DB."""
    return get_latest_deployment(shift)


# ── T3: Full deploy + AI briefing — the showstopper ──────────────────────────
@router.post("/deploy/full")
async def deploy_full(
    total_officers: int = 60,
    shift: Optional[str] = None,
    scenario: str = "NORMAL",
    day: str = "TUESDAY",
):
    """
    Single call that:
    1. Runs LP optimizer
    2. Classifies patrol type per zone
    3. Attaches nearest unit + ETA per zone
    4. Feeds top 5 zones into Gemini for field briefing
    5. Returns everything in one payload
    """
    result = await run_patrol_optimization(total_officers, shift)
    result["allocation"] = _enrich_zones(result["allocation"])

    # Top 5 zones by risk — keeps Gemini response short enough to not truncate
    top5 = sorted(result["allocation"], key=lambda z: z["risk_score"], reverse=True)[:5]

    zone_lines = "\n".join([
        f"- {z['zone_id']} ({z['zone']}): {z['officers_assigned']} officers, "
        f"RISK={z['risk_score']:.1f}, TYPE={z['patrol_type']['type']}, "
        f"NEAREST={z['dispatch']['unit_name']}, ETA={z['dispatch']['eta_mins']}min"
        for z in top5
    ])

    prompt = f"""[SENTINEL_TACTICAL_AI — MUMBAI POLICE COMMAND]
Shift: {result['shift'].upper()} | Scenario: {scenario} | Day: {day}
LP Status: {result['lp_status']} | Total officers: {total_officers}

Top risk zones with LP allocation:
{zone_lines}

Return ONLY valid JSON — no markdown, no code fences, no extra text:
{{
  "deployment_order": "Single authoritative paragraph. Specific Mumbai landmarks and choke points. Written for a field commander.",
  "briefings": {{
    "ZONE_ID": {{
      "strategic_rollout": "Exactly 2 sentences. Ground-level. Actionable.",
      "shift_advice": "One line. Which shift needs most strength and why.",
      "priority_action": "Single most critical action in next 2 hours."
    }}
  }}
}}

Rules:
- Replace ZONE_ID with actual zone IDs from the list above (e.g. Z08, Z13)
- Include exactly {len(top5)} zones in briefings
- Max 60 words per zone total
- Use real Mumbai landmarks: CST, Bandra station, Dharavi, LBS Marg, Western Express Highway etc.
- Write for field officers, not analysts"""

    try:
        ai_raw = await generate(prompt)
        briefing = _safe_parse(ai_raw)
        if not briefing:
            briefing = {"deployment_order": "AI briefing unavailable.", "briefings": {}}
    except Exception as ex:
        logger.error("Gemini briefing failed: %s", ex)
        briefing = {"deployment_order": f"AI error: {ex}", "briefings": {}}

    result["briefing"] = briefing
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
    """Legacy endpoint — accepts manual zone input, returns AI briefing."""
    if not req.zones:
        return {"deployment_order": "No active zones for briefing.", "briefings": {}}

    top_zones = sorted(req.zones, key=lambda z: z.risk_score, reverse=True)[:5]
    zone_lines = "\n".join([
        f"- {z.zone_id} ({z.zone_name}): {z.units} units, STATUS={z.status}, RISK={z.risk_score:.2f}"
        for z in top_zones
    ])

    prompt = f"""[SENTINEL_TACTICAL_AI — MUMBAI POLICE COMMAND]
Day: {req.day} | Scenario: {req.scenario}

Zones:
{zone_lines}

Return ONLY valid JSON:
{{
  "deployment_order": "One paragraph. Real Mumbai geography.",
  "briefings": {{
    "Z01": {{
      "strategic_rollout": "2 sentences. Actionable.",
      "shift_advice": "One line.",
      "priority_action": "Next 2 hours."
    }}
  }}
}}
Include all {len(top_zones)} zones. Max 60 words per zone. No markdown."""

    try:
        raw = await generate(prompt)
        briefing = _safe_parse(raw)
        return briefing if briefing else {"deployment_order": "Parse failed.", "briefings": {}}
    except Exception as e:
        return {"deployment_order": f"ENGINE_FAILURE: {e}", "briefings": {}}
