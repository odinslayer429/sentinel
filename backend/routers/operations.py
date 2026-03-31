from fastapi import APIRouter, Depends, HTTPException, Body
from typing import List, Dict

from services import dispatch_ops
from services.auth import get_current_user, get_current_active_dispatcher
from db.models import User

router = APIRouter(prefix="/api/ops", tags=["Operations"])

@router.get("/my-tasks")
def get_my_tasks(current_user: User = Depends(get_current_user)):
    """Officer fetches their queue of active tasks/dispatches."""
    return dispatch_ops.get_tasks_for_user(current_user.id)

@router.post("/tasks/{task_id}/status")
def update_task(task_id: int, status: str = Body(embed=True), notes: str = Body(default="", embed=True), current_user: User = Depends(get_current_user)):
    """Officer moving a task from PENDING -> ACKNOWLEDGED -> RESOLVED."""
    success = dispatch_ops.update_task_status(task_id, current_user.id, status, notes)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to update task or unauthorized.")
    return {"status": "success"}

@router.post("/dispatch")
def assign_dispatch(alert_id: int = Body(embed=True), assign_to_user_id: int = Body(embed=True), notes: str = Body(default="", embed=True), current_dispatcher: User = Depends(get_current_active_dispatcher)):
    """Dispatcher or Admin route to manually assign an alert to a specific officer user."""
    task_id = dispatch_ops.assign_task(alert_id, assign_to_user_id, notes)
    if not task_id:
        raise HTTPException(status_code=400, detail="Failed to assign task.")
    return {"status": "success", "task_id": task_id}

@router.get("/tasks")
def get_all_ops_tasks(current_user: User = Depends(get_current_user)):
    return dispatch_ops.get_all_tasks()

