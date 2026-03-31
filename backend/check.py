import sqlite3
conn = sqlite3.connect('sentinel_v2.db')
for t in ['crime_events','fir_cases','zones','alerts','dispatch_tasks']:
    print(t, conn.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0])
conn.close()
