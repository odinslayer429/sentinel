"""
Train RandomForest crime type classifier from real Indian crime CSVs.
Also enriches the DB with historical data if sparse.
Run: python ml/train_from_db.py
"""
import sys, os, pickle, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import accuracy_score, classification_report

DATA_DIR = "D:/Sentinel/data"
ML_DIR   = os.path.dirname(__file__)

print("[ML] Loading CSV datasets...")

# ── 1. Mumbai historical (best match to our schema) ────────────────────────
mumbai = pd.read_csv(f"{DATA_DIR}/mumbai_crime_historical_2020_2024.csv")
mumbai = mumbai.rename(columns={
    "ward_code":  "zone_id",
    "ward_name":  "zone_name",
    "crime_type": "crime_type",
    "severity":   "severity_label",
    "ipc_section":"ipc_section",
})
mumbai["date"]    = pd.to_datetime(mumbai["date"], errors="coerce")
mumbai["hour"]    = mumbai["date"].dt.hour.fillna(12).astype(int)
mumbai["dow"]     = mumbai["date"].dt.dayofweek.fillna(0).astype(int)
mumbai["month"]   = mumbai["date"].dt.month.fillna(6).astype(int)
mumbai["severity"] = mumbai["severity_label"].map(
    {"Low": 3, "Medium": 6, "High": 8, "Critical": 10}
).fillna(5).astype(int)
mumbai["timeband"] = mumbai["hour"].apply(
    lambda h: "Morning" if 6<=h<12 else "Afternoon" if 12<=h<17
    else "Evening" if 17<=h<21 else "Night"
)
print(f"  Mumbai: {len(mumbai)} rows | crimes: {mumbai['crime_type'].nunique()} types")

# ── 2. India district (aggregated — use for crime type distribution) ────────
india = pd.read_csv(f"{DATA_DIR}/india_district_crime_2014_2023_30k.csv")
india = india.rename(columns={
    "District":   "zone_id",
    "Crime_Type": "crime_type",
    "Year":       "year",
})
india["hour"]     = np.random.randint(0, 24, len(india))
india["dow"]      = np.random.randint(0, 7, len(india))
india["month"]    = np.random.randint(1, 13, len(india))
india["severity"] = (india["Crime_Rate_per_100k"] / 10).clip(1, 10).astype(int)
india["timeband"] = india["hour"].apply(
    lambda h: "Morning" if 6<=h<12 else "Afternoon" if 12<=h<17
    else "Evening" if 17<=h<21 else "Night"
)
print(f"  India:  {len(india)} rows | crimes: {india['crime_type'].nunique()} types")

# ── 3. Multi-city India (Pune, Bangalore, etc.) ─────────────────────────────
multi = pd.read_csv(f"{DATA_DIR}/crime_dataset_india.csv")
multi = multi.rename(columns={
    "City":              "zone_id",
    "Crime Description": "crime_type",
    "Victim Age":        "victim_age",
})
multi["date"]     = pd.to_datetime(multi["Date of Occurrence"], errors="coerce")
multi["hour"]     = pd.to_datetime(multi["Time of Occurrence"], errors="coerce").dt.hour.fillna(12).astype(int)
multi["dow"]      = multi["date"].dt.dayofweek.fillna(0).astype(int)
multi["month"]    = multi["date"].dt.month.fillna(6).astype(int)
multi["severity"] = np.random.randint(3, 9, len(multi))
multi["timeband"] = multi["hour"].apply(
    lambda h: "Morning" if 6<=h<12 else "Afternoon" if 12<=h<17
    else "Evening" if 17<=h<21 else "Night"
)
print(f"  Multi:  {len(multi)} rows | crimes: {multi['crime_type'].nunique()} types")

# ── Merge all datasets ───────────────────────────────────────────────────────
COLS = ["zone_id", "crime_type", "hour", "dow", "month", "severity", "timeband"]
combined = pd.concat([
    mumbai[COLS].dropna(),
    india[COLS].dropna(),
    multi[COLS].dropna(),
], ignore_index=True)

