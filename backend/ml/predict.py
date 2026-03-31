"""
ML inference — loaded once at startup, never retrained at request time.
Feature vector must exactly match train_from_db.py:
  [zone_enc, hour, day_of_week, month, severity, timeband_enc]
"""
import pickle, json, os
import numpy as np

ML_DIR = os.path.dirname(os.path.abspath(__file__))
_model        = None
_encoders     = None
_feature_info = None


def _load():
    global _model, _encoders, _feature_info
    if _model is not None:
        return
    model_path   = os.path.join(ML_DIR, "crime_model.pkl")
    encoder_path = os.path.join(ML_DIR, "label_encoder.pkl")
    info_path    = os.path.join(ML_DIR, "feature_info.json")
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model not found at {model_path}. Run ml/train_from_db.py first.")
    with open(model_path,   "rb") as f: _model    = pickle.load(f)
    with open(encoder_path, "rb") as f: _encoders = pickle.load(f)
    with open(info_path)         as f: _feature_info = json.load(f)


def predict_crime(zone_id: str, hour: int, day_of_week: int, month: int, severity: int = 5):
    """
    Returns top-3 predicted crime types with probabilities.
    Feature order: [zone_enc, hour, day_of_week, month, severity, timeband_enc]
    """
    _load()

    # zone encoding — fallback to 0 if zone not in training set
    try:
        zone_enc = int(_encoders["zone"].transform([zone_id])[0])
    except (ValueError, KeyError):
        zone_enc = 0

    # timeband: must match train_from_db.py exactly
    timeband_label = (
        "Morning"   if 6  <= hour < 12 else
        "Afternoon" if 12 <= hour < 18 else
        "Evening"   if 18 <= hour < 22 else
        "Night"
    )
    try:
        timeband_enc = int(_encoders["timeband"].transform([timeband_label])[0])
    except (ValueError, KeyError):
        timeband_enc = 0

    # Exact 6-feature vector — matches training
    features = np.array([[zone_enc, hour, day_of_week, month, severity, timeband_enc]])

    proba   = _model.predict_proba(features)[0]
    classes = _encoders["target"].classes_

    top3_idx = proba.argsort()[-3:][::-1]
    predictions = [
        {
            "crime_type":  classes[i],
            "probability": round(float(proba[i]), 4),
            "risk_level":  "HIGH" if proba[i] > 0.35 else "MEDIUM" if proba[i] > 0.15 else "LOW",
        }
        for i in top3_idx
    ]

    return {
        "zone_id":        zone_id,
        "hour":           hour,
        "day_of_week":    day_of_week,
        "month":          month,
        "timeband":       timeband_label,
        "predictions":    predictions,
        "model_accuracy": _feature_info.get("accuracy", 0),
        "top3_accuracy":  _feature_info.get("top3_accuracy", 0),
    }


def get_model_info():
    _load()
    return _feature_info
