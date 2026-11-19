"""Replay the V5 pullback hypothesis against the existing BTC/USD paper round."""
import argparse
from collections import Counter
from contextlib import closing
from datetime import datetime
from decimal import Decimal
import json
from pathlib import Path
import sqlite3
import time
from sys import float_info

from pair_report import valid_replay_candle
from worker import DAY, FEE, SLIP, STEP, execute, forced, initial, iso, mark


def closed_bars(snapshot, key, count, end, step):
    bars = snapshot.get(key) if isinstance(snapshot, dict) else None
    if not isinstance(bars, list) or len(bars) < count:
        return None
    window = bars[-count:]
    if not all(valid_replay_candle(bar, end - (count-i)*step) for i, bar in enumerate(window)):
        return None
    return window


def target_covers_cost(ask, target):
    buy = Decimal(str(ask)) * (1+SLIP) * (1+FEE)
    sell = Decimal(str(target)) * (1-SLIP) * (1-FEE)
    return sell > buy


def usable_book(book, observed, slot):
    if not isinstance(book, dict) or not slot <= observed < slot+STEP:
        return None
    for key in ('bid', 'ask', 'bidSize', 'askSize', 'received', 'bidAt', 'askAt'):
        value = book.get(key)
        if type(value) not in (float, int) or not 0 < value <= float_info.max:
            return None
    if book['bid'] > book['ask'] or any(not 0 <= observed-book[k] <= 5
                                        for k in ('received', 'bidAt', 'askAt')):
        return None
    return book


def signal(state, snapshot, slot):
    """Return (action, reason, stop, target) using information available before the fill."""
    opened = state['opened']
    if forced(state, slot):
        return ('SELL' if opened is not None else 'HOLD'), 'DAY_CLOSE', None, None
    if opened is not None and slot-opened >= 3600:
        return 'SELL', 'TIME_EXIT', None, None
    ten = closed_bars(snapshot, 'ten', 2, slot, STEP)
    if ten is None:
        return 'HOLD', 'CANDLES_UNAVAILABLE', None, None
    pullback, recovery = ten
    close = recovery[4]
    if opened is not None:
        if close <= state['stop']:
            return 'SELL', 'PULLBACK_FAILED', None, None
        if close >= state['target']:
            return 'SELL', 'TARGET_REACHED', None, None
        return 'HOLD', 'POSITION_OPEN', None, None
    hour = slot-slot % 3600
    bars = closed_bars(snapshot, 'hour', 3, hour, 3600)
    if bars is None:
        return 'HOLD', 'CANDLES_UNAVAILABLE', None, None
    if not bars[0][4] < bars[1][4] < bars[2][4]:
        return 'HOLD', 'NO_UPTREND', None, None
    if pullback[4] >= pullback[1] or close <= pullback[2]:
        return 'HOLD', 'WAIT_RECOVERY', None, None
    decision_book = snapshot.get('book')
    observed = decision_book.get('received') if isinstance(decision_book, dict) else None
    if type(observed) not in (int, float) or not usable_book(decision_book, observed, slot):
        return 'HOLD', 'NO_SIGNAL_BOOK', None, None
    target = bars[2][2]
    if not target_covers_cost(decision_book['ask'], target):
        return 'HOLD', 'TARGET_BELOW_COST', None, None
    return 'BUY', 'PULLBACK_RECOVERY', pullback[3], target


def paper_slot(state, snapshot, fill_book, slot, observed):
    action, reason, stop, target = signal(state, snapshot, slot)
    book = usable_book(fill_book, observed, slot)
    if action == 'BUY' and book and snapshot['book']['received'] > book['received']:
        action, reason = 'HOLD', 'SIGNAL_AFTER_FILL_BOOK'
    if action == 'BUY' and book and not target_covers_cost(book['ask'], target):
        action, reason = 'HOLD', 'EXECUTION_COST_FILTER'
    if action != 'HOLD' and observed >= slot+90 and not forced(state, slot):
        execution = 'DECISION_WINDOW_EXPIRED'
    else:
        execution = execute(state, action, book, slot)
    if execution == 'PAPER_BUY':
        state.update(stop=stop, target=target)
    equity = mark(state, book)['equityEur']
    return dict(action=action, reason=reason, execution=execution, equityUsd=equity)


