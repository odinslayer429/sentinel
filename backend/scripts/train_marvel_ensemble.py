import os
import sys
import pandas as pd
import numpy as np
import json
import logging
from datetime import datetime, timedelta
from sklearn.ensemble import RandomForestClassifier
from xgboost import XGBClassifier
import joblib

# Add project root to sys.path
sys.path.append(os.getcwd())

from db.database import SessionLocal
from db.models import CrimeEvent
from services.zone_graph import zone_ids

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def train():
    db = SessionLocal()
    try:
        logger.info("Fetching real-world training data...")
        events = db.query(CrimeEvent).all()
        if not events:
            logger.error("No training data found in DB!")
            return

        # Prepare features
        data = []
        for e in events:
            data.append({
                'zone_id': e.zone_id,
                'hour': e.published_at.hour if e.published_at else 0,
                'day_of_week': e.published_at.weekday() if e.published_at else 0,
                'is_weekend': 1 if (e.published_at and e.published_at.weekday() >= 5) else 0,
                'severity_score': 10 if e.severity == "CRITICAL" else (5 if e.severity == "MEDIUM" else 1)
            })
        
        df = pd.DataFrame(data)
        
        # Target: High risk if event count in zone > mean
        counts = df.groupby('zone_id').size().to_dict()
        avg_count = np.mean(list(counts.values()))
        df['target'] = df['zone_id'].map(lambda x: 1 if counts.get(x, 0) > avg_count else 0)

        # One-hot encode zones
        zids = zone_ids()
        for zid in zids:
            df[f'zone_{zid}'] = (df['zone_id'] == zid).astype(int)

        X = df.drop(['zone_id', 'target'], axis=1)
        y = df['target']

        logger.info(f"Training on {len(X)} records with {len(X.columns)} features...")

        # 1. Random Forest (Spatial Stability)
        rf = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
        rf.fit(X, y)

        # 2. XGBoost (Temporal Trend)
        xgb = XGBClassifier(n_estimators=100, learning_rate=0.1, max_depth=5)
        xgb.fit(X, y)

        # Save models
        model_dir = r"d:\Sentinel\ml"
        os.makedirs(model_dir, exist_ok=True)
        joblib.dump(rf, os.path.join(model_dir, "rf_spatial.pkl"))
        joblib.dump(xgb, os.path.join(model_dir, "xgb_temporal.pkl"))
        
        # Save feature list for inference
        with open(os.path.join(model_dir, "features.json"), 'w') as f:
            json.dump(list(X.columns), f)

        logger.info("Ensemble models trained and saved to /ml/ successfully.")

    except Exception as e:
        logger.exception(f"Training failed: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    train()

