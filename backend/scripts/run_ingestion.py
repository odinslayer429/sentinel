import os
import pandas as pd
from services.ingestion import IngestionService
from db.database import SessionLocal
from db.models import User

def run_sample_ingestion():
    # 1. Ensure officer01 exists for guest mode
    db = SessionLocal()
    user = db.query(User).filter(User.username == "officer01").first()
    if not user:
        print("Creating officer01 for guest mode...")
        from services.auth import get_password_hash
        new_user = User(
            username="officer01",
            hashed_password=get_password_hash("password123"),
            role="Admin"
        )
        db.add(new_user)
        db.commit()
    db.close()

    # 2. Ingest Sample Crime
    crime_csv = "d:/Sentinel/data/mumbai_crime_historical_2020_2024.csv"
    if os.path.exists(crime_csv):
        df = pd.read_csv(crime_csv)
        sample_crime = df.head(1000)
        sample_crime.to_csv("d:/Sentinel/data/sample_crime.csv", index=False)
        IngestionService.ingest_historical_crime("d:/Sentinel/data/sample_crime.csv")
    
    # 3. Ingest Sample UPI
    upi_csv = "d:/Sentinel/data/upi_fraud_historical_2024_2025.csv"
    if os.path.exists(upi_csv):
        df = pd.read_csv(upi_csv)
        sample_upi = df.head(500)
        sample_upi.to_csv("d:/Sentinel/data/sample_upi.csv", index=False)
        IngestionService.ingest_upi_fraud("d:/Sentinel/data/sample_upi.csv")

if __name__ == "__main__":
    run_sample_ingestion()

