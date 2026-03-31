from fastapi import APIRouter, Body, Depends
from services.auth import get_current_user

router = APIRouter(prefix="/api/cyber", tags=["Cybercrime Fraud Detection"])

def rule_based_fraud_check(tx: dict) -> dict:
    """Lightweight rule-based fraud scorer — replaces deleted ml_service."""
    score = 0.0
    flags = []

    amount = float(tx.get("amount", 0))
    hour   = int(tx.get("hour", 12))
    is_new = tx.get("new_device", False)
    state  = str(tx.get("receiver_state", "")).lower()

    if amount > 50000:
        score += 0.35; flags.append("HIGH_VALUE_TRANSFER")
    elif amount > 10000:
        score += 0.15; flags.append("ELEVATED_AMOUNT")

    if hour < 5 or hour > 23:
        score += 0.25; flags.append("ODD_HOUR_TRANSACTION")

    if is_new:
        score += 0.20; flags.append("NEW_DEVICE_DETECTED")

    if state in ["jharkhand", "assam", "rajasthan"]:
        score += 0.15; flags.append("HIGH_RISK_RECEIVER_STATE")

    score = min(score, 1.0)
    verdict = "FRAUD" if score > 0.6 else "SUSPICIOUS" if score > 0.3 else "CLEAR"

    return {
        "fraud_score": round(score, 3),
        "verdict": verdict,
        "flags": flags,
        "amount": amount,
    }

@router.post("/check-transaction")
async def check_transaction(tx: dict = Body(...), user=Depends(get_current_user)):
    return rule_based_fraud_check(tx)

@router.get("/threats")
async def get_threat_summary(user=Depends(get_current_user)):
    return {
        "active_patterns": ["Sim-swapping waves in Zone 3", "Bulk UPI refund scams"],
        "flagged_accounts_count": 124,
        "total_diverted_sum": 4500000,
    }
