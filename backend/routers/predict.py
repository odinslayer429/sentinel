from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from datetime import datetime
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder

from db.database import get_db
from db.models import CrimeEvent
from services.zone_graph import zone_ids

router = APIRouter(prefix="/api/predict", tags=["Prediction"])

class PredictRequest(BaseModel):
    month: int
    day: str  # Monday, Tuesday, etc.
    time_period: str  # Morning, Afternoon, Evening, Night

@router.post("")
def predict_crime(req: PredictRequest, db: Session = Depends(get_db)):
    # 1. Load Data
    events = db.query(CrimeEvent).all()
    if not events:
        raise HTTPException(status_code=404, detail="No historical data found for training.")

    df = pd.DataFrame([{
        "zone_id": e.zone_id,
        "timestamp": e.published_at or e.ingested_at
    } for e in events])
    
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df['month'] = df['timestamp'].dt.month
    df['weekday_num'] = df['timestamp'].dt.weekday
    
    def get_timeband(hour):
        if 6 <= hour < 12: return 0 # Morning
        if 12 <= hour < 18: return 1 # Afternoon
        if 18 <= hour < 24: return 2 # Evening
        return 3 # Night
    
    df['timeband_encoded'] = df['timestamp'].dt.hour.apply(get_timeband)

    # 2. Target: is_hotspot (75th percentile)
    counts = df.groupby(['zone_id', 'month', 'weekday_num', 'timeband_encoded']).size().reset_index(name='crime_count')
    threshold = counts['crime_count'].quantile(0.75)
    counts['is_hotspot'] = (counts['crime_count'] > threshold).astype(int)

    # 3. Train Model
    le = LabelEncoder()
    counts['district_encoded'] = le.fit_transform(counts['zone_id'])
    
    features = ['district_encoded', 'month', 'weekday_num', 'timeband_encoded']
    X = counts[features]
    y = counts['is_hotspot']
    
    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X, y)

    # 4. Input Encoding
    day_map = {
        "Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3,
        "Friday": 4, "Saturday": 5, "Sunday": 6
    }
    time_map = {"Morning": 0, "Afternoon": 1, "Evening": 2, "Night": 3}
    
    weekday_val = day_map.get(req.day, 0)
    time_val = time_map.get(req.time_period, 0)

    # 5. Predict per Zone
    results = []
    all_zids = zone_ids()
    urban_zones = ["Z01", "Z02", "Z03", "Z04", "Z07", "Z08", "Z09", "Z10"]
    
    # Pre-calculate multipliers
    month_factor = 1.0
    if req.month == 10: month_factor = 1.3
    elif req.month == 11: month_factor = 1.4
    elif req.month == 3: month_factor = 1.2
    
    if req.month in [6, 7, 8, 9]:
        month_factor *= 1.1 # Monsoon
        
    day_factor = 1.15 if weekday_val >= 5 else 1.0 # Weekend

    for zid in all_zids:
        try:
            d_enc = le.transform([zid])[0]
        except:
            d_enc = 0 # Fallback
            
        pred_input = [[d_enc, req.month, weekday_val, time_val]]
        base_risk = float(model.predict_proba(pred_input)[0][1])
        
        # Apply multipliers
        urban_mult = 1.2 if zid in urban_zones else 1.0
        enhanced_risk = base_risk * month_factor * day_factor * urban_mult
        
        # Risk classification
        risk_level = "LOW"
        if enhanced_risk > 0.7: risk_level = "CRITICAL"
        elif enhanced_risk > 0.4: risk_level = "ELEVATED"
        
        # Strategic actions
        action = "Increase patrol frequency" if risk_level != "LOW" else "Routine monitoring"
        if zid in urban_zones and risk_level == "CRITICAL":
            action = "Deploy rapid response unit + Fixed point pickets"
            
        results.append({
            "zone": zid,
            "base_risk": round(base_risk, 3),
            "enhanced_risk": round(enhanced_risk, 3),
            "confidence_band": "HIGH" if base_risk > 0.6 or base_risk < 0.2 else "MEDIUM",
            "risk_level": risk_level,
            "strategic_action": action,
            "month_factor": month_factor,
            "time_factor": 1.0 # Static for now as requested
        })

    return results

