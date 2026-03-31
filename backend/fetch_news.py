import os
import sqlite3
import hashlib
import requests
from datetime import datetime
from dotenv import load_dotenv
load_dotenv()

API_KEY = os.getenv("NEWSDATA_API_KEY")
if not API_KEY:
    print("Error: NEWSDATA_API_KEY not found in environment variables.")
    exit(1)

url = f'https://newsdata.io/api/1/news?apikey={API_KEY}&q=mumbai+crime&country=in&language=en'

r = requests.get(url).json()
print('Status:', r.get('status'))
print('Total results:', len(r.get('results', [])))

conn = sqlite3.connect('sentinel_v2.db')
cur = conn.cursor()

inserted = 0
for item in r.get('results', []):
    title = item.get('title','') or ''
    desc = item.get('description','') or item.get('content','') or ''
    link = item.get('link','') or ''
    source = item.get('source_id','') or ''
    pub = item.get('pubDate', datetime.now().isoformat())
    h = hashlib.md5(link.encode()).hexdigest()[:20]
    try:
        cur.execute('''INSERT OR IGNORE INTO crime_events
            (title,description,source,url,published_at,ingested_at,
             story_hash,language,locations,persons,orgs,crime_types,
             zone_id,zone,zone_lat,zone_lon,severity,is_processed)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
            (title[:500],desc[:1000],source,link[:500],pub,
             datetime.now().isoformat(),h,'en','Mumbai','','','News',
             'Z18','Mumbai',19.0760,72.8777,'HIGH',0))
        inserted += 1
    except Exception as e:
        print('Skip:', e)

conn.commit()
conn.close()
print(f'Real news inserted: {inserted}')
