from fastapi import APIRouter, Body, Depends
from services.ml_models import ml_service
from services.auth import get_current_user

router = APIRouter(prefix="/api/cyber", tags=["Cybercrime Fraud Detection"])

@router.post("/check-transaction")
async def check_transaction(tx: dict = Body(...), user=Depends(get_current_user)):
    # Isolation Forest + LSTM logic
    res = ml_service.detect_fraud(tx)
    return res

@router.get("/threats")
async def get_threat_summary(user=Depends(get_current_user)):
    # Aggregated fraud cases
    return {
        "active_patterns": ["Sim-swapping waves in Zone 3", "Bulk UPI refund scams"],
        "flagged_accounts_count": 124,
        "total_diverted_sum": 4500000
    }

