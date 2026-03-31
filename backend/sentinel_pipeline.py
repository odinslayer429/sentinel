"""
SENTINEL Crime Intelligence Platform — Data Pipeline
=====================================================
Reads all CSV sources, normalises to schema, and inserts into the SQLite DB.

All paths are driven by environment variables — no hardcoded Windows paths.
Set SENTINEL_DB_PATH and SENTINEL_DATA_DIR in your .env file.
"""

import os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import sqlite3
import pandas as pd
import numpy as np
import random
import json
import hashlib
import uuid
from datetime import datetime, timedelta
import warnings

warnings.filterwarnings("ignore")

# ── CONFIG (env-driven) ───────────────────────────────────────────────────────
DB_PATH  = os.getenv(
    "SENTINEL_DB_PATH",
    os.path.join(os.path.dirname(__file__), "..", "data", "sentinel_v2.db")
)
CSV_DIR  = os.getenv(
    "SENTINEL_DATA_DIR",
    os.path.join(os.path.dirname(__file__), "..", "data")
)

CSV_FILES = {
    "mumbai_historical":  os.path.join(CSV_DIR, "mumbai_crime_historical_2020_2024.csv"),
    "real_mumbai":        os.path.join(CSV_DIR, "real_mumbai_crime.csv"),
    "crime_india":        os.path.join(CSV_DIR, "crime_dataset_india.csv"),
    "ride_safety":        os.path.join(CSV_DIR, "ride_safety_dataset.csv"),
    "upi_fraud":          os.path.join(CSV_DIR, "real_upi_fraud.csv"),
    "upi_historical":     os.path.join(CSV_DIR, "upi_fraud_historical_2024_2025.csv"),
    "india_district":     os.path.join(CSV_DIR, "india_district_crime_2014_2023_30k.csv"),
    "ipc_crimes":         os.path.join(CSV_DIR, "IPC_Crimes_2022-23.csv"),
    "cyber_crimes":       os.path.join(CSV_DIR, "Cyber_Crimes_2023.csv"),
    "women_crimes":       os.path.join(CSV_DIR, "Crimes_against_women-_2022_and_2023.csv"),
    "crimes_2025":        os.path.join(CSV_DIR, "indian-crimes-from-jan-to-aug-2025.csv"),
    "ncrb":               os.path.join(CSV_DIR, "NCRB_CII_2023_Table_13A_1_0.csv"),
    "upi_transactions":   os.path.join(CSV_DIR, "real_upi_transactions.csv"),
}

random.seed(42)
np.random.seed(42)

# ─────────────────────────────────────────────
# ZONE MASTER DATA — 24 Mumbai Zones
# ─────────────────────────────────────────────
ZONES = [
    ("Z01", "Colaba",      18.9067, 72.8147, "A",   "Colaba",      67000,   2.82),
    ("Z02", "Fort",        18.9320, 72.8355, "B",   "Fort",        55000,   3.10),
    ("Z03", "Malabar Hill",18.9548, 72.8057, "C",   "Malabar Hill",42000,   1.90),
    ("Z04", "Worli",       19.0176, 72.8181, "G/S", "Worli",       88000,   4.60),
    ("Z05", "Dadar",       19.0178, 72.8478, "F/S", "Dadar",      115000,   5.40),
    ("Z06", "Sion",        19.0396, 72.8626, "F/N", "Sion",       143000,   6.20),
    ("Z07", "Dharavi",     19.0426, 72.8530, "F/N", "Dharavi",    850000,   2.40),
    ("Z08", "Kurla",       19.0728, 72.8826, "L",   "Kurla",      425000,   8.30),
    ("Z09", "Chembur",     19.0623, 72.9010, "M/E", "Chembur",    310000,   9.80),
    ("Z10", "Ghatkopar",   19.0860, 72.9081, "N",   "Ghatkopar",  340000,  10.20),
    ("Z11", "Vikhroli",    19.1073, 72.9258, "N",   "Vikhroli",   220000,   7.50),
    ("Z12", "Mulund",      19.1726, 72.9560, "T",   "Mulund",     240000,  11.10),
    ("Z13", "Bhandup",     19.1478, 72.9415, "S",   "Bhandup",    198000,   8.70),
    ("Z14", "Nahur",       19.1309, 72.9377, "S",   "Nahur",       85000,   4.20),
    ("Z15", "Bandra",      19.0596, 72.8295, "H/E", "Bandra",     210000,   7.10),
    ("Z16", "Santacruz",   19.0815, 72.8417, "H/W", "Santacruz",  195000,   6.80),
    ("Z17", "Vile Parle",  19.0990, 72.8450, "K/W", "Vile Parle", 173000,   5.90),
    ("Z18", "Andheri",     19.1197, 72.8468, "K/W", "Andheri",    450000,  18.60),
    ("Z19", "Jogeshwari",  19.1441, 72.8476, "K/W", "Jogeshwari", 180000,   6.40),
    ("Z20", "Goregaon",    19.1664, 72.8490, "P/S", "Goregaon",   260000,   9.80),
    ("Z21", "Malad",       19.1872, 72.8483, "P/N", "Malad",      320000,  11.30),
    ("Z22", "Kandivali",   19.2095, 72.8519, "R/N", "Kandivali",  370000,  13.50),
    ("Z23", "Borivali",    19.2307, 72.8567, "R/C", "Borivali",   290000,  12.80),
    ("Z24", "Dahisar",     19.2523, 72.8545, "R/N", "Dahisar",    185000,   8.90),
]

