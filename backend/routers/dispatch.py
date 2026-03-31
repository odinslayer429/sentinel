"""
routers/dispatch.py
────────────────────
Dispatch command board endpoints.

GET  /api/dispatch/tasks         — list all active dispatch tasks (joined with alert data)
POST /api/dispatch/assign        — create a dispatch task for an officer
PATCH /api/dispatch/tasks/{id}   — update task status (PENDING → ACKNOWLEDGED → RESOLVED)
GET  /api/dispatch/summary       — summary counts per status for the dashboard card
"""

from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import DispatchTask, Alert, User
from services.dispatch_ops import assign_task, update_task_status, get_all_tasks
from services.zone_graph import ZONES

router = APIRouter(prefix="/api/dispatch", tags=["Dispatch"])


class AssignPayload(BaseModel):
    alert_id: int
    user_id: int = 1          # default officer if not specified
    notes: str = ""


class StatusPayload(BaseModel):
    status: str               # PENDING | ACKNOWLEDGED | RESOLVED
    user_id: int = 1
    notes: str = ""


def _serialize_task(t: DispatchTask, db: Session) -> dict:
    alert = db.query(Alert).filter_by(id=t.alert_id).first() if t.alert_id else None
    return {
        "id":         t.id,
        "alert_id":   t.alert_id,
        "user_id":    t.user_id,
        "status":     t.status,
        "notes":      t.notes,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
        "alert": {
            "title":    alert.title    if alert else "Unknown Alert",
            "severity": alert.severity if alert else "INFO",
            "zone_id":  alert.zone_id  if alert else None,
            "zone":     alert.zone     if alert else None,
        } if alert else None,
    }


@router.get("/tasks")
def list_tasks(
    status: Optional[str] = None,
    limit:  int = 50,
    db: Session = Depends(get_db),
):
    """All dispatch tasks, optionally filtered by status."""
    q = db.query(DispatchTask)
    if status:
        q = q.filter(DispatchTask.status == status.upper())
    tasks = q.order_by(DispatchTask.created_at.desc()).limit(limit).all()
    return [_serialize_task(t, db) for t in tasks]


@router.post("/assign")
def create_task(payload: AssignPayload, db: Session = Depends(get_db)):
    """Create a new dispatch task for an officer."""
    task_id = assign_task(payload.alert_id, payload.user_id, payload.notes)
    if not task_id:
        raise HTTPException(status_code=400, detail="Failed to create dispatch task.")
    return {"task_id": task_id, "status": "PENDING"}


@router.patch("/tasks/{task_id}")
def update_task(task_id: int, payload: StatusPayload, db: Session = Depends(get_db)):
    """Update task status. Valid: PENDING → ACKNOWLEDGED → RESOLVED."""
    valid = {"PENDING", "ACKNOWLEDGED", "RESOLVED"}
    if payload.status.upper() not in valid:
        raise HTTPException(status_code=422, detail=f"Status must be one of {valid}")
    ok = update_task_status(task_id, payload.user_id, payload.status.upper(), payload.notes)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found.")
    return {"task_id": task_id, "status": payload.status.upper()}


@router.get("/summary")
def dispatch_summary(db: Session = Depends(get_db)):
    """Summary counts for the Kanban header."""
    tasks = db.query(DispatchTask).all()
    counts = {"PENDING": 0, "ACKNOWLEDGED": 0, "RESOLVED": 0}
    for t in tasks:
        if t.status in counts:
            counts[t.status] += 1
    return {"counts": counts, "total": len(tasks)}

