"""Publish a bounded, read-only comparison of the two co-located paper ledgers."""
from contextlib import closing
from datetime import datetime, timezone
import fcntl
import json
from pathlib import Path
import sqlite3
import time


def iso(slot):
    return datetime.fromtimestamp(slot, timezone.utc).isoformat()


def describe(raw, initial):
    report = json.loads(raw)['report']
    equity = report['arms']['model']['equityEur']
    last = report['last']
    skipped = (last['reason'].startswith(('MODEL_UNAVAILABLE', 'MODEL_KEY_UNAVAILABLE'))
               or last['reason'] in ('MARKET_UNAVAILABLE', 'DECISION_WINDOW_EXPIRED'))
    action = 'SKIPPED' if skipped else last['action']
    return dict(action=action, equity=equity, change=None if equity is None or initial is None else round(equity-initial, 2))


def comparison(volume):
    base = (volume/'pilot.sqlite').as_uri() + '?mode=ro'
    challenger = (volume/'challenger-v2'/'pilot.sqlite').as_uri() + '?mode=ro'
    with closing(sqlite3.connect(base, uri=True)) as db:
        db.execute('ATTACH DATABASE ? AS v2', (challenger,))
        db.execute('BEGIN')
        start, = db.execute('SELECT start FROM v2.pilot WHERE id=1').fetchone()
        end, = db.execute('SELECT start+604800 FROM main.pilot WHERE id=1').fetchone()
        pair = db.execute("""SELECT a.slot, a.record, b.record FROM main.slots a
                             JOIN v2.slots b USING(slot) WHERE a.slot>=? AND a.slot<?
                             AND a.record IS NOT NULL AND b.record IS NOT NULL
                             ORDER BY a.slot DESC LIMIT 1""", (start, end)).fetchone()
        if not pair:
            return end, None
        opening = db.execute("""SELECT json_extract(record,'$.report.arms.model.equityEur')
                                FROM main.slots WHERE slot=?""", (start-600,)).fetchone()
        slot, v1, v2 = pair
        return end, dict(start=iso(start), at=iso(slot), v1=describe(v1, opening[0] if opening else None),
                         v2=describe(v2, 1000))


def publish(volume):
    last = None
    with (volume/'challenger-v2'/'comparison.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while True:
            end, row = comparison(volume)
            if row and row['at'] != last:
                print(json.dumps({'pilotAudit': {'comparison': row}}, allow_nan=False), flush=True)
                last = row['at']
            if time.time() >= end:
                return
            time.sleep(30)


if __name__ == '__main__':
    publish(Path('/state'))
