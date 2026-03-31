"""
Sentinel RF Crime Classifier v2
Improvements over v1:
- Adds timeband as categorical feature
- Adds victim_age as continuous (not bucketed)
- Adds season feature
- Removes Crime Domain leak → honest accuracy
- Cross-validation for real generalization estimate
"""
import pandas as pd
import numpy as np
import pickle, json, os
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import classification_report, accuracy_score

BASE = os.path.dirname(__file__)
DATA = os.path.join(BASE, "..", "data", "crime_dataset_india.csv")
OUT  = BASE

print("=== Sentinel ML Training Pipeline v2 ===\n")

# ── 1. Load ───────────────────────────────────────────────────
print("[1] Loading dataset...")
df = pd.read_csv(DATA)
print(f"    Rows: {len(df)}, Cols: {list(df.columns)}")

# ── 2. Feature engineering ────────────────────────────────────
print("\n[2] Feature engineering...")
df.columns = df.columns.str.strip()

# Parse datetime
df["Date of Occurrence"] = pd.to_datetime(df["Date of Occurrence"], errors="coerce")
df["Time of Occurrence"] = df["Time of Occurrence"].astype(str).str.zfill(4)
df["hour"]        = df["Time of Occurrence"].str[:2].astype(int, errors="ignore").fillna(12)
df["month"]       = df["Date of Occurrence"].dt.month.fillna(6)
df["day_of_week"] = df["Date of Occurrence"].dt.dayofweek.fillna(0)
df["is_weekend"]  = (df["day_of_week"] >= 5).astype(int)
df["season"]      = ((df["month"] % 12) // 3).astype(int)  # 0=winter,1=spring,2=summer,3=autumn

# Timeband from hour
def get_timeband(h):
    if 5 <= h < 12:  return "Morning"
    elif 12 <= h < 17: return "Afternoon"
    elif 17 <= h < 21: return "Evening"
    else: return "Night"

df["timeband"] = df["hour"].apply(get_timeband)

# Victim age continuous + bucket
df["Victim Age"] = pd.to_numeric(df["Victim Age"], errors="coerce").fillna(30)
df["age_group"]  = pd.cut(df["Victim Age"], bins=[0,18,30,45,60,100],
                           labels=[0,1,2,3,4]).astype(int)

# Target
df["crime_type"] = df["Crime Description"].str.strip().str.upper()
crime_types = df["crime_type"].value_counts()
valid_types  = crime_types[crime_types >= 100].index
df = df[df["crime_type"].isin(valid_types)].copy()
print(f"    Crime types ({len(valid_types)}): {sorted(valid_types.tolist())}")

# ── 3. Encode ─────────────────────────────────────────────────
print("\n[3] Encoding features...")
encoders = {}

for col in ["City", "Weapon Used", "timeband"]:
    le = LabelEncoder()
    df[f"{col}_enc"] = le.fit_transform(df[col].fillna("Unknown").astype(str))
    encoders[col.lower().replace(" ", "_")] = le

le_target = LabelEncoder()
df["target"] = le_target.fit_transform(df["crime_type"])
encoders["crime_type"] = le_target

# Features — NO Crime Domain (would leak label)
FEATURES = [
    "hour", "month", "day_of_week", "is_weekend", "season",
    "City_enc", "Weapon Used_enc", "timeband_enc",
    "Victim Age", "age_group",
    "Police Deployed",
]
FEATURES = [f for f in FEATURES if f in df.columns]

X = df[FEATURES].fillna(0)
y = df["target"]
print(f"    Feature matrix: {X.shape}, Features: {FEATURES}")

# ── 4. Train ──────────────────────────────────────────────────
print("\n[4] Training RandomForestClassifier (honest — no domain leak)...")
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

model = RandomForestClassifier(
    n_estimators=300,
    max_depth=12,
    min_samples_leaf=4,
    class_weight="balanced",
    random_state=42,
    n_jobs=-1,
)
model.fit(X_train, y_train)

y_pred = model.predict(X_test)
acc = accuracy_score(y_test, y_pred)
print(f"    Test Accuracy: {acc:.3f} ({acc*100:.1f}%)")

# 5-fold CV for honest generalization
cv_scores = cross_val_score(model, X, y, cv=5, scoring="accuracy", n_jobs=-1)
print(f"    5-Fold CV:     {cv_scores.mean():.3f} ± {cv_scores.std():.3f}")

print("\n", classification_report(y_test, le_target.inverse_transform(y_pred),
                                   target_names=le_target.classes_))

# Feature importances
fi = sorted(zip(FEATURES, model.feature_importances_), key=lambda x: -x[1])
print("    Feature importances:")
for name, imp in fi:
    print(f"      {name}: {imp:.4f}")

# ── 5. Save ───────────────────────────────────────────────────
print("\n[5] Saving artifacts...")
with open(os.path.join(OUT, "crime_model.pkl"), "wb") as f:
    pickle.dump(model, f)
with open(os.path.join(OUT, "label_encoder.pkl"), "wb") as f:
    pickle.dump(encoders, f)

feature_info = {
    "features": FEATURES,
    "crime_types": le_target.classes_.tolist(),
    "accuracy": round(acc, 4),
    "cv_mean": round(cv_scores.mean(), 4),
    "cv_std": round(cv_scores.std(), 4),
    "n_classes": int(le_target.classes_.shape[0]),
    "n_estimators": 300,
    "trained_at": pd.Timestamp.now().isoformat(),
}
with open(os.path.join(OUT, "feature_info.json"), "w") as f:
    json.dump(feature_info, f, indent=2)

print(f"    Saved: crime_model.pkl, label_encoder.pkl, feature_info.json")
print(f"\n=== Training complete. Accuracy: {acc*100:.1f}%, CV: {cv_scores.mean()*100:.1f}% ===")
