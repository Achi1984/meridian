"""Publish a bounded, read-only comparison of the co-located paper ledgers."""
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
    execution = last.get('execution')
    if execution in ('PAPER_BUY', 'PAPER_SELL', 'HOLD', 'POSITION_UNCHANGED', 'NO_FRESH_BOOK',
                     'DECISION_WINDOW_EXPIRED', 'INSUFFICIENT_ASK_SIZE', 'INSUFFICIENT_BID_SIZE'):
        arm['execution'] = execution
    if cause:
        arm['skipCause'] = cause
    return arm


def comparison(volume):
    base = (volume/'pilot.sqlite').as_uri() + '?mode=ro'
    challenger = (volume/'challenger-v2'/'pilot.sqlite').as_uri() + '?mode=ro'
    with closing(sqlite3.connect(base, uri=True)) as db:
        db.execute('ATTACH DATABASE ? AS v2', (challenger,))
        third = volume/'challenger-v3'/'pilot.sqlite'
        has_third = third.is_file()
        if has_third:
            db.execute('ATTACH DATABASE ? AS v3', (third.as_uri() + '?mode=ro',))
        db.execute('BEGIN')
        start, = db.execute('SELECT start FROM v2.pilot WHERE id=1').fetchone()
        end, = db.execute('SELECT start+604800 FROM main.pilot WHERE id=1').fetchone()
        pair = db.execute("""SELECT a.slot, a.record, b.record FROM main.slots a
                             JOIN v2.slots b USING(slot) WHERE a.slot>=? AND a.slot<?
                             AND a.record IS NOT NULL AND b.record IS NOT NULL
                             ORDER BY a.slot DESC LIMIT 1""", (start, end)).fetchone()
        if not pair:
            return end, None
        def opening(table, epoch):
            row = db.execute(f"""SELECT json_extract(record,'$.report.arms.model.equityEur')
                                 FROM {table}.slots WHERE slot=?""", (epoch-600,)).fetchone()
            return row[0] if row else None

        slot, v1, v2 = pair
        result = dict(start=iso(start), at=iso(slot), v1=describe(v1, opening('main', start)),
                      v2=describe(v2, 1000))
        if not has_third:
            return end, result
        # An initializing or delayed V3 must not hide the latest V1/V2 comparison.
        ready = db.execute("SELECT 1 FROM v3.sqlite_master WHERE type='table' AND name='pilot'").fetchone()
        epoch = db.execute('SELECT start FROM v3.pilot WHERE id=1').fetchone() if ready else None
        if epoch is not None:
            # V2 can retire while V1 and V3 continue in the same pilot.
            newer = db.execute('''SELECT a.slot, a.record, c.record FROM main.slots a
                                  JOIN v3.slots c USING(slot) WHERE a.slot > ? AND a.slot >= ? AND a.slot < ?
                                  AND a.record IS NOT NULL AND c.record IS NOT NULL
                                  ORDER BY a.slot DESC LIMIT 1''', (slot, epoch[0], end)).fetchone()
            if newer:
                at, baseline, third_record = newer
                initial = 1000 if epoch[0] == end - 604800 else opening('main', epoch[0])
                return end, dict(start=iso(epoch[0]), at=iso(at),
                                 v1=describe(baseline, initial), v3=describe(third_record, 1000))
        if epoch is None or slot < epoch[0]:
            return end, result
        third_row = db.execute('SELECT record FROM v3.slots WHERE slot=?', (slot,)).fetchone()
        if not third_row or third_row[0] is None:
            result['v3Pending'] = True
            return end, result
        third_start = epoch[0]
        epoch = max(start, third_start)
        base_start = end - 604800
        return end, dict(start=iso(epoch), at=iso(slot),
                         v1=describe(v1, 1000 if epoch == base_start else opening('main', epoch)),
                         v2=describe(v2, 1000 if epoch == start else opening('v2', epoch)),
                         v3=describe(third_row[0], 1000 if epoch == third_start else opening('v3', epoch)))
