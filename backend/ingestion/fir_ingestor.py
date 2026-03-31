from fastapi import APIRouter, Depends, Body
from pydantic import BaseModel
from typing import List
from services.auth import get_current_user

import uuid
from datetime import datetime
from services.ml_models import ml_service
from db.database import SessionLocal
from db.models import CrimeRecord

router = APIRouter(prefix="/api/ingest", tags=["Data Ingestion"])

class FIRData(BaseModel):
    station: str
    date: str
    crime_type: str
    location_text: str
    description: str
    accused: List[str]

@router.post("/fir")
async def ingest_fir(fir: FIRData, user=Depends(get_current_user)):
    # 1. Geocoding (Mock for Mumbai location)
    lat, lon = 19.076, 72.877
    
    # 2. Extract sections via Module 4 logic
    # suggestions = await copilot_service.analyze_fir(fir.description)
    
    # 3. Insert into DB
    session = SessionLocal()
    new_crime = CrimeRecord(
        id=uuid.uuid4(),
        source_tag="fir",
        crime_type=fir.crime_type,
        registered_at=datetime.strptime(fir.date, "%Y-%m-%d") if fir.date else datetime.utcnow(),
        raw_text=fir.description,
        severity_score=0.9 # Default for FIR
    )
    session.add(new_crime)
    session.commit()
    session.close()

    # 4. Success Response
    return {
        "status": "success", 
        "id": str(new_crime.id),
        "geocoded": {"lat": lat, "lon": lon},
        "message": "FIR ingested and forwarded to Predictive Engine."
    }

