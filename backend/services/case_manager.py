import logging
from typing import Dict, List, Optional
from sqlalchemy.orm import Session
from db.database import SessionLocal
from db.models import FIRCase, CaseUpdate

logger = logging.getLogger(__name__)

def update_case_status(fir_id: int, status: str, officer_id: str, notes: str = "") -> bool:
    """Updates the overarching status of a FIR and creates an auditable case update."""
    db = SessionLocal()
    try:
        case = db.query(FIRCase).filter(FIRCase.id == fir_id).first()
        if not case:
            return False
            
        case.status = status
        if status.lower() in ["closed", "resolved"]:
            case.resolution_notes = notes
            
        update = CaseUpdate(
            fir_id=fir_id,
            update_type="STATUS_CHANGE",
            notes=f"Status changed to {status}. {notes}",
            created_by=officer_id
        )
        db.add(update)
        db.commit()
        return True
    except Exception as exc:
        logger.error("Failed to update case status: %s", exc)
        return False
    finally:
        db.close()

def assign_officer(fir_id: int, officer_id: str) -> bool:
    """Assigns an officer to investigate the FIR."""
    db = SessionLocal()
    try:
        case = db.query(FIRCase).filter(FIRCase.id == fir_id).first()
        if not case:
            return False
            
        case.assigned_officer = officer_id
        
        update = CaseUpdate(
            fir_id=fir_id,
            update_type="OFFICER_ASSIGNMENT",
            notes=f"Assigned officer {officer_id} to case.",
            created_by="system"
        )
        db.add(update)
        db.commit()
        return True
    finally:
        db.close()

def add_case_update(fir_id: int, update_type: str, notes: str, officer_id: str) -> bool:
    """Adds a general investigation log timestamp."""
    db = SessionLocal()
    try:
        update = CaseUpdate(
            fir_id=fir_id,
            update_type=update_type,
            notes=notes,
            created_by=officer_id
        )
        db.add(update)
        db.commit()
        return True
    except Exception as exc:
        logger.error("Failed to add case update logs: %s", exc)
        return False
    finally:
        db.close()

def get_case_timeline(fir_id: int) -> List[Dict]:
    """Returns the full history / lifecycle tracking of an FIR case."""
    db = SessionLocal()
    try:
        updates = db.query(CaseUpdate).filter(CaseUpdate.fir_id == fir_id).order_by(CaseUpdate.created_at.desc()).all()
        return [{
            "id": u.id,
            "update_type": u.update_type,
            "notes": u.notes,
            "created_by": u.created_by,
            "created_at": u.created_at.isoformat() if u.created_at else None
        } for u in updates]
    finally:
        db.close()

def get_all_cases() -> List[Dict]:
    """Retrieves basic overview of all cases."""
    db = SessionLocal()
    try:
        cases = db.query(FIRCase).order_by(FIRCase.created_at.desc()).all()
        return [{
            "id": c.id,
            "fir_number": c.fir_number,
            "crime_type": c.crime_type,
            "zone": c.zone,
            "status": c.status,
            "assigned_officer": c.assigned_officer,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None
        } for c in cases]
    finally:
        db.close()

