import time
import random
import json
import sqlite3
import os
from datetime import datetime

# Path to the database
DB_PATH = "d:\\Sentinel\\sentinel_v2.db"

PLATES = [
    "MH 01 AB 1234", "MH 02 CD 5678", "MH 04 EF 9101", 
    "MH 43 GH 2345", "MH 46 JK 6789", "MH 12 LM 3456"
]

LOCATIONS = [
    {"zid": "A", "name": "Colaba"},
    {"zid": "D", "name": "Marine Lines"},
    {"zid": "H/W", "name": "Bandra West"},
    {"zid": "K/W", "name": "Andheri West"},
    {"zid": "S", "name": "Bhandup"}
]

def generate_anpr_hit():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    plate = random.choice(PLATES)
    loc = random.choice(LOCATIONS)
    
    alert_title = f"ANPR POSITIVE: {plate}"
    message = f"Simulated VAHAN match for flagged vehicle {plate} detected at {loc['name']} checkpoint. High probability of link to Case #DEEP_SYNC_{random.randint(100, 999)}."
    
    cursor.execute("""
        INSERT INTO alerts (title, message, severity, zone_id, zone, created_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (alert_title, message, "CRITICAL", loc['zid'], loc['name'], datetime.now(), 1))
    
    conn.commit()
    conn.close()
    print(f"[*] Live ANPR Hit Injected: {plate} at {loc['name']}")

if __name__ == "__main__":
    print("[!] Starting VAHAN/ANPR Live Simulator (Phase 16)...")
    try:
        while True:
            generate_anpr_hit()
            time.sleep(random.randint(15, 45)) # Simulate realistic hit frequency
    except KeyboardInterrupt:
        print("[!] Simulator Stopped.")

