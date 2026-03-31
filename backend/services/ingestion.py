import pandas as pd
import logging
from sqlalchemy.orm import Session
from db.database import SessionLocal
from db.models import FIRCase, Suspect, Entity, FIREntityLink, CrimeEvent
from datetime import datetime

logger = logging.getLogger(__name__)

class IngestionService:
    @staticmethod
    def ingest_historical_crime(csv_path: str):
        """Loads historical Mumbai crime with per-record isolation."""
        db = SessionLocal()
        new_count = 0
        skip_count = 0
        try:
            df = pd.read_csv(csv_path)
            for _, row in df.iterrows():
                try:
                    s_hash = f"HIST_{record_hash(row)}"
                    # 1. Check if exists (fast optimization)
                    existing = db.query(CrimeEvent).filter(CrimeEvent.story_hash == s_hash).first()
                    if not existing:
                        event = CrimeEvent(
                            story_hash=s_hash,
                            title=f"{row['crime_type']} in {row['ward_name']}",
                            description=f"Historical record from {row['date']}. Section: {row['ipc_section']}",
                            crime_types=f"['{row['crime_type']}']",
                            zone_id=row['ward_code'],
                            zone=row['ward_name'],
                            severity=row['severity'].upper(),
                            published_at=datetime.strptime(row['date'], "%Y-%m-%d"),
                            is_processed=True
                        )
                        db.add(event)
                        db.commit() # Commit individually to isolate errors
                        new_count += 1
                        if new_count % 500 == 0:
                            print(f"Progress: {new_count} new records added...")
                    else:
                        skip_count += 1
                except Exception:
                    db.rollback()
                    skip_count += 1
            print(f"Final: {new_count} added, {skip_count} skipped/existing.")
        except Exception as e:
            logger.error(f"Global historical ingestion failed: {e}")
        finally:
            db.close()

    @staticmethod
    def ingest_upi_fraud(csv_path: str):
        """Loads UPI fraud with per-record isolation."""
        db = SessionLocal()
        new_count = 0
        skip_count = 0
        try:
            df = pd.read_csv(csv_path)
            for _, row in df.iterrows():
                try:
                    # UPI ID
                    val = row['upi_id']
                    if not db.query(Entity).filter(Entity.value == val).first():
                        db.add(Entity(type="UPI", value=val))
                        db.commit()
                        new_count += 1
                    
                    # URL
                    url_val = row['phishing_url']
                    if url_val and not db.query(Entity).filter(Entity.value == url_val).first():
                        db.add(Entity(type="URL", value=url_val))
                        db.commit()
                        new_count += 1
                except Exception:
                    db.rollback()
                    skip_count += 1
            print(f"Final: {new_count} fraud nodes added, {skip_count} skipped.")
        finally:
            db.close()

def record_hash(row):
    import hashlib
    content = f"{row['date']}{row['ward_code']}{row['crime_type']}"
    return hashlib.md5(content.encode()).hexdigest()[:12]

