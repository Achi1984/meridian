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


def signal(state, snapshot, slot, *, require_uptrend=True):
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
    if require_uptrend and not bars[0][4] < bars[1][4] < bars[2][4]:
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


def reclaim_entry(ask, stop, target):
    """Require two dollars of potential net gain for each dollar at risk."""
    ask, stop, target = (Decimal(str(x)) for x in (ask, stop, target))
    entry = ask * (1+SLIP) * (1+FEE)
    proceeds = (1-SLIP) * (1-FEE)
    return stop < ask and target*proceeds-entry >= 2*(entry-stop*proceeds)


def reclaim_signal(state, snapshot, slot):
    """Buy a failed downside break of the preceding six completed candles."""
    if forced(state, slot):
        return ('SELL' if state['opened'] is not None else 'HOLD'), 'DAY_CLOSE', None, None
    if state['opened'] is not None and slot-state['opened'] >= 7200:
        return 'SELL', 'TIME_EXIT', None, None
    bars = closed_bars(snapshot, 'ten', 1 if state['opened'] is not None else 7, slot, STEP)
    if bars is None:
        return 'HOLD', 'CANDLES_UNAVAILABLE', None, None
    last = bars[-1]
    if state['opened'] is not None:
        if last[4] <= state['stop'] or last[4] >= state['target']:
            return 'SELL', ('STOP_CLOSE' if last[4] <= state['stop'] else 'TARGET_CLOSE'), None, None
        return 'HOLD', 'POSITION_OPEN', None, None
    floor = min(b[3] for b in bars[:-1])
    if not last[3] < floor < last[4] or last[4] <= last[1]:
        return 'HOLD', 'WAIT_RECLAIM', None, None
    book = snapshot.get('book')
    stamp = book.get('received') if isinstance(book, dict) else None
    if type(stamp) not in (int, float) or not usable_book(book, stamp, slot):
        return 'HOLD', 'NO_SIGNAL_BOOK', None, None
    target = max(b[2] for b in bars[:-1])
    if not reclaim_entry(book['ask'], last[3], target):
        return 'HOLD', 'INSUFFICIENT_NET_REWARD', None, None
    return 'BUY', 'RANGE_RECLAIM', last[3], target


def pnl_parts(state, equity):
    """Attribute net PnL using the recorded cash cost of the open BTC lot."""
    if not state or 'cash' not in state or 'btc' not in state:
        return dict(realizedUsd=None, openPnlUsd=None)
    cash = Decimal(state['cash'])
    if not Decimal(state['btc']):
        return dict(realizedUsd=float(cash-1000), openPnlUsd=0.0)
    if state.get('entryCostUsd') is None:
        return dict(realizedUsd=None, openPnlUsd=None)
    basis = cash + Decimal(state['entryCostUsd'])
    return dict(realizedUsd=float(basis-1000),
                openPnlUsd=None if equity is None else float(Decimal(str(equity))-basis))


def paper_slot(state, snapshot, fill_book, slot, observed, *, require_uptrend=True, reclaim=False):
    action, reason, stop, target = (reclaim_signal(state, snapshot, slot) if reclaim else
                                  signal(state, snapshot, slot, require_uptrend=require_uptrend))
    book = usable_book(fill_book, observed, slot)
    if action == 'BUY' and book and snapshot['book']['received'] > book['received']:
        action, reason = 'HOLD', 'SIGNAL_AFTER_FILL_BOOK'
    if action == 'BUY' and book and not (reclaim_entry(book['ask'], stop, target) if reclaim
                                        else target_covers_cost(book['ask'], target)):
        action, reason = 'HOLD', 'EXECUTION_COST_FILTER'
    cash_before = Decimal(state['cash'])
    if action != 'HOLD' and observed >= slot+90 and not forced(state, slot):
        execution = 'DECISION_WINDOW_EXPIRED'
    else:
        execution = execute(state, action, book, slot)
    if execution == 'PAPER_BUY':
        state.update(stop=stop, target=target, entryCostUsd=str(cash_before-Decimal(state['cash'])))
    equity = mark(state, book)['equityEur']
    return dict(action=action, reason=reason, execution=execution, equityUsd=equity)


