"""Train fraud detection model on real UPI fraud data."""
import pandas as pd, numpy as np, pickle, json, os
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "..", "..", "data")

print("=== UPI Fraud Model Training ===\n")
df = pd.read_csv(os.path.join(DATA, "real_upi_fraud.csv"))
print(f"Rows: {len(df)}, FraudFlag distribution:\n{df['FraudFlag'].value_counts()}")

# Features
df["freq_num"] = df["TransactionFrequency"].str.extract(r"(\d+)").astype(float).fillna(1)
df["UnusualLocation"] = (df["UnusualLocation"].astype(str).str.upper() == "TRUE").astype(int)
df["UnusualAmount"]   = (df["UnusualAmount"].astype(str).str.upper() == "TRUE").astype(int)
df["NewDevice"]       = (df["NewDevice"].astype(str).str.upper() == "TRUE").astype(int)

le_merchant = LabelEncoder()
df["merchant_enc"] = le_merchant.fit_transform(df["MerchantCategory"].fillna("Unknown"))
le_txn = LabelEncoder()
df["txn_type_enc"] = le_txn.fit_transform(df["TransactionType"].fillna("P2P"))

FEATURES = [
    "Amount", "AvgTransactionAmount", "freq_num",
    "UnusualLocation", "UnusualAmount", "NewDevice",
    "FailedAttempts", "merchant_enc", "txn_type_enc",
]
X = df[FEATURES].fillna(0)
y = df["FraudFlag"]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = GradientBoostingClassifier(n_estimators=100, max_depth=4, random_state=42)
model.fit(X_train, y_train)

y_prob = model.predict_proba(X_test)[:, 1]
auc = roc_auc_score(y_test, y_prob)
print(f"AUC-ROC: {auc:.3f}")
print(classification_report(y_test, model.predict(X_test)))

with open(os.path.join(BASE, "fraud_model.pkl"), "wb") as f:
    pickle.dump(model, f)

encoders = {"merchant": le_merchant, "txn_type": le_txn, "features": FEATURES, "auc": round(auc, 4)}
with open(os.path.join(BASE, "fraud_encoder.pkl"), "wb") as f:
    pickle.dump(encoders, f)

print(f"\nSaved fraud_model.pkl (AUC: {auc:.3f})")
