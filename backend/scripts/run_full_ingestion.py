import os
from services.ingestion import IngestionService
from db.database import SessionLocal
from db.models import User

def run_full_ingestion():
    # 1. Ingest Full Crime Dataset (25k+ records)
    crime_csv = "d:/Sentinel/data/mumbai_crime_historical_2020_2024.csv"
    if os.path.exists(crime_csv):
        print("Starting full Mumbai Crime ingestion (2020-2024)...")
        IngestionService.ingest_historical_crime(crime_csv)
    
    # 2. Ingest Full UPI Fraud Dataset (4k+ records)
    upi_csv = "d:/Sentinel/data/upi_fraud_historical_2024_2025.csv"
    if os.path.exists(upi_csv):
        print("Starting full UPI Fraud ingestion (2024-2025)...")
        IngestionService.ingest_upi_fraud(upi_csv)

if __name__ == "__main__":
    run_full_ingestion()

