from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List
from pydantic import BaseModel
from db.database import SessionLocal
from db.models import CrimeEvent, ZoneRiskScore

router = APIRouter(prefix="/api/heatmap", tags=["Heatmap"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.get("")
def heatmap(
    severity: Optional[str] = None,
    zone_id: Optional[str] = None,
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db)
):
    q = db.query(CrimeEvent).filter(CrimeEvent.zone_lat.isnot(None))
    if severity: q = q.filter(CrimeEvent.severity == severity.upper())
    if zone_id:  q = q.filter(CrimeEvent.zone_id == zone_id)
    crimes = q.limit(limit).all()
    weight_map = {"HIGH": 3.0, "MEDIUM": 2.0, "LOW": 1.0}
    points = [{"lat": c.zone_lat, "lon": c.zone_lon,
               "weight": weight_map.get(c.severity, 1.0),
               "zone_id": c.zone_id, "crime_type": c.crime_types}
              for c in crimes if c.zone_lat and c.zone_lon]
    return {"points": points, "total_points": len(points)}

@router.get("/zones-summary")
def zones_summary(db: Session = Depends(get_db)):
    rows = (db.query(CrimeEvent.zone_id, CrimeEvent.zone,
                     func.count(CrimeEvent.id).label("crime_count"),
                     func.avg(CrimeEvent.zone_lat).label("lat"),
                     func.avg(CrimeEvent.zone_lon).label("lon"))
            .group_by(CrimeEvent.zone_id, CrimeEvent.zone).all())
    return [{"zone_id": r[0], "zone": r[1], "crime_count": r[2],
             "lat": round(r[3],6), "lon": round(r[4],6),
             "risk_level": "HIGH" if r[2]>200 else "MEDIUM" if r[2]>100 else "LOW"}
            for r in rows]
