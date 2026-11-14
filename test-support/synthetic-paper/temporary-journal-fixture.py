"""Generated harness snapshots only; no reducer, reconciliation, or runtime adapter."""
import json
import os
import sqlite3
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

MAX_INPUT = 16384
MAX_DB = 262144

def encode(value):
    return json.dumps(value, separators=(',', ':'), sort_keys=True)

def connect(path):
    db = sqlite3.connect(path, timeout=1)
    db.execute('PRAGMA page_size=4096')
    db.execute('PRAGMA journal_mode=DELETE')
    db.execute('PRAGMA synchronous=FULL')
    db.execute('PRAGMA max_page_count=64')
    return db

def child(path, phase):
    # A test-generated original attempt; no recovery/resolution write path exists.
    db = connect(path)
    db.execute('BEGIN IMMEDIATE')
    before, current, fence, blocked, receipt = db.execute('SELECT prior, current, fence, blocked, receipt FROM fixture').fetchone()
    if current != before or not blocked or receipt is not None:
        raise ValueError('original attempt no longer eligible')
    expected, proposed, result = db.execute('SELECT expected, proposed, result FROM generated').fetchone()
    if expected != before:
        raise ValueError('CAS_LOSER')
    original = json.loads(result)['receipt']
    if original['fenceToken'] != fence:
        raise ValueError('STALE_FENCE')
    # Opaque account/state/sequence/receipt from the existing JS harness: one transaction.
    db.execute('UPDATE fixture SET current=?, receipt=?, fence_state=?',
               (proposed, result, 'RESOLVED_COMMITTED'))
    if phase == 'before':
        os._exit(31)
    db.commit()
    if phase == 'after':
        os._exit(32)
    db.close()

def run(data):
    if data['scope'] != 'SYNTHETIC_TEST_ONLY' or not data['identity'].startswith('synthetic-test:'):
        raise ValueError('fixture scope')
    result = data['committed']
    receipt = result['receipt']
    if result['status'] != 'COMMITTED' or result['syntheticIdentity'] != data['identity']:
        raise ValueError('fixture identity')
    if receipt['parentStateIdentity'] != data['before']['stateIdentity']:
        raise ValueError('fixture parent')
    if receipt['stateIdentity'] != data['after']['stateIdentity'] or receipt['account'] != data['after']['account']:
        raise ValueError('fixture state')
    if data['phase'] not in ('before', 'after', 'normal'):
        raise ValueError('phase')
    for snapshot in (data['before'], data['after']):
        for key in ('cashCents', 'holdingsShares', 'costBasisCents', 'feesCents'):
            value = snapshot['account'][key]
            if not isinstance(value, str) or not value.isascii() or not value.isdigit() or len(value) > 32:
                raise ValueError('integer fixture units required')
    with tempfile.TemporaryDirectory(prefix='synthetic-paper-journal-') as root:
        path = Path(root) / 'fixture.sqlite'
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        db = connect(path)
        db.execute('CREATE TABLE fixture(prior TEXT NOT NULL, current TEXT NOT NULL, fence TEXT NOT NULL, blocked INTEGER NOT NULL, receipt TEXT, fence_state TEXT NOT NULL)')
        db.execute('CREATE TABLE generated(expected TEXT NOT NULL, proposed TEXT NOT NULL, result TEXT NOT NULL)')
        before, after = encode(data['before']), encode(data['after'])
        # Original claim is durable before child launch. Restart is always blocked.
        db.execute('INSERT INTO fixture VALUES(?,?,?,?,NULL,?)', (before, before, receipt['fenceToken'], 1, 'ACTIVE_UNRESOLVED'))
        db.execute('INSERT INTO generated VALUES(?,?,?)', (before, after, encode(result)))
        db.commit()
        db.close()
        env = {key: os.environ[key] for key in ('PATH', 'LANG') if key in os.environ}
        proc = subprocess.run([sys.executable, '-I', __file__, '--child', str(path), data['phase']],
                              env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        expected_exit = {'before': 31, 'after': 32, 'normal': 0}[data['phase']]
        if proc.returncode != expected_exit:
            raise ValueError('unexpected child exit')
        # SQLite may need to roll back its hot journal before read-only inspection.
        db = connect(path)
        db.execute('SELECT current FROM fixture').fetchone()
        db.close()
        disk_before = path.read_bytes()
        db = sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=1)
        db.execute('PRAGMA query_only=ON')
        if db.execute('PRAGMA integrity_check').fetchone() != ('ok',):
            raise ValueError('integrity')
        current, fence, blocked, stored, fence_state = db.execute('SELECT current,fence,blocked,receipt,fence_state FROM fixture').fetchone()
        def lookup(identity, token):
            if stored:
                saved = json.loads(stored)
                if saved['receipt']['receiptIdentity'] == identity and saved['receipt']['fenceToken'] == token:
                    return saved
            return {'status': 'UNKNOWN', 'reason': 'PERSISTENCE_UNKNOWN'}
        exact = lookup(receipt['receiptIdentity'], fence)
        repeated = lookup(receipt['receiptIdentity'], fence)
        wrong_fence = lookup(receipt['receiptIdentity'], fence + ':wrong')
        missing = lookup(receipt['receiptIdentity'] + ':missing', fence)
        try:
            db.execute('UPDATE fixture SET blocked=0')
            raise AssertionError('write permitted')
        except sqlite3.OperationalError:
            pass
        db.close()
        if disk_before != path.read_bytes() or sum(p.stat().st_size for p in Path(root).iterdir()) > MAX_DB:
            raise ValueError('read mutation or size bound')
        output = dict(scope='SYNTHETIC_TEST_ONLY', snapshot=json.loads(current), exact=exact,
                      repeated=repeated, wrongFence=wrong_fence, missing=missing,
                      blocked=bool(blocked), fence=fence, fenceState=fence_state,
                      receiptCount=0 if stored is None else 1, readOnlyUnchanged=True,
                      retryAuthorized=False, reconciliationImplemented=False)
    output['temporaryDirectoryRemoved'] = not Path(root).exists()
    return output

def interrupted(_signal, _frame):
    raise TimeoutError('bounded fixture interrupted')

if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    if len(sys.argv) == 4 and sys.argv[1] == '--child':
        child(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 1:
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        if len(raw) > MAX_INPUT:
            raise ValueError('input bound')
        print(encode(run(json.loads(raw))))
    else:
        raise ValueError('arguments')
