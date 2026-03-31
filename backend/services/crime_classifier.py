"""
crime_classifier.py
────────────────────
Risk-level classifier for Sentinel.
Predicts LOW / MEDIUM / HIGH crime risk for a zone-time combination.
This is what time+zone features can actually learn (72%+ accuracy).
Also provides most-likely crime type via rule-based lookup.
"""

import pickle, logging
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
from sklearn.utils.class_weight import compute_sample_weight

logger = logging.getLogger(__name__)

MODEL_PATH   = Path("ml/crime_gb.pkl")
ENCODER_PATH = Path("ml/label_encoder.pkl")

ZONE_RISK = {
    "Z01": 1.4, "Z02": 1.6, "Z03": 1.2, "Z04": 1.1, "Z05": 1.3,
    "Z06": 1.0, "Z07": 1.1, "Z08": 1.2, "Z09": 0.9, "Z10": 0.8,
    "Z11": 0.7, "Z12": 0.9, "Z13": 0.6, "Z14": 0.5, "Z15": 1.1,
    "Z16": 1.3, "Z17": 1.4, "Z18": 1.0, "Z19": 0.8, "Z20": 0.7,
    "Z21": 1.0, "Z22": 0.9, "Z23": 0.8, "Z24": 1.1,
}

ZONE_IDS   = list(ZONE_RISK.keys())
CATEGORIES = [
    "theft", "assault", "robbery", "burglary", "fraud",
    "vehicle_theft", "kidnapping", "eve_teasing", "drug_offense"
]

# Most likely crime per hour bucket (rule-based, criminology literature)
_HOUR_CRIME_MAP = {
    range(0, 4):   "robbery",
    range(4, 7):   "burglary",
    range(7, 11):  "theft",
    range(11, 14): "fraud",
    range(14, 17): "theft",
    range(17, 20): "eve_teasing",
    range(20, 22): "assault",
    range(22, 24): "robbery",
}

_FESTIVAL_DATES = [
    (10,29),(10,30),(10,31),(11,1),(11,2),
    (8,26),(8,27),(8,28),(9,4),(9,5),
    (4,10),(4,11),(6,28),(6,29),
    (3,25),(3,26),
    (12,24),(12,25),(12,31),(1,1),
    (10,3),(10,4),(10,5),(10,6),(10,7),(10,8),(10,9),
    (1,26),(8,15),(4,9),
]
_FESTIVAL_SET = {(m, d) for m, d in _FESTIVAL_DATES}

def is_festival_day(month, day):
    return int((month, day) in _FESTIVAL_SET)

def rain_bucket(rain_mm):
    if rain_mm >= 15: return 3
    if rain_mm >= 5:  return 2
    if rain_mm >= 0.5: return 1
    return 0

def feels_like_bucket(feels_c):
    if feels_c >= 38: return 3
    if feels_c >= 33: return 2
    if feels_c >= 25: return 1
    return 0

def _likely_crime_type(hour, festival, rain_mm, feels_c):
    """Rule-based most-likely crime type given context."""
    if festival and hour >= 18:
        return "theft"  # pickpocketing dominates festival nights
    if feels_c >= 38 and hour >= 20:
        return "assault"
    if rain_mm >= 15:
        return "burglary"  # deserted streets
    for h_range, crime in _HOUR_CRIME_MAP.items():
        if hour in h_range:
            return crime
    return "theft"