ZONE_LOOKUP = {}
for z in ZONES:
    zone_id, name, lat, lon = z[0], z[1], z[2], z[3]
    ZONE_LOOKUP[name.lower()]                         = (zone_id, name, lat, lon)
    ZONE_LOOKUP[name.lower().replace(" ", "")]        = (zone_id, name, lat, lon)

ZONE_ALIASES = {
    "bandra east": "bandra",   "bandra west": "bandra",
    "bandra (e)":  "bandra",   "bandra (w)":  "bandra",
    "andheri east":"andheri",  "andheri west":"andheri",
    "andheri (e)": "andheri",  "andheri (w)": "andheri",
    "malad east":  "malad",    "malad west":  "malad",
    "kandivali east":"kandivali","kandivali west":"kandivali",
    "borivali east":"borivali","borivali west":"borivali",
    "ghatkopar east":"ghatkopar","ghatkopar west":"ghatkopar",
    "vile parle east":"vile parle","vile parle west":"vile parle",
    "santacruz east":"santacruz","santacruz west":"santacruz",
    "juhu":        "santacruz", "powai":       "vikhroli",
    "khar":        "bandra",    "kurla east":  "kurla",
    "kurla west":  "kurla",     "chembur east":"chembur",
    "chembur west":"chembur",   "dharavi":     "dharavi",
    "worli":       "worli",     "dadar east":  "dadar",
    "dadar west":  "dadar",     "sion":        "sion",
    "colaba":      "colaba",    "fort":        "fort",
    "churchgate":  "fort",      "lower parel": "worli",
    "parel":       "dadar",     "matunga":     "dadar",
    "wadala":      "worli",     "govandi":     "chembur",
    "mankhurd":    "chembur",   "trombay":     "chembur",
    "nahur":       "nahur",     "bhandup east":"bhandup",
    "bhandup west":"bhandup",   "mulund east": "mulund",
    "mulund west": "mulund",    "vikhroli east":"vikhroli",
    "vikhroli west":"vikhroli", "jogeshwari east":"jogeshwari",
    "jogeshwari west":"jogeshwari","goregaon east":"goregaon",
    "goregaon west":"goregaon", "dahisar east":"dahisar",
    "dahisar west": "dahisar",  "malabar hill":"malabar hill",
}

ZONE_IDS   = [z[0] for z in ZONES]
ZONE_NAMES = [z[1] for z in ZONES]


def resolve_zone(location_str):
    if not location_str or pd.isna(location_str):
        z = random.choice(ZONES)
        return z[0], z[1], z[2], z[3]
    loc = str(location_str).lower().strip()
    if loc in ZONE_LOOKUP:
        return ZONE_LOOKUP[loc]
    alias = ZONE_ALIASES.get(loc)
    if alias and alias in ZONE_LOOKUP:
        return ZONE_LOOKUP[alias]
    for key, val in ZONE_LOOKUP.items():
        if key in loc or loc in key:
            return val
    for key, target in ZONE_ALIASES.items():
        if key in loc and target in ZONE_LOOKUP:
            return ZONE_LOOKUP[target]
    z = random.choice(ZONES)
    return z[0], z[1], z[2], z[3]


