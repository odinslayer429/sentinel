from fastapi import APIRouter, UploadFile, File, Depends
from services.ml_models import ml_service
from services.auth import get_current_user

router = APIRouter(prefix="/api/anpr", tags=["ANPR"])

@router.post("/recognize")
async def recognize_plate(file: UploadFile = File(...), user=Depends(get_current_user)):
    contents = await file.read()
    result = ml_service.detect_plate(contents)
    
    # Mock SQLite check for stolen vehicle
    stolen_plates = ["MH01-AB-1234", "MH12-CC-9999"]
    result["stolen"] = result["plate"] in stolen_plates
    result["flag"] = "RED" if result["stolen"] else "GREEN"
    
    return result

