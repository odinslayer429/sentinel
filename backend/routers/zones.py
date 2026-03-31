import json
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from datetime import datetime, timedelta
from db.database import SessionLocal
from db.models import ZoneRiskScore, CrimeEvent
from services.zone_graph import ZONES, get_neighbors, zone_ids

router = APIRouter(prefix="/api", tags=["zones"])

class PatrolRequest(BaseModel):
    total_officers: int = 60
    shift: Optional[str] = None

def _compute_risk_from_events(db, zone_id: str) -> float:
    """Compute risk score from recent crime events when Hawkes hasn't run."""
    now = datetime.utcnow()
    c24 = db.query(func.count(CrimeEvent.id)).filter(
        CrimeEvent.zone_id == zone_id,
        CrimeEvent.ingested_at >= now - timedelta(hours=24)
    ).scalar() or 0
    c7d = db.query(func.count(CrimeEvent.id)).filter(
        CrimeEvent.zone_id == zone_id,
        CrimeEvent.ingested_at >= now - timedelta(days=7)
    ).scalar() or 0
    severity_score = db.query(func.count(CrimeEvent.id)).filter(
        CrimeEvent.zone_id == zone_id,
        CrimeEvent.severity.in_(["CRITICAL", "HIGH"]),
        CrimeEvent.ingested_at >= now - timedelta(days=7)
    ).scalar() or 0
    raw = (c24 * 0.5) + (c7d * 0.03) + (severity_score * 0.1)
    return round(min(raw / 10.0, 1.0), 3)

def _serialise_zone_score(row: ZoneRiskScore) -> dict:
    return {
        "zone_id": row.zone_id,
        "zone_name": row.zone_name,
        "short": ZONES.get(row.zone_id, {}).get("short", row.zone_id),
        "lat": ZONES.get(row.zone_id, {}).get("lat"),
        "lon": ZONES.get(row.zone_id, {}).get("lon"),
        "risk_score": row.risk_score,
        "hawkes_intensity": row.hawkes_intensity,
        "trend": row.trend,
        "dominant_crime": row.dominant_crime_type,
        "event_count_1h": row.event_count_1h,
        "event_count_6h": row.event_count_6h,
        "event_count_24h": row.event_count_24h,
        "weather_multiplier": row.weather_multiplier,
        "explainability": json.loads(row.explainability_json or "[]"),
        "computed_at": row.computed_at.isoformat() if row.computed_at else None,
    }

def _zone_with_computed_risk(db, zone_id: str) -> dict:
    z = ZONES.get(zone_id, {})
    risk = _compute_risk_from_events(db, zone_id)
    return {
        "zone_id": zone_id,
        "zone_name": z.get("name", zone_id),
        "short": z.get("short", zone_id),
        "lat": z.get("lat"),
        "lon": z.get("lon"),
        "risk_score": risk,
        "hawkes_intensity": 0.0,
        "trend": "rising" if risk > 0.6 else "stable",
        "dominant_crime": None,
        "event_count_1h": 0,
        "event_count_6h": 0,
        "event_count_24h": 0,
        "weather_multiplier": 1.0,
        "explainability": [],
        "computed_at": None,
    }

@router.get("/zones")
async def list_zones():
    db = SessionLocal()
    try:
        rows = db.query(ZoneRiskScore).all()
        score_map = {r.zone_id: _serialise_zone_score(r) for r in rows}
        result = []
        for zid in zone_ids():
            if zid in score_map and score_map[zid]["risk_score"] > 0:
                result.append(score_map[zid])
            else:
                result.append(_zone_with_computed_risk(db, zid))
        return result
    finally:
        db.close()

@router.get("/zones/intelligence")
async def list_zones_intelligence():
    return await list_zones()

@router.get("/zones/{zone_id}")
async def get_zone(zone_id: str):
    zone_id = zone_id.upper()
    if zone_id not in ZONES:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found.")
    db = SessionLocal()
    try:
        row = db.query(ZoneRiskScore).filter_by(zone_id=zone_id).first()
        data = _serialise_zone_score(row) if (row and row.risk_score > 0) else _zone_with_computed_risk(db, zone_id)
        neighbours = get_neighbors(zone_id)
        data["neighbours"] = [
            _serialise_zone_score(nb_row) if (nb_row := db.query(ZoneRiskScore).filter_by(zone_id=nb).first()) else _zone_with_computed_risk(db, nb)
            for nb in neighbours
        ]
        return data
    finally:
        db.close()

@router.post("/patrol/optimise")
async def optimise_patrol(payload: PatrolRequest):
    from services.patrol_optimizer import run_patrol_optimization
    if payload.total_officers < len(zone_ids()):
        raise HTTPException(status_code=422, detail=f"total_officers must be >= {len(zone_ids())}")
    return await run_patrol_optimization(total_officers=payload.total_officers, shift=payload.shift)

@router.get("/patrol/latest")
async def latest_patrol(shift: Optional[str] = Query(default=None)):
    from services.patrol_optimizer import get_latest_deployment
    rows = get_latest_deployment(shift=shift)
    if not rows:
        return {"message": "No deployment found.", "allocation": []}
    return {"allocation": rows}

@router.get("/weather")
async def get_weather():
    from services.weather_service import get_weather_features
    features = await get_weather_features()
    return features.to_dict()
