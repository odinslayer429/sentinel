from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta

from database import get_db
from models import Crime, Zone

router = APIRouter(tags=["Stats & Alerts"])


# ── /api/stats ────────────────────────────────────────────────────────────────

class StatsResponse(BaseModel):
    total_crimes: int
    crimes_today: int
    crimes_this_week: int
    crimes_this_month: int
    open_cases: int
    closed_cases: int
    high_severity_count: int
    active_zones: int
    top_crime_type: str
    top_zone: str
    resolution_rate: float   # percentage

@router.get("/api/stats", response_model=StatsResponse)
def get_stats(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    today     = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago  = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    total      = db.query(Crime).count()
    today_c    = db.query(Crime).filter(Crime.timestamp >= today).count()
    week_c     = db.query(Crime).filter(Crime.timestamp >= week_ago).count()
    month_c    = db.query(Crime).filter(Crime.timestamp >= month_ago).count()
    open_c     = db.query(Crime).filter(Crime.status.in_(["OPEN", "UNDER_INVESTIGATION"])).count()
    closed_c   = db.query(Crime).filter(Crime.status == "CLOSED").count()
    high_sev   = db.query(Crime).filter(Crime.severity >= 7).count()
    zones_act  = db.query(func.count(func.distinct(Crime.zone_id))).scalar() or 0

    top_crime_row = (db.query(Crime.crime_type, func.count(Crime.id).label("n"))
                     .group_by(Crime.crime_type).order_by(desc("n")).first())
    top_zone_row  = (db.query(Crime.zone_id, func.count(Crime.id).label("n"))
                     .group_by(Crime.zone_id).order_by(desc("n")).first())

    resolution_rate = round((closed_c / total * 100), 1) if total > 0 else 0.0

    return StatsResponse(
        total_crimes=total,
        crimes_today=today_c,
        crimes_this_week=week_c,
        crimes_this_month=month_c,
        open_cases=open_c,
        closed_cases=closed_c,
        high_severity_count=high_sev,
        active_zones=zones_act,
        top_crime_type=top_crime_row[0] if top_crime_row else "N/A",
        top_zone=top_zone_row[0] if top_zone_row else "N/A",
        resolution_rate=resolution_rate,
    )


# ── /api/alerts ───────────────────────────────────────────────────────────────

class Alert(BaseModel):
    id: int
    zone_id: str
    crime_type: str
    severity: int
    message: str
    timestamp: datetime
    status: str

class AlertsResponse(BaseModel):
    alerts: List[Alert]
    total: int
    critical_count: int

@router.get("/api/alerts", response_model=AlertsResponse)
def get_alerts(db: Session = Depends(get_db)):
    # Alerts = recent open high-severity crimes (sev >= 7)
    crimes = (db.query(Crime)
               .filter(Crime.severity >= 7, Crime.status.in_(["OPEN", "UNDER_INVESTIGATION"]))
               .order_by(desc(Crime.timestamp))
               .limit(50)
               .all())

    alerts = [
        Alert(
            id=c.id,
            zone_id=c.zone_id,
            crime_type=c.crime_type,
            severity=c.severity,
            message=f"HIGH ALERT [{c.ipc_section}]: {c.crime_type} in {c.zone_id}"
                    + (f" — {c.description[:80]}" if c.description else ""),
            timestamp=c.timestamp,
            status=c.status,
        )
        for c in crimes
    ]

    return AlertsResponse(
        alerts=alerts,
        total=len(alerts),
        critical_count=sum(1 for a in alerts if a.severity >= 9),
    )
