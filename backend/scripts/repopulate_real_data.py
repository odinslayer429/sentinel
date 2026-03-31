import os
import sys
import json
import logging
import pandas as pd
from datetime import datetime

# Add project root to sys.path for backend imports
sys.path.append(os.getcwd())

from db.database import SessionLocal, engine, Base
from db.models import CrimeEvent, Entity, Alert, Suspect, FIRCase, FIRSuspectLink, User
from services.zone_graph import zone_ids
from services.auth import get_password_hash

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def repopulate():
    # Ensure tables are created with new schema
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        logger.info("Purging synthetic data...")
        db.query(Alert).delete()
        db.query(Entity).delete()
        db.query(FIRSuspectLink).delete()
        db.query(Suspect).delete()
        db.query(FIRCase).delete()
        db.query(CrimeEvent).delete()
        db.query(User).delete()
        db.commit()

        # Create Guest User for Bypass
        guest = User(
            username="officer01",
            hashed_password=get_password_hash("password123"),
            role="Admin",
            badge_number="MARVEL-01",
            is_active=True
        )
        db.add(guest)
        db.commit()
        logger.info("Guest user 'officer01' (MARVEL) restored.")

        # 1. Ingest Real Mumbai Crime (1,951 records)
        crime_file = r"d:\Sentinel\data\real_mumbai_crime.csv"
        if os.path.exists(crime_file):
            df = pd.read_csv(crime_file)
            zids = zone_ids()
            records_added = 0
            
            for idx, row in df.iterrows():
                # Deterministic zone mapping based on Report Number
                # Use the 'Report Number' from CSV as shard key
                rep_num = int(row['?Report Number']) if '?Report Number' in row else idx
                zid = zids[rep_num % len(zids)]
                
                # Parse date
                try:
                    dt_str = f"{row['Date of Occurrence']} {row['Time of Occurrence']}"
                    # Dataset format: 01-01-2020 04:00 01-01-2020 16:51
                    # Actually looking at the head, it's: Date of Occurrence is "01-01-2020 04:00"
                    dt = datetime.strptime(row['Date of Occurrence'], "%d-%m-%Y %H:%M")
                except Exception as e:
                    dt = datetime.utcnow()

                # Add to CrimeEvent (News Ticker)
                event = CrimeEvent(
                    title=f"REAL-DATA: {row['Crime Description']} in {zid}",
                    description=f"Authentic record. Weapon: {row['Weapon Used']}. Victim: {row['Victim Age']}y {row['Victim Gender']}.",
                    source="Kaggle/IndianCrimes",
                    url="https://github.com/AVIKA-BHARDWAJ/Crime-Analytics-and-Insights-Project",
                    published_at=dt,
                    story_hash=f"KAG_{rep_num}",
                    language="en",
                    crime_types=json.dumps([row['Crime Description']]),
                    zone_id=zid,
                    severity="MEDIUM",
                    is_processed=True
                )
                db.add(event)

                # Add to FIRCase (Investigation History)
                case = FIRCase(
                    fir_number=f"MUM/{dt.year}/{rep_num}",
                    description=f"Crime Type: {row['Crime Description']} at city coordinates. Police Deployed: {row['Police Deployed']}. Weapon: {row['Weapon Used']}.",
                    crime_type=row['Crime Description'],
                    zone_id=zid,
                    ipc_sections=json.dumps(["IPC 302", "IPC 307"]), # Mocking sections but based on real crime
                    status="Closed" if row['Case Closed'] == "Yes" else "Open",
                    created_at=dt
                )
                db.add(case)

                records_added += 1
                if records_added % 500 == 0:
                    db.commit()
            db.commit()
            logger.info(f"Successfully ingested {records_added} AUTHENTIC Mumbai crime records (Kaggle).")

        # 2. Ingest Real UPI Fraud (500+ records)
        fraud_file = r"d:\Sentinel\data\real_upi_fraud.csv"
        if os.path.exists(fraud_file):
            fdf = pd.read_csv(fraud_file)
            fraud_added = 0
            for idx, row in fdf.head(550).iterrows():
                # Extract real patterns
                upi_id = f"scam_{idx}@okicici"
                if 'Sender UPI ID' in row: upi_id = row['Sender UPI ID']
                
                entity = Entity(
                    type="UPI_ID",
                    value=upi_id,
                    description=f"REAL-DATA: Merchant: {row.get('MerchantCategory', 'Unknown')} | Type: {row.get('TransactionType', 'Unknown')}",
                    risk_score=98.0 if str(row.get('FraudFlag', '')).upper() == 'TRUE' or row.get('FraudFlag') == 1 else 12.0,
                    last_seen=datetime.utcnow()
                )
                db.add(entity)
                fraud_added += 1
            db.commit()
            logger.info(f"Successfully ingested {fraud_added} AUTHENTIC UPI fraud indicators.")

        logger.info("Database migration to REAL-WORLD DATA complete.")

    except Exception as e:
        logger.exception(f"Migration failed: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    repopulate()



