"""
Train RandomForest crime-type classifier from real Indian crime CSVs.
Run: python ml/train_from_db.py

Key fixes vs original:
  - All paths read from environment / .env (no hardcoded D:\\Sentinel)
  - Temporal features derived ONLY from real timestamps (no random injection)
  - Train / test split is TEMPORAL (train pre-2023, test 2023+) to prevent
    data leakage and produce honest accuracy metrics
  - Rows without a parseable date are dropped rather than filled with noise
"""
import sys, os, pickle, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import accuracy_score, classification_report

# ── Paths from env ────────────────────────────────────────────────────────────
DATA_DIR = os.getenv("SENTINEL_DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data"))
ML_DIR   = os.path.dirname(__file__)

print("[ML] DATA_DIR:", os.path.abspath(DATA_DIR))
print("[ML] Loading CSV datasets...")


def _timeband(h: int) -> str:
    if   6  <= h < 12: return "Morning"
    elif 12 <= h < 17: return "Afternoon"
    elif 17 <= h < 21: return "Evening"
    else:              return "Night"


# ── 1. Mumbai historical ──────────────────────────────────────────────────────
def load_mumbai(data_dir: str) -> pd.DataFrame:
    path = os.path.join(data_dir, "mumbai_crime_historical_2020_2024.csv")
    df   = pd.read_csv(path)
    df   = df.rename(columns={
        "ward_code":   "zone_id",
        "ward_name":   "zone_name",
        "crime_type":  "crime_type",
        "severity":    "severity_label",
        "ipc_section": "ipc_section",
    })
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date", "crime_type"])    # drop rows without real dates
    df["hour"]     = df["date"].dt.hour.astype(int)
    df["dow"]      = df["date"].dt.dayofweek.astype(int)
    df["month"]    = df["date"].dt.month.astype(int)
    df["year"]     = df["date"].dt.year.astype(int)
    df["severity"] = df["severity_label"].map(
        {"Low": 3, "Medium": 6, "High": 8, "Critical": 10}
    ).fillna(5).astype(int)
    df["timeband"] = df["hour"].apply(_timeband)
    print(f"  Mumbai: {len(df)} rows | {df['crime_type'].nunique()} crime types")
    return df


# ── 2. Multi-city India ───────────────────────────────────────────────────────
def load_multi(data_dir: str) -> pd.DataFrame:
    path = os.path.join(data_dir, "crime_dataset_india.csv")
    df   = pd.read_csv(path)
    df   = df.rename(columns={
        "City":              "zone_id",
        "Crime Description": "crime_type",
    })
    df["date"] = pd.to_datetime(df["Date of Occurrence"], errors="coerce")
    df = df.dropna(subset=["date", "crime_type"])    # only rows with real dates
    # Derive time features from real timestamps — no random injection
    time_col = pd.to_datetime(df["Time of Occurrence"], errors="coerce")
    df["hour"]     = time_col.dt.hour.fillna(df["date"].dt.hour).astype(int)
    df["dow"]      = df["date"].dt.dayofweek.astype(int)
    df["month"]    = df["date"].dt.month.astype(int)
    df["year"]     = df["date"].dt.year.astype(int)
    df["severity"] = 5  # no severity column — neutral default
    df["timeband"] = df["hour"].apply(_timeband)
    print(f"  Multi:  {len(df)} rows | {df['crime_type'].nunique()} crime types")
    return df


# ── Merge ─────────────────────────────────────────────────────────────────────
COLS = ["zone_id", "crime_type", "hour", "dow", "month", "year", "severity", "timeband"]

dfs = []
for loader in [load_mumbai, load_multi]:
    try:
        dfs.append(loader(DATA_DIR)[COLS])
    except FileNotFoundError as e:
        print(f"  [WARN] Skipping dataset: {e}")

if not dfs:
    raise RuntimeError("No training data found. Check SENTINEL_DATA_DIR in your .env")

combined = pd.concat(dfs, ignore_index=True).dropna()
combined["crime_type"] = combined["crime_type"].str.strip().str.upper()
combined["zone_id"]    = combined["zone_id"].str.strip()