def fixed_lot_fee_scenarios(ask, quantity, exit_bid, observed_bids, exit_slot):
    """Reprice identical fills and sampled executable exits, holding size and slippage fixed."""
    scenarios = []
    for bps in (50, 35, 20, 10, 5):
        fee = Decimal(bps) / 10000
        cost = ask * (1+SLIP) * (1+fee)
        proceeds_factor = (1-SLIP) * (1-fee)
        first = next(((at, bid) for at, bid in observed_bids if bid*proceeds_factor > cost), None)
        baseline_net = quantity * (exit_bid * proceeds_factor - cost)
        early = first is not None and first[0] < exit_slot
        delta = quantity / 2 * (first[1] - exit_bid) * proceeds_factor if early else Decimal(0)
        scenarios.append(dict(halfExitAt=iso(first[0]) if early else None,
                              halfExitNetUsd=float(baseline_net + delta), halfExitDeltaUsd=float(delta),
                              feeBpsPerSide=bps, breakEvenBidUsd=float(cost/proceeds_factor),
                              exitNetUsd=float(baseline_net),
                              firstPositiveAt=iso(first[0]) if first else None,
                              firstPositiveBidUsd=float(first[1]) if first else None))
    return scenarios


def replay(db, *, duration=7*DAY, require_uptrend=True, reclaim=False, since=None):
    # Keep the pilot epoch, slots and endpoint baselines on one SQLite snapshot.
    with closing(db.cursor()) as cursor:
        rows = cursor.execute("""SELECT p.start, s.slot, s.record FROM pilot p
                                 LEFT JOIN slots s ON s.slot >= max(p.start, coalesce(?, p.start))
                                 AND s.slot < p.start + ? WHERE p.id=1 ORDER BY s.slot""", (since, duration))
        state = initial()
        latest = baseline = start = previous = None
        missing = modeled = 0
        trades = []
        entry = None
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
            next_slot = max(start, since or start) if previous is None else previous + STEP
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
            if entry is not None:
                now = observed.timestamp()
                book = usable_book(record.get('fillBook'), now, slot)
                if book and (now < slot+90 or forced(state, slot)) and Decimal(str(book['bidSize'])) >= entry[2]:
                    observed_bids.append((slot, Decimal(str(book['bid']))))
            cash_before = Decimal(state['cash'])
            latest = paper_slot(state, record.get('snapshot'), record.get('fillBook'), slot,
                                observed.timestamp(), require_uptrend=require_uptrend, reclaim=reclaim)
            reasons[latest['action']][latest['reason']] += 1
            executions[latest['execution']] += 1
            modeled += 1
            equity = latest['equityUsd']
            if equity is not None:
                peak = max(peak, equity)
                drawdown = max(drawdown, 100*(1-equity/peak))
            if latest['execution'] in ('PAPER_BUY', 'PAPER_SELL'):
                active_days.add(slot//DAY)
            if latest['execution'] == 'PAPER_BUY':
                observed_bids = []
                entry = (slot, Decimal(str(record['fillBook']['ask'])), Decimal(state['btc']), cash_before)
            elif latest['execution'] == 'PAPER_SELL':
                opened, ask, quantity, starting_cash = entry
                bid = Decimal(str(record['fillBook']['bid']))
                gross = quantity * (bid - ask)
                slippage = quantity * (ask + bid) * SLIP
                net = Decimal(state['cash']) - starting_cash
                trades.append(dict(entryAt=iso(opened), exitAt=iso(slot), entryAskUsd=float(ask),
                                   exitBidUsd=float(bid), btc=float(quantity), exitReason=latest['reason'],
                                   quotePnlUsd=float(gross), slippageUsd=float(slippage),
                                   feesUsd=float(gross-slippage-net), netUsd=float(net),
                                   eligibleExitSlots=len(observed_bids), holdingSlots=(slot-opened)//STEP,
                                   fixedLotFeeScenarios=fixed_lot_fee_scenarios(ask, quantity, bid, observed_bids, slot)))
                entry = None
            latest['at'] = iso(slot)
            baseline = {name: report['arms'][name]['equityUsd']
                        for name in ('v3', 'v4', 'cash', 'btcHold')}
    if latest is None:
        raise ValueError('no completed BTC/USD round slots')
    equity = latest['equityUsd']
    return dict(schema=('MERIDIAN_USD_RECLAIM_V1' if reclaim else 'MERIDIAN_USD_PULLBACK_V1'), mode='REPLAY', pair='BTC/USD', start=iso(max(start, since or start)),
                through=iso(previous), modeledSlots=modeled, missingSlots=missing, last=latest,
                equityUsd=equity, netUsd=None if equity is None else equity-1000, closed=len(trades), closedTrades=trades,
                **pnl_parts(state, equity), activeDays=len(active_days), maxObservedDrawdownPct=drawdown,
                signalReasonCounts=reasons, executionCounts=executions, sameSlotBaselineEquityUsd=baseline if since is None or since <= start else None)


def first_day(db, now):
    """Report closed ten-minute intervals of day one on the caller's read snapshot."""
    from pilot import UNIT

    start, = db.execute('SELECT start FROM pilot WHERE id=1').fetchone()
    expected = max(0, min(DAY, int(now)-start)) // STEP
    end = start + expected*STEP
    arms = {key: dict(buySignals=0, buys=0, sells=0, equityUsd=None, netUsd=None, realizedUsd=None, openPnlUsd=None,
                      reasons=Counter()) for key in ('v3', 'v4', 'cash', 'btcHold')}
    observed = 0
    for slot, raw in db.execute('SELECT slot, record FROM slots WHERE slot>=? AND slot<? '
                                'AND record IS NOT NULL ORDER BY slot', (start, end)):
        record = json.loads(raw)
        report = record['report']
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
                summary.update(equityUsd=arm['equityUsd'], netUsd=arm['netUsd'],
                               **pnl_parts(record.get('states', {}).get(key), arm['equityUsd']))
    spent, reserved = db.execute('SELECT coalesce(sum(charge*settled),0), '
                                 'coalesce(sum(charge*(1-settled)),0) FROM calls '
                                 'WHERE slot>=? AND slot<?', (start, end)).fetchone()
    v5 = replay(db, duration=end-start) if observed else None
    if v5:
        summary = dict(buySignals=sum(v5['signalReasonCounts']['BUY'].values()),
                       buys=v5['executionCounts']['PAPER_BUY'], sells=v5['closed'],
                       equityUsd=None, netUsd=None, realizedUsd=None, openPnlUsd=None, reasons=v5['signalReasonCounts'])
        if v5['last']['at'] == iso(end-STEP):
            summary.update(equityUsd=v5['equityUsd'], netUsd=v5['netUsd'],
                           realizedUsd=v5['realizedUsd'], openPnlUsd=v5['openPnlUsd'])
        v5 = summary
    return dict(start=iso(start), endExclusive=iso(end), targetSlots=DAY//STEP,
                expectedSlots=expected, observedSlots=observed, missingSlots=expected-observed,
                arms=arms, v5Replay=v5, modelCostUsd=spent/UNIT, modelReserveUsd=reserved/UNIT)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ledger', type=Path, required=True, help='Existing USD round.sqlite file')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--compare-hourly-filter', action='store_true',
                      help='Compare independent all-slot pullbacks with and without the hourly trend requirement')
    mode.add_argument('--first-day', action='store_true',
                        help='Compare closed intervals of the first 24 hours, including recorded model costs')
    mode.add_argument('--range-reclaim', action='store_true',
                      help='Replay the cost-aware failed breakdown and score future slots separately')
    args = parser.parse_args()
    with closing(sqlite3.connect(args.ledger.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        db.execute('BEGIN')
        if args.range_reclaim:
            cutoff = int(datetime.fromisoformat('2026-11-21T00:00:00+00:00').timestamp())
            result = dict(fullRound=replay(db, reclaim=True), forwardFrom=iso(cutoff), forward=None)
            start, = db.execute('SELECT start FROM pilot WHERE id=1').fetchone()
            if db.execute('SELECT 1 FROM slots WHERE slot>=? AND slot<? AND record IS NOT NULL LIMIT 1',
                          (max(start, cutoff), start+7*DAY)).fetchone():
                result['forward'] = replay(db, reclaim=True, since=cutoff)
        elif args.compare_hourly_filter:
            result = dict(withHourlyTrend=replay(db), withoutHourlyTrend=replay(db, require_uptrend=False))
        else:
            result = first_day(db, time.time()) if args.first_day else replay(db)
        print(json.dumps(result, allow_nan=False))
