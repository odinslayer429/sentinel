import sqlite3
conn = sqlite3.connect('sentinel_v2.db')
for tbl in ['crime_events','fir_cases','zones']:
    print(f'--- {tbl} ---')
    for row in conn.execute(f'PRAGMA table_info({tbl})'):
        print(row)
conn.close()
