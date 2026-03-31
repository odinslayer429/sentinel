from fastapi import APIRouter, Depends, Body
from typing import Dict, Any, List
from services.cyber_copilot_v2 import query_legal_rag, auto_suggest_sections
from services.fraud_detector import predict_fraud_risk
from services.phishing_detector import PhishingDetector
from services.auth import get_current_user

router = APIRouter(prefix="/api/cyber", tags=["Cybercrime"], dependencies=[Depends(get_current_user)])

@router.post("/copilot")
async def copilot_chat(query: str = Body(embed=True)):
    """MARVEL MahaCrimeOS AI Assistant (RAG V2)."""
    return await query_legal_rag(query)

@router.post("/fraud/score")
async def fraud_score(transaction: Dict[str, Any] = Body(...)):
    """Predicts transaction fraud probability."""
    return predict_fraud_risk(transaction)

@router.get("/phishing/scan")
async def phishing_scan(url: str):
    """Lexical phishing scanner for URLs."""
    return PhishingDetector.scan_url(url)

@router.post("/fir/suggest")
async def suggest_sections(fir_text: str = Body(embed=True)):
    """Auto-suggests legal sections from FIR text."""
    return await auto_suggest_sections(fir_text)