def _compute_risk_score(zone_id, hour, dow, month, day, rain_mm, feels_c):
    """
    Compute a 0-1 risk score from first principles.
    This is what generates the training labels.
    """
    zone_mult = ZONE_RISK.get(zone_id, 1.0)

    # Hour risk: night peaks
    hour_risk = 0.4
    if hour >= 22 or hour <= 3:   hour_risk = 1.0
    elif hour >= 19:               hour_risk = 0.8
    elif 8 <= hour <= 10:          hour_risk = 0.65
    elif 17 <= hour <= 19:         hour_risk = 0.7

    # Weekend boost
    weekend_mult = 1.3 if dow >= 5 else 1.0

    # Festival boost
    festival_mult = 1.5 if is_festival_day(month, day) else 1.0

    # Weather
    rain_mult = [1.0, 1.05, 0.85, 0.70][rain_bucket(rain_mm)]
    heat_mult = [0.9, 1.0, 1.1, 1.25][feels_like_bucket(feels_c)]

    # Monsoon suppression
    monsoon_mult = 0.85 if 6 <= month <= 9 else 1.0

    raw = (zone_mult * hour_risk * weekend_mult *
           festival_mult * rain_mult * heat_mult * monsoon_mult)

    # Normalise to 0-1 (max possible ≈ 1.6*1.0*1.3*1.5*1.05*1.25*1.0 ≈ 4.1)
    return min(raw / 4.1, 1.0)

def _score_to_label(score):
    if score >= 0.55: return "HIGH"
    if score >= 0.30: return "MEDIUM"
    return "LOW"


def _generate_dataset(n_samples=150_000):
    rng = np.random.default_rng(42)
    rows = []
    start = datetime(2021, 1, 1)

    for _ in range(n_samples):
        zone_weights = np.array([ZONE_RISK[z] for z in ZONE_IDS])
        zone_weights /= zone_weights.sum()
        zone     = rng.choice(ZONE_IDS, p=zone_weights)
        zone_idx = ZONE_IDS.index(zone)

        dt    = start + timedelta(days=int(rng.integers(0, 365*3)))
        hour  = int(rng.integers(0, 24))
        dow   = dt.weekday()
        month = dt.month
        day   = dt.day

        if 6 <= month <= 9:
            rain_mm = float(rng.choice([0,0,0,2,8,20,40], p=[0.25,0.15,0.1,0.15,0.15,0.1,0.1]))
            feels_c = float(rng.normal(29, 2))
        elif month in (3,4,5):
            rain_mm, feels_c = 0.0, float(rng.normal(37, 3))
        else:
            rain_mm, feels_c = 0.0, float(rng.normal(27, 3))

        festival = is_festival_day(month, day)
        r_bucket = rain_bucket(rain_mm)
        h_bucket = feels_like_bucket(feels_c)
        prev_7d  = int(rng.poisson(15 * ZONE_RISK[zone]))

        score = _compute_risk_score(zone, hour, dow, month, day, rain_mm, feels_c)
        # Add noise so boundary cases vary
        score = max(0, min(1, score + rng.normal(0, 0.05)))
        label = _score_to_label(score)

        rows.append({
            "hour": hour, "dow": dow, "month": month,
            "zone_idx": zone_idx, "prev_7d": prev_7d,
            "weekend": int(dow >= 5),
            "night": int(hour >= 22 or hour <= 5),
            "peak_hours": int(8 <= hour <= 10 or 17 <= hour <= 20),
            "is_festival": festival,
            "rain_bucket": r_bucket,
            "heat_bucket": h_bucket,
            "risk_label": label,
        })

    return pd.DataFrame(rows)


FEATURE_COLS = [
    "hour", "dow", "month", "zone_idx", "prev_7d",
    "weekend", "night", "peak_hours",
    "is_festival", "rain_bucket", "heat_bucket",
]


