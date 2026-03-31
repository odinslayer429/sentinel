import sys
import os
import asyncio

# Add current dir to path for imports
sys.path.append(os.getcwd())

from services.predictive_v3 import run_prediction_cycle
from sqlalchemy.orm import Session
from db.database import SessionLocal
from db.models import ZoneRiskScore
import json

async def force_verify():
    print("--- TRIGGERING SUPREMACY INFERENCE ---")
    # 1. Run the cycle manually to populate DB with new logic
    await run_prediction_cycle()
    print("Inference Cycle CM-V20 Complete.")
    
    # 2. Query DB directly to check the JSON
    db = SessionLocal()
    try:
        scores = db.query(ZoneRiskScore).all()
        print(f"Checking {len(scores)} zones in database...")
        
        found = False
        for s in scores:
            if s.explainability_json:
                data = json.loads(s.explainability_json)
                # Look for the Ensemble Score entry
                ensemble = next((item for item in data if item["feature"] == "Ensemble Score"), None)
                if ensemble:
                    details = ensemble.get("details", {})
                    if "sentiment_mult" in details:
                        print(f"SUCCESS: Zone {s.zone_id} has Sentiment Mult: {details['sentiment_mult']} and Network Influence: {details.get('network_influence')}")
                        found = True
        
        if not found:
            print("FAILURE: No supremacy fields found after cycle.")
            
    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(force_verify())