SEVERITY_CRITICAL = {"murder","rape","robbery","dacoity","kidnapping","abduction",
                      "homicide","attempt to murder","culpable homicide"}
SEVERITY_HIGH     = {"assault","burglary","theft","cyber crime","fraud","cybercrime",
                      "sexual assault","molestation","extortion","phishing","upi fraud",
                      "chain snatching","vehicle theft","drug offense","narcotic"}
SEVERITY_MEDIUM   = {"cheating","forgery","mischief","vandalism","harassment",
                      "domestic violence","eve teasing","stalking","trespass"}


def assign_severity(crime_type_str):
    if not crime_type_str or pd.isna(crime_type_str):
        return "LOW"
    ct = str(crime_type_str).lower()
    for kw in SEVERITY_CRITICAL:
        if kw in ct: return "CRITICAL"
    for kw in SEVERITY_HIGH:
        if kw in ct: return "HIGH"
    for kw in SEVERITY_MEDIUM:
        if kw in ct: return "MEDIUM"
    return "LOW"


def make_hash(text):  return hashlib.sha256(str(text).encode()).hexdigest()[:16]
def make_uuid():      return str(uuid.uuid4())


def rand_ts(start_year=2022, end_year=2024):
    start_year = max(2020, min(start_year, 2024))
    end_year   = max(start_year, min(end_year, 2024))
    start = datetime(start_year, 1, 1)
    end   = datetime(end_year, 12, 31, 23, 59, 59)
    secs  = max(0, int((end - start).total_seconds()))
    return (start + timedelta(seconds=random.randint(0, secs) if secs else 0)).isoformat()


def parse_ts(val, fallback_range=(2022, 2024)):
    if pd.isna(val) or not val:
        return rand_ts(*fallback_range)
    val = str(val).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d-%m-%Y %H:%M",
                "%d-%m-%Y", "%m/%d/%Y", "%d/%m/%Y %H:%M"):
        try:
            return datetime.strptime(val, fmt).isoformat()
        except ValueError:
            continue
    return rand_ts(*fallback_range)


def title_from_crime(crime, location):
    crime    = str(crime).title()    if crime    else "Crime"
    location = str(location).title() if location else "Mumbai"
    return random.choice([
        f"{crime} Reported in {location}",
        f"{crime} Case Filed at {location}",
        f"Incident: {crime} Near {location}",
        f"Alert — {crime} Detected in {location}",
        f"Police Action: {crime} in {location}",
    ])


