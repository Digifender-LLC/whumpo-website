"""Verify migration 0102 preserves real pre-upgrade rows and their constraints."""
import pathlib, sqlite3
c=sqlite3.connect(':memory:')
c.execute('PRAGMA foreign_keys=ON')
for p in sorted(pathlib.Path('migrations').glob('*.sql')):
    if p.name.startswith('0102_'): break
    c.executescript(p.read_text())
for i,state in enumerate(['reserved','completed','stale']):
    user=f'fixture-{i}'
    c.execute("INSERT INTO users VALUES(?,?, 'fixture','fixture',datetime('now'))",(user,user+'@example.test'))
    c.execute("INSERT INTO user_profiles(user_id,photo,photo_digest) VALUES(?,? ,?)",(user,b'synthetic-non-image', 'a'*64))
    c.execute("INSERT INTO profile_photo_safety(user_id,digest,photo_revision,policy_version) VALUES(?,?,0,'2026-09-30')",(user,'a'*64))
    c.execute("INSERT INTO photo_scan_tickets(id,kind,subject_id,user_id,digest,policy_version,authority_hash,expires_at) VALUES(?,'profile',?,?,?,'2026-09-30',?,datetime('now','+15 minutes'))",(user,user,user,'a'*64,'b'*64))
    if state!='reserved':
        c.execute("UPDATE photo_scan_tickets SET state=?,result_hash=?,outcome='held',completed_at=datetime('now') WHERE id=?",(state,'c'*64,user))
before=c.execute('SELECT * FROM photo_scan_tickets ORDER BY id').fetchall()
c.executescript(pathlib.Path('migrations/0102_photo_scan_retries.sql').read_text())
assert before==c.execute('SELECT * FROM photo_scan_tickets ORDER BY id').fetchall()
assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
for i in range(3):
    user=f'fixture-{i}'
    try:
        c.execute("INSERT INTO photo_scan_tickets(id,kind,subject_id,user_id,digest,policy_version,authority_hash,expires_at) VALUES(?,'profile',?,?,?,'2026-09-30',?,datetime('now','+15 minutes'))",('retry-'+user,user,user,'a'*64,'d'*64))
        assert i!=0
    except sqlite3.IntegrityError:
        assert i==0
try:
    c.execute("UPDATE photo_scan_tickets SET state='reserved' WHERE id='fixture-1'")
    raise AssertionError('Terminal record became mutable')
except sqlite3.IntegrityError:
    pass
print('Migration 0102 preserves pending/completed/stale rows, foreign keys, one reserved attempt, terminal immutability, and permits terminal retries.')
