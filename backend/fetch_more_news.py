import os
import sqlite3
import hashlib
import requests
import time
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("NEWSDATA_API_KEY")
if not API_KEY:
    print("Error: NEWSDATA_API_KEY not found in environment variables.")
    exit(1)
conn = sqlite3.connect('sentinel_v2.db')
cur = conn.cursor()

queries = [
    'mumbai crime',
    'mumbai police arrest',
    'mumbai theft robbery murder',
    'maharashtra crime',
    'mumbai gang fraud',
]

total_inserted = 0

for q in queries:
    url = f'https://newsdata.io/api/1/news?apikey={API_KEY}&q={q}&country=in&language=en'
    try:
        r = requests.get(url, timeout=10).json()
        if r.get('status') != 'success':
            print(f'SKIP {q}: {r.get("message","")}')
            continue

        for item in r.get('results', []):
            title = item.get('title','') or ''
            desc = item.get('description','') or item.get('content','') or ''
            link = item.get('link','') or ''
            source = item.get('source_id','') or ''
            pub = item.get('pubDate', datetime.now().isoformat())
            h = hashlib.md5(link.encode()).hexdigest()[:20]

            keywords = ['crime','police','murder','theft','robbery','arrest',
                        'fir','fraud','assault','drug','gang','kidnap','rape',
                        'accused','custody','detained','convicted']
            if not any(k in (title+desc).lower() for k in keywords):
                continue

            try:
                cur.execute('''INSERT OR IGNORE INTO crime_events
                    (title,description,source,url,published_at,ingested_at,
                     story_hash,language,locations,persons,orgs,crime_types,
                     zone_id,zone,zone_lat,zone_lon,severity,is_processed)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                    (title[:500],desc[:1000],source,link[:500],pub,
                     datetime.now().isoformat(),h,'en','Mumbai','','','News',
                     'Z18','Mumbai',19.0760,72.8777,'HIGH',0))
                total_inserted += 1
            except: pass

        print(f'OK: "{q}" -> {len(r.get("results",[]))} results')
        time.sleep(1)  # avoid rate limit

    except Exception as e:
        print(f'FAIL {q}: {e}')

conn.commit()
conn.close()
print(f'\nTotal new articles inserted: {total_inserted}')
count = sqlite3.connect('sentinel_v2.db').execute('SELECT COUNT(*) FROM crime_events WHERE source != ""').fetchone()[0]
print(f'Total real news in DB: {count}')
