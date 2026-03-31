import sys
import os
import re
import json
from pathlib import Path

# Add backend to path
sys.path.append(str(Path(__file__).parent.parent.parent))

from db.database import SessionLocal
from db.models import CrimeEvent, Entity, FIREntityLink, FIRCase

# Regex Patterns
_PHONE_RE = re.compile(r'\b[6-9]\d{9}\b')
_VEHICLE_RE = re.compile(r'\b[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{1,2}[ -]?\d{4}\b', re.IGNORECASE)
_UPI_RE = re.compile(r'\b[a-zA-Z0-9.\-_]+@[a-zA-Z]+\b')

def pump():
    db = SessionLocal()
    try:
        # 1. Ensure a 'Global Feed' FIR exists to host OSINT entities if needed
        global_fir = db.query(FIRCase).filter_by(fir_number="OSINT-PRO-2026").first()
        if not global_fir:
            global_fir = FIRCase(
                fir_number="OSINT-PRO-2026",
                description="Aggregated OSINT feed for real-time entity tracking.",
                crime_type="OSINT",
                zone="MUMBAI-GLOBAL"
            )
            db.add(global_fir)
            db.commit()
            db.refresh(global_fir)
        
        events = db.query(CrimeEvent).all()
        print(f"Scanning {len(events)} events for tactical entities...")
        
        entities_found = 0
        for ev in events:
            text = f"{ev.title} {ev.description or ''}"
            
            phones = _PHONE_RE.findall(text)
            vehicles = _VEHICLE_RE.findall(text)
            upis = _UPI_RE.findall(text)
            
            for p in phones:
                _save_entity(db, p, "PHONE", global_fir.id)
                entities_found += 1
            for v in vehicles:
                _save_entity(db, v.upper(), "VEHICLE", global_fir.id)
                entities_found += 1
            for u in upis:
                _save_entity(db, u.lower(), "UPI", global_fir.id)
                entities_found += 1
            
            if entities_found % 50 == 0 and entities_found > 0:
                print(f"  Extracted {entities_found} entities...")
                db.commit()
        
        db.commit()
        print(f"Successfully pumped {entities_found} entities into the Intelligence Hub.")
        
    finally:
        db.close()

def _save_entity(db, val, e_type, fir_id):
    ent = db.query(Entity).filter(Entity.value == val, Entity.type == e_type).first()
    if not ent:
        ent = Entity(type=e_type, value=val)
        db.add(ent)
        db.commit()
        db.refresh(ent)
    
    # Link to global feed
    link = db.query(FIREntityLink).filter_by(fir_id=fir_id, entity_id=ent.id).first()
    if not link:
        link = FIREntityLink(fir_id=fir_id, entity_id=ent.id)
        db.add(link)

if __name__ == "__main__":
    pump()

