import os
import sys
import json
import sqlite3
import re
from datetime import datetime

# Path to the database
DB_PATH = "d:\\Sentinel\\sentinel_v2.db"

def extract_suspect_from_fir(fir_text):
    """
    Simulated NER/Extraction logic. Using regex to identify names and locations.
    """
    # Look for common patterns: "Accused: [Name]", "[Name], age [Age]"
    name_match = re.search(r"Accused:\s*([A-Za-z\s]+)", fir_text)
    age_match = re.search(r"age\s*(\d{2})", fir_text.lower())
    loc_match = re.search(r"at\s*([A-Za-z\s]+)\s*checkpoint", fir_text.lower())
    
    name = name_match.group(1).strip() if name_match else "Unknown Suspect"
    age = int(age_match.group(1)) if age_match else random.randint(20, 50)
    zone = loc_match.group(1).strip() if loc_match else "Mumbai Division"
    
    return {
        "name": name,
        "age": age,
        "last_known_zone": zone,
        "characteristics": "Flagged via Automated FIR Ingestion"
    }

def ingest_fir(fir_text, fir_number=None):
    suspect_data = extract_suspect_from_fir(fir_text)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Insert Suspect if not exists
    cursor.execute("""
        INSERT OR IGNORE INTO suspects (name, age, last_known_zone, characteristics)
        VALUES (?, ?, ?, ?)
    """, (suspect_data["name"], suspect_data["age"], suspect_data["last_known_zone"], suspect_data["characteristics"]))
    
    # 2. Link to fictitious FIR case (Phase 16 Automation)
    cursor.execute("""
        INSERT INTO fir_cases (fir_number, description, crime_type, zone_id, status)
        VALUES (?, ?, ?, ?, ?)
    """, (fir_number or f"FIR_{random.randint(10000, 99999)}", fir_text, "Investigation-Pending", suspect_data["last_known_zone"][:4], "Open"))
    
    conn.commit()
    conn.close()
    print(f"[+] Automated FIR Ingestion Complete: {suspect_data['name']} linked to Case #{fir_number or 'AUTOGEN'}")

if __name__ == "__main__":
    import random
    TEST_FIRS = [
        "Accused: Ravi Kumar, age 32, matched to UPI fraud pattern at Bandra checkpoint.",
        "Accused: Sanjay Mehra, age 45, identified via ANPR at Colaba crossing.",
        "Suspect: Amit Singh, age 28, linked to burglary syndicate at Andheri West."
    ]
    
    print("[!] Starting Phase 16: FIR-to-Suspect Automation Test...")
    for fir in TEST_FIRS:
        ingest_fir(fir)

