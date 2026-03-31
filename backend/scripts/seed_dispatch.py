import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.abspath(os.path.join(os.path.dirname(__file__), '../../.env')))

from db.database import SessionLocal, engine, Base
from db.models import DispatchTask, Alert, User
from services.zone_graph import ZONES
from datetime import datetime, timedelta
import random

# Create tables if they don't exist
Base.metadata.create_all(bind=engine)

TYPES = ["Patrol", "FIR Response", "OSINT Follow-up", "Raid", "Surveillance", "Crowd Control"]
PRIORITIES = ["HIGH", "MEDIUM", "LOW"]
STATUSES = ["PENDING", "ACKNOWLEDGED", "RESOLVED"]

db = SessionLocal()
try:
    # Ensure a default officer exists
    officer = db.query(User).filter_by(id=1).first()
    if not officer:
        print("ℹ️ Creating default officer (ID: 1)")
        officer = User(id=1, username="officer_01", hashed_password=os.getenv("DEFAULT_SEED_PASSWORD", "fake_hash"), role="OFFICER", badge_number="PS-123")
        db.add(officer)
        db.commit()

    zone_ids = list(ZONES.keys())

    for i in range(50):
        zid = random.choice(zone_ids)
        zname = ZONES[zid]["short"]
        created_at = datetime.utcnow() - timedelta(hours=random.randint(0, 48))
        
        # 1. Create the Alert first
        alert = Alert(
            title=f"{random.choice(TYPES)} — {zname}",
            message=f"Urgent dispatch required for {random.choice(TYPES)} in {zname}.",
            severity=random.choice(PRIORITIES),
            zone_id=zid,
            zone=ZONES[zid]["name"],
            created_at=created_at,
            is_active=True
        )
        db.add(alert)
        db.flush() # Get the alert ID

        # 2. Link the DispatchTask to the Alert
        task = DispatchTask(
            alert_id=alert.id,
            user_id=1, # Assigned to our default officer
            status=random.choice(STATUSES),
            notes=f"Mission critical task {i+1}",
            created_at=created_at,
            updated_at=datetime.utcnow()
        )
        db.add(task)

    db.commit()
    print("✅ 50 dispatch tasks seeded successfully")
except Exception as e:
    db.rollback()
    print(f"❌ Seeding failed: {e}")
finally:
    db.close()

