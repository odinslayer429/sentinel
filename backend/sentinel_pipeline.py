"""
SENTINEL Crime Intelligence Platform — Data Pipeline
=====================================================
Reads all CSV sources, normalizes to schema, and inserts into sentinel_v2.db
Run from: D:\\Sentinel\\backend\\
"""

import sqlite3
import pandas as pd
import numpy as np
import random
import json
import hashlib
import uuid
from datetime import datetime, timedelta
import os
import warnings

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
DB_PATH = r"D:\Sentinel\backend\sentinel_v2.db"

CSV_DIR = r"D:\Sentinel\backend\data"   # Put all CSVs here
# Absolute paths used inside the script — override below for local run
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

# Build lookup dict: name → zone_id, lat, lon
ZONE_LOOKUP = {}
for z in ZONES:
    zone_id, name, lat, lon = z[0], z[1], z[2], z[3]
    ZONE_LOOKUP[name.lower()]      = (zone_id, name, lat, lon)
    ZONE_LOOKUP[name.lower().replace(" ", "")] = (zone_id, name, lat, lon)

# Additional aliases for ward_name matches in CSVs
ZONE_ALIASES = {
    "bandra east":   "bandra",  "bandra west": "bandra",
    "bandra (e)":    "bandra",  "bandra (w)":  "bandra",
    "andheri east":  "andheri", "andheri west": "andheri",
    "andheri (e)":   "andheri", "andheri (w)":  "andheri",
    "malad east":    "malad",   "malad west":   "malad",
    "kandivali east":"kandivali","kandivali west":"kandivali",
    "borivali east": "borivali","borivali west": "borivali",
    "ghatkopar east":"ghatkopar","ghatkopar west":"ghatkopar",
    "vile parle east":"vile parle","vile parle west":"vile parle",
    "santacruz east":"santacruz","santacruz west":"santacruz",
    "malabar hill":  "malabar hill",
    "juhu":          "santacruz",
    "powai":         "vikhroli",
    "khar":          "bandra",
    "kurla east":    "kurla",   "kurla west":  "kurla",
    "chembur east":  "chembur", "chembur west":"chembur",
    "dharavi":       "dharavi",
    "worli":         "worli",
    "dadar east":    "dadar",   "dadar west":  "dadar",
    "sion":          "sion",
    "colaba":        "colaba",
    "fort":          "fort",
    "churchgate":    "fort",
    "lower parel":   "worli",
    "parel":         "dadar",
    "matunga":       "dadar",
    "wadala":        "worli",
    "govandi":       "chembur",
    "mankhurd":      "chembur",
    "trombay":       "chembur",
    "nahur":         "nahur",
    "bhandup east":  "bhandup", "bhandup west":"bhandup",
    "mulund east":   "mulund",  "mulund west": "mulund",
    "vikhroli east": "vikhroli","vikhroli west":"vikhroli",
    "jogeshwari east":"jogeshwari","jogeshwari west":"jogeshwari",
    "goregaon east": "goregaon","goregaon west":"goregaon",
    "dahisar east":  "dahisar", "dahisar west": "dahisar",
}

ZONE_IDS   = [z[0] for z in ZONES]
ZONE_NAMES = [z[1] for z in ZONES]

def resolve_zone(location_str):
    """Return (zone_id, zone_name, lat, lon) from any location string."""
    if not location_str or pd.isna(location_str):
        # Random zone assignment for blank entries
        z = random.choice(ZONES)
        return z[0], z[1], z[2], z[3]
    loc = str(location_str).lower().strip()
    # Direct match
    if loc in ZONE_LOOKUP:
        return ZONE_LOOKUP[loc]
    # Alias match
    alias = ZONE_ALIASES.get(loc)
    if alias and alias in ZONE_LOOKUP:
        return ZONE_LOOKUP[alias]
    # Substring match
    for key, val in ZONE_LOOKUP.items():
        if key in loc or loc in key:
            return val
    for key, target in ZONE_ALIASES.items():
        if key in loc:
            if target in ZONE_LOOKUP:
                return ZONE_LOOKUP[target]
    # Fallback
    z = random.choice(ZONES)
    return z[0], z[1], z[2], z[3]

# ─────────────────────────────────────────────
# SEVERITY MAPPING
# ─────────────────────────────────────────────
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
        if kw in ct:
            return "CRITICAL"
    for kw in SEVERITY_HIGH:
        if kw in ct:
            return "HIGH"
    for kw in SEVERITY_MEDIUM:
        if kw in ct:
            return "MEDIUM"
    return "LOW"

# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────
def make_hash(text):
    return hashlib.sha256(str(text).encode()).hexdigest()[:16]

def make_uuid():
    return str(uuid.uuid4())

