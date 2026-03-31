import numpy as np
import pandas as pd
from xgboost import XGBClassifier
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

# Pre-trained internal weights simulation
_model = None

def init_fraud_model():
    """Initializes a synthetic fraud detection model for the demo."""
    global _model
    
    # Synthetic dataset for UPI transactions
    # Features: amount, hour_of_day, city_dist, is_new_device, failed_attempts
    data = {
        'amount': [500, 50000, 1000, 25000, 100, 75000, 50, 40000],
        'hour_of_day': [12, 2, 14, 3, 10, 1, 9, 23],
        'city_dist': [5, 450, 2, 300, 1, 800, 0, 150],
        'is_new_device': [0, 1, 0, 1, 0, 1, 0, 0],
        'failed_attempts': [0, 3, 0, 2, 0, 5, 0, 1],
        'is_fraud': [0, 1, 0, 1, 0, 1, 0, 0]
    }
    df = pd.DataFrame(data)
    X = df.drop('is_fraud', axis=1)
    y = df['is_fraud']
    
    # Scale positive weight due to imbalance (fraud is rare)
    _model = XGBClassifier(n_estimators=10, max_depth=3, scale_pos_weight=10)
    _model.fit(X, y)
    logger.info("MahaCrimeOS: UPI Fraud Model initialized.")

def predict_fraud_risk(transaction: Dict[str, Any]) -> Dict[str, Any]:
    """
    Predicts transaction risk using the XGBoost engine.
    """
    global _model
    if _model is None:
        init_fraud_model()
        
    features = ['amount', 'hour_of_day', 'city_dist', 'is_new_device', 'failed_attempts']
    vals = [transaction.get(f, 0) for f in features]
    X_input = pd.DataFrame([vals], columns=features)
    
    prob = float(_model.predict_proba(X_input)[0, 1])
    score = round(prob * 100.0, 1)
    
    # Rule-based insights
    insights = []
    if transaction.get('hour_of_day', 0) < 5:
        insights.append("Suspicious transaction time (Midnight/Early Morning).")
    if transaction.get('city_dist', 0) > 100:
        insights.append("Geographic anomaly: Distance > 100km from last known location.")
    if transaction.get('is_new_device'):
        insights.append("New device detected in transaction flow.")
        
    status = "HIGH RISK" if score > 75 else "MEDIUM RISK" if score > 30 else "LOW RISK"
    
    return {
        "score": score,
        "status": status,
        "insights": insights,
        "features": {f: transaction.get(f) for f in features}
    }

