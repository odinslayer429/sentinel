"""
crime_velocity.py
─────────────────
Crime velocity and anomaly detection module.

Two complementary detection methods run together every cycle:

1. Z-Score Velocity Detector
   ─────────────────────────
   For each zone, compute the rolling hourly crime rate over the
   last 30 days and compare the current 1-hour count against that
   baseline. A Z-score > 2.5 triggers WARNING, > 3.5 triggers CRITICAL.

   This catches absolute spikes — "Dharavi just had 8 crimes in
   one hour when the average is 1.2".

2. Isolation Forest (Multivariate)
   ─────────────────────────────────
   Trains on a feature vector per zone per hour:
     [hour_of_day, day_of_week, event_count, severity_score, crime_type_entropy]
   Flags statistically anomalous combinations that Z-score alone
   misses — e.g. a zone with normal count but all CRITICAL severity,
   or an unusual crime type mix at an unusual hour.

   Model is re-fitted on 30 days of hourly aggregates every 6 hours.
   Stored in memory only (no pickle) — refits in < 1 second.

No synthetic data. If insufficient history exists, both detectors
log a clear warning and return empty results.
"""

import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import numpy as np
from sklearn.ensemble import IsolationForest
from sqlalchemy.orm import Session

from db.database import SessionLocal
from db.models import Alert, CrimeEvent
from .zone_graph import ZONES, zone_ids
from .ws_manager import manager

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
_ZSCORE_WARNING  = 2.5
_ZSCORE_CRITICAL = 3.5
_BASELINE_DAYS   = 30
_MIN_HISTORY     = 48    # minimum hourly buckets needed before scoring
_IF_CONTAMINATION = 0.05 # IsolationForest: expected anomaly fraction
_REFIT_HRS       = 6

# Module-level IsolationForest — refitted periodically
_iso_forest: Optional[IsolationForest] = None
_last_refit: Optional[datetime] = None


# ─────────────────────────────────────────────────────────────────────────────
# Data aggregation
# ─────────────────────────────────────────────────────────────────────────────

def _severity_score(severity: str) -> float:
    return {"CRITICAL": 3.0, "WARNING": 2.0, "INFO": 1.0}.get(severity, 1.0)


def _build_hourly_buckets(
    events: List[CrimeEvent],
    zone_id: str,
) -> List[Dict]:
    """
    Aggregate events for a zone into hourly buckets.
    Returns list of dicts sorted ascending by hour_start.
    """
    buckets: Dict[datetime, Dict] = defaultdict(lambda: {
        "count": 0,
        "severity_sum": 0.0,
        "crime_type_counts": defaultdict(int),
    })

    for e in events:
        if e.zone_id != zone_id or not e.ingested_at:
            continue
        hour_start = e.ingested_at.replace(minute=0, second=0, microsecond=0)
        buckets[hour_start]["count"]        += 1
        buckets[hour_start]["severity_sum"] += _severity_score(e.severity)
        try:
            for ct in json.loads(e.crime_types or "[]"):
                buckets[hour_start]["crime_type_counts"][ct] += 1
        except Exception:
            pass

    result = []
    for hour_start in sorted(buckets.keys()):
        b = buckets[hour_start]
        counts = list(b["crime_type_counts"].values())
        total  = sum(counts) or 1
        # Shannon entropy of crime type distribution
        probs   = [c / total for c in counts]
        entropy = float(-sum(p * np.log2(p + 1e-9) for p in probs))
        result.append({
            "hour_start":    hour_start,
            "hour_of_day":   hour_start.hour,
            "day_of_week":   hour_start.weekday(),
            "count":         b["count"],
            "severity_score": round(b["severity_sum"] / max(b["count"], 1), 3),
            "entropy":       round(entropy, 4),
        })

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Z-Score velocity detector
# ─────────────────────────────────────────────────────────────────────────────