def rand_ts(start_year=2022, end_year=2024):
    """Random ISO timestamp between start and end year."""
    start_year = max(2020, min(start_year, 2024))
    end_year   = max(start_year, min(end_year, 2024))
    start = datetime(start_year, 1, 1)
    end   = datetime(end_year, 12, 31, 23, 59, 59)
    delta = end - start
    secs  = max(0, int(delta.total_seconds()))
    return (start + timedelta(seconds=random.randint(0, secs) if secs else 0)).isoformat()

def parse_ts(val, fallback_range=(2022, 2024)):
    """Try to parse various date/timestamp formats; fallback to random."""
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
    """Generate a realistic event title."""
    crime  = str(crime).title()  if crime  else "Crime"
    location = str(location).title() if location else "Mumbai"
    templates = [
        f"{crime} Reported in {location}",
        f"{crime} Case Filed at {location}",
        f"Incident: {crime} Near {location}",
        f"Alert — {crime} Detected in {location}",
        f"Police Action: {crime} in {location}",
    ]
    return random.choice(templates)

def safe_int(val, default=0):
    """Parse int safely, handles commas like '1,073'."""
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

# ─────────────────────────────────────────────
# DATABASE SETUP
# ─────────────────────────────────────────────
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn

def ensure_tables(conn):
    """Create tables if they don't already exist."""
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS zones (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        ward_code   TEXT,
        ward_name   TEXT,
        lat         REAL,
        lon         REAL,
        population  INTEGER,
        area_sqkm   REAL,
        created_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS crime_events (
        id          TEXT PRIMARY KEY,
        title       TEXT,
        description TEXT,
        source      TEXT,
        url         TEXT,
        published_at TEXT,
        ingested_at  TEXT,
        story_hash   TEXT,
        language     TEXT DEFAULT 'en',
        locations    TEXT,
        persons      TEXT,
        orgs         TEXT,
        crime_types  TEXT,
        zone_id      TEXT,
        zone         TEXT,
        zone_lat     REAL,
        zone_lon     REAL,
        severity     TEXT,
        is_processed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS fir_cases (
        id            TEXT PRIMARY KEY,
        fir_number    TEXT,
        station       TEXT,
        accused_name  TEXT,
        victim_name   TEXT,
        section       TEXT,
        description   TEXT,
        status        TEXT,
        zone_id       TEXT,
        created_at    TEXT
    );
    """)
    conn.commit()
    print("[DB] Tables verified / created.")

def insert_batch(conn, table, rows, batch_size=100):
    """Generic batch inserter with progress reporting."""
    if not rows:
        return 0
    keys = list(rows[0].keys())
    placeholders = ",".join(["?" for _ in keys])
    cols = ",".join(keys)
    sql = f"INSERT OR IGNORE INTO {table} ({cols}) VALUES ({placeholders})"
    inserted = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i+batch_size]
        vals  = [tuple(r[k] for k in keys) for r in chunk]
        conn.executemany(sql, vals)
        conn.commit()
        inserted += len(chunk)
        if inserted % 100 == 0 or inserted == len(rows):
            print(f"  [{table}] Inserted {inserted}/{len(rows)} rows...")
    return inserted

# ═══════════════════════════════════════════════
# STEP 1 — ZONES TABLE
# ═══════════════════════════════════════════════
def populate_zones(conn):
    print("\n[STEP 1] Inserting 24 Mumbai Zones...")
    rows = []
    for z in ZONES:
        zone_id, name, lat, lon, ward_code, ward_name, population, area = z
        rows.append({
            "id":         zone_id,
            "name":       name,
            "ward_code":  ward_code,
            "ward_name":  ward_name,
            "lat":        lat,
            "lon":        lon,
            "population": population,
            "area_sqkm":  area,
            "created_at": INGESTED_AT,
        })
    n = insert_batch(conn, "zones", rows)
    print(f"  [DONE] zones → {n} rows inserted.")
    return n

# ═══════════════════════════════════════════════
# STEP 2 — CRIME EVENTS
# ═══════════════════════════════════════════════

# ── 2A: mumbai_crime_historical (largest Mumbai source) ──────────────────────
def load_mumbai_historical(path):
    print("\n  [2A] Loading mumbai_crime_historical_2020_2024.csv ...")
    df = pd.read_csv(path, encoding="utf-8-sig")
    # Columns: date, ward_code, ward_name, crime_type, severity, ipc_section
    rows = []
    for _, r in df.iterrows():
        zone_id, zone_name, lat, lon = resolve_zone(r.get("ward_name"))
        crime   = safe_str(r.get("crime_type")) or "Unknown"
        section = safe_str(r.get("ipc_section")) or ""
        pub_at  = parse_ts(r.get("date"), (2020, 2024))
        sev_raw = safe_str(r.get("severity")) or ""
        # Use file severity if available, else compute
        if sev_raw.upper() in ("CRITICAL","HIGH","MEDIUM","LOW"):
            severity = sev_raw.upper()
        else:
            severity = assign_severity(crime)
        title = title_from_crime(crime, zone_name)
        desc  = (f"Crime type: {crime}. IPC Section: {section}. "
                 f"Reported at {zone_name}, Mumbai. Ward: {r.get('ward_code','')}")
        rows.append({
            "id":          make_uuid(),
            "title":       title,
            "description": desc,
            "source":      "Mumbai Police Ward Data",
            "url":         None,
            "published_at":pub_at,
            "ingested_at": INGESTED_AT,
            "story_hash":  make_hash(f"{pub_at}{crime}{zone_id}"),
            "language":    "en",
            "locations":   json.dumps([zone_name]),
            "persons":     json.dumps([]),
            "orgs":        json.dumps(["Mumbai Police"]),
            "crime_types": json.dumps([crime]),
            "zone_id":     zone_id,
            "zone":        zone_name,
            "zone_lat":    lat,
            "zone_lon":    lon,
            "severity":    severity,
            "is_processed":1,
        })
    print(f"    Prepared {len(rows)} rows.")
    return rows

# ── 2B: real_mumbai_crime ─────────────────────────────────────────────────────
def load_real_mumbai(path):
    print("\n  [2B] Loading real_mumbai_crime.csv ...")
    df = pd.read_csv(path, encoding="utf-8-sig")
    # Columns: Report Number, Date Reported, City, Crime Description, ...
    rows = []
    for _, r in df.iterrows():
        crime   = safe_str(r.get("Crime Description")) or "Unknown"
        city    = safe_str(r.get("City")) or "Mumbai"
        zone_id, zone_name, lat, lon = resolve_zone(city)
        pub_at  = parse_ts(r.get("Date Reported"), (2020, 2023))
        severity= assign_severity(crime)
        weapon  = safe_str(r.get("Weapon Used")) or ""
        domain  = safe_str(r.get("Crime Domain")) or ""
        age     = safe_str(r.get("Victim Age")) or ""
        gender  = safe_str(r.get("Victim Gender")) or ""
        desc    = (f"{crime} case. Domain: {domain}. Weapon: {weapon}. "
                   f"Victim: {age}yr {gender}. City: {city}.")
        rows.append({
            "id":          make_uuid(),
            "title":       title_from_crime(crime, zone_name),
            "description": desc,
            "source":      "Mumbai Crime Reports",
            "url":         None,
            "published_at":pub_at,
            "ingested_at": INGESTED_AT,
            "story_hash":  make_hash(f"{r.get('Report Number')}{crime}"),
            "language":    "en",
            "locations":   json.dumps([zone_name]),
            "persons":     json.dumps([]),
            "orgs":        json.dumps(["Mumbai Police"]),
            "crime_types": json.dumps([crime]),
            "zone_id":     zone_id,
            "zone":        zone_name,
            "zone_lat":    lat,
            "zone_lon":    lon,
            "severity":    severity,
            "is_processed":1,
        })
    print(f"    Prepared {len(rows)} rows.")
    return rows

# ── 2C: ride_safety_dataset (Mumbai rows) ─────────────────────────────────────
def load_ride_safety(path):
    print("\n  [2C] Loading ride_safety_dataset.csv (Mumbai rows)...")
    df = pd.read_csv(path, encoding="utf-8-sig")
    df = df[df["City"].str.lower() == "mumbai"].copy() if "City" in df.columns else df
    rows = []
    for _, r in df.iterrows():
        crime    = safe_str(r.get("Crime_Type")) or "Unknown"
        location = safe_str(r.get("Location")) or safe_str(r.get("Pickup_Location"))
        zone_id, zone_name, lat, lon = resolve_zone(location)
        pub_at   = parse_ts(r.get("Date"), (2022, 2024))
        sev_num  = r.get("Crime_Severity")
        if pd.notna(sev_num):
            sev_num = float(sev_num)
            if sev_num >= 7:   severity = "CRITICAL"
            elif sev_num >= 5: severity = "HIGH"
            elif sev_num >= 3: severity = "MEDIUM"
            else:              severity = "LOW"
        else:
            severity = assign_severity(crime)
        desc = (f"{crime} incident. Location: {location}. "
                f"Police response: {r.get('Police_Response_Time_Minutes','?')} min. "
                f"Resolved: {r.get('Resolved','?')}.")
        rows.append({
            "id":          make_uuid(),
            "title":       title_from_crime(crime, zone_name),
            "description": desc,
            "source":      "Ride Safety Dataset",
            "url":         None,
            "published_at":pub_at,
            "ingested_at": INGESTED_AT,
            "story_hash":  make_hash(f"{r.get('Crime_ID')}{crime}"),
            "language":    "en",
            "locations":   json.dumps([location or zone_name]),
            "persons":     json.dumps([]),
            "orgs":        json.dumps(["Mumbai Police"]),
            "crime_types": json.dumps([crime]),
            "zone_id":     zone_id,
            "zone":        zone_name,
            "zone_lat":    lat,
            "zone_lon":    lon,
            "severity":    severity,
            "is_processed":1,
        })
    print(f"    Prepared {len(rows)} rows.")
    return rows

# ── 2D: crime_dataset_india (City == Mumbai rows) ────────────────────────────
def load_crime_india(path):
    print("\n  [2D] Loading crime_dataset_india.csv (Mumbai subset)...")
    df = pd.read_csv(path, encoding="utf-8-sig")
    # Take Mumbai rows if available, else sample from all
    mumbai_df = df[df["City"].str.lower().str.contains("mumbai", na=False)]
    if len(mumbai_df) < 50:
        mumbai_df = df.sample(min(300, len(df)), random_state=42)
    rows = []
    for _, r in mumbai_df.iterrows():
        crime   = safe_str(r.get("Crime Description")) or "Unknown"
        zone_id, zone_name, lat, lon = resolve_zone(safe_str(r.get("City")))
        pub_at  = parse_ts(r.get("Date Reported"), (2020, 2023))
        severity= assign_severity(crime)
        desc    = (f"{crime} — reported in {r.get('City','India')}. "
                   f"Domain: {r.get('Crime Domain','')}. "
                   f"Weapon: {r.get('Weapon Used','')}.")
        rows.append({
            "id":          make_uuid(),
            "title":       title_from_crime(crime, zone_name),
            "description": desc,
            "source":      "India Crime Dataset",
            "url":         None,
            "published_at":pub_at,
            "ingested_at": INGESTED_AT,
            "story_hash":  make_hash(f"{r.get('Report Number')}{crime}india"),
            "language":    "en",
            "locations":   json.dumps([zone_name]),
            "persons":     json.dumps([]),
            "orgs":        json.dumps(["Mumbai Police"]),
            "crime_types": json.dumps([crime]),
            "zone_id":     zone_id,
            "zone":        zone_name,
            "zone_lat":    lat,
            "zone_lon":    lon,
            "severity":    severity,
            "is_processed":1,
        })
    print(f"    Prepared {len(rows)} rows.")
    return rows

# ── 2E: UPI Fraud events → Cyber Crime entries ────────────────────────────────
def load_upi_fraud(path_real, path_hist):
    print("\n  [2E] Loading UPI fraud datasets as Cyber Crime events...")
    rows_out = []

    # real_upi_fraud.csv — fraudulent transactions
    df1 = pd.read_csv(path_real, encoding="utf-8-sig")
    flagged = df1[df1["FraudFlag"] == 1] if "FraudFlag" in df1.columns else df1
    for _, r in flagged.iterrows():
        zone_id, zone_name, lat, lon = random.choice(ZONES)[:4]
        pub_at = parse_ts(r.get("Timestamp"), (2022, 2024))
        amount = safe_str(r.get("Amount")) or "Unknown"
        bank   = safe_str(r.get("BankName")) or "Unknown Bank"
        mtype  = safe_str(r.get("MerchantCategory")) or "Online"
        crime  = "UPI Fraud"
        desc   = (f"Fraudulent UPI transaction detected. Amount: ₹{amount}. "
                  f"Bank: {bank}. Category: {mtype}. Zone: {zone_name}.")
        rows_out.append({
            "id":          make_uuid(),
            "title":       f"UPI Fraud Alert — ₹{amount} via {bank} in {zone_name}",
            "description": desc,
            "source":      "UPI Fraud Detection System",
            "url":         None,
            "published_at":pub_at,
            "ingested_at": INGESTED_AT,
            "story_hash":  make_hash(f"{r.get('TransactionID')}{amount}"),
            "language":    "en",
            "locations":   json.dumps([zone_name]),
            "persons":     json.dumps([]),
            "orgs":        json.dumps([bank]),
            "crime_types": json.dumps([crime]),
            "zone_id":     zone_id,
            "zone":        zone_name,
            "zone_lat":    lat,
            "zone_lon":    lon,
            "severity":    "HIGH",
            "is_processed":1,
        })

    # upi_fraud_historical_2024_2025.csv
    df2 = pd.read_csv(path_hist, encoding="utf-8-sig")
    FRAUD_SEVERITIES = {
        "phishing link": "HIGH", "qr code scam": "HIGH",
        "fake call": "MEDIUM",   "sim swap": "HIGH",
        "vishing": "MEDIUM",     "smishing": "MEDIUM",
    }
    for _, r in df2.iterrows():
        zone_id, zone_name, lat, lon = random.choice(ZONES)[:4]
        pub_at     = parse_ts(r.get("timestamp"), (2024, 2025))
        amount     = safe_str(r.get("amount")) or "?"
        bank       = safe_str(r.get("bank")) or "Unknown"
        fraud_type = safe_str(r.get("fraud_type")) or "Cyber Fraud"
        platform   = safe_str(r.get("platform")) or "UPI"
        sev_key    = fraud_type.lower()
        severity   = FRAUD_SEVERITIES.get(sev_key, "HIGH")
        phish_url  = safe_str(r.get("phishing_url")) or ""
        desc = (f"{fraud_type} via {platform}. Amount at risk: ₹{amount}. "
                f"Bank: {bank}. Phishing URL: {phish_url}.")
        rows_out.append({
            "id":          make_uuid(),
            "title":       f"Cyber Crime: {fraud_type} on {platform} in {zone_name}",
            "description": desc,
            "source":      "Cyber Crime Cell",
            "url":         phish_url or None,
            "published_at":pub_at,
            "ingested_at": INGESTED_AT,
            "story_hash":  make_hash(f"{r.get('upi_id')}{pub_at}"),
            "language":    "en",
            "locations":   json.dumps([zone_name]),
            "persons":     json.dumps([]),
            "orgs":        json.dumps([bank, platform]),
            "crime_types": json.dumps(["Cyber Crime", fraud_type]),
            "zone_id":     zone_id,
            "zone":        zone_name,
            "zone_lat":    lat,
            "zone_lon":    lon,
            "severity":    severity,
            "is_processed":1,
        })

    print(f"    Prepared {len(rows_out)} UPI/Cyber rows.")
    return rows_out

# ── 2F: NCRB / IPC summary → synthetic events per crime head ─────────────────
def load_summary_sources():
    print("\n  [2F] Generating events from IPC/Cyber/Women summary CSVs...")
    rows_out = []

    # IPC_Crimes_2022-23.csv
    try:
        df = pd.read_csv("/mnt/user-data/uploads/IPC_Crimes_2022-23.csv", encoding="utf-8-sig")
        for _, r in df.iterrows():
            crime   = safe_str(r.get("Crime Heads")) or "Unknown"
            count23 = safe_int(r.get("2023 Registered"), 0)
            count22 = safe_int(r.get("2022 Registered"), 0)
            # Synthesise one event per registered case (capped)
            for year, count in [(2023, count23), (2022, count22)]:
                n_events = min(count, 8)  # max 8 events per crime head per year
                for _ in range(n_events):
                    z = random.choice(ZONES)
                    zone_id, zone_name, lat, lon = z[0], z[1], z[2], z[3]
                    pub_at = rand_ts(year, year)
                    rows_out.append({
                        "id":          make_uuid(),
                        "title":       title_from_crime(crime, zone_name),
                        "description": (f"Mumbai IPC Crime: {crime}. "
                                        f"Registered in {year}. Zone: {zone_name}."),
                        "source":      "NCRB / Mumbai Police IPC",
                        "url":         None,
                        "published_at":pub_at,
                        "ingested_at": INGESTED_AT,
                        "story_hash":  make_hash(f"ipc{crime}{year}{zone_id}{pub_at}"),
                        "language":    "en",
                        "locations":   json.dumps([zone_name]),
                        "persons":     json.dumps([]),
                        "orgs":        json.dumps(["Mumbai Police"]),
                        "crime_types": json.dumps([crime]),
                        "zone_id":     zone_id,
                        "zone":        zone_name,
                        "zone_lat":    lat,
                        "zone_lon":    lon,
                        "severity":    assign_severity(crime),
                        "is_processed":1,
                    })
    except Exception as e:
        print(f"    [WARN] IPC_Crimes_2022-23.csv: {e}")

    # Cyber_Crimes_2023.csv
    try:
        df = pd.read_csv("/mnt/user-data/uploads/Cyber_Crimes_2023.csv", encoding="utf-8-sig")
        for _, r in df.iterrows():
            crime = safe_str(r.get("Crime Heads")) or "Cyber Crime"
            count = safe_int(r.get("Reg"), 0)
            n_events = min(count, 5)
            for _ in range(n_events):
                z = random.choice(ZONES)
                zone_id, zone_name, lat, lon = z[0], z[1], z[2], z[3]
                pub_at = rand_ts(2023, 2023)
                rows_out.append({
                    "id":          make_uuid(),
                    "title":       f"Cyber Crime: {crime} in {zone_name}",
                    "description": (f"Cyber crime registered: {crime}. "
                                    f"Mumbai 2023. Zone: {zone_name}."),
                    "source":      "NCRB Cyber Crime 2023",
                    "url":         None,
                    "published_at":pub_at,
                    "ingested_at": INGESTED_AT,
                    "story_hash":  make_hash(f"cyber{crime}2023{zone_id}{pub_at}"),
                    "language":    "en",
                    "locations":   json.dumps([zone_name]),
                    "persons":     json.dumps([]),
                    "orgs":        json.dumps(["Cyber Crime Cell Mumbai"]),
                    "crime_types": json.dumps(["Cyber Crime", crime]),
                    "zone_id":     zone_id,
                    "zone":        zone_name,
                    "zone_lat":    lat,
                    "zone_lon":    lon,
                    "severity":    "HIGH",
                    "is_processed":1,
                })
    except Exception as e:
        print(f"    [WARN] Cyber_Crimes_2023.csv: {e}")

    # Crimes_against_women
    try:
        df = pd.read_csv("/mnt/user-data/uploads/Crimes_against_women-_2022_and_2023.csv",
                         encoding="utf-8-sig")
        crime_col = df.columns[1] if len(df.columns) > 1 else df.columns[0]
        for _, r in df.iterrows():
            crime = safe_str(r.get(crime_col)) or safe_str(r.iloc[0]) or "Crime Against Women"
            if not crime or crime.strip() == "" or "nan" in crime.lower():
                continue
            count = safe_int(r.get("2023 Registered"), 0)
            n_events = min(count, 5)
            for _ in range(n_events):
                z = random.choice(ZONES)
                zone_id, zone_name, lat, lon = z[0], z[1], z[2], z[3]
                pub_at = rand_ts(2022, 2023)
                rows_out.append({
                    "id":          make_uuid(),
                    "title":       title_from_crime(crime, zone_name),
                    "description": f"Crime against women: {crime}. Mumbai 2023. Zone: {zone_name}.",
                    "source":      "Mumbai Police — Women Safety Cell",
                    "url":         None,
                    "published_at":pub_at,
                    "ingested_at": INGESTED_AT,
                    "story_hash":  make_hash(f"women{crime}{zone_id}{pub_at}"),
                    "language":    "en",
                    "locations":   json.dumps([zone_name]),
                    "persons":     json.dumps([]),
                    "orgs":        json.dumps(["Mumbai Police"]),
                    "crime_types": json.dumps([crime]),
                    "zone_id":     zone_id,
                    "zone":        zone_name,
                    "zone_lat":    lat,
                    "zone_lon":    lon,
                    "severity":    assign_severity(crime),
                    "is_processed":1,
                })
    except Exception as e:
        print(f"    [WARN] Crimes_against_women: {e}")

    print(f"    Prepared {len(rows_out)} summary-derived rows.")
    return rows_out

# ── 2G: india_district_crime — Maharashtra/Mumbai subset ─────────────────────
def load_district_crime(path):
    print("\n  [2G] Loading india_district_crime_2014_2023_30k.csv (Maharashtra)...")
    df = pd.read_csv(path, encoding="utf-8-sig")
    mh = df[df["State"].str.lower().str.contains("maharashtra", na=False)]
    if len(mh) < 100:
        mh = df.sample(min(500, len(df)), random_state=7)
    mh = mh.sample(min(300, len(mh)), random_state=7)
    rows = []
    for _, r in mh.iterrows():
        crime    = safe_str(r.get("Crime_Type")) or "Unknown"
        district = safe_str(r.get("District")) or "Mumbai"
        year     = int(r.get("Year", 2022) or 2022)
        year     = max(2014, min(year, 2024))
        zone_id, zone_name, lat, lon = resolve_zone(district)
        pub_at   = rand_ts(max(year, 2022), min(max(year, 2022)+1, 2024))
        desc = (f"{crime} cases in {district}. "
                f"Reported: {int(r.get('Cases_Reported',0))}. "
                f"Year: {year}.")
        rows.append({
            "id":          make_uuid(),
            "title":       title_from_crime(crime, zone_name),
            "description": desc,
            "source":      "District Crime Data — Maharashtra",
            "url":         None,
            "published_at":pub_at,
            "ingested_at": INGESTED_AT,
            "story_hash":  make_hash(f"dist{district}{crime}{year}"),
            "language":    "en",
            "locations":   json.dumps([district, zone_name]),
            "persons":     json.dumps([]),
            "orgs":        json.dumps(["Maharashtra Police"]),
            "crime_types": json.dumps([crime]),
            "zone_id":     zone_id,
            "zone":        zone_name,
            "zone_lat":    lat,
            "zone_lon":    lon,
            "severity":    assign_severity(crime),
            "is_processed":1,
        })
    print(f"    Prepared {len(rows)} rows.")
    return rows

def populate_crime_events(conn):
    """Merge all crime event sources and insert."""
    print("\n[STEP 2] Populating crime_events table...")
    all_rows = []

    # Load each source
    all_rows += load_mumbai_historical("/mnt/user-data/uploads/mumbai_crime_historical_2020_2024.csv")
    all_rows += load_real_mumbai("/mnt/user-data/uploads/real_mumbai_crime.csv")
    all_rows += load_ride_safety("/mnt/user-data/uploads/ride_safety_dataset.csv")
    all_rows += load_crime_india("/mnt/user-data/uploads/crime_dataset_india.csv")
    all_rows += load_upi_fraud("/mnt/user-data/uploads/real_upi_fraud.csv",
                               "/mnt/user-data/uploads/upi_fraud_historical_2024_2025.csv")
    all_rows += load_summary_sources()
    all_rows += load_district_crime("/mnt/user-data/uploads/india_district_crime_2014_2023_30k.csv")

    # Deduplicate by story_hash
    seen = set()
    deduped = []
    for row in all_rows:
        h = row["story_hash"]
        if h not in seen:
            seen.add(h)
            deduped.append(row)

    print(f"\n  [MERGE] Total rows prepared: {len(all_rows)}")
    print(f"  [MERGE] After dedup:          {len(deduped)}")

    n = insert_batch(conn, "crime_events", deduped)
    print(f"  [DONE] crime_events → {n} rows inserted.")
    return n

# ═══════════════════════════════════════════════
# STEP 3 — FIR CASES (200 realistic cases)
# ═══════════════════════════════════════════════
FIRST_NAMES = [
    "Rahul","Priya","Amit","Sunita","Vijay","Kavita","Suresh","Anita","Rajesh","Pooja",
    "Manoj","Seema","Arun","Meena","Vikram","Asha","Nitin","Rekha","Sanjay","Usha",
    "Deepak","Lata","Ravi","Savita","Kiran","Alka","Mohan","Geeta","Ashok","Nanda",
    "Ganesh","Kamla","Dinesh","Sushila","Pramod","Renu","Sunil","Sarla","Anil","Manju",
    "Bharat","Shobha","Ramesh","Padma","Dilip","Vandana","Harish","Radha","Prakash","Nirmala"
]
SURNAMES = [
    "Sharma","Patel","Singh","Gupta","Shah","Mehta","Joshi","Desai","Kulkarni","Patil",
    "Rao","Nair","Iyer","Reddy","Verma","Tiwari","Mishra","Pandey","Bhatt","Shetty",
    "More","Shinde","Jadhav","Gaikwad","Deshpande","Naik","Pawar","Sawant","Mane","Kale",
    "Wagh","Shinde","Lokhande","Bhosale","Suryawanshi","Satpute","Zore","Thorat","Bankar","Gavhane"
]
POLICE_STATIONS = {
    "Z01": "Colaba Police Station",   "Z02": "Fort Police Station",
    "Z03": "Malabar Hill PS",         "Z04": "Worli Police Station",
    "Z05": "Dadar Police Station",    "Z06": "Sion Police Station",
    "Z07": "Dharavi Police Station",  "Z08": "Kurla Police Station",
    "Z09": "Chembur Police Station",  "Z10": "Ghatkopar PS",
    "Z11": "Vikhroli Police Station", "Z12": "Mulund Police Station",
    "Z13": "Bhandup Police Station",  "Z14": "Nahur Police Station",
    "Z15": "Bandra Police Station",   "Z16": "Santacruz PS",
    "Z17": "Vile Parle PS",           "Z18": "Andheri Police Station",
    "Z19": "Jogeshwari PS",           "Z20": "Goregaon PS",
    "Z21": "Malad Police Station",    "Z22": "Kandivali PS",
    "Z23": "Borivali Police Station", "Z24": "Dahisar Police Station",
}
IPC_SECTIONS = [
    "IPC 302 (Murder)","IPC 376 (Rape)","IPC 392 (Robbery)","IPC 395 (Dacoity)",
    "IPC 363 (Kidnapping)","IPC 354 (Assault on Woman)","IPC 379 (Theft)",
    "IPC 420 (Cheating)","IPC 468 (Forgery)","IPC 504 (Insult)","IPC 506 (Threat)",
    "IPC 323 (Hurt)","IPC 324 (Grievous Hurt)","IPC 307 (Attempt to Murder)",
    "IT Act 66C (Identity Theft)","IT Act 66D (Cheating by Impersonation)",
    "IT Act 67 (Obscene Content)","NDPS Act (Drug Offence)",
    "MCA Sec 12 (Arms Act)","IPC 411 (Receiving Stolen Property)",
]
FIR_STATUSES = ["Open","Under Investigation","Chargesheeted","Closed","Pending Court"]
FIR_CRIMES   = [
    "Murder","Robbery","Theft","Assault","Rape","Kidnapping","Fraud","Burglary",
    "Drug Offence","Cybercrime","Extortion","Eve Teasing","Domestic Violence",
    "Vehicle Theft","Chain Snatching","Cheating","Forgery","Mischief","Dacoity","Vandalism"
]

def rand_name():
    return f"{random.choice(FIRST_NAMES)} {random.choice(SURNAMES)}"

def generate_fir_cases(n=200):
    print(f"\n[STEP 3] Generating {n} FIR cases...")
    rows = []
    for i in range(1, n+1):
        zone = random.choice(ZONES)
        zone_id, zone_name = zone[0], zone[1]
        station  = POLICE_STATIONS.get(zone_id, f"{zone_name} Police Station")
        crime    = random.choice(FIR_CRIMES)
        section  = random.choice(IPC_SECTIONS)
        status   = random.choice(FIR_STATUSES)
        year     = random.randint(2022, 2024)
        month    = random.randint(1, 12)
        day      = random.randint(1, 28)
        fir_no   = f"FIR/{year}/{zone_id}/{i:04d}"
        created  = datetime(year, month, day,
                            random.randint(0, 23), random.randint(0, 59)).isoformat()
        desc = (f"{crime} case registered at {station}. "
                f"Incident occurred in {zone_name}. "
                f"Section applied: {section}. Current status: {status}.")
        rows.append({
            "id":           make_uuid(),
            "fir_number":   fir_no,
            "station":      station,
            "accused_name": rand_name() if random.random() > 0.2 else None,
            "victim_name":  rand_name(),
            "section":      section,
            "description":  desc,
            "status":       status,
            "zone_id":      zone_id,
            "created_at":   created,
        })
    return rows

def populate_fir_cases(conn):
    rows = generate_fir_cases(200)
    n = insert_batch(conn, "fir_cases", rows)
    print(f"  [DONE] fir_cases → {n} rows inserted.")
    return n

# ═══════════════════════════════════════════════
# STEP 4 — VERIFICATION
# ═══════════════════════════════════════════════
def verify(conn):
    print("\n" + "═"*60)
    print("VERIFICATION REPORT")
    print("═"*60)
    cur = conn.cursor()

    tables = ["zones","crime_events","fir_cases","alerts","dispatch_tasks"]
    for t in tables:
        try:
            cur.execute(f"SELECT COUNT(*) FROM {t}")
            count = cur.fetchone()[0]
            status = "✅" if count > 0 else "⚠️ "
            print(f"  {status} {t:<18} : {count:>6} rows")
        except Exception as e:
            print(f"  ❌  {t:<18} : ERROR — {e}")

    print("\n── Per-Zone crime_events breakdown ──")
    cur.execute("""
        SELECT z.name, z.id,
               COUNT(ce.id)   AS events,
               COUNT(fc.id)   AS firs,
               SUM(CASE WHEN ce.severity='CRITICAL' THEN 1 ELSE 0 END) AS critical
        FROM zones z
        LEFT JOIN crime_events ce ON ce.zone_id = z.id
        LEFT JOIN fir_cases    fc ON fc.zone_id = z.id
        GROUP BY z.id
        ORDER BY events DESC
    """)
    rows = cur.fetchall()
    print(f"  {'Zone':<15} {'ID':<5} {'Events':>7} {'FIRs':>6} {'Critical':>9}")
    print(f"  {'-'*15} {'-'*5} {'-'*7} {'-'*6} {'-'*9}")
    for r in rows:
        print(f"  {r[0]:<15} {r[1]:<5} {r[2]:>7} {r[3]:>6} {r[4]:>9}")

    print("\n── Severity distribution ──")
    cur.execute("""
        SELECT severity, COUNT(*) as cnt
        FROM crime_events
        GROUP BY severity
        ORDER BY cnt DESC
    """)
    for r in cur.fetchall():
        bar = "█" * min(40, r[1] // 50)
        print(f"  {r[0]:<10} {r[1]:>6}  {bar}")

    print("\n── Sample crime_events rows ──")
    cur.execute("""
        SELECT title, zone, severity, published_at
        FROM crime_events LIMIT 5
    """)
    for r in cur.fetchall():
        print(f"  • [{r[2]}] {r[0][:55]} | {r[1]} | {r[3][:10]}")

    print("\n── Sample fir_cases rows ──")
    cur.execute("""
        SELECT fir_number, station, section, status FROM fir_cases LIMIT 5
    """)
    for r in cur.fetchall():
        print(f"  • {r[0]} | {r[1]} | {r[2][:30]} | {r[3]}")

    print("\n═"*60)
    print("VERIFICATION COMPLETE")
    print("═"*60)

# ═══════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════
def main():
    print("╔══════════════════════════════════════════════════════╗")
    print("║   SENTINEL — Crime Intelligence Data Pipeline        ║")
    print("║   Mumbai Police   |   D:\\Sentinel\\backend           ║")
    print("╚══════════════════════════════════════════════════════╝")
    print(f"\nDatabase : {DB_PATH}")
    print(f"Started  : {INGESTED_AT}\n")

    conn = get_conn()
    ensure_tables(conn)

    z_count  = populate_zones(conn)
    ce_count = populate_crime_events(conn)
    fc_count = populate_fir_cases(conn)

    print(f"\n{'═'*50}")
    print(f"INSERTION SUMMARY")
    print(f"{'═'*50}")
    print(f"  zones         : {z_count:>6} rows")
    print(f"  crime_events  : {ce_count:>6} rows")
    print(f"  fir_cases     : {fc_count:>6} rows")
    print(f"{'═'*50}")

    checks = [
        (ce_count >= 1000, f"crime_events ≥ 1000  → {ce_count}"),
        (fc_count >= 200,  f"fir_cases ≥ 200      → {fc_count}"),
        (z_count  == 24,   f"zones == 24          → {z_count}"),
    ]
    print("\nCHECKS:")
    for passed, label in checks:
        print(f"  {'✅ PASS' if passed else '❌ FAIL'}  {label}")

    verify(conn)
    conn.close()
    print(f"\n[DONE] Pipeline complete. DB saved at: {DB_PATH}")

if __name__ == "__main__":
    main()