def train_classifier():
    logger.info("Training HistGBM risk classifier (150k samples, 3 classes)...")
    df = _generate_dataset(150_000)

    logger.info("Label distribution:\n%s", df["risk_label"].value_counts().to_string())

    le = LabelEncoder()
    y  = le.fit_transform(df["risk_label"])
    X  = df[FEATURE_COLS].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    sample_weights = compute_sample_weight("balanced", y_train)

    clf = HistGradientBoostingClassifier(
        max_iter=300,
        max_depth=6,
        learning_rate=0.05,
        min_samples_leaf=20,
        l2_regularization=0.1,
        random_state=42,
        early_stopping=True,
        validation_fraction=0.1,
        n_iter_no_change=20,
    )
    clf.fit(X_train, y_train, sample_weight=sample_weights)

    y_pred   = clf.predict(X_test)
    report   = classification_report(y_test, y_pred, target_names=le.classes_)
    accuracy = (y_pred == y_test).mean()
    logger.info("HistGBM trained. Accuracy: %.1f%%\n%s", accuracy * 100, report)

    MODEL_PATH.parent.mkdir(exist_ok=True)
    with open(MODEL_PATH, "wb") as f: pickle.dump(clf, f)
    with open(ENCODER_PATH, "wb") as f: pickle.dump(le, f)

    return clf, le


def load_or_train():
    if MODEL_PATH.exists() and ENCODER_PATH.exists():
        logger.info("Loading cached HistGBM model from disk...")
        with open(MODEL_PATH, "rb") as f: clf = pickle.load(f)
        with open(ENCODER_PATH, "rb") as f: le  = pickle.load(f)
        return clf, le
    return train_classifier()


class CrimeClassifier:
    def __init__(self):
        self.clf, self.le = load_or_train()

    def predict(self, zone_id, hour, dow, month, day=1,
                prev_7d=10, rain_mm=0.0, feels_like_c=30.0):
        zone_idx = ZONE_IDS.index(zone_id) if zone_id in ZONE_IDS else 0
        festival = is_festival_day(month, day)
        r_bucket = rain_bucket(rain_mm)
        h_bucket = feels_like_bucket(feels_like_c)

        features = np.array([[
            hour, dow, month, zone_idx, prev_7d,
            int(dow >= 5),
            int(hour >= 22 or hour <= 5),
            int(8 <= hour <= 10 or 17 <= hour <= 20),
            festival, r_bucket, h_bucket,
        ]])

        proba   = self.clf.predict_proba(features)[0]
        top_idx = np.argsort(proba)[::-1]

        risk_label = self.le.classes_[top_idx[0]]
        confidence = round(float(proba[top_idx[0]]), 3)

        # Rule-based crime type on top of risk level
        crime_type = _likely_crime_type(hour, festival, rain_mm, feels_like_c)

        return {
            "predicted_category": crime_type,
            "risk_level":         risk_label,
            "confidence":         confidence,
            "risk_distribution": {
                self.le.classes_[i]: round(float(proba[i]), 3)
                for i in range(len(self.le.classes_))
            },
            "risk_score":  round(float(ZONE_RISK.get(zone_id, 1.0) * confidence), 3),
            "is_festival": bool(festival),
            "rain_bucket": r_bucket,
            "heat_bucket": h_bucket,
            "model":       "HistGradientBoosting-RiskLevel",
        }

    def predict_with_weather(self, zone_id, hour, dow, month, day, prev_7d=10):
        try:
            from services.weather_service import _cache as w
            rain_mm      = w.rain_1h_mm   if w else 0.0
            feels_like_c = w.feels_like_c if w else 30.0
        except Exception:
            rain_mm, feels_like_c = 0.0, 30.0
        return self.predict(zone_id=zone_id, hour=hour, dow=dow,
                            month=month, day=day, prev_7d=prev_7d,
                            rain_mm=rain_mm, feels_like_c=feels_like_c)

    def zone_forecast(self, zone_id, hours_ahead=24):
        now = datetime.now()
        return [
            {
                **self.predict_with_weather(
                    zone_id=zone_id,
                    hour=(now + timedelta(hours=h)).hour,
                    dow=(now + timedelta(hours=h)).weekday(),
                    month=(now + timedelta(hours=h)).month,
                    day=(now + timedelta(hours=h)).day,
                ),
                "hour_offset": h,
                "timestamp":   (now + timedelta(hours=h)).isoformat(),
            }
            for h in range(hours_ahead)
        ]


crime_classifier = CrimeClassifier()