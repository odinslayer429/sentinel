import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv("D:/Sentinel/.env")

from db.database import SessionLocal, Base, engine
from db.models import Suspect, FIRCase, FIRSuspectLink
from datetime import datetime, timedelta
import random

Base.metadata.create_all(bind=engine)
db = SessionLocal()

ZONES = ["Ghatkopar", "Bandra", "Colaba", "Thane", "Andheri", "Dharavi", "Kurla", "Dadar", "Borivali", "Malad"]
CRIME_TYPES = ["Chain Snatching", "Vehicle Theft", "Robbery", "Drug Trafficking", "Assault", "Cyber Fraud", "Extortion", "Burglary", "Murder", "NDPS Act"]
IPC = ["379", "392", "302", "307", "420", "376", "395", "120B", "34", "506"]

SUSPECTS = [
    ("Raju Bhosale",      "Raju Dada",      38, "Ghatkopar",  ["Chain Snatching", "Robbery"],           7),
    ("Salim Shaikh",      "Chhota Salim",   42, "Dharavi",    ["Drug Trafficking", "Extortion"],        9),
    ("Vikram Patil",      "Vikku",          29, "Andheri",    ["Vehicle Theft", "Burglary"],            5),
    ("Deepak Rane",       "D-Bhai",         45, "Thane",      ["Murder", "Extortion"],                 11),
    ("Naresh Gupta",      "Naresh Bhaiya",  33, "Kurla",      ["Robbery", "Assault"],                   6),
    ("Imran Qureshi",     "Immi",           27, "Bandra",     ["Cyber Fraud", "Chain Snatching"],       4),
    ("Santosh Kamble",    "Santi",          36, "Colaba",     ["Drug Trafficking", "NDPS Act"],         8),
    ("Ajay Tiwari",       "Ajju Bhai",      41, "Dadar",      ["Extortion", "Murder"],                 10),
    ("Prakash Shinde",    "Pakya",          31, "Borivali",   ["Vehicle Theft", "Chain Snatching"],     5),
    ("Rahul Mhatre",      "Rahul D",        25, "Malad",      ["Burglary", "Robbery"],                  3),
    ("Suresh Jadhav",     "Surya",          48, "Ghatkopar",  ["Murder", "Assault"],                   12),
    ("Karim Ansari",      "K-Bhai",         39, "Dharavi",    ["Drug Trafficking", "Extortion"],        9),
    ("Girish Nair",       "Giri",           34, "Andheri",    ["Cyber Fraud", "Robbery"],               6),
    ("Arvind Pawar",      "Arvi",           52, "Thane",      ["Extortion", "Murder"],                 14),
    ("Ramesh Yadav",      "Ramu",           28, "Kurla",      ["Chain Snatching", "Vehicle Theft"],     4),
    ("Sanjay More",       "Sanju",          37, "Bandra",     ["Assault", "Robbery"],                   7),
    ("Aslam Khan",        "Aslam Bhai",     44, "Colaba",     ["Drug Trafficking", "NDPS Act"],        10),
    ("Dinesh Solanki",    "Dinu",           30, "Dadar",      ["Burglary", "Chain Snatching"],          5),
    ("Rajesh Sawant",     "Raja D",         26, "Borivali",   ["Vehicle Theft", "Cyber Fraud"],         3),
    ("Mukesh Thakur",     "Muku Bhai",      43, "Malad",      ["Extortion", "Assault"],                 8),
    ("Pradeep Gaikwad",   "Pappi",          35, "Ghatkopar",  ["Robbery", "Murder"],                    9),
    ("Naved Shaikh",      "Navi",           23, "Dharavi",    ["Chain Snatching", "Burglary"],           2),
    ("Hemant Desai",      "Hemu",           50, "Andheri",    ["Drug Trafficking", "Extortion"],        13),
    ("Kiran Bhoir",       "Kiru",           32, "Thane",      ["Assault", "Robbery"],                   6),
    ("Yogesh Patil",      "Yogi",           29, "Kurla",      ["Vehicle Theft", "Chain Snatching"],     4),
]

print(f"Seeding {len(SUSPECTS)} suspects...")

for name, alias, age, zone, crimes, fir_count in SUSPECTS:
    existing = db.query(Suspect).filter(Suspect.name == name).first()
    if existing:
        print(f"  SKIP (exists): {name}")
        continue

    s = Suspect(
        name=name,
        aliases=json.dumps([alias]),
        age=age,
        last_known_zone=zone,
        crime_types=json.dumps(crimes),
        contact_info=f"+91-9{random.randint(100000000,999999999)}"
    )
    db.add(s)
    db.flush()

    for j in range(fir_count):
        days_ago = random.randint(1, 1200)
        crime = random.choice(crimes)
        fir_zone = zone if random.random() > 0.3 else random.choice(ZONES)
        fir = FIRCase(
            fir_number=f"FIR-{zone[:3].upper()}-{2022 + (j % 3)}-{random.randint(1000,9999)}",
            description=f"{crime} incident reported in {fir_zone} area. Suspect identified as {name} aka {alias}.",
            crime_type=crime,
            zone=fir_zone,
            ipc_sections=json.dumps(random.sample(IPC, k=2)),
            created_at=datetime.utcnow() - timedelta(days=days_ago)
        )
        db.add(fir)
        db.flush()
        link = FIRSuspectLink(fir_id=fir.id, suspect_id=s.id, role="Accused",
                              created_at=datetime.utcnow() - timedelta(days=days_ago))
        db.add(link)

    print(f"  SEEDED: {name} ({fir_count} FIRs, {zone})")

db.commit()
db.close()
print("\nDone. Seed complete.")
