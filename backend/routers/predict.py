"""
Prediction Router

GET  /api/predict              — predict hotspot risk for all zones (Neural Node panel)
GET  /api/predict/crime-type   — predict top-3 crime types for a specific zone+time
POST /api/predict              — legacy body-based hotspot prediction (kept for compatibility)

All inference uses the pre-trained crime_model.pkl + label_encoder.pkl.
NEVER retrains at request time.
"""
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel
from datetime import datetime
from ml.predict import predict_crime, get_model_info

router = APIRouter(prefix="/api/predict", tags=["Prediction"])

ZONE_NAMES = {
    "Z01": "Fort / Colaba",  "Z02": "Byculla / Dongri", "Z03": "Dadar / Worli",
    "Z04": "Bandra / Khar",  "Z05": "Andheri",           "Z06": "Borivali / Kandivali",
    "Z07": "Kurla / Ghatkopar", "Z08": "Mulund / Bhandup", "Z09": "Thane",
    "Z10": "Powai / Vikhroli",  "Z11": "Navi Mumbai",       "Z12": "Mira Road / Vasai",
}
URBAN_ZONES = {"Z01", "Z02", "Z03", "Z04", "Z07"}


@router.get("/model-info")
def model_info():
    """Return accuracy and feature metadata of the loaded model."""
    try:
        return get_model_info()
    except FileNotFoundError:
        raise HTTPException(503, detail="Model not trained yet. Run ml/train_from_db.py first.")


@router.get("/crime-type")
def crime_type_prediction(
    zone_id:     str = Query("Z07", description="Zone code e.g. Z07"),
    hour:        int = Query(...,    ge=0, le=23),
    day_of_week: int = Query(...,    ge=0, le=6,  description="0=Mon, 6=Sun"),
    month:       int = Query(...,    ge=1, le=12),
):
    """
    Returns top-3 predicted crime types with probabilities.
    This is the primary Neural Node endpoint.
    """
    try:
        return predict_crime(zone_id=zone_id, hour=hour, day_of_week=day_of_week, month=month)
    except FileNotFoundError:
        raise HTTPException(503, detail="Model not trained yet. Run ml/train_from_db.py first.")
    except Exception as exc:
        raise HTTPException(500, detail=str(exc))


@router.get("")
def hotspot_prediction(
    month:       int = Query(default_factory=lambda: datetime.utcnow().month, ge=1, le=12),
    day_of_week: int = Query(default_factory=lambda: datetime.utcnow().weekday(), ge=0, le=6),
    hour:        int = Query(default_factory=lambda: datetime.utcnow().hour, ge=0, le=23),
):
    """
    Predict hotspot risk for ALL zones for a given time context.
    Defaults to current time if not supplied — perfect for the dashboard.
    """
    now = datetime.utcnow()
    month       = month       or now.month
    day_of_week = day_of_week if day_of_week is not None else now.weekday()
    hour        = hour        if hour        is not None else now.hour

    MONTH_FACTOR = {10: 1.3, 11: 1.4, 3: 1.2}
    month_factor = MONTH_FACTOR.get(month, 1.0)
    if month in {6, 7, 8, 9}:
        month_factor *= 1.1
    day_factor = 1.15 if day_of_week >= 5 else 1.0

    results = []
    for zone_id, zone_name in ZONE_NAMES.items():
        try:
            pred = predict_crime(zone_id=zone_id, hour=hour, day_of_week=day_of_week, month=month)
        except FileNotFoundError:
            raise HTTPException(503, detail="Model not trained yet. Run ml/train_from_db.py first.")
        except Exception:
            continue

        top = pred["predictions"][0]
        base_risk  = top["probability"]
        urban_mult = 1.2 if zone_id in URBAN_ZONES else 1.0
        enhanced   = min(base_risk * month_factor * day_factor * urban_mult, 1.0)

        risk_level = "LOW"
        if enhanced > 0.55: risk_level = "CRITICAL"
        elif enhanced > 0.35: risk_level = "ELEVATED"
        elif enhanced > 0.20: risk_level = "MODERATE"

        actions = {
            "CRITICAL": "Deploy rapid response unit + Fixed point pickets",
            "ELEVATED": "Increase patrol frequency",
            "MODERATE": "Monitor closely",
            "LOW":      "Routine patrol",
        }

        results.append({
            "zone":            zone_id,
            "zone_name":       zone_name,
            "top_crime_type":  top["crime_type"],
            "top_probability": round(base_risk, 3),
            "enhanced_risk":   round(enhanced, 3),
            "risk_level":      risk_level,
            "strategic_action":actions[risk_level],
            "all_predictions": pred["predictions"],
            "timeband":        pred["timeband"],
            "model_accuracy":  pred["model_accuracy"],
        })

    results.sort(key=lambda x: -x["enhanced_risk"])
    return results


# ── Legacy POST (kept so nothing breaks) ───────────────────────────────────
class PredictRequest(BaseModel):
    month:       int
    day:         str   # "Monday" … "Sunday"
    time_period: str   # "Morning" | "Afternoon" | "Evening" | "Night"

@router.post("/legacy")
def predict_legacy(req: PredictRequest):
    DAY_MAP  = {"Monday":0,"Tuesday":1,"Wednesday":2,"Thursday":3,"Friday":4,"Saturday":5,"Sunday":6}
    TIME_MAP = {"Morning":7,"Afternoon":14,"Evening":20,"Night":1}
    return hotspot_prediction(
        month=req.month,
        day_of_week=DAY_MAP.get(req.day, 0),
        hour=TIME_MAP.get(req.time_period, 12),
    )
