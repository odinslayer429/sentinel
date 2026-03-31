"""
Hawkes Process for crime hotspot forecasting.
Uses a simplified Hawkes intensity model: λ(t) = μ + Σ α·exp(-β·(t-tᵢ))
Trained on historical timestamps per zone from the DB.
"""
import numpy as np
from datetime import datetime, timedelta
from collections import defaultdict
from typing import List, Dict


# Hawkes parameters (fitted heuristically on crime data patterns)
ALPHA = 0.3   # excitation magnitude
BETA  = 1.5   # decay rate (per hour)
MU_BASE = 0.05  # baseline intensity


def compute_hawkes_intensity(
    event_times_hours: List[float],
    query_time_hour: float
) -> float:
    """
    Compute Hawkes intensity at query_time given past events.
    event_times_hours: list of past event times (in hours from epoch)
    query_time_hour: time to evaluate intensity at
    """
    base = MU_BASE
    excitation = sum(
        ALPHA * np.exp(-BETA * (query_time_hour - t))
        for t in event_times_hours
        if t < query_time_hour
    )
    return base + excitation


def forecast_zone_intensity(
    event_timestamps: List[datetime],
    forecast_hours: int = 6
) -> List[Dict]:
    """
    Given a list of past crime timestamps for a zone,
    forecast intensity for the next `forecast_hours` hours.
    Returns list of {hour_offset, intensity, risk_level}.
    """
    now = datetime.utcnow()
    # Convert timestamps to hours since 24h ago (rolling window)
    cutoff = now - timedelta(hours=48)
    recent = [t for t in event_timestamps if t >= cutoff]
    
    # Hours from now-48h
    base_hour = cutoff.timestamp() / 3600
    event_hours = [(t.timestamp() / 3600) - base_hour for t in recent]
    current_hour = (now.timestamp() / 3600) - base_hour

    forecasts = []
    for h in range(forecast_hours + 1):
        future_hour = current_hour + h
        intensity = compute_hawkes_intensity(event_hours, future_hour)
        
        # Scale to 0-1 and classify
        scaled = min(intensity / 2.0, 1.0)  # cap at 2.0 raw intensity
        if scaled > 0.7:
            risk = "CRITICAL"
        elif scaled > 0.45:
            risk = "HIGH"
        elif scaled > 0.2:
            risk = "MEDIUM"
        else:
            risk = "LOW"
        
        forecasts.append({
            "hour_offset": h,
            "timestamp": (now + timedelta(hours=h)).isoformat(),
            "intensity": round(intensity, 4),
            "intensity_scaled": round(scaled, 3),
            "risk_level": risk,
        })
    
    return forecasts


def anomaly_zscore(zone_counts: Dict[str, List[int]]) -> Dict[str, Dict]:
    """
    Z-score anomaly detection.
    zone_counts: {zone_id: [daily_crime_counts_last_30_days]}
    Returns zones with z-score > 2 as anomalies.
    """
    results = {}
    for zone_id, counts in zone_counts.items():
        if len(counts) < 3:
            continue
        arr = np.array(counts, dtype=float)
        mean = arr.mean()
        std  = arr.std()
        if std == 0:
            continue
        latest = arr[-1]
        z = (latest - mean) / std
        results[zone_id] = {
            "z_score":    round(float(z), 2),
            "mean":       round(float(mean), 1),
            "std":        round(float(std), 1),
            "latest":     int(latest),
            "is_anomaly": bool(z > 2.0),
            "severity":   "CRITICAL" if z > 3 else "HIGH" if z > 2 else "NORMAL",
        }
    return results
