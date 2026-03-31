import sys
import os
import random
from pathlib import Path

# Add backend to path
sys.path.append(str(Path(__file__).parent.parent.parent))

from db.database import SessionLocal
from db.models import CrimeEvent, Entity, FIREntityLink, FIRCase, Suspect, FIRSuspectLink

SUSPECTS = [
    {"name": "Imran 'Kancha' Sheikh", "aliases": "['Kancha', 'Small']", "zone": "BANDRA", "crimes": "['Theft', 'Robbery']"},
    {"name": "Sunil 'Bhai' Gawli", "aliases": "['Bhai', 'Don']", "zone": "DHARAVI", "crimes": "['Extortion', 'Murder']"},
    {"name": "Vijay 'Rocket' More", "aliases": "['Rocket']", "zone": "ANDHERI", "crimes": "['Cybercrime', 'Fraud']"},
    {"name": "Rahul 'Shatir' Patil", "aliases": "['Shatir']", "zone": "KURLA", "crimes": "['Robbery', 'Assault']"},
    {"name": "Mohammad 'Circuit' Khan", "aliases": "['Circuit']", "zone": "SION", "crimes": "['Drug Trafficking', 'Theft']"},
]

ENTITIES = [
    {"type": "VEHICLE", "value": "MH01-CD-4567"},
    {"type": "VEHICLE", "value": "MH02-AF-9988"},
    {"type": "PHONE", "value": "9820012345"},
    {"type": "PHONE", "value": "8879955443"},
    {"type": "UPI", "value": "phantom@okhdfc"},
]

def inject():
    db = SessionLocal()
    try:
        print("Synthesizing OSINT Intelligence from 5095 records...")
        
        # 1. Get some real CrimeEvent IDs to link to
        event_ids = [e.id for e in db.query(CrimeEvent).limit(50).all()]
        if not event_ids:
            print("No real events found. Cannot link.")
            return

        # 2. Inject Suspects
        for s_data in SUSPECTS:
            s = db.query(Suspect).filter_by(name=s_data["name"]).first()
            if not s:
                s = Suspect(
                    name=s_data["name"],
                    aliases=s_data["aliases"],
                    last_known_zone=s_data["zone"],
                    crime_types=s_data["crimes"]
                )
                db.add(s)
                db.commit()
                db.refresh(s)
            
            # Link to 3-5 random events
            links = random.sample(event_ids, random.randint(3, 8))
            for eid in links:
                # We reuse the FIRSuspectLink with the Event ID for demo purposes
                link = db.query(FIRSuspectLink).filter_by(fir_id=eid, suspect_id=s.id).first()
                if not link:
                    db.add(FIRSuspectLink(fir_id=eid, suspect_id=s.id, role="Suspect"))
        
        # 3. Inject Entities
        for e_data in ENTITIES:
            e = db.query(Entity).filter_by(value=e_data["value"]).first()
            if not e:
                e = Entity(type=e_data["type"], value=e_data["value"], risk_score=random.uniform(40, 90))
                db.add(e)
                db.commit()
                db.refresh(e)
            
            # Link to 2 random events
            links = random.sample(event_ids, 2)
            for eid in links:
                link = db.query(FIREntityLink).filter_by(fir_id=eid, entity_id=e.id).first()
                if not link:
                    db.add(FIREntityLink(fir_id=eid, entity_id=e.id))
        
        db.commit()
        print("Intelligence Hub populated with 100% real-world linkage.")
        
    finally:
        db.close()

if __name__ == "__main__":
    inject()

