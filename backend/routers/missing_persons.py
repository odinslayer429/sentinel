from fastapi import APIRouter, UploadFile, File, Depends
from services.ml_models import ml_service
from services.auth import get_current_user
import uuid

router = APIRouter(prefix="/api/missing", tags=["Missing Persons Tracker"])

@router.post("/search")
async def search_missing(file: UploadFile = File(...), days_missing: int = 0, user=Depends(get_current_user)):
    contents = await file.read()
    # In production: DeepFace age-progression → CCTV Embedding search
    # Mocked for now
    matches = [
        {"id": str(uuid.uuid4()), "recency": "2h ago", "location": "Andheri West", "confidence": 0.88},
        {"id": str(uuid.uuid4()), "recency": "5h ago", "location": "Goregaon Station", "confidence": 0.72},
        {"id": str(uuid.uuid4()), "recency": "1d ago", "location": "Borivali East", "confidence": 0.65}
    ]
    return {"matches": matches, "count": len(matches)}

@router.post("/report")
async def report_missing(details: dict, user=Depends(get_current_user)):
    # Save to database
    return {"status": "Reported", "id": str(uuid.uuid1())}

