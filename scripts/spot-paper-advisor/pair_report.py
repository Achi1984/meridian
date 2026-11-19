"""Publish a bounded, read-only comparison of the co-located paper ledgers."""
from contextlib import closing
from datetime import datetime, timezone
import json
import sqlite3
from decimal import Decimal

from feeds import COST_VERSION
from worker import DAY, STEP, execute, forced, initial, mark


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


# First eligible hour after the rule was fixed. All timestamps are UTC.
BREAKOUT_START = int(datetime.fromisoformat('2026-11-19T17:00:00+00:00').timestamp())


def breakout_reason(record, slot):
    hour = slot - slot % 3600
    inputs = record.get('inputs') or {}
    bars = inputs.get('hour', [])[-4:]
    ten = inputs.get('ten', [])
    if slot == hour:
        return 'WAIT_FIRST_CLOSE'
    if len(bars) != 4 or not ten:
        return 'CANDLES_UNAVAILABLE'
    if any(len(bar) != 5 or bar[0] != hour-(4-i)*3600 or bar[1] <= 0
           for i, bar in enumerate(bars)):
        return 'CANDLES_UNAVAILABLE'
    candle = ten[-1]
    if len(candle) != 5 or candle[0] != slot-STEP:
        return 'CANDLES_UNAVAILABLE'
    ranges = [(bar[2]-bar[3])/bar[1] for bar in bars]
    if ranges[-1] >= min(ranges[:-1]):
        return 'NO_COMPRESSION'
    return 'BREAKOUT' if candle[4] > bars[-1][2] else 'WAIT_BREAKOUT'


def breakout_signal(record, slot):
    return breakout_reason(record, slot) == 'BREAKOUT'


def breakout_duel(db, end, *, standalone=False):
    """Replay V4 chronologically and compare with the observed flat-start V3 ledger."""
    if end < BREAKOUT_START:
        return None
    table = 'main.slots' if standalone else 'v3.slots'
    rows = db.execute(f"""SELECT slot, record FROM {table} WHERE slot BETWEEN ? AND ?
                         AND record IS NOT NULL ORDER BY slot""", (BREAKOUT_START-STEP, end))
    state = initial()
    metrics = {k: dict(closed=0, realized=0.0, maxDrawdownPct=0.0, equity=None, last='HOLD')
               for k in ('v3', 'v4')}
    peaks = dict(v3=1000.0, v4=1000.0)
    only = dict(closed=0, netEur=0.0, costsEur=0.0)
    start = previous = baseline = v3_entry = None
    last_entry_hour = None
    exclusive = False
    gaps = 0
    for slot, raw in rows:
        record = json.loads(raw)
        if record.get('promptVersion') != COST_VERSION:
            continue
        last = record['report']['last']
        account = record['states']['model']
        cash, btc = float(account['cash']), Decimal(account['btc'])
        if start is None:
            if not btc:
                start, previous, baseline = slot+STEP, slot, cash
                prior_cash = cash
            continue
        contiguous = slot == previous + STEP
        gaps += (slot-previous)//STEP-1
        previous = slot
        execution = last['execution']
        model = metrics['v3']
        model['last'] = execution
        if execution == 'PAPER_BUY':
            v3_entry = prior_cash if contiguous else None
        if execution == 'PAPER_SELL' and v3_entry is not None:
            model['closed'] += 1
            model['realized'] += cash-v3_entry
            v3_entry = None
        prior_cash = cash
        equity = record['report']['arms']['model']['equityEur']
        model['equity'] = None if equity is None else 1000 + equity-baseline
        # A V4-only trade requires continuous evidence of V3 staying flat.
        flat = not btc and execution not in ('PAPER_BUY', 'PAPER_SELL')
        exclusive = exclusive and contiguous and flat
        now = datetime.fromisoformat(last['at']).timestamp()
        mandatory = forced(state, slot)
        book = record.get('executionBook') if slot <= now < slot+(STEP if mandatory else 90) else None
        opened = state['opened']
        action = 'HOLD'
        if mandatory:
            reason = 'DAY_CLOSE'
            if opened is not None:
                action = 'SELL'
        elif opened is not None:
            reason = 'POSITION_OPEN'
            if slot-opened >= 3600:
                action, reason = 'SELL', 'TIME_EXIT'
        elif last_entry_hour == slot//3600:
            reason = 'HOUR_USED'
        else:
            reason = breakout_reason(record, slot)
            if reason == 'BREAKOUT':
                action = 'BUY'
        before = Decimal(state['cash'])
        result = execute(state, action, book, slot)
        shadow = metrics['v4']
        shadow['last'] = result
        shadow['reason'] = reason
        if result == 'PAPER_BUY':
            last_entry_hour = slot//3600
            exclusive = flat
            entry_cash = before
            quantity = Decimal(state['btc'])
            entry_mid = (Decimal(str(book['bid'])) + Decimal(str(book['ask'])))/2
        elif result == 'PAPER_SELL':
            net = Decimal(state['cash'])-entry_cash
            shadow['closed'] += 1
            shadow['realized'] += float(net)
            if exclusive:
                exit_mid = (Decimal(str(book['bid'])) + Decimal(str(book['ask'])))/2
                only['closed'] += 1
                only['netEur'] += float(net)
                only['costsEur'] += float(quantity*(exit_mid-entry_mid)-net)
        shadow['equity'] = mark(state, book)['equityEur']
        for key, arm in metrics.items():
            value = arm['equity']
            if value is not None:
                peaks[key] = max(peaks[key], value)
                arm['maxDrawdownPct'] = max(arm['maxDrawdownPct'], 100*(1-value/peaks[key]))
    if start is None or previous < start or previous != end:
        return None
    days = (end-start+STEP)/DAY
    for arm in metrics.values():
        arm['netEur'] = None if arm['equity'] is None else arm['equity']-1000
        arm['tradesPerDay'] = arm['closed']/days
        arm['netPerTradeEur'] = arm['realized']/arm['closed'] if arm['closed'] else None
    return dict(start=iso(start), at=iso(end), missingSlots=gaps, onlyV4=only, **metrics)


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
                return end, dict(duel=breakout_duel(db, at), start=iso(epoch[0]), at=iso(at),
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
        return end, dict(duel=breakout_duel(db, slot), start=iso(epoch), at=iso(slot),
                         v1=describe(v1, 1000 if epoch == base_start else opening('main', epoch)),
                         v2=describe(v2, 1000 if epoch == start else opening('v2', epoch)),
                         v3=describe(third_row[0], 1000 if epoch == third_start else opening('v3', epoch)))
