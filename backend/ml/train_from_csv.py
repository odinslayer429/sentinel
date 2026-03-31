"""
Train RandomForest from CSV files in data/ folder.
Run: python ml/train_from_csv.py
"""
import sys, os, pickle, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

# ── Load all CSVs from data/ folder ──────────────────────────
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")
print(f"[ML] Looking for CSVs in: {os.path.abspath(DATA_DIR)}")

import glob
csv_files = glob.glob(os.path.join(DATA_DIR, "*.csv"))
print(f"[ML] Found: {[os.path.basename(f) for f in csv_files]}")

dfs = [pd.read_csv(f) for f in csv_files]
df = pd.concat(dfs, ignore_index=True)
print(f"[ML] Total rows: {len(df)}")
print(f"[ML] Columns: {list(df.columns)}")

# ── Normalize column names (lowercase, strip spaces) ─────────
df.columns = df.columns.str.lower().str.strip().str.replace(" ", "_")

# Auto-detect columns (handles different CSV schemas)
col_map = {}
for col in df.columns:
    if "zone" in col:          col_map["zone_id"] = col
    if "crime_type" in col or "crime type" in col: col_map["crime_type"] = col
    if "hour" in col:          col_map["hour"] = col
    if "day" in col and "week" in col: col_map["day_of_week"] = col
    if "month" in col:         col_map["month"] = col
    if "severity" in col:      col_map["severity"] = col
    if "timeband" in col or "time_band" in col: col_map["timeband"] = col

print(f"[ML] Column mapping: {col_map}")

# Fill defaults for missing columns
if "zone_id"     not in col_map: df["zone_id"] = "ZONE_A"
if "crime_type"  not in col_map: raise ValueError("No crime_type column found!")
if "hour"        not in col_map: df["hour"] = 12
if "day_of_week" not in col_map: df["day_of_week"] = 0
if "month"       not in col_map: df["month"] = 6
if "severity"    not in col_map: df["severity"] = 5
if "timeband"    not in col_map: df["timeband"] = "Evening"

# Remap to standard names
for std, orig in col_map.items():
    if orig != std:
        df[std] = df[orig]

df = df.dropna(subset=["crime_type"])
df["hour"]        = pd.to_numeric(df["hour"],        errors="coerce").fillna(12).astype(int)
df["day_of_week"] = pd.to_numeric(df["day_of_week"], errors="coerce").fillna(0).astype(int)
df["month"]       = pd.to_numeric(df["month"],       errors="coerce").fillna(6).astype(int)
df["severity"]    = pd.to_numeric(df["severity"],    errors="coerce").fillna(5).astype(int)

# ── Encode ────────────────────────────────────────────────────
zone_enc     = LabelEncoder().fit(df["zone_id"].astype(str))
timeband_enc = LabelEncoder().fit(df["timeband"].astype(str))
crime_enc    = LabelEncoder().fit(df["crime_type"].astype(str))

X = np.column_stack([
    zone_enc.transform(df["zone_id"].astype(str)),
    df["hour"].values,
    df["day_of_week"].values,
    df["month"].values,
    df["severity"].values,
    timeband_enc.transform(df["timeband"].astype(str)),
])
y = crime_enc.transform(df["crime_type"].astype(str))

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# ── Train ─────────────────────────────────────────────────────
print(f"[ML] Training RandomForest on {len(X_train)} samples...")
clf = RandomForestClassifier(n_estimators=300, max_depth=15, random_state=42, n_jobs=-1)
clf.fit(X_train, y_train)

acc = accuracy_score(y_test, clf.predict(X_test))
print(f"[ML] Test Accuracy: {acc:.3f} ({acc*100:.1f}%)")

# ── Save ──────────────────────────────────────────────────────
ML_DIR = os.path.dirname(__file__)
with open(os.path.join(ML_DIR, "crime_model.pkl"), "wb") as f: pickle.dump(clf, f)
with open(os.path.join(ML_DIR, "label_encoder.pkl"), "wb") as f:
    pickle.dump({"zone": zone_enc, "timeband": timeband_enc, "crime": crime_enc}, f)
with open(os.path.join(ML_DIR, "feature_info.json"), "w") as f:
    json.dump({
        "features":     ["zone_id", "hour", "day_of_week", "month", "severity", "timeband"],
        "classes":      list(crime_enc.classes_),
        "zones":        list(zone_enc.classes_),
        "accuracy":     round(acc, 4),
        "training_size": len(X_train),
        "csv_files":    [os.path.basename(f) for f in csv_files],
    }, f, indent=2)

print(f"[ML] Done! Crime types: {list(crime_enc.classes_)}")
print(f"[ML] Artifacts saved to {ML_DIR}")