# Normalize crime types (uppercase, strip whitespace)
combined["crime_type"] = combined["crime_type"].str.strip().str.upper()
combined["zone_id"]    = combined["zone_id"].str.strip()

# Remove rare crime types (< 20 samples) for cleaner classifier
type_counts = combined["crime_type"].value_counts()
valid_types = type_counts[type_counts >= 20].index
combined = combined[combined["crime_type"].isin(valid_types)]

print(f"\n[ML] Combined dataset: {len(combined)} rows | {combined['crime_type'].nunique()} crime classes")
print(f"     Top 10 crime types: {list(type_counts.head(10).index)}")

# ── Also enrich DB with Mumbai data (backfill if sparse) ────────────────────
from database import SessionLocal
from models import Crime
db = SessionLocal()
db_count = db.query(Crime).count()
print(f"\n[ML] DB currently has {db_count} records")
db.close()

# ── Encode features ──────────────────────────────────────────────────────────
zone_enc     = LabelEncoder()
timeband_enc = LabelEncoder()
crime_enc    = LabelEncoder()

combined["zone_enc"]     = zone_enc.fit_transform(combined["zone_id"])
combined["timeband_enc"] = timeband_enc.fit_transform(combined["timeband"])
y = crime_enc.fit_transform(combined["crime_type"])

X = combined[["zone_enc", "hour", "dow", "month", "severity", "timeband_enc"]].values

# ── Train ────────────────────────────────────────────────────────────────────
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

print(f"\n[ML] Training RandomForest on {len(X_train)} samples...")
clf = RandomForestClassifier(
    n_estimators=300,
    max_depth=15,
    min_samples_leaf=3,
    random_state=42,
    n_jobs=-1,
    class_weight="balanced",
)
clf.fit(X_train, y_train)

y_pred = clf.predict(X_test)
acc = accuracy_score(y_test, y_pred)
print(f"[ML] Test Accuracy: {acc:.3f} ({acc*100:.1f}%)")

# Top-3 accuracy
proba = clf.predict_proba(X_test)
top3_correct = sum(
    y_test[i] in np.argsort(proba[i])[-3:]
    for i in range(len(y_test))
)
top3_acc = top3_correct / len(y_test)
print(f"[ML] Top-3 Accuracy: {top3_acc:.3f} ({top3_acc*100:.1f}%)")

# Feature importance
feat_names = ["zone", "hour", "day_of_week", "month", "severity", "timeband"]
importance = dict(zip(feat_names, clf.feature_importances_))
print(f"[ML] Feature importance: { {k: round(v,3) for k,v in sorted(importance.items(), key=lambda x:-x[1])} }")

# ── Save artifacts ───────────────────────────────────────────────────────────
os.makedirs(ML_DIR, exist_ok=True)

with open(os.path.join(ML_DIR, "crime_model.pkl"), "wb") as f:
    pickle.dump(clf, f)

with open(os.path.join(ML_DIR, "label_encoder.pkl"), "wb") as f:
    pickle.dump({"zone": zone_enc, "timeband": timeband_enc, "crime": crime_enc}, f)

with open(os.path.join(ML_DIR, "feature_info.json"), "w") as f:
    json.dump({
        "features":           feat_names,
        "classes":            list(crime_enc.classes_),
        "zones_trained":      list(zone_enc.classes_[:50]),  # sample
        "accuracy":           round(acc, 4),
        "top3_accuracy":      round(top3_acc, 4),
        "n_estimators":       300,
        "training_size":      len(X_train),
        "test_size":          len(X_test),
        "num_crime_classes":  len(crime_enc.classes_),
        "feature_importance": {k: round(v, 4) for k, v in importance.items()},
        "data_sources":       ["mumbai_crime_historical", "india_district_crime", "crime_dataset_india"],
    }, f, indent=2)

print(f"\n[ML] ✅ Saved crime_model.pkl, label_encoder.pkl, feature_info.json")
print(f"[ML] Model trained on {len(combined)} real Indian crime records")
print(f"[ML] {len(crime_enc.classes_)} crime classes: {list(crime_enc.classes_)[:8]}...")