def _zscore_detect(
    buckets: List[Dict],
    zone_id: str,
) -> Optional[Dict]:
    """
    Compare the most recent complete hour against the rolling 30-day baseline.
    Returns an anomaly dict if Z-score exceeds threshold, else None.
    """
    if len(buckets) < _MIN_HISTORY:
        return None

    counts = np.array([b["count"] for b in buckets])

    # Exclude the last bucket (current hour — may be incomplete)
    baseline = counts[:-1]
    current  = counts[-1]

    mean = baseline.mean()
    std  = baseline.std()

    if std < 0.01:
        # Zero variance — all buckets are identical (very quiet zone)
        # Only flag if current count is meaningfully above mean
        if current > mean + 3:
            z = 999.0
        else:
            return None
    else:
        z = (current - mean) / std

    if z >= _ZSCORE_CRITICAL:
        level = "CRITICAL"
    elif z >= _ZSCORE_WARNING:
        level = "WARNING"
    else:
        return None

    return {
        "detector":   "zscore_velocity",
        "zone_id":    zone_id,
        "zone":       ZONES[zone_id]["name"],
        "severity":   level,
        "z_score":    round(float(z), 3),
        "current_count": int(current),
        "baseline_mean": round(float(mean), 2),
        "baseline_std":  round(float(std), 2),
        "message": (
            f"{ZONES[zone_id]['short']}: {int(current)} events in last hour "
            f"(baseline {mean:.1f} ± {std:.1f}, Z={z:.2f})"
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Isolation Forest anomaly detector
# ─────────────────────────────────────────────────────────────────────────────

def _build_feature_matrix(all_buckets: Dict[str, List[Dict]]) -> Tuple[np.ndarray, List[Tuple]]:
    """
    Flatten all zone hourly buckets into feature matrix for IsolationForest.
    Features: [hour_of_day, day_of_week, count, severity_score, entropy]
    Returns matrix and list of (zone_id, hour_start) labels.
    """
    rows   = []
    labels = []
    for zid, buckets in all_buckets.items():
        for b in buckets:
            rows.append([
                b["hour_of_day"],
                b["day_of_week"],
                b["count"],
                b["severity_score"],
                b["entropy"],
            ])
            labels.append((zid, b["hour_start"]))

    return np.array(rows, dtype=float), labels


def _refit_isolation_forest(X: np.ndarray):
    global _iso_forest, _last_refit
    if len(X) < 20:
        logger.warning("IsolationForest: only %d samples — skipping refit.", len(X))
        return
    _iso_forest = IsolationForest(
        n_estimators   = 150,
        contamination  = _IF_CONTAMINATION,
        random_state   = 42,
        n_jobs         = -1,
    )
    _iso_forest.fit(X)
    _last_refit = datetime.utcnow()
    logger.info("IsolationForest refitted on %d samples.", len(X))


def _iforest_detect(
    all_buckets: Dict[str, List[Dict]],
) -> List[Dict]:
    """
    Run IsolationForest on the most recent hour for each zone.
    Returns list of anomaly dicts for zones flagged as outliers.
    """
    global _iso_forest, _last_refit

    if not all_buckets:
        return []

    X, labels = _build_feature_matrix(all_buckets)
    if len(X) == 0:
        return []

    # Refit if due
    should_refit = (
        _iso_forest is None or
        _last_refit is None or
        (datetime.utcnow() - _last_refit).total_seconds() > _REFIT_HRS * 3600
    )
    if should_refit:
        _refit_isolation_forest(X)

    if _iso_forest is None:
        return []

    preds  = _iso_forest.predict(X)           # -1 = anomaly, 1 = normal
    scores = _iso_forest.score_samples(X)     # lower = more anomalous

    anomalies = []
    # Build index of most-recent bucket per zone
    latest_idx: Dict[str, int] = {}
    for idx, (zid, _) in enumerate(labels):
        latest_idx[zid] = idx  # last occurrence = most recent bucket

    for zid, idx in latest_idx.items():
        if preds[idx] == -1:
            anomaly_score = float(scores[idx])
            # Map score to severity: < -0.15 is CRITICAL, else WARNING
            severity = "CRITICAL" if anomaly_score < -0.15 else "WARNING"
            b = all_buckets[zid][-1]
            anomalies.append({
                "detector":      "isolation_forest",
                "zone_id":       zid,
                "zone":          ZONES[zid]["name"],
                "severity":      severity,
                "anomaly_score": round(anomaly_score, 4),
                "hour_of_day":   b["hour_of_day"],
                "count":         b["count"],
                "severity_score": b["severity_score"],
                "entropy":       b["entropy"],
                "message": (
                    f"{ZONES[zid]['short']}: multivariate anomaly detected "
                    f"(score={anomaly_score:.3f}, {b['count']} events, "
                    f"entropy={b['entropy']:.2f})"
                ),
            })

    return anomalies


# ─────────────────────────────────────────────────────────────────────────────
# DB + alert helpers
# ─────────────────────────────────────────────────────────────────────────────

def _load_events(db: Session) -> List[CrimeEvent]:
    since = datetime.utcnow() - timedelta(days=_BASELINE_DAYS)
    return (
        db.query(CrimeEvent)
        .filter(CrimeEvent.ingested_at >= since)
        .filter(CrimeEvent.zone_id.isnot(None))
        .order_by(CrimeEvent.ingested_at.asc())
        .all()
    )


async def _persist_and_push(anomaly: Dict, db: Session):
    """Save anomaly as Alert and push to WebSocket."""
    existing = (
        db.query(Alert)
        .filter(
            Alert.zone_id   == anomaly["zone_id"],
            Alert.severity  == anomaly["severity"],
            Alert.is_active == True,
            Alert.created_at >= datetime.utcnow() - timedelta(hours=1),
        )
        .first()
    )
    if existing:
        return  # already alerted for this zone in last hour

    alert = Alert(
        title    = f"[{anomaly['severity']}] Velocity spike — {anomaly['zone']}",
        message  = anomaly["message"],
        severity = anomaly["severity"],
        zone_id  = anomaly["zone_id"],
        zone     = anomaly["zone"],
    )
    db.add(alert)
    db.commit()

    await manager.push({
        "type":      "alert",
        "severity":  anomaly["severity"],
        "title":     alert.title,
        "zone_id":   anomaly["zone_id"],
        "zone":      anomaly["zone"],
        "detector":  anomaly["detector"],
        "message":   anomaly["message"],
        "timestamp": datetime.utcnow().isoformat(),
    })


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

async def run_velocity_cycle():
    """
    Called after every RSS ingestion + Hawkes cycle.
    Runs both detectors and persists alerts for any anomalies found.
    """
    db = SessionLocal()
    try:
        events = _load_events(db)

        if len(events) < 20:
            logger.warning(
                "Velocity: only %d events — detectors need more real data.", len(events)
            )
            return

        # Build hourly buckets per zone
        all_buckets: Dict[str, List[Dict]] = {}
        for zid in zone_ids():
            buckets = _build_hourly_buckets(events, zid)
            if buckets:
                all_buckets[zid] = buckets

        if not all_buckets:
            return

        anomalies: List[Dict] = []

        # 1. Z-score per zone
        for zid, buckets in all_buckets.items():
            result = _zscore_detect(buckets, zid)
            if result:
                anomalies.append(result)
                logger.warning("Z-score anomaly: %s", result["message"])

        # 2. Isolation Forest (multivariate, all zones together)
        if_anomalies = _iforest_detect(all_buckets)
        for a in if_anomalies:
            # Avoid duplicating an alert already raised by z-score for same zone
            already_flagged = any(
                x["zone_id"] == a["zone_id"] and x["severity"] == a["severity"]
                for x in anomalies
            )
            if not already_flagged:
                anomalies.append(a)
                logger.warning("IsolationForest anomaly: %s", a["message"])

        # 3. Persist and push
        for anomaly in anomalies:
            await _persist_and_push(anomaly, db)

        if anomalies:
            logger.info("Velocity cycle: %d anomalies detected.", len(anomalies))
        else:
            logger.debug("Velocity cycle: no anomalies.")

    except Exception as exc:
        logger.exception("Velocity cycle failed: %s", exc)
    finally:
        db.close()

