import logging
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from db.database import SessionLocal
from db.models import DispatchTask, Alert, User
from .zone_graph import ZONES

logger = logging.getLogger(__name__)

def assign_task(alert_id: int, user_id: int, notes: str = "") -> Optional[int]:
    """Creates a new dispatch task for an officer regarding an active alert."""
    db = SessionLocal()
    try:
        task = DispatchTask(
            alert_id=alert_id, 
            user_id=user_id, 
            status="PENDING", 
            notes=notes
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        return task.id
    except Exception as exc:
        logger.error("Failed to assign dispatch task: %s", exc)
        return None
    finally:
        db.close()

def update_task_status(task_id: int, user_id: int, status: str, notes: str = "") -> bool:
    """Updates status for a task assigned to a specific officer. e.g. ACKNOWLEDGED or RESOLVED."""
    db = SessionLocal()
    try:
        task = db.query(DispatchTask).filter(DispatchTask.id == task_id, DispatchTask.user_id == user_id).first()
        if not task:
            return False
            
        task.status = status
        if notes:
            task.notes = f"{task.notes}\n[Update]: {notes}" if task.notes else notes
            
        # If resolving the task, conditionally resolve the root Alert too.
        if status == "RESOLVED" and task.alert_id:
            alert = db.query(Alert).filter(Alert.id == task.alert_id).first()
            if alert:
                alert.is_active = False
                
        db.commit()
        return True
    except Exception as exc:
        logger.error("Failed to update task status: %s", exc)
        return False
    finally:
        db.close()

def get_tasks_for_user(user_id: int) -> List[Dict]:
    """Retrieves all tasks for the logged-in officer."""
    db = SessionLocal()
    try:
        tasks = db.query(DispatchTask).filter(DispatchTask.user_id == user_id).order_by(DispatchTask.created_at.desc()).all()
        result = []
        for t in tasks:
            alert_title = None
            zone_id = None
            severity = "INFO"
            if t.alert_id:
                a = db.query(Alert).filter(Alert.id == t.alert_id).first()
                if a:
                    alert_title = a.title
                    zone_id = a.zone_id
                    severity = a.severity
            
            result.append({
                "id": t.id,
                "alert_id": t.alert_id,
                "alert_title": alert_title,
                "zone_id": zone_id,
                "severity": severity,
                "status": t.status,
                "notes": t.notes,
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "updated_at": t.updated_at.isoformat() if t.updated_at else None
            })
        return result
    finally:
        db.close()

import math

POLICE_UNITS = [
    {"id": "QRV-01", "name": "Bandra QRV", "lat": 19.0596, "lon": 72.8295, "type": "MOBILE"},
    {"id": "QRV-02", "name": "Dharavi Patrol", "lat": 19.0380, "lon": 72.8538, "type": "MOBILE"},
    {"id": "PS-COLABA", "name": "Colaba Police Station", "lat": 18.9150, "lon": 72.8258, "type": "STATION"},
    {"id": "PS-ANDHERI", "name": "Andheri CP Office", "lat": 19.1136, "lon": 72.8697, "type": "STATION"},
    {"id": "QRV-05", "name": "Borivali Interceptor", "lat": 19.2307, "lon": 72.8567, "type": "MOBILE"},
]

def calculate_distance(lat1, lon1, lat2, lon2) -> float:
    """Haversine distance in KM."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 2)

def get_dispatch_recommendation(zone_id: str) -> Dict:
    """Finds the closest unit for a zone and returns details."""
    zone = ZONES.get(zone_id)
    if not zone: return {"unit": "HQ_CENTRAL", "dist": 0, "eta": "N/A"}
    
    zlat, zlon = zone["lat"], zone["lon"]
    best_unit = min(POLICE_UNITS, key=lambda u: calculate_distance(zlat, zlon, u["lat"], u["lon"]))
    dist = calculate_distance(zlat, zlon, best_unit["lat"], best_unit["lon"])
    eta = int(dist * 2.5 + 2) # Heuristic for Mumbai traffic
    
    return {
        "unit_id": best_unit["id"],
        "unit_name": best_unit["name"],
        "distance_km": dist,
        "eta_mins": eta,
        "type": best_unit["type"]
    }

def get_all_tasks() -> List[Dict]:
    """Retrieves all tasks with autonomous unit recommendations."""
    db = SessionLocal()
    try:
        tasks = (
            db.query(DispatchTask, User.username, Alert.title, Alert.zone_id)
            .outerjoin(User, DispatchTask.user_id == User.id)
            .outerjoin(Alert, DispatchTask.alert_id == Alert.id)
            .order_by(DispatchTask.created_at.desc())
            .all()
        )
        result = []
        for t in tasks:
            rec = get_dispatch_recommendation(t[3]) if t[3] else {}
            result.append({
                "id": t[0].id,
                "status": t[0].status,
                "assigned_to": t[1],
                "alert_title": t[2],
                "zone_id": t[3],
                "lat": ZONES.get(t[3], {}).get("lat") if t[3] else None,
                "lon": ZONES.get(t[3], {}).get("lon") if t[3] else None,
                "notes": t[0].notes,
                "recommendation": rec,
                "created_at": t[0].created_at.isoformat() if t[0].created_at else None
            })
        return result
    finally:
        db.close()


