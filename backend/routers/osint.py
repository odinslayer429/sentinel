from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Dict, Any, Optional
from services.osint_service import osint_scanner

router = APIRouter(prefix="/api/osint", tags=["OSINT"])

class ScanRequest(BaseModel):
    target: str
    type: str # "URL" or "PHONE"

@router.post("/scan")
async def scan_target(req: ScanRequest):
    """
    Scans a target (URL or Phone) and returns a Gemini-synthesized trust score.
    """
    try:
        if req.type.upper() == "URL":
            return await osint_scanner.scan_url(req.target)
        elif req.type.upper() == "PHONE":
            return await osint_scanner.scan_phone(req.target)
        else:
            raise HTTPException(status_code=400, detail="Invalid scan type. Use 'URL' or 'PHONE'.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

