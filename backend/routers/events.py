from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime, timedelta
from db.database import SessionLocal
from db.models import CrimeEvent, ZoneRiskScore

router = APIRouter(prefix="/api/events", tags=["Crime Events"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class EventOut(BaseModel):
    id: int
    title: Optional[str]
    description: Optional[str]
    crime_types: Optional[str]
    zone_id: Optional[str]
    zone: Optional[str]
    zone_lat: Optional[float]
    zone_lon: Optional[float]
    severity: Optional[str]
    published_at: Optional[datetime]
    ingested_at: Optional[datetime]
    source: Optional[str]
    url: Optional[str]
    is_processed: Optional[bool]
    class Config:
        from_attributes = True

class SummaryOut(BaseModel):
    total_crimes: int
    high_severity: int
    medium_severity: int
    low_severity: int
    zones_active: int
    most_common_crime: str
    hottest_zone: str

@router.get("/summary", response_model=SummaryOut)
def summary(db: Session = Depends(get_db)):
    total    = db.query(CrimeEvent).count()
    high     = db.query(CrimeEvent).filter(CrimeEvent.severity == "HIGH").count()
    medium   = db.query(CrimeEvent).filter(CrimeEvent.severity == "MEDIUM").count()
    low      = db.query(CrimeEvent).filter(CrimeEvent.severity == "LOW").count()
    zones    = db.query(func.count(func.distinct(CrimeEvent.zone_id))).scalar()
    top_type = (db.query(CrimeEvent.crime_types, func.count(CrimeEvent.id).label("n"))
                .group_by(CrimeEvent.crime_types).order_by(desc("n")).first())
    top_zone = (db.query(CrimeEvent.zone, func.count(CrimeEvent.id).label("n"))
                .group_by(CrimeEvent.zone).order_by(desc("n")).first())
    return SummaryOut(
        total_crimes=total, high_severity=high,
        medium_severity=medium, low_severity=low,
        zones_active=zones or 0,
        most_common_crime=top_type[0] if top_type else "N/A",
        hottest_zone=top_zone[0] if top_zone else "N/A",
    )

@router.get("/recent", response_model=List[EventOut])
def recent(
    limit: int = Query(200, ge=1, le=500),
    hours: int = Query(3, ge=0, le=168),   # FIX: ge=0 so hours=0 is valid when `since` is provided
    since: Optional[datetime] = None,
    db: Session = Depends(get_db),
):
    """
    Return recent crime events.
    - `hours`  (default 3, min 0) — look back N hours from now.
    - `since`                     — explicit ISO-8601 datetime cutoff (overrides hours).
    - `limit`  (default 200)      — max rows returned.
    Falls back to last `limit` rows across all time if the time-window returns nothing.

    NOTE: Frontend poll loop passes hours=0 alongside `since`. hours=0 is now valid
    because `since` takes precedence when provided. ge changed from 1 → 0.
    """
    cutoff = since if since else (datetime.utcnow() - timedelta(hours=max(hours, 1)))
    q = (
        db.query(CrimeEvent)
        .filter(CrimeEvent.published_at >= cutoff)
        .order_by(desc(CrimeEvent.published_at))
        .limit(limit)
    )
    results = q.all()

    if not results:
        results = (
            db.query(CrimeEvent)
            .order_by(desc(CrimeEvent.published_at))
            .limit(limit)
            .all()
        )
    return results

@router.get("/by-type")
def by_type(db: Session = Depends(get_db)):
    r = (db.query(CrimeEvent.crime_types, func.count(CrimeEvent.id).label("count"))
         .group_by(CrimeEvent.crime_types).order_by(desc("count")).all())
    return [{"crime_type": x[0], "count": x[1]} for x in r]

@router.get("/by-zone")
def by_zone(db: Session = Depends(get_db)):
    r = (db.query(CrimeEvent.zone_id, CrimeEvent.zone, func.count(CrimeEvent.id).label("count"))
         .group_by(CrimeEvent.zone_id, CrimeEvent.zone).order_by(desc("count")).all())
    return [{"zone_id": x[0], "zone": x[1], "count": x[2]} for x in r]

@router.get("", response_model=List[EventOut])
def list_events(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    zone_id: Optional[str] = None,
    crime_type: Optional[str] = None,
    severity: Optional[str] = None,
    db: Session = Depends(get_db)
):
    q = db.query(CrimeEvent)
    if zone_id:    q = q.filter(CrimeEvent.zone_id == zone_id)
    if crime_type: q = q.filter(CrimeEvent.crime_types.contains(crime_type))
    if severity:   q = q.filter(CrimeEvent.severity == severity.upper())
    return q.order_by(desc(CrimeEvent.published_at)).offset((page-1)*per_page).limit(per_page).all()

@router.get("/{event_id}", response_model=EventOut)
def get_event(event_id: int, db: Session = Depends(get_db)):
    e = db.query(CrimeEvent).filter(CrimeEvent.id == event_id).first()
    if not e:
        raise HTTPException(404, f"Event {event_id} not found")
    return e
