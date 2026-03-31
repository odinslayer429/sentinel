import asyncio
import httpx
import logging
import pandas as pd
import pdfplumber
import os
import uuid
from datetime import datetime
from datasets import load_dataset
from sqlalchemy.orm import sessionmaker
from backend.db.database import engine, Base
from backend.db.models import CrimeRecord, IngestionLog
# from geoalchemy2.shape import from_shape # Optional if not using PostGIS in seed script directly
# from shapely.geometry import Point

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("HistoricalLoader")

# Ensure tables exist
Base.metadata.create_all(bind=engine)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

async def load_huggingface_data():
    logger.info("Loading HuggingFace Mumbai Crime Dataset...")
    session = SessionLocal()
    try:
        dataset = load_dataset("shreyaskal3/crime-stats-mumbai-2018-2025")
        df = dataset['train'].to_pandas()
        
        inserted = 0
        dupes = 0
        for _, row in df.iterrows():
            # Deduplication logic (crime_type, ward, month)
            # crime_code, crime_name, month_end_date, detected, registered
            dt = pd.to_datetime(row['month_end_date'])
            exists = session.query(CrimeRecord).filter(
                CrimeRecord.crime_type == row['crime_name'],
                CrimeRecord.registered_at == dt
            ).first()
            
            if not exists:
                crime = CrimeRecord(
                    source_tag="huggingface",
                    crime_type=str(row['crime_name']),
                    registered_at=dt,
                    detected=bool(row['detected']),
                    raw_text=str(row.to_dict())
                )
                session.add(crime)
                inserted = (inserted or 0) + 1
            else:
                dupes = (dupes or 0) + 1
        
        session.commit()
        logger.info(f"HF Ingestion: {inserted} inserted, {dupes} dupes skipped.")
        return inserted, dupes
    except Exception as e:
        logger.error(f"HF Load failed: {e}")
        return 0, 0
    finally:
        session.close()

async def load_opencity_data():
    logger.info("Loading OpenCity Mumbai Crime Data...")
    session = SessionLocal()
    try:
        # Dummy actual CSV fetch and parse
        # In real case: httpx.get -> csv.DictReader
        inserted = 0
        logger.info("OpenCity data processed.")
        return inserted, 0
    except Exception as e:
        logger.error(f"OpenCity Load failed: {e}")
        return 0, 0
    finally:
        session.close()

async def scrape_mumbai_police_pdfs():
    logger.info("Scraping Mumbai Police Crime Info PDFs...")
    # Placeholder for actual pdfplumber scraper
    return 0, 0

async def main():
    logger.info("Starting Parallel Historical Ingestion...")
    tasks = [
        load_huggingface_data(),
        load_opencity_data(),
        scrape_mumbai_police_pdfs()
    ]
    results = await asyncio.gather(*tasks)
    
    total_inserted = sum(r[0] if r else 0 for r in results)
    logger.info(f"Historical Ingestion Complete. Total Inserted: {total_inserted}")

if __name__ == "__main__":
    asyncio.run(main())
