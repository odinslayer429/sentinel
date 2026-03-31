import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pandas as pd
import numpy as np
from datetime import datetime
from db.database import SessionLocal, Base
from db.models import CrimeEvent, ZoneRiskScore
from sqlalchemy import func

np.random.seed(42)

MUMBAI_ZONES = {
    "Z01": ("Colaba-Cuffe Parade",  18.9067, 72.8147),
    "Z02": ("Byculla-Mazgaon",      18.9754, 72.8340),
    "Z03": ("Dharavi-Sion",         19.0392, 72.8579),
    "Z04": ("Kurla-Chembur",        19.0726, 72.8795),
    "Z05": ("Ghatkopar-Vikhroli",   19.0868, 72.9089),
    "Z06": ("Mulund-Bhandup",       19.1726, 72.9568),
    "Z07": ("Andheri-Jogeshwari",   19.1197, 72.8468),
    "Z08": ("Borivali-Kandivali",   19.2307, 72.8567),
    "Z09": ("Malad-Goregaon",       19.1865, 72.8489),
    "Z10": ("Bandra-Khar",          19.0596, 72.8295),
    "Z11": ("Worli-Lower Parel",    19.0176, 72.8297),
    "Z12": ("Dadar-Matunga",        19.0178, 72.8478),
    "Z13": ("Santacruz-Vile Parle", 19.0896, 72.8490),
    "Z14": ("Powai-Hiranandani",    19.1176, 72.9060),
    "Z15": ("Navi Mumbai-Vashi",    19.0771, 73.0000),
    "Z16": ("Fort-CST Area",        18.9322, 72.8356),
    "Z17": ("Govandi-Mankhurd",     19.0519, 72.9246),
    "Z18": ("Wadala-GTB Nagar",     19.0221, 72.8610),
    "Z19": ("Dharavi-KK Nagar",     19.0507, 72.8568),
    "Z20": ("Thane-Belapur Road",   19.2183, 72.9780),
}
ZONE_IDS = list(MUMBAI_ZONES.keys())

SEVERITY_MAP = {
    "Violent Crime":    "HIGH",
    "Fire Accident":    "HIGH",
    "Traffic Fatality": "MEDIUM",
    "Other Crime":      "LOW",
}

def parse_date(s):
    if pd.isna(s) or str(s).strip() == "":
        return None
    for fmt in ("%d-%m-%Y %H:%M", "%m-%d-%Y %H:%M", "%Y-%m-%d %H:%M", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(s).strip(), fmt)
        except:
            continue
    return None

def assign_zone(report_num):
    try:
        return ZONE_IDS[int(str(report_num).strip()) % 20]
    except:
        return ZONE_IDS[0]

def seed():
    db = SessionLocal()
    try:
        print("Clearing old data...")
        db.query(CrimeEvent).delete()
        db.query(ZoneRiskScore).delete()
        db.commit()

        for zone_id, (zone_name, lat, lon) in MUMBAI_ZONES.items():
            db.add(ZoneRiskScore(
                zone_id=zone_id, zone_name=zone_name,
                hawkes_intensity=0.0, risk_score=0.0, trend="STABLE",
                dominant_crime_type="UNKNOWN",
                event_count_1h=0, event_count_6h=0, event_count_24h=0,
                weather_multiplier=1.0,
            ))
        db.commit()
        print("Zones seeded.")

        csv_path = r"D:\Sentinel\data\real_mumbai_crime.csv"
        df = pd.read_csv(csv_path, dtype=str, encoding="utf-8-sig")
        df.columns = df.columns.str.strip()
        print(f"Loaded {len(df)} rows. Columns: {list(df.columns)}")

        added = 0
        for _, row in df.iterrows():
            try:
                report_num = str(row.get("Report Number", "")).strip()
                occ_dt = parse_date(row.get("Date of Occurrence", "")) or parse_date(row.get("Date Reported", ""))
                if not occ_dt:
                    continue
                crime_type = str(row.get("Crime Description", "UNKNOWN")).strip().upper()
                domain     = str(row.get("Crime Domain", "Other Crime")).strip()
                is_closed  = str(row.get("Case Closed", "No")).strip().upper() == "YES"
                weapon     = str(row.get("Weapon Used", "None")).strip()
                vic_age    = str(row.get("Victim Age", "")).strip()
                vic_gender = str(row.get("Victim Gender", "")).strip()
                ipc_code   = str(row.get("Crime Code", "000")).strip()
                zone_id    = assign_zone(report_num)
                zone_name, zlat, zlon = MUMBAI_ZONES[zone_id]
                lat = round(zlat + np.random.uniform(-0.004, 0.004), 6)
                lon = round(zlon + np.random.uniform(-0.004, 0.004), 6)
                severity = SEVERITY_MAP.get(domain, "LOW")
                title = f"{crime_type} in {zone_name}"
                desc  = f"IPC:{ipc_code} | Victim:{vic_gender} age {vic_age} | Weapon:{weapon} | {'CLOSED' if is_closed else 'OPEN'}"
                db.add(CrimeEvent(
                    title=title[:500], description=desc,
                    source="real_mumbai_crime.csv", url=None,
                    published_at=occ_dt, story_hash=report_num[:20],
                    language="en", locations=zone_name,
                    crime_types=crime_type,
                    zone_id=zone_id, zone=zone_name,
                    zone_lat=lat, zone_lon=lon,
                    severity=severity, is_processed=True,
                ))
                added += 1
                if added % 500 == 0:
                    db.commit()
                    print(f"  {added} committed...")
            except Exception as e:
                continue

        db.commit()
        total = db.query(CrimeEvent).count()
        print(f"Done! {added} inserted | {total} total in DB")

        results = db.query(CrimeEvent.zone_id, func.count(CrimeEvent.id)).group_by(CrimeEvent.zone_id).all()
        for zid, count in results:
            zr = db.query(ZoneRiskScore).filter(ZoneRiskScore.zone_id == zid).first()
            if zr:
                zr.event_count_24h = count
                zr.risk_score = min(10.0, count / 50.0)
                zr.trend = "UP" if count > 100 else "STABLE"
        db.commit()
        print("Zone risk scores updated.")
    finally:
        db.close()

if __name__ == "__main__":
    seed()
