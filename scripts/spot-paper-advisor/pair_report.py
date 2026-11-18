"""Publish a bounded, read-only comparison of the two co-located paper ledgers."""
from contextlib import closing
from datetime import datetime, timezone
import json
import sqlite3


def iso(slot):
    return datetime.fromtimestamp(slot, timezone.utc).isoformat()


# Export only operational categories. Ledger records also contain model prose.
def skip_cause(reason, market_status):
    if reason == 'MARKET_UNAVAILABLE':
        if market_status in ('EMPTY_OHLC', 'INCOMPLETE_OHLC', 'INVALID_OHLC', 'OHLC_GAP_OR_INVALID_RANGE'):
            return 'CANDLES'
        if market_status in ('BOOK_TIME_INVALID', 'STALE_BOOK'):
            return 'BOOK_TIME'
        if market_status in ('SLOW_BOOK', 'EMPTY_BOOK', 'INVALID_BOOK', 'CROSSED_BOOK'):
            return 'BOOK'
        if market_status == 'HTTP_429':
            return 'RATE_LIMIT'
        if market_status == 'REQUEST_FAILED':
            return 'REQUEST'
        if market_status == 'SLOT_EXPIRED':
            return 'WINDOW'
        return 'MARKET'
    if reason == 'MODEL_KEY_UNAVAILABLE':
        return 'MODEL_ACCESS'
    if reason.startswith('MODEL_UNAVAILABLE'):
        return 'MODEL'
    if reason == 'DECISION_WINDOW_EXPIRED':
        return 'WINDOW'
    return None


def describe(raw, initial):
    record = json.loads(raw)
    report = record['report']
    equity = report['arms']['model']['equityEur']
    last = report['last']
    cause = skip_cause(last['reason'], record.get('marketStatus'))
    change = None if equity is None or initial is None else round(equity-initial, 2)
    arm = dict(action='SKIPPED' if cause else last['action'], equity=equity, change=change)
    if cause:
        arm['skipCause'] = cause
    return arm


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
