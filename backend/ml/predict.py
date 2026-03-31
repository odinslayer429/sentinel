"""
ML inference module — loaded once at startup, called by routers.
Never retrain at request time.
"""
import pickle, json, os
import numpy as np

ML_DIR = os.path.dirname(os.path.abspath(__file__))
_model = None
_encoders = None
_feature_info = None

def _load():
    global _model, _encoders, _feature_info
    if _model is not None:
        return
    with open(os.path.join(ML_DIR, "crime_model.pkl"), "rb") as f:
        _model = pickle.load(f)
    with open(os.path.join(ML_DIR, "label_encoder.pkl"), "rb") as f:
        _encoders = pickle.load(f)
    with open(os.path.join(ML_DIR, "feature_info.json")) as f:
        _feature_info = json.load(f)

def predict_crime(zone_id: str, hour: int, day_of_week: int, month: int, severity: int = 5):
    """
    Returns top-3 predicted crime types with probabilities for a given context.
    """
    _load()

    try:
        zone_enc = int(_encoders["zone"].transform([zone_id])[0])
    except ValueError:
        zone_enc = 0

    timeband_label = (
        "Morning"   if 6  <= hour < 12 else
        "Afternoon" if 12 <= hour < 18 else
        "Evening"   if 18 <= hour < 22 else
        "Night"
    )
    timeband_enc = int(_encoders["timeband"].transform([timeband_label])[0])
    is_weekend   = int(day_of_week >= 5)
    is_night     = int(hour >= 22 or hour < 6)
    is_festival  = int(month in [10, 11, 3])
    is_monsoon   = int(month in [6, 7, 8, 9])

    features = np.array([[
        zone_enc, hour, day_of_week, month, severity,
        timeband_enc, is_weekend, is_night, is_festival, is_monsoon
    ]])

    proba = _model.predict_proba(features)[0]
    classes = _encoders["target"].classes_

    top3_idx = proba.argsort()[-3:][::-1]
    results = [
        {
            "crime_type": classes[i],
            "probability": round(float(proba[i]), 4),
            "risk_level": (
                "HIGH"   if proba[i] > 0.35 else
                "MEDIUM" if proba[i] > 0.15 else
                "LOW"
            )
        }
        for i in top3_idx
    ]
    return {
        "zone_id":    zone_id,
        "hour":       hour,
        "day_of_week":day_of_week,
        "month":      month,
        "timeband":   timeband_label,
        "predictions":results,
        "model_accuracy": _feature_info["accuracy"]
    }

def get_model_info():
    _load()
    return _feature_info