def safe_int(val, default=0):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return default
    try:
        return int(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return default


def safe_str(val, max_len=None):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    s = str(val).strip()
    if max_len:
        s = s[:max_len]
    return s or None


INGESTED_AT = datetime.now().isoformat()


# ── DB helpers ────────────────────────────────────────────────────────────────
def get_conn():
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def ensure_tables(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS zones (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        ward_code TEXT, ward_name TEXT,
        lat REAL, lon REAL, population INTEGER, area_sqkm REAL, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS crime_events (
        id TEXT PRIMARY KEY, title TEXT, description TEXT,
        source TEXT, url TEXT, published_at TEXT, ingested_at TEXT,
        story_hash TEXT, language TEXT DEFAULT 'en',
        locations TEXT, persons TEXT, orgs TEXT, crime_types TEXT,
        zone_id TEXT, zone TEXT, zone_lat REAL, zone_lon REAL,
        severity TEXT, is_processed INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS fir_cases (
        id TEXT PRIMARY KEY, fir_number TEXT, station TEXT,
        accused_name TEXT, victim_name TEXT, section TEXT,
        description TEXT, status TEXT, zone_id TEXT, created_at TEXT
    );
    """)
    conn.commit()
    print("[DB] Tables verified / created.")


def insert_batch(conn, table, rows, batch_size=100):
    if not rows:
        return 0
    keys         = list(rows[0].keys())
    placeholders = ",".join(["?" for _ in keys])
    sql          = f"INSERT OR IGNORE INTO {table} ({','.join(keys)}) VALUES ({placeholders})"
    inserted     = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i+batch_size]
        conn.executemany(sql, [tuple(r[k] for k in keys) for r in chunk])
        conn.commit()
        inserted += len(chunk)
        if inserted % 500 == 0 or inserted == len(rows):
            print(f"  [{table}] {inserted}/{len(rows)} rows inserted...")
    return inserted


# ══ Data loaders (unchanged logic, paths now use CSV_FILES dict) ══════════════

def load_mumbai_historical():
    path = CSV_FILES["mumbai_historical"]
    print(f"\n  [2A] {os.path.basename(path)}")
    df = pd.read_csv(path, encoding="utf-8-sig")
    rows = []
    for _, r in df.iterrows():
        zone_id, zone_name, lat, lon = resolve_zone(r.get("ward_name"))
        crime    = safe_str(r.get("crime_type")) or "Unknown"
        section  = safe_str(r.get("ipc_section")) or ""
        pub_at   = parse_ts(r.get("date"), (2020, 2024))
        sev_raw  = safe_str(r.get("severity")) or ""
        severity = sev_raw.upper() if sev_raw.upper() in ("CRITICAL","HIGH","MEDIUM","LOW") else assign_severity(crime)
        rows.append({
            "id": make_uuid(), "title": title_from_crime(crime, zone_name),
            "description": f"Crime type: {crime}. IPC Section: {section}. Reported at {zone_name}.",
            "source": "Mumbai Police Ward Data", "url": None,
            "published_at": pub_at, "ingested_at": INGESTED_AT,
            "story_hash": make_hash(f"{pub_at}{crime}{zone_id}"), "language": "en",
            "locations": json.dumps([zone_name]), "persons": json.dumps([]),
            "orgs": json.dumps(["Mumbai Police"]), "crime_types": json.dumps([crime]),
            "zone_id": zone_id, "zone": zone_name, "zone_lat": lat, "zone_lon": lon,
            "severity": severity, "is_processed": 1,
        })
    print(f"    Prepared {len(rows)} rows.")
    return rows


def load_real_mumbai():
    path = CSV_FILES["real_mumbai"]
    print(f"\n  [2B] {os.path.basename(path)}")
    df   = pd.read_csv(path, encoding="utf-8-sig")
    rows = []
    for _, r in df.iterrows():
        crime    = safe_str(r.get("Crime Description")) or "Unknown"
        city     = safe_str(r.get("City")) or "Mumbai"
        zone_id, zone_name, lat, lon = resolve_zone(city)
        pub_at   = parse_ts(r.get("Date Reported"), (2020, 2023))
        rows.append({
            "id": make_uuid(), "title": title_from_crime(crime, zone_name),
            "description": f"{crime} case. Domain: {r.get('Crime Domain','')}. Victim: {r.get('Victim Age','')}yr {r.get('Victim Gender','')}.",
            "source": "Mumbai Crime Reports", "url": None,
            "published_at": pub_at, "ingested_at": INGESTED_AT,
            "story_hash": make_hash(f"{r.get('Report Number')}{crime}"), "language": "en",
            "locations": json.dumps([zone_name]), "persons": json.dumps([]),
            "orgs": json.dumps(["Mumbai Police"]), "crime_types": json.dumps([crime]),
            "zone_id": zone_id, "zone": zone_name, "zone_lat": lat, "zone_lon": lon,
            "severity": assign_severity(crime), "is_processed": 1,
        })
    print(f"    Prepared {len(rows)} rows.")
    return rows


def populate_crime_events(conn):
    print("\n[STEP 2] Populating crime_events...")
    all_rows = []
    for loader in [load_mumbai_historical, load_real_mumbai]:
        try:
            all_rows += loader()
        except FileNotFoundError as e:
            print(f"  [WARN] Skipping: {e}")

    seen, deduped = set(), []
    for row in all_rows:
        h = row["story_hash"]
        if h not in seen:
            seen.add(h)
            deduped.append(row)

    print(f"  [MERGE] Total: {len(all_rows)} → After dedup: {len(deduped)}")
    n = insert_batch(conn, "crime_events", deduped)
    print(f"  [DONE] crime_events → {n} rows")
    return n


# ── FIR generation (unchanged) ────────────────────────────────────────────────
FIRST_NAMES = ["Rahul","Priya","Amit","Sunita","Vijay","Kavita","Suresh","Anita",
               "Rajesh","Pooja","Manoj","Seema","Arun","Meena","Vikram","Asha"]
SURNAMES    = ["Sharma","Patel","Singh","Gupta","Shah","Mehta","Joshi","Desai",
               "Kulkarni","Patil","Rao","Nair","Iyer","Reddy","Verma","Tiwari"]
POLICE_STATIONS = {
    z[0]: f"{z[1]} Police Station" for z in ZONES
}
IPC_SECTIONS = [
    "IPC 302 (Murder)","IPC 376 (Rape)","IPC 392 (Robbery)","IPC 395 (Dacoity)",
    "IPC 363 (Kidnapping)","IPC 354 (Assault on Woman)","IPC 379 (Theft)",
    "IPC 420 (Cheating)","IPC 468 (Forgery)","IPC 504 (Insult)","IPC 506 (Threat)",
    "IPC 323 (Hurt)","IPC 324 (Grievous Hurt)","IPC 307 (Attempt to Murder)",
    "IT Act 66C (Identity Theft)","IT Act 66D (Cheating by Impersonation)",
    "NDPS Act (Drug Offence)","IPC 411 (Receiving Stolen Property)",
]
FIR_STATUSES = ["Open","Under Investigation","Chargesheeted","Closed","Pending Court"]
FIR_CRIMES   = ["Murder","Robbery","Theft","Assault","Rape","Kidnapping","Fraud",
               "Burglary","Drug Offence","Cybercrime","Extortion","Eve Teasing",
               "Domestic Violence","Vehicle Theft","Chain Snatching","Cheating"]


def rand_name():
    return f"{random.choice(FIRST_NAMES)} {random.choice(SURNAMES)}"


def generate_fir_cases(n=200):
    print(f"\n[STEP 3] Generating {n} FIR cases...")
    rows = []
    for i in range(1, n+1):
        zone    = random.choice(ZONES)
        zone_id, zone_name = zone[0], zone[1]
        station = POLICE_STATIONS.get(zone_id, f"{zone_name} PS")
        crime   = random.choice(FIR_CRIMES)
        section = random.choice(IPC_SECTIONS)
        status  = random.choice(FIR_STATUSES)
        year    = random.randint(2022, 2024)
        created = datetime(year, random.randint(1,12), random.randint(1,28),
                           random.randint(0,23), random.randint(0,59)).isoformat()
        rows.append({
            "id":           make_uuid(),
            "fir_number":   f"FIR/{year}/{zone_id}/{i:04d}",
            "station":      station,
            "accused_name": rand_name() if random.random() > 0.2 else None,
            "victim_name":  rand_name(),
            "section":      section,
            "description":  f"{crime} case at {station}. Section: {section}. Status: {status}.",
            "status":       status,
            "zone_id":      zone_id,
            "created_at":   created,
        })
    return rows


def populate_fir_cases(conn):
    rows = generate_fir_cases(200)
    n    = insert_batch(conn, "fir_cases", rows)
    print(f"  [DONE] fir_cases → {n} rows")
    return n


def populate_zones(conn):
    print("\n[STEP 1] Inserting 24 Mumbai Zones...")
    rows = [{
        "id": z[0], "name": z[1], "ward_code": z[4], "ward_name": z[5],
        "lat": z[2], "lon": z[3], "population": z[6], "area_sqkm": z[7],
        "created_at": INGESTED_AT,
    } for z in ZONES]
    n = insert_batch(conn, "zones", rows)
    print(f"  [DONE] zones → {n} rows")
    return n


def main():
    print("╔══════════════════════════════════════════════════════╗")
    print("║   SENTINEL — Crime Intelligence Data Pipeline        ║")
    print("╚══════════════════════════════════════════════════════╝")
    print(f"  DB   : {os.path.abspath(DB_PATH)}")
    print(f"  Data : {os.path.abspath(CSV_DIR)}\n")

    conn      = get_conn()
    ensure_tables(conn)
    z_count   = populate_zones(conn)
    ce_count  = populate_crime_events(conn)
    fc_count  = populate_fir_cases(conn)

    print(f"\n{'='*50}")
    print(f"  zones        : {z_count}")
    print(f"  crime_events : {ce_count}")
    print(f"  fir_cases    : {fc_count}")
    print(f"{'='*50}")
    conn.close()
    print("[DONE] Pipeline complete.")


if __name__ == "__main__":
    main()
