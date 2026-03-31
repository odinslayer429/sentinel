import json, logging, numpy as np
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from db.database import get_db
from db.models import CrimeEvent, ZoneRiskScore
from services.zone_graph import ZONES

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/velocity", tags=["Velocity"])
CURRENT_DAYS = 5

def get_velocity_data(db): return []

@router.get("")
def velocity_snapshot(db: Session = Depends(get_db)):
    anchor = db.execute(text("SELECT MAX(ingested_at) FROM crime_events")).scalar()
    if not anchor:
        return []
    anchor_dt     = datetime.fromisoformat(anchor)
    current_start = (anchor_dt - timedelta(days=CURRENT_DAYS)).isoformat()
    baseline_start= (anchor_dt - timedelta(days=30)).isoformat()
    baseline_end  = current_start
    mid           = (anchor_dt - timedelta(days=CURRENT_DAYS) + timedelta(days=CURRENT_DAYS//2)).isoformat()

    cur_rows = db.execute(text(
        "SELECT zone_id, COUNT(*) as cnt FROM crime_events "
        "WHERE ingested_at >= :cs AND ingested_at <= :a GROUP BY zone_id"
    ), {"cs": current_start, "a": anchor}).fetchall()
    cur_map = {r[0]: r[1] for r in cur_rows}

    db_zone_ids = [r[0] for r in db.execute(text(
        "SELECT DISTINCT zone_id FROM crime_events WHERE zone_id IS NOT NULL ORDER BY zone_id"
    )).fetchall()]

    bl_rows = db.execute(text(
        "SELECT zone_id, strftime('%Y-%m-%dT%H:00:00', ingested_at) as hkey, COUNT(*) as cnt "
        "FROM crime_events WHERE ingested_at >= :bs AND ingested_at < :be GROUP BY zone_id, hkey"
    ), {"bs": baseline_start, "be": baseline_end}).fetchall()
    bl_hourly = {}
    for zid, hkey, cnt in bl_rows:
        bl_hourly.setdefault(zid, []).append(cnt)

    f_rows = db.execute(text(
        "SELECT zone_id, COUNT(*) FROM crime_events WHERE ingested_at >= :cs AND ingested_at < :mid GROUP BY zone_id"
    ), {"cs": current_start, "mid": mid}).fetchall()
    s_rows = db.execute(text(
        "SELECT zone_id, COUNT(*) FROM crime_events WHERE ingested_at >= :mid AND ingested_at <= :a GROUP BY zone_id"
    ), {"mid": mid, "a": anchor}).fetchall()
    map_first  = {r[0]: r[1] for r in f_rows}
    map_second = {r[0]: r[1] for r in s_rows}

    cr_rows = db.execute(text(
        "SELECT zone_id, crime_types FROM crime_events WHERE ingested_at >= :cs"
    ), {"cs": current_start}).fetchall()
    dom_map = {}
    for zid, ctypes in cr_rows:
        try:
            for ct in json.loads(ctypes or "[]"):
                dom_map.setdefault(zid, {})
                dom_map[zid][ct] = dom_map[zid].get(ct, 0) + 1
        except: pass
    dominant = {z: max(v, key=v.get) for z, v in dom_map.items() if v}

    counts_arr = np.array([float(cur_map.get(z, 0)) for z in db_zone_ids])
    pop_mean = float(np.mean(counts_arr))
    pop_std  = float(np.std(counts_arr))
    max_cnt  = float(max(cur_map.values())) if cur_map else 1.0

    print(f"[VELOCITY] anchor={anchor} zones={len(db_zone_ids)} cur_map_total={sum(cur_map.values())}")

    results = []
    for zid in db_zone_ids:
        zone_info   = ZONES.get(zid, {})
        current_cnt = float(cur_map.get(zid, 0))
        bl_buckets  = bl_hourly.get(zid, [])

        if len(bl_buckets) >= 3:
            arr  = np.array(bl_buckets, dtype=float)
            mean = float(np.mean(arr)); std = float(np.std(arr))
            z    = round((current_cnt - mean) / std, 3) if std > 1e-9 else round((current_cnt - mean) / max(mean * 0.5, 0.5), 3)
            method = "timeseries"
        else:
            z      = round((current_cnt - pop_mean) / pop_std, 3) if pop_std > 1e-9 else 0.0
            method = "cross_zone"

        c1, c2 = map_first.get(zid, 0), map_second.get(zid, 0)
        trend  = "stable" if (c1 == 0 and c2 == 0) else ("rising" if (c1 == 0 or c2 > c1 * 1.25) else ("falling" if c2 < c1 * 0.75 else "stable"))
        level  = "CRITICAL" if z >= 2 else "WARNING" if z >= 1 else "ELEVATED" if z >= 0.5 else "NORMAL"

        risk_row   = db.query(ZoneRiskScore).filter_by(zone_id=zid).first()
        risk_score = risk_row.risk_score if (risk_row and risk_row.risk_score > 0) else round(min(current_cnt / max_cnt, 1.0), 3)

        results.append({
            "zone_id": zid, "zone_name": zone_info.get("name", zid),
            "lat": zone_info.get("lat"), "lon": zone_info.get("lon"),
            "current_1h": int(current_cnt),
            "mean_1h": round(float(np.mean(bl_buckets)) if bl_buckets else pop_mean, 2),
            "std_1h":  round(float(np.std(bl_buckets))  if bl_buckets else pop_std,  2),
            "z_score": z, "anomaly_level": level, "dominant_crime": dominant.get(zid),
            "risk_score": round(risk_score, 3), "trend": trend,
            "event_count_5d": int(current_cnt), "baseline_hours": len(bl_buckets),
            "zscore_method": method, "anchor": anchor,
        })

    results.sort(key=lambda x: ({"CRITICAL":3,"WARNING":2,"ELEVATED":1,"NORMAL":0}.get(x["anomaly_level"], 0), x["z_score"]), reverse=True)
    return results

@router.get("/{zone_id}")
def zone_velocity(zone_id: str, db: Session = Depends(get_db)):
    zid   = zone_id.upper()
    since = (datetime.utcnow() - timedelta(days=CURRENT_DAYS)).isoformat()
    rows  = db.execute(text(
        "SELECT strftime('%Y-%m-%dT%H:00:00', ingested_at), COUNT(*), "
        "SUM(CASE WHEN severity='CRITICAL' THEN 1 ELSE 0 END), "
        "SUM(CASE WHEN severity='WARNING' THEN 1 ELSE 0 END) "
        "FROM crime_events WHERE zone_id=:zid AND ingested_at>=:since GROUP BY 1 ORDER BY 1"
    ), {"zid": zid, "since": since}).fetchall()
    return {"zone_id": zid, "timeline": [{"hour": r[0], "count": r[1], "critical": r[2], "warning": r[3]} for r in rows]}
