import sqlite3
import json
from datetime import datetime

def seed_marvel_intelligence():
    conn = sqlite3.connect('sentinel.db')
    c = conn.cursor()

    # 1. Seed Suspects
    suspects = [
        ("Sameer 'Ghost' Khan", "['Ghost', 'Sam']", 34, "+91-98765-43210", "Bandra West", "['Cyber Fraud', 'Phishing']"),
        ("Vijay Mallya Wannabe", "['The King']", 45, "Unknown", "Dubai/London", "['Financial Fraud', 'Money Laundering']"),
        ("Rahul 'Flash' Gupta", "['Flash', 'RG']", 22, "+91-99887-76655", "Dharavi", "['Mobile Theft', 'UPI Scam']"),
        ("Priya Sharma", "['Didi']", 29, "+91-91234-56789", "Colaba", "['Identity Theft', 'Social Engineering']"),
        ("Unknown Suspect #092", "['Shadow']", 0, "No Data", "Unknown", "['Infrastructure Sabotage']")
    ]
    
    c.executemany("INSERT INTO suspects (name, aliases, age, contact_info, last_known_zone, crime_types) VALUES (?,?,?,?,?,?)", suspects)
    print("Seeded 5 Suspects")

    # 2. Seed Entities (Vehicles, Phones, UPI IDs)
    entities = [
        ('VEHICLE', 'MH-01-AX-4567'),
        ('VEHICLE', 'MH-02-BY-1234'),
        ('PHONE', '+91-98765-43210'),
        ('UPI', 'ghost@okicici'),
        ('BANK', 'HDFC-998877665544')
    ]
    c.executemany("INSERT OR IGNORE INTO entities (type, value) VALUES (?,?)", entities)
    print("Seeded 5 Entities")

    # 3. Seed FIRs if empty or limited
    firs = [
        ('FIR/2026/001', 'Major UPI fraud reported in Bandra involving guest checkout exploit.', 'Cyber Fraud', 'Z04', 'Bandra Zone', '["IT Act 66D", "IPC 420"]', 'Open', 'Inspector Kulkarni'),
        ('FIR/2026/002', 'High-speed chase on Sea Link involving a stolen luxury sedan.', 'Traffic/Theft', 'Z01', 'South Mumbai', '["IPC 379", "IPC 279"]', 'Investigation', 'Officer Sawant')
    ]
    c.executemany("INSERT INTO fir_cases (fir_number, description, crime_type, zone_id, zone, ipc_sections, status, assigned_officer) VALUES (?,?,?,?,?,?,?,?)", firs)
    print("Seeded 2 FIRs")

    # 4. Link Suspects to FIRs
    # Sameer (ID 1) linked to FIR 1
    # Rahul (ID 3) linked to FIR 2
    links = [
        (1, 1, 'Main Accused'),
        (2, 3, 'Co-accused')
    ]
    # Fetch real IDs just in case
    c.execute("SELECT id FROM fir_cases")
    fir_ids = [r[0] for r in c.fetchall()]
    c.execute("SELECT id FROM suspects")
    suspect_ids = [r[0] for r in c.fetchall()]

    if fir_ids and suspect_ids:
        c.execute("INSERT OR IGNORE INTO fir_suspect_links (fir_id, suspect_id, role) VALUES (?,?,?)", (fir_ids[-2], suspect_ids[0], 'Accused'))
        c.execute("INSERT OR IGNORE INTO fir_suspect_links (fir_id, suspect_id, role) VALUES (?,?,?)", (fir_ids[-1], suspect_ids[2], 'Accused'))
        print("Linked Suspects to FIRs")

    # 5. Link Entities to FIRs
    c.execute("SELECT id FROM entities")
    entity_ids = [r[0] for r in c.fetchall()]
    if fir_ids and entity_ids:
        c.execute("INSERT OR IGNORE INTO fir_entity_links (fir_id, entity_id) VALUES (?,?)", (fir_ids[-2], entity_ids[3])) # UPI to FIR 1
        c.execute("INSERT OR IGNORE INTO fir_entity_links (fir_id, entity_id) VALUES (?,?)", (fir_ids[-1], entity_ids[0])) # Vehicle to FIR 2
        print("Linked Entities to FIRs")

    conn.commit()
    conn.close()

if __name__ == "__main__":
    seed_marvel_intelligence()