def replay(db, *, duration=7*DAY):
    # Keep the pilot epoch, slots and endpoint baselines on one SQLite snapshot.
    with closing(db.cursor()) as cursor:
        rows = cursor.execute("""SELECT p.start, s.slot, s.record FROM pilot p
                                 LEFT JOIN slots s ON s.slot >= p.start
                                 AND s.slot < p.start + ? WHERE p.id=1 ORDER BY s.slot""", (duration,))
        state = initial()
        latest = baseline = start = previous = None
        missing = closed = modeled = 0
        peak = 1000
        drawdown = 0
        active_days = set()
        reasons = {action: Counter() for action in ('BUY', 'SELL', 'HOLD')}
        executions = Counter()
        for start, slot, raw in rows:
            if slot is None:
                break
            if slot % STEP:
                raise ValueError('USD ledger contains an off-grid slot')
            next_slot = start if previous is None else previous + STEP
            missing += (slot-next_slot)//STEP
            previous = slot
            if raw is None:
                missing += 1
                continue
            record = json.loads(raw)
            report = record['report']
            if (report.get('schema') != 'MERIDIAN_USD_ROUND_V1' or report.get('pair') != 'BTC/USD'
                    or report.get('start') != iso(start) or report.get('at') != iso(slot)):
                raise ValueError('expected matching BTC/USD round and decision slot')
            observed = datetime.fromisoformat(report['publishedAt'])
            if observed.tzinfo is None:
                raise ValueError('expected timezone-aware publication time')
            latest = paper_slot(state, record.get('snapshot'), record.get('fillBook'), slot,
                                observed.timestamp())
            reasons[latest['action']][latest['reason']] += 1
            executions[latest['execution']] += 1
            modeled += 1
            equity = latest['equityUsd']
            if equity is not None:
                peak = max(peak, equity)
                drawdown = max(drawdown, 100*(1-equity/peak))
            if latest['execution'] in ('PAPER_BUY', 'PAPER_SELL'):
                active_days.add(slot//DAY)
            if latest['execution'] == 'PAPER_SELL':
                closed += 1
            latest['at'] = iso(slot)
            baseline = {name: report['arms'][name]['equityUsd']
                        for name in ('v3', 'v4', 'cash', 'btcHold')}
    if latest is None:
        raise ValueError('no completed BTC/USD round slots')
    equity = latest['equityUsd']
    return dict(schema='MERIDIAN_USD_PULLBACK_V1', mode='REPLAY', pair='BTC/USD', start=iso(start),
                through=iso(previous), modeledSlots=modeled, missingSlots=missing, last=latest,
                equityUsd=equity, netUsd=None if equity is None else equity-1000, closed=closed,
                activeDays=len(active_days), maxObservedDrawdownPct=drawdown,
                signalReasonCounts=reasons, executionCounts=executions, sameSlotBaselineEquityUsd=baseline)


def first_day(db, now):
    """Report closed ten-minute intervals of day one on the caller's read snapshot."""
    from pilot import UNIT

    start, = db.execute('SELECT start FROM pilot WHERE id=1').fetchone()
    expected = max(0, min(DAY, int(now)-start)) // STEP
    end = start + expected*STEP
    arms = {key: dict(buySignals=0, buys=0, sells=0, equityUsd=None, netUsd=None,
                      reasons=Counter()) for key in ('v3', 'v4', 'cash', 'btcHold')}
    observed = 0
    for slot, raw in db.execute('SELECT slot, record FROM slots WHERE slot>=? AND slot<? '
                                'AND record IS NOT NULL ORDER BY slot', (start, end)):
        report = json.loads(raw)['report']
        if (slot % STEP or report.get('schema') != 'MERIDIAN_USD_ROUND_V1' or
                report.get('pair') != 'BTC/USD' or report.get('at') != iso(slot) or
                report.get('start') != iso(start)):
            raise ValueError('unexpected USD round or slot')
        observed += 1
        for key, summary in arms.items():
            arm = report['arms'][key]
            summary['buySignals'] += arm['action'] == 'BUY'
            summary['buys'] += arm['execution'] == 'PAPER_BUY'
            summary['sells'] += arm['execution'] == 'PAPER_SELL'
            summary['reasons'][arm['reason']] += 1
            if slot == end-STEP:
                summary.update(equityUsd=arm['equityUsd'], netUsd=arm['netUsd'])
    spent, reserved = db.execute('SELECT coalesce(sum(charge*settled),0), '
                                 'coalesce(sum(charge*(1-settled)),0) FROM calls '
                                 'WHERE slot>=? AND slot<?', (start, end)).fetchone()
    v5 = replay(db, duration=end-start) if observed else None
    if v5:
        summary = dict(buySignals=sum(v5['signalReasonCounts']['BUY'].values()),
                       buys=v5['executionCounts']['PAPER_BUY'], sells=v5['closed'],
                       equityUsd=None, netUsd=None, reasons=v5['signalReasonCounts'])
        if v5['last']['at'] == iso(end-STEP):
            summary.update(equityUsd=v5['equityUsd'], netUsd=v5['netUsd'])
        v5 = summary
    return dict(start=iso(start), endExclusive=iso(end), targetSlots=DAY//STEP,
                expectedSlots=expected, observedSlots=observed, missingSlots=expected-observed,
                arms=arms, v5Replay=v5, modelCostUsd=spent/UNIT, modelReserveUsd=reserved/UNIT)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ledger', type=Path, required=True, help='Existing USD round.sqlite file')
    parser.add_argument('--first-day', action='store_true',
                        help='Compare closed intervals of the first 24 hours, including recorded model costs')
    args = parser.parse_args()
    with closing(sqlite3.connect(args.ledger.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        db.execute('BEGIN')
        result = first_day(db, time.time()) if args.first_day else replay(db)
        print(json.dumps(result, allow_nan=False))
