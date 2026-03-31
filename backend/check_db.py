import sqlite3
conn = sqlite3.connect('sentinel_v2.db')
tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
print('Tables:', tables)
for t in tables:
    print(f'\n--- {t[0]} ---')
    cols = conn.execute(f'PRAGMA table_info({t[0]})').fetchall()
    for c in cols:
        print(f'  {c[1]} ({c[2]})')
    count = conn.execute(f'SELECT COUNT(*) FROM {t[0]}').fetchone()[0]
    print(f'  -> {count} rows')
