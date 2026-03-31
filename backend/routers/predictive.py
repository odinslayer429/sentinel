"""
predictive.py
─────────────
Live ML endpoints. Two real models blended:
  1. Hawkes Process (hawkes_engine.py) — spatio-temporal self-exciting intensity
  2. Gradient Boosting Classifier (crime_classifier.py) — crime category + risk
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel, Field
from datetime import datetime, timezone
from typing import Optional

from services.crime_classifier import crime_classifier, ZONE_IDS, ZONE_RISK
from services.hawkes_engine import _state as _hawkes_state, _compute_intensity
from services.auth import get_current_user

router = APIRouter(prefix="/api/predictive", tags=["Predictive Policing"])


# ── Schemas ─────────────────────────────────────────────────────────────────────

class ClassifyRequest(BaseModel):
    zone_id: str = Field(..., example="Z02")
    hour:    Optional[int] = Field(None, ge=0, le=23)
    dow:     Optional[int] = Field(None, ge=0, le=6, description="0=Mon 6=Sun")
    month:   Optional[int] = Field(None, ge=1, le=12)
    day:     Optional[int] = Field(None, ge=1, le=31)
    prev_7d_crimes: int    = Field(10, ge=0)

class RiskRequest(BaseModel):
    lat: float
    lon: float
    timestamp: Optional[datetime] = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


# ── Endpoints ────────────────────────────────────────────────────────────────────

@router.post("/classify")
async def classify_crime(req: ClassifyRequest, user=Depends(get_current_user)):
    """
    GBM: predict most likely crime category for a zone at a given time.
    Includes festival and live weather context automatically.
    """
    now   = datetime.now(timezone.utc)
    hour  = req.hour  if req.hour  is not None else now.hour
    dow   = req.dow   if req.dow   is not None else now.weekday()
    month = req.month if req.month is not None else now.month
    day   = req.day   if req.day   is not None else now.day

    return crime_classifier.predict_with_weather(
        zone_id=req.zone_id, hour=hour, dow=dow,
        month=month, day=day, prev_7d=req.prev_7d_crimes,
    )


@router.get("/forecast/{zone_id}")
async def zone_forecast(
    zone_id: str,
    hours: int = Query(24, ge=1, le=72),
    user=Depends(get_current_user),
):
    """GBM 24-72h hourly forecast: crime type + probability + weather context."""
    if zone_id not in ZONE_IDS:
        raise HTTPException(404, f"Zone {zone_id} not found")
    return {
        "zone_id":     zone_id,
        "hours_ahead": hours,
        "forecast":    crime_classifier.zone_forecast(zone_id, hours),
    }


@router.post("/risk-score")
async def get_risk_score(req: RiskRequest, user=Depends(get_current_user)):
    """
    Hawkes 60% + GBM 40% blended risk score for any lat/lon.
    """
    import math
    from services.zone_graph import ZONES

    def _nearest_zone(lat: float, lon: float) -> str:
        best, best_d = "Z01", float("inf")
        for zid, zdata in ZONES.items():
            d = math.hypot(lat - zdata["lat"], lon - zdata["lon"])
            if d < best_d:
                best_d = d
                best = zid
        return best

    ts      = req.timestamp or datetime.now(timezone.utc)
    zone_id = _nearest_zone(req.lat, req.lon)

    # — Hawkes intensity —
    try:
        raw_intensity = _compute_intensity(zone_id, ts.timestamp(), weather_mult=1.0)
        hawkes_score  = round(min(raw_intensity / 10.0, 1.0), 3)
    except Exception:
        hawkes_score = None

    # — GBM prediction with live weather —
    rf = crime_classifier.predict_with_weather(
        zone_id=zone_id,
        hour=ts.hour,
        dow=ts.weekday(),
        month=ts.month,
        day=ts.day,
    )

    # Blend: 60% Hawkes (recency-aware) + 40% GBM (pattern-aware)
    if hawkes_score is not None:
        blended = round(0.6 * hawkes_score + 0.4 * rf["risk_score"], 3)
    else:
        blended = round(rf["risk_score"], 3)

    return {
        "zone_id":            zone_id,
        "lat":                req.lat,
        "lon":                req.lon,
        "blended_score":      blended,
        "hawkes_score":       hawkes_score,
        "gbm_score":          rf["risk_score"],
        "predicted_category": rf["predicted_category"],
        "confidence":         rf["confidence"],
        "top_3":              rf["top_3"],
        "is_festival":        rf["is_festival"],
        "rain_bucket":        rf["rain_bucket"],
        "heat_bucket":        rf["heat_bucket"],
        "model":              "Hawkes+GBM-Blend",
    }


@router.get("/zone-risk-summary")
async def all_zone_risks(user=Depends(get_current_user)):
    """GBM risk snapshot for all 24 zones right now. Feeds heatmap."""
    now = datetime.now(timezone.utc)
    return {
        "timestamp": now.isoformat(),
        "zones": [
            {
                "zone_id": zid,
                **crime_classifier.predict_with_weather(
                    zone_id=zid, hour=now.hour, dow=now.weekday(),
                    month=now.month, day=now.day,
                ),
            }
            for zid in ZONE_IDS
        ],
    }


@router.get("/heatmap")
async def get_heatmap(resolution: int = 7, user=Depends(get_current_user)):
    """H3 hexgrid scored by live GBM model (not random)."""
    import h3, math
    from services.zone_graph import ZONES

    def _nearest_zone(lat, lon):
        best, best_d = "Z01", float("inf")
        for zid, zdata in ZONES.items():
            d = math.hypot(lat - zdata["lat"], lon - zdata["lon"])
            if d < best_d:
                best_d = d
                best = zid
        return best

    poly     = h3.LatLngPoly([
        (18.89, 72.77), (18.89, 72.98),
        (19.30, 72.98), (19.30, 72.77), (18.89, 72.77),
    ])
    hexagons = list(h3.polygon_to_cells(poly, resolution))[:500]
    now      = datetime.now(timezone.utc)

    grid_data = []
    for h_idx in hexagons:
        clat, clon = h3.cell_to_latlng(h_idx)
        zid = _nearest_zone(clat, clon)
        rf  = crime_classifier.predict_with_weather(
            zone_id=zid, hour=now.hour, dow=now.weekday(),
            month=now.month, day=now.day,
        )
        grid_data.append({"h3_index": h_idx, "score": rf["risk_score"]})

    return {"resolution": resolution, "data": grid_data}