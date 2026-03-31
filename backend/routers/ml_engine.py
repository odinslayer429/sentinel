"""
ML Engine Router — Hawkes Process forecasting + Anomaly Detection
Endpoints:
  GET  /api/ml/hawkes-forecast   — 6h intensity forecast per zone
  GET  /api/ml/anomalies         — Z-score anomaly zones
  GET  /api/ml/hotspot-zones     — Top predicted hotspots for next 3h
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from pydantic import BaseModel
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from database import get_db
from models import Crime
from ml.hawkes import forecast_zone_intensity, anomaly_zscore

router = APIRouter(prefix="/api/ml", tags=["ML Engine"])


# ── Response models ───────────────────────────────────────────

class ZoneForecast(BaseModel):
    zone_id: str
    crime_count_24h: int
    forecasts: List[Dict]
    peak_risk: str
    peak_hour_offset: int

class AnomalyZone(BaseModel):
    zone_id: str
    z_score: float
    latest_count: int
    mean_daily: float
    severity: str
    is_anomaly: bool

class HotspotZone(BaseModel):
    zone_id: str
    predicted_intensity: float
    risk_level: str
    crimes_last_24h: int
    top_crime_type: str


# ── Routes ────────────────────────────────────────────────────

@router.get("/hawkes-forecast", response_model=List[ZoneForecast])
def hawkes_forecast(
    top_n: int = Query(10, ge=1, le=30),
    db: Session = Depends(get_db)
):
    """Run Hawkes Process on last 48h data for top N active zones."""
    cutoff = datetime.utcnow() - timedelta(hours=48)

    # Get top zones by recent activity
    top_zones = (
        db.query(Crime.zone_id, func.count(Crime.id).label("cnt"))
        .filter(Crime.timestamp >= cutoff)
        .group_by(Crime.zone_id)
        .order_by(func.count(Crime.id).desc())
        .limit(top_n)
        .all()
    )

    results = []
    for zone_id, cnt in top_zones:
        # Get event timestamps for this zone
        timestamps = (
            db.query(Crime.timestamp)
            .filter(Crime.zone_id == zone_id, Crime.timestamp >= cutoff)
            .all()
        )
        ts_list = [r[0] for r in timestamps if r[0]]

        forecasts = forecast_zone_intensity(ts_list, forecast_hours=6)
        peak = max(forecasts, key=lambda x: x["intensity_scaled"])

        results.append(ZoneForecast(
            zone_id=zone_id,
            crime_count_24h=cnt,
            forecasts=forecasts,
            peak_risk=peak["risk_level"],
            peak_hour_offset=peak["hour_offset"],
        ))

    return results


@router.get("/anomalies", response_model=List[AnomalyZone])
def detect_anomalies(
    days: int = Query(30, ge=7, le=90),
    db: Session = Depends(get_db)
):
    """Z-score anomaly detection across all zones for last N days."""
    cutoff = datetime.utcnow() - timedelta(days=days)

    # Get daily crime counts per zone
    rows = db.execute(text("""
        SELECT zone_id,
               date(timestamp) as crime_date,
               COUNT(*) as cnt
        FROM crimes
        WHERE timestamp >= :cutoff
        GROUP BY zone_id, date(timestamp)
        ORDER BY zone_id, crime_date
    """), {"cutoff": cutoff}).fetchall()

    # Build zone → [daily counts] dict
    zone_daily: Dict[str, List[int]] = {}
    for zone_id, _, cnt in rows:
        zone_daily.setdefault(zone_id, []).append(int(cnt))

    anomalies = anomaly_zscore(zone_daily)

    return [
        AnomalyZone(
            zone_id=z,
            z_score=v["z_score"],
            latest_count=v["latest"],
            mean_daily=v["mean"],
            severity=v["severity"],
            is_anomaly=v["is_anomaly"],
        )
        for z, v in sorted(anomalies.items(), key=lambda x: -abs(x[1]["z_score"]))
        if v["is_anomaly"]
    ]


@router.get("/hotspot-zones", response_model=List[HotspotZone])
def hotspot_zones(
    hours_ahead: int = Query(3, ge=1, le=12),
    top_n: int = Query(8, ge=1, le=20),
    db: Session = Depends(get_db)
):
    """Predicted hotspot zones for the next N hours using Hawkes intensity."""
    cutoff = datetime.utcnow() - timedelta(hours=48)

    top_zones = (
        db.query(Crime.zone_id, func.count(Crime.id).label("cnt"))
        .filter(Crime.timestamp >= cutoff)
        .group_by(Crime.zone_id)
        .order_by(func.count(Crime.id).desc())
        .limit(top_n * 2)
        .all()
    )

    hotspots = []
    for zone_id, cnt in top_zones:
        timestamps = (
            db.query(Crime.timestamp)
            .filter(Crime.zone_id == zone_id, Crime.timestamp >= cutoff)
            .all()
        )
        ts_list = [r[0] for r in timestamps if r[0]]
        forecasts = forecast_zone_intensity(ts_list, forecast_hours=hours_ahead)

        # Take max intensity in the forecast window
        target = max(forecasts[1:], key=lambda x: x["intensity_scaled"])

        # Top crime type
        top_crime_row = (
            db.query(Crime.crime_type, func.count(Crime.id).label("n"))
            .filter(Crime.zone_id == zone_id, Crime.timestamp >= cutoff)
            .group_by(Crime.crime_type)
            .order_by(func.count(Crime.id).desc())
            .first()
        )

        hotspots.append(HotspotZone(
            zone_id=zone_id,
            predicted_intensity=target["intensity_scaled"],
            risk_level=target["risk_level"],
            crimes_last_24h=cnt,
            top_crime_type=top_crime_row[0] if top_crime_row else "Unknown",
        ))

    # Sort by predicted intensity
    hotspots.sort(key=lambda x: -x.predicted_intensity)
    return hotspots[:top_n]


@router.get("/model-info")
def model_info():
    """Return Hawkes model parameters and methodology."""
    return {
        "model": "Hawkes Self-Exciting Point Process",
        "parameters": {
            "alpha": 0.3,
            "beta": 1.5,
            "mu_base": 0.05,
        },
        "description": (
            "Temporal point process where each crime event excites "
            "future crime probability. Intensity decays exponentially "
            "with parameter β=1.5/hour."
        ),
        "anomaly_method": "Z-score (threshold: 2σ above 30-day baseline)",
        "forecast_window": "6 hours ahead",
        "data_window": "48 hours rolling",
    }
