"""
routers/briefing.py
────────────────────
Shift Intelligence Briefing endpoint.

GET /api/briefing/{shift}  — Returns structured shift briefing from real DB data.

Aggregates:
  - Last 24h event count and severity breakdown
  - Top 3 high-risk zones (from ZoneRiskScore)
  - Active critical alerts
  - Dominant crime types
  - Officer deployment summary from last patrol run
  - Night pattern comparison (rising vs falling trend count)

No LLM required — deterministic structured generation from real data.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import CrimeEvent, Alert, ZoneRiskScore, PatrolDeployment
from services.zone_graph import ZONES, zone_ids

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/briefing", tags=["Briefing"])

SHIFT_HOURS = {
    "morning":   (6,  14),
    "afternoon": (14, 22),
    "night":     (22, 6),
}

SHIFT_LABEL = {
    "morning":   "MORNING SHIFT (0600–1400 HRS)",
    "afternoon": "AFTERNOON SHIFT (1400–2200 HRS)",
    "night":     "NIGHT SHIFT (2200–0600 HRS)",
}


def _safe_json(val) -> list:
    try:
        r = json.loads(val or "[]")
        return r if isinstance(r, list) else []
    except Exception:
        return []


@router.get("/{shift}")
def get_briefing(
    shift: str = "morning",
    db: Session = Depends(get_db),
):
    """
    Generate a full shift intelligence briefing from real DB data.
    """
    now = datetime.utcnow()
    since_24h = now - timedelta(hours=24)
    since_6h  = now - timedelta(hours=6)

    # ── 1. Event Counts ────────────────────────────────────────────────────────
    events_24h = db.query(CrimeEvent).filter(CrimeEvent.ingested_at >= since_24h).all()
    events_6h  = db.query(CrimeEvent).filter(CrimeEvent.ingested_at >= since_6h).all()

    sev_counts = {"CRITICAL": 0, "WARNING": 0, "INFO": 0}
    crime_counts: dict = {}

    for e in events_24h:
        sev_counts[e.severity] = sev_counts.get(e.severity, 0) + 1
        for ct in _safe_json(e.crime_types):
            crime_counts[ct] = crime_counts.get(ct, 0) + 1

    top_crimes = sorted(crime_counts.items(), key=lambda x: x[1], reverse=True)[:5]

    # ── 2. Zone Risk Summary ───────────────────────────────────────────────────
    zone_scores = db.query(ZoneRiskScore).all()
    zone_scores_sorted = sorted(zone_scores, key=lambda z: z.risk_score, reverse=True)
    top_zones = zone_scores_sorted[:5]
    rising_zones = [z for z in zone_scores if z.trend == "rising"]
    falling_zones = [z for z in zone_scores if z.trend == "falling"]

    # ── 3. Active Alerts ───────────────────────────────────────────────────────
    alerts = db.query(Alert).filter(Alert.is_active == True).all()
    critical_alerts = [a for a in alerts if a.severity == "CRITICAL"]
    warning_alerts  = [a for a in alerts if a.severity == "WARNING"]

    # ── 4. Deployment Summary ─────────────────────────────────────────────────
    try:
        from db.models import PatrolDeployment
        deployments = db.query(PatrolDeployment).filter_by(shift=shift).all()
        total_officers = sum(d.officers_assigned for d in deployments)
        top_deployment = max(deployments, key=lambda d: d.officers_assigned) if deployments else None
    except Exception:
        total_officers = 0
        top_deployment = None
        deployments = []

    # ── 5. Build Structured Briefing ──────────────────────────────────────────
    shift_label = SHIFT_LABEL.get(shift, f"{shift.upper()} SHIFT")

    briefing_lines = [
        f"MARVEL INTELLIGENCE BRIEFING — {shift_label}",
        f"Generated: {now.strftime('%d %b %Y, %H:%M UTC')} | Mumbai Metropolitan Region",
        "",
        "── SITUATION OVERVIEW ──────────────────────────────────────────",
        f"  Total events (last 24h):   {len(events_24h)}",
        f"  Events (last 6h):          {len(events_6h)}",
        f"  Critical incidents:        {sev_counts['CRITICAL']}",
        f"  Warning-level events:      {sev_counts['WARNING']}",
        f"  Active alerts:             {len(alerts)} ({len(critical_alerts)} CRITICAL)",
        "",
        "── HIGH-RISK ZONES ────────────────────────────────────────────",
    ]

    for i, z in enumerate(top_zones[:5]):
        trend_arrow = "↑ RISING" if z.trend == "rising" else ("↓ FALLING" if z.trend == "falling" else "→ STABLE")
        briefing_lines.append(
            f"  {i+1}. {z.zone_name:<20} Risk: {z.risk_score:.1f}   {trend_arrow}   Dominant: {z.dominant_crime_type or 'Mixed'}"
        )

    briefing_lines += [
        "",
        f"  Zones rising:  {len(rising_zones)}   Zones falling: {len(falling_zones)}",
        "",
        "── DOMINANT CRIME PATTERNS ─────────────────────────────────────",
    ]

    for crime, count in top_crimes:
        bar = "█" * min(int(count / max(top_crimes[0][1] if top_crimes else 1, 1) * 20), 20)
        briefing_lines.append(f"  {crime:<25} {bar} {count}")

    briefing_lines += [
        "",
        "── DEPLOYMENT STATUS ───────────────────────────────────────────",
        f"  Officers on duty ({shift}):  {total_officers}",
    ]

    if top_deployment:
        briefing_lines.append(
            f"  Highest density zone:       {top_deployment.zone_id} ({top_deployment.officers_assigned} officers)"
        )

    if critical_alerts:
        briefing_lines += ["", "── CRITICAL ALERTS ─────────────────────────────────────────────"]
        for a in critical_alerts[:5]:
            briefing_lines.append(f"  • [{a.zone or 'MMR'}] {a.title}")

    briefing_lines += [
        "",
        "── TACTICAL RECOMMENDATIONS ────────────────────────────────────",
    ]

    if len(rising_zones) > 3:
        briefing_lines.append(f"  ⚠  {len(rising_zones)} zones show rising trends — recommend QRV standby.")
    if sev_counts["CRITICAL"] > 5:
        briefing_lines.append(f"  ⚠  High critical event count ({sev_counts['CRITICAL']}) — escalate to DCP.")
    if top_crimes:
        top_crime = top_crimes[0][0]
        briefing_lines.append(f"  →  Primary crime pattern: {top_crime}. Focus patrol accordingly.")
    if total_officers < 30:
        briefing_lines.append("  →  Officer count below threshold. Request reinforcements from adjacent division.")

    briefing_lines.append("")
    briefing_lines.append("END OF MARVEL SHIFT BRIEFING — RESTRICTED TO AUTHORIZED PERSONNEL")

    return {
        "shift": shift,
        "generated_at": now.isoformat(),
        "briefing_text": "\n".join(briefing_lines),
        "summary": {
            "total_24h":       len(events_24h),
            "total_6h":        len(events_6h),
            "critical_alerts": len(critical_alerts),
            "warning_alerts":  len(warning_alerts),
            "rising_zones":    len(rising_zones),
            "falling_zones":   len(falling_zones),
            "top_zone":        zone_scores_sorted[0].zone_name if zone_scores_sorted else "N/A",
            "top_zone_risk":   round(zone_scores_sorted[0].risk_score, 1) if zone_scores_sorted else 0.0,
            "top_crime":       top_crimes[0][0] if top_crimes else "N/A",
            "officers_deployed": total_officers,
        },
    }