# Remove rare crime types (< 20 samples)
type_counts  = combined["crime_type"].value_counts()
valid_types  = type_counts[type_counts >= 20].index
combined     = combined[combined["crime_type"].isin(valid_types)]

print(f"\n[ML] Combined: {len(combined)} rows | {combined['crime_type'].nunique()} classes")


# ── Temporal train/test split ─────────────────────────────────────────────────
# Train on data before 2023; test on 2023 and later.
# This mirrors real-world deployment and prevents leakage.
train_df = combined[combined["year"] < 2023]
test_df  = combined[combined["year"] >= 2023]

if len(test_df) < 50:
    # Fallback: if not enough post-2023 data, use last 20% chronologically
    print("  [WARN] Insufficient post-2023 data; falling back to last-20%% split")
    combined = combined.sort_values("year")
    split    = int(len(combined) * 0.8)
    train_df = combined.iloc[:split]
    test_df  = combined.iloc[split:]

print(f"  Train: {len(train_df)} rows  |  Test: {len(test_df)} rows")


# ── Encode ────────────────────────────────────────────────────────────────────
zone_enc     = LabelEncoder().fit(combined["zone_id"])
timeband_enc = LabelEncoder().fit(combined["timeband"])
crime_enc    = LabelEncoder().fit(combined["crime_type"])

def encode(df: pd.DataFrame) -> tuple:
    X = np.column_stack([
        zone_enc.transform(df["zone_id"]),
        df["hour"].values,
        df["dow"].values,
        df["month"].values,
        df["severity"].values,
        timeband_enc.transform(df["timeband"]),
    ])
    y = crime_enc.transform(df["crime_type"])
    return X, y

X_train, y_train = encode(train_df)
X_test,  y_test  = encode(test_df)


# ── Train ─────────────────────────────────────────────────────────────────────
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

y_pred  = clf.predict(X_test)
acc     = accuracy_score(y_test, y_pred)
print(f"[ML] Temporal Test Accuracy: {acc:.3f} ({acc*100:.1f}%)")

proba       = clf.predict_proba(X_test)
top3_acc    = sum(
    y_test[i] in np.argsort(proba[i])[-3:]
    for i in range(len(y_test))
) / len(y_test)
print(f"[ML] Top-3 Accuracy:         {top3_acc:.3f} ({top3_acc*100:.1f}%)")

feat_names = ["zone", "hour", "day_of_week", "month", "severity", "timeband"]
importance = dict(zip(feat_names, clf.feature_importances_))
print(f"[ML] Feature importance: { {k: round(v,3) for k,v in sorted(importance.items(), key=lambda x:-x[1])} }")


# ── Save artifacts ────────────────────────────────────────────────────────────
os.makedirs(ML_DIR, exist_ok=True)

with open(os.path.join(ML_DIR, "crime_model.pkl"), "wb") as f:
    pickle.dump(clf, f)

with open(os.path.join(ML_DIR, "label_encoder.pkl"), "wb") as f:
    pickle.dump({"zone": zone_enc, "timeband": timeband_enc, "crime": crime_enc}, f)

with open(os.path.join(ML_DIR, "feature_info.json"), "w") as f:
    json.dump({
        "features":           feat_names,
        "classes":            list(crime_enc.classes_),
        "zones_trained":      list(zone_enc.classes_[:50]),
        "accuracy":           round(acc, 4),
        "top3_accuracy":      round(top3_acc, 4),
        "split_strategy":     "temporal (train < 2023, test >= 2023)",
        "n_estimators":       300,
        "training_size":      len(X_train),
        "test_size":          len(X_test),
        "num_crime_classes":  len(crime_enc.classes_),
        "feature_importance": {k: round(v, 4) for k, v in importance.items()},
        "data_sources":       ["mumbai_crime_historical", "crime_dataset_india"],
    }, f, indent=2)

print(f"\n[ML] Saved crime_model.pkl, label_encoder.pkl, feature_info.json")
print(f"[ML] Model trained on {len(combined)} real Indian crime records (NO synthetic temporal features)")
