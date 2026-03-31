import sqlite3, random, hashlib
from datetime import datetime, timedelta

conn = sqlite3.connect('sentinel_v2.db')
cur = conn.cursor()

zones = [
    ('Z01','Colaba',18.9067,72.8147,'A Ward',80000,2.6,0.72),
    ('Z02','Fort',18.9322,72.8353,'B Ward',65000,2.1,0.65),
    ('Z03','Malabar Hill',18.9548,72.8022,'C Ward',55000,3.2,0.41),
    ('Z04','Worli',19.0176,72.8150,'E Ward',120000,4.1,0.68),
    ('Z05','Dadar',19.0178,72.8478,'G North',180000,3.8,0.75),
    ('Z06','Sion',19.0392,72.8619,'F North',160000,3.5,0.71),
    ('Z07','Dharavi',19.0380,72.8493,'F North',850000,2.4,0.89),
    ('Z08','Kurla',19.0726,72.8845,'L Ward',400000,4.2,0.82),
    ('Z09','Chembur',19.0620,72.8990,'M East',280000,5.1,0.66),
    ('Z10','Ghatkopar',19.0860,72.9081,'N Ward',320000,4.8,0.74),
    ('Z11','Vikhroli',19.1070,72.9230,'S Ward',180000,6.2,0.61),
    ('Z12','Mulund',19.1724,72.9565,'T Ward',220000,7.1,0.55),
    ('Z13','Bhandup',19.1435,72.9415,'S Ward',190000,5.8,0.58),
    ('Z14','Nahur',19.1580,72.9340,'S Ward',90000,3.2,0.49),
    ('Z15','Bandra',19.0596,72.8295,'H West',280000,4.4,0.63),
    ('Z16','Santacruz',19.0822,72.8396,'H East',210000,4.1,0.60),
    ('Z17','Vile Parle',19.0990,72.8490,'K West',230000,5.2,0.62),
    ('Z18','Andheri',19.1197,72.8466,'K East',680000,6.8,0.78),
    ('Z19','Jogeshwari',19.1390,72.8490,'K West',240000,4.6,0.67),
    ('Z20','Goregaon',19.1663,72.8489,'P North',380000,5.9,0.70),
    ('Z21','Malad',19.1871,72.8488,'P North',520000,6.3,0.73),
    ('Z22','Kandivali',19.2067,72.8561,'P North',610000,7.1,0.69),
    ('Z23','Borivali',19.2307,72.8567,'R North',580000,8.2,0.64),
    ('Z24','Dahisar',19.2523,72.8563,'R North',320000,6.9,0.57),
]
cur.executemany('INSERT OR REPLACE INTO zones VALUES (?,?,?,?,?,?,?,?)', zones)
print('Zones: 24 inserted')

crime_types = ['Theft','Robbery','Assault','Murder','Burglary','Rape',
               'Kidnapping','Fraud','Cyber Crime','Dacoity','Cheating',
               'Chain Snatching','Vehicle Theft','Drug Trafficking','Mischief']
severity_map = {
    'Murder':'CRITICAL','Rape':'CRITICAL','Robbery':'CRITICAL',
    'Dacoity':'CRITICAL','Kidnapping':'CRITICAL',
    'Assault':'HIGH','Burglary':'HIGH','Theft':'HIGH',
    'Cyber Crime':'HIGH','Fraud':'HIGH','Chain Snatching':'HIGH',
    'Vehicle Theft':'HIGH','Drug Trafficking':'HIGH',
    'Cheating':'MEDIUM','Mischief':'LOW'
}
sources = ['Mumbai Mirror','Times of India','Hindustan Times',
           'Maharashtra Times','Mid-Day','NDTV Mumbai','Mumbai Police PRO']
base = datetime(2022, 1, 1)

events = []
for i in range(1500):
    z = random.choice(zones)
    ct = random.choice(crime_types)
    ts = base + timedelta(days=random.randint(0,730),
                          hours=random.randint(0,23),
                          minutes=random.randint(0,59))
    title = f'{ct} reported in {z[1]}'
    desc = f'A case of {ct.lower()} was reported in {z[1]}. Police registered a case under relevant IPC sections. Investigation is underway.'
    h = hashlib.md5(f'{title}{ts}{i}'.encode()).hexdigest()[:20]
    events.append((
        title, desc, random.choice(sources),
        f'https://news.example.com/{h[:8]}',
        ts.isoformat(), datetime.now().isoformat(),
        h, 'en', z[1], '', '', ct,
        z[0], z[1], z[2], z[3],
        severity_map.get(ct,'MEDIUM'), 1
    ))

cur.executemany('''INSERT INTO crime_events
    (title,description,source,url,published_at,ingested_at,
     story_hash,language,locations,persons,orgs,crime_types,
     zone_id,zone,zone_lat,zone_lon,severity,is_processed)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', events)
print(f'Crime events: {len(events)} inserted')

sections = ['IPC 302','IPC 307','IPC 376','IPC 379','IPC 420',
            'IPC 392','IPC 363','IT Act 66C','IPC 354','IPC 406']
statuses = ['OPEN','UNDER_INVESTIGATION','CHARGESHEETED','CLOSED']
officers = ['Insp. R. Patil','Insp. S. Sharma','SI V. More',
            'SI D. Jadhav','Insp. K. Singh','SI A. Desai']

firs = []
for i in range(300):
    z = random.choice(zones)
    ts = base + timedelta(days=random.randint(0,730))
    ct = random.choice(crime_types)
    firs.append((
        f'FIR/{random.randint(100,999)}/{ts.year}',
        f'Complaint regarding {ct.lower()} in {z[1]} area. FIR registered under relevant IPC sections. Victim reported the incident to local police station.',
        ct, z[0], z[1],
        random.choice(sections),
        None,
        random.choice(statuses),
        random.choice(officers),
        None,
        ts.isoformat(),
        ts.isoformat()
    ))

cur.executemany('''INSERT INTO fir_cases
    (fir_number,description,crime_type,zone_id,zone,
     ipc_sections,faiss_index_id,status,assigned_officer,
     resolution_notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''', firs)
print(f'FIR cases: {len(firs)} inserted')

conn.commit()
conn.close()
print('ALL DONE')
