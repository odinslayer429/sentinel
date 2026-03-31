from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
from services.gemini_service import generate
import json

router = APIRouter(prefix="/api/tactical", tags=["Tactical Allocation AI"])

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

    top_zones = sorted(req.zones, key=lambda z: z.risk_score, reverse=True)[:8]
    zone_lines = "\n".join([
        f"- {z.zone_id} ({z.zone_name}): {z.units} units, STATUS={z.status}, RISK={z.risk_score:.2f}, Z={z.z_score:.2f}"
        for z in top_zones
    ])

    prompt = f"""
[SENTINEL_TACTICAL_AI — MUMBAI POLICE COMMAND]
You are a senior tactical intelligence officer for Mumbai Police.
Today is {req.day}. Active scenario: {req.scenario}.

Zone deployment summary:
{zone_lines}

For each zone listed, provide a tactical deployment briefing in this exact JSON format:
{{
  "deployment_order": "One authoritative paragraph — overall deployment order for today combining scenario and day context. Be specific to Mumbai geography.",
  "briefings": {{
    "Z01": {{
      "strategic_rollout": "2-sentence ground-level tactical instruction for officers. Specific, actionable, no fluff.",
      "shift_advice": "One line — which shift needs most strength and why.",
      "priority_action": "Single most critical action for next 2 hours."
    }}
  }}
}}

Rules:
- Use real Mumbai geography, landmarks, choke points
- Be direct — write for a field officer, not an analyst
- No generic filler. Every word must be operationally useful.
- Only include zones from the list above in briefings object.
- Return valid JSON only, no markdown, no extra text.
"""

    try:
        result = await generate(prompt)
        start = result.find('{')
        end = result.rfind('}') + 1
        if start != -1 and end != -1:
            return json.loads(result[start:end])
        return {"deployment_order": "AI briefing parsing failed.", "briefings": {}}
    except Exception as e:
        return {"deployment_order": f"ENGINE_FAILURE: {str(e)}", "briefings": {}}