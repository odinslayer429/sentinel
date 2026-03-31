"""
Run once: python seed.py
Seeds SQLite DB with Mumbai zones, realistic crimes, officers, offenders, and a default admin user.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import engine, SessionLocal, Base
from models import Zone, Crime, Officer, Offender, User
from passlib.context import CryptContext
from datetime import datetime, timedelta
import random

random.seed(42)
Base.metadata.create_all(bind=engine)
db = SessionLocal()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── Zones ──────────────────────────────────────────────────────
ZONES = [
    ("Z01", "Vashi",        19.0771, 73.0036, "high"),
    ("Z02", "Nerul",        19.0330, 73.0297, "high"),
    ("Z03", "Belapur",      19.0215, 73.0389, "high"),
    ("Z04", "Kharghar",     19.0474, 73.0694, "medium"),
    ("Z05", "Panvel",       18.9894, 73.1175, "medium"),
    ("Z06", "Uran",         18.8822, 72.9438, "low"),
    ("Z07", "Turbhe",       19.0796, 73.0134, "high"),
    ("Z08", "Koparkhairane",19.1077, 73.0144, "high"),
    ("Z09", "Ghansoli",     19.1204, 73.0013, "medium"),
    ("Z10", "Airoli",       19.1554, 72.9986, "medium"),
]

if db.query(Zone).count() == 0:
    for zid, name, lat, lon, density in ZONES:
        db.add(Zone(zone_id=zid, name=name, latitude=lat, longitude=lon, density=density))
    db.commit()
    print(f"Seeded {len(ZONES)} zones")

# ── Crimes ─────────────────────────────────────────────────────
CRIME_TYPES = [
    ("Theft",           "379", 4),
    ("Assault",         "323", 5),
    ("Robbery",         "392", 7),
    ("Fraud",           "420", 5),
    ("Murder",          "302", 10),
    ("Dacoity",         "395", 8),
    ("Molestation",     "354", 7),
    ("Domestic Violence","498A",6),
    ("Public Disorder", "504", 2),
    ("Cheating",        "406", 5),
]

TIMEBANDS = {
    range(0,6):"Night", range(6,12):"Morning",
    range(12,18):"Afternoon", range(18,24):"Evening"
}

def get_timeband(hour):
    for r, t in TIMEBANDS.items():
        if hour in r:
            return t
    return "Night"

ZONE_IDS = [z[0] for z in ZONES]

if db.query(Crime).count() == 0:
    crimes_added = 0
    start = datetime(2023, 1, 1)
    for _ in range(1500):
        ct, ipc, sev = random.choice(CRIME_TYPES)
        zone = random.choice(ZONES)
        days_offset = random.randint(0, 820)
        hour = random.choices(range(24), weights=[
            1.6,1.6,1.6,1.6,0.4,0.4,0.8,0.8,0.8,0.9,
            0.9,0.9,0.9,0.9,1.0,1.0,1.0,1.0,1.4,1.4,
            1.4,1.4,1.5,1.5
        ])[0]
        ts = start + timedelta(days=days_offset, hours=hour, minutes=random.randint(0,59))
        lat = zone[2] + random.gauss(0, 0.007)
        lon = zone[3] + random.gauss(0, 0.007)
        db.add(Crime(
            zone_id=zone[0],
            crime_type=ct,
            ipc_section=ipc,
            severity=sev,
            latitude=round(lat,6),
            longitude=round(lon,6),
            timestamp=ts,
            hour=hour,
            day_of_week=ts.weekday(),
            month=ts.month,
            timeband=get_timeband(hour),
            status=random.choices(["OPEN","UNDER_INVESTIGATION","CLOSED","CHARGESHEETED"],
                                   weights=[30,35,25,10])[0],
            description=f"{ct} reported in {zone[1]} area. IPC {ipc} applied.",
            source="SEED"
        ))
        crimes_added += 1
    db.commit()
    print(f"Seeded {crimes_added} crimes")

# ── Officers ───────────────────────────────────────────────────
OFFICER_NAMES = [
    "Rajesh Kumar","Priya Sharma","Amit Patil","Sunita Desai","Vijay More",
    "Deepa Nair","Rahul Singh","Kavita Joshi","Suresh Yadav","Meena Tiwari",
    "Arun Gupta","Rekha Shetty","Sanjay Pawar","Anjali Mehta","Nilesh Jadhav"
]

if db.query(Officer).count() == 0:
    for i, name in enumerate(OFFICER_NAMES):
        zone = ZONES[i % len(ZONES)]
        db.add(Officer(
            badge_no=f"MH-{1001+i}",
            name=name,
            rank=random.choice(["Constable","Head Constable","ASI","SI","Inspector"]),
            zone_id=zone[0],
            is_active=True,
            latitude=zone[2] + random.gauss(0, 0.005),
            longitude=zone[3] + random.gauss(0, 0.005),
        ))
    db.commit()
    print(f"Seeded {len(OFFICER_NAMES)} officers")

# ── Offenders ──────────────────────────────────────────────────
OFFENDER_DATA = [
    ("Ravi Thakur","Kala Ravi",34,"Male","HIGH",3,True),
    ("Salim Khan","Chhota Salim",28,"Male","HIGH",5,True),
    ("Pradeep Lad","P-Lad",41,"Male","MEDIUM",2,False),
    ("Rekha Gawde","Rani",25,"Female","LOW",1,False),
    ("Mukesh Bhai","Mukkha",38,"Male","HIGH",7,True),
    ("Sonu Sharma","Sonu D",22,"Male","MEDIUM",2,False),
    ("Asha Mane","Kali Asha",30,"Female","MEDIUM",3,False),
    ("Dilip Karande","Dilu",45,"Male","HIGH",4,True),
]

if db.query(Offender).count() == 0:
    for name, alias, age, gender, risk, arrests, wanted in OFFENDER_DATA:
        zones = ",".join(random.sample(ZONE_IDS, 3))
        db.add(Offender(
            name=name, alias=alias, age=age, gender=gender,
            risk_level=risk, arrest_count=arrests, is_wanted=wanted,
            known_zones=zones,
            description=f"Known offender. Alias: {alias}. Active in {zones}."
        ))
    db.commit()
    print(f"Seeded {len(OFFENDER_DATA)} offenders")

# ── Default Admin User ─────────────────────────────────────────
if db.query(User).filter(User.username == "admin").count() == 0:
    db.add(User(
        username="admin",
        hashed_password=pwd_context.hash("sentinel@123"),
        full_name="System Administrator",
        role="admin",
        is_active=True
    ))
    db.commit()
    print("Created default user: admin / sentinel@123")

db.close()
print("\nDB seed complete. File: backend/sentinel.db")
