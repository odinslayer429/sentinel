"""
scripts/seed_risk_scores.py
────────────────────────────
Seeds ZoneRiskScore table with realistic Mumbai crime risk data.
Run once to give the LP optimizer meaningful differentiation.

Usage:
    cd D:\sentinel\backend
    python -m scripts.seed_risk_scores
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.database import SessionLocal
from db.models import ZoneRiskScore
from datetime import datetime

# Realistic Mumbai zone risk scores based on actual crime geography
# Higher = more incidents historically
ZONE_RISK_DATA = [
    {"zone_id": "Z01", "zone_name": "Colaba-Cuffe Parade",       "risk_score": 45.0,  "trend": "STABLE",   "dominant_crime_type": "theft"},
    {"zone_id": "Z02", "zone_name": "Azad Maidan-Byculla",       "risk_score": 62.0,  "trend": "UP",      "dominant_crime_type": "assault"},
    {"zone_id": "Z03", "zone_name": "Worli-Lower Parel",         "risk_score": 38.0,  "trend": "DOWN",    "dominant_crime_type": "theft"},
    {"zone_id": "Z04", "zone_name": "Dadar-Matunga",             "risk_score": 55.0,  "trend": "STABLE",  "dominant_crime_type": "robbery"},
    {"zone_id": "Z05", "zone_name": "Dharavi-Sion",              "risk_score": 78.0,  "trend": "UP",      "dominant_crime_type": "organized_crime"},
    {"zone_id": "Z06", "zone_name": "Kurla-Chembur",             "risk_score": 71.0,  "trend": "UP",      "dominant_crime_type": "assault"},
    {"zone_id": "Z07", "zone_name": "Santacruz-Vile Parle",      "risk_score": 49.0,  "trend": "STABLE",  "dominant_crime_type": "theft"},
    {"zone_id": "Z08", "zone_name": "Andheri-Jogeshwari",        "risk_score": 83.0,  "trend": "UP",      "dominant_crime_type": "robbery"},
    {"zone_id": "Z09", "zone_name": "Malad-Kandivali",           "risk_score": 52.0,  "trend": "STABLE",  "dominant_crime_type": "theft"},
    {"zone_id": "Z10", "zone_name": "Borivali-Dahisar",          "risk_score": 41.0,  "trend": "DOWN",    "dominant_crime_type": "theft"},
    {"zone_id": "Z11", "zone_name": "Bandra-Khar",               "risk_score": 58.0,  "trend": "UP",      "dominant_crime_type": "cybercrime"},
    {"zone_id": "Z12", "zone_name": "Juhu-Versova",              "risk_score": 35.0,  "trend": "STABLE",  "dominant_crime_type": "theft"},
    {"zone_id": "Z13", "zone_name": "Vasai-Nalasopara",          "risk_score": 76.0,  "trend": "UP",      "dominant_crime_type": "gang_activity"},
    {"zone_id": "Z14", "zone_name": "Mira Road-Bhayander",       "risk_score": 60.0,  "trend": "UP",      "dominant_crime_type": "robbery"},
    {"zone_id": "Z15", "zone_name": "Thane-Mumbra",              "risk_score": 67.0,  "trend": "STABLE",  "dominant_crime_type": "assault"},
    {"zone_id": "Z16", "zone_name": "Navi Mumbai-Vashi",         "risk_score": 44.0,  "trend": "DOWN",    "dominant_crime_type": "theft"},
    {"zone_id": "Z17", "zone_name": "Panvel-Kharghar",           "risk_score": 39.0,  "trend": "STABLE",  "dominant_crime_type": "theft"},
    {"zone_id": "Z18", "zone_name": "Ghatkopar-Vikhroli",        "risk_score": 69.0,  "trend": "UP",      "dominant_crime_type": "robbery"},
    {"zone_id": "Z19", "zone_name": "Bhandup-Kanjurmarg",        "risk_score": 57.0,  "trend": "STABLE",  "dominant_crime_type": "assault"},
    {"zone_id": "Z20", "zone_name": "Mulund-Nahur",              "risk_score": 33.0,  "trend": "DOWN",    "dominant_crime_type": "theft"},
]

def seed():
    db = SessionLocal()
    try:
        # Clear existing scores
        db.query(ZoneRiskScore).delete()
        for z in ZONE_RISK_DATA:
            row = ZoneRiskScore(
                zone_id=z["zone_id"],
                zone_name=z["zone_name"],
                risk_score=z["risk_score"],
                hawkes_intensity=z["risk_score"] / 100.0,
                trend=z["trend"],
                dominant_crime_type=z["dominant_crime_type"],
                event_count_1h=int(z["risk_score"] / 10),
                event_count_6h=int(z["risk_score"] / 5),
                event_count_24h=int(z["risk_score"] / 2),
                weather_multiplier=1.0,
                computed_at=datetime.utcnow(),
            )
            db.add(row)
        db.commit()
        print(f"Seeded {len(ZONE_RISK_DATA)} zone risk scores.")
        print("Top 5 risk zones:")
        top5 = sorted(ZONE_RISK_DATA, key=lambda x: x['risk_score'], reverse=True)[:5]
        for z in top5:
            print(f"  {z['zone_id']} {z['zone_name']}: {z['risk_score']}")
    except Exception as e:
        db.rollback()
        print(f"Seed failed: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed()
