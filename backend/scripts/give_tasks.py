import sys
sys.path.insert(0, r"d:\Sentinel")
from db.database import SessionLocal
from db.models import User, Alert, DispatchTask

def assign_alerts_to_demo_officer():
    db = SessionLocal()
    officer = db.query(User).filter_by(username="officer01").first()
    if not officer:
        print("Officer not found!")
        return
        
    alerts = db.query(Alert).limit(3).all()
    if not alerts:
        print("No alerts found to assign.")
        return
        
    for alert in alerts:
        # Check if already assigned
        existing = db.query(DispatchTask).filter_by(alert_id=alert.id, user_id=officer.id).first()
        if not existing:
            task = DispatchTask(
                alert_id=alert.id,
                user_id=officer.id,
                status="PENDING",
                notes="Priority task assigned dynamically for Sentinel demonstration."
            )
            db.add(task)
            
    db.commit()
    print("Tasks successfully dispatched to officer01 tactical queue.")
    db.close()

if __name__ == "__main__":
    assign_alerts_to_demo_officer()

