"""Prospective seven-day BTC/USD paper comparison on an isolated pilot volume ledger."""
import argparse
from contextlib import closing
from decimal import Decimal
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import time

import feeds
from pair_report import breakout_reason
from pilot import BudgetedFeeds, MODEL, UNIT, configure
from worker import DAY, STEP, challenger_inputs, execute, forced, initial, iso, mark, range_covers_cost


def usd_fields(values):
    return {key.removesuffix('Eur') + 'Usd' if key.endswith('Eur') else key: value
            for key, value in values.items()}


def signal_v3(state, snapshot, slot, decide):
    if forced(state, slot):
        return ('SELL' if state['opened'] is not None else 'HOLD'), 'DAY_CLOSE'
    if snapshot is None:
        return 'HOLD', 'MARKET_UNAVAILABLE'
    if state['opened'] is None and not range_covers_cost(snapshot, snapshot['book']):
        return 'HOLD', 'COST_FILTER'
    portfolio = usd_fields(mark(state, snapshot['book']))
    context = dict(policy=feeds.COST_VERSION, pair='BTC/USD', slotUtc=iso(slot),
                   market=snapshot, portfolio=portfolio, initialUsd=1000, entryBudgetUsd=100,
                   feeBpsPerSide=50, slippageBpsPerSide=10,
                   executionContext=usd_fields(challenger_inputs(snapshot, state, slot)))
    if state['opened'] is not None:
        equity = portfolio['equityUsd']
        context['position'] = dict(entryCostUsd=float(state['entryCostUsd']),
                                   minutesHeld=(slot-state['opened'])//60,
                                   liquidationPnlUsd=None if equity is None else
                                   equity-float(state['cash'])-float(state['entryCostUsd']))
    try:
        action, reason, _ = decide(context)
        return action, reason
    except feeds.FeedError as exc:
        return 'HOLD', feeds.model_failure(exc)


def signal_v4(state, snapshot, slot):
    if forced(state, slot):
        return ('SELL' if state['opened'] is not None else 'HOLD'), 'DAY_CLOSE'
    if state['opened'] is not None:
        if slot-state['opened'] >= 3600:
            return 'SELL', 'TIME_EXIT'
        return 'HOLD', 'POSITION_OPEN'
    if state.get('entryHour') == slot//3600:
        return 'HOLD', 'HOUR_USED'
    reason = breakout_reason({'inputs': snapshot}, slot)
    return ('BUY' if reason == 'BREAKOUT' else 'HOLD'), reason


def tick(db, slot, start, decide, *, market=feeds.market, orderbook=feeds.book, clock=time.time):
    now = clock()
    if slot % STEP or not start <= slot < start+7*DAY or not slot <= now < slot+STEP:
        raise ValueError('outside USD round or current slot')
    # A durable reservation prevents a second model call after a crash.
    with db:
        if not db.execute('INSERT OR IGNORE INTO slots VALUES (?, NULL)', (slot,)).rowcount:
            return None
    previous = db.execute('SELECT record FROM slots WHERE record IS NOT NULL AND slot<? ORDER BY slot DESC LIMIT 1',
                          (slot,)).fetchone()
    states = json.loads(previous[0])['states'] if previous else {
        name: dict(initial(), closed=0, activeDays=0, peakUsd=1000, maxDrawdownPct=0)
        for name in ('v3', 'v4', 'cash', 'btcHold')}
    try:
        snapshot = market(slot, pair='XBTUSD')
    except feeds.FeedError:
        snapshot = None
    v3 = states['v3']
    if clock() >= slot+90 and not forced(v3, slot):
        v3_signal = ('HOLD', 'DECISION_WINDOW_EXPIRED')
    else:
        v3_signal = signal_v3(v3, snapshot, slot, decide)
    actions = dict(v3=v3_signal, v4=signal_v4(states['v4'], snapshot, slot),
                   cash=('HOLD', 'CASH'),
                   btcHold=('HOLD', 'BUY_AND_HOLD') if states['btcHold']['opened'] is not None
                   else ('BUY', 'BUY_AND_HOLD'))
    try:
        book = orderbook(pair='XBTUSD')
    except feeds.FeedError:
        book = None
    now = clock()
    if book and (not slot <= now < slot+STEP or any(not 0 <= now-book[k] <= 5
                                                      for k in ('received', 'bidAt', 'askAt'))):
        book = None
    results = {}
    for name, state in states.items():
        action, reason = actions[name]
        if name == 'v3' and action == 'BUY' and book and not range_covers_cost(snapshot, book):
            action, reason = 'HOLD', 'EXECUTION_COST_FILTER'
        before = Decimal(state['cash'])
        if now >= slot+90 and action != 'HOLD' and not (name in ('v3','v4') and forced(state, slot)):
            execution = 'DECISION_WINDOW_EXPIRED'
        else:
            execution = execute(state, action, book, slot, entry_budget=Decimal(1000 if name == 'btcHold' else 100))
        if execution == 'PAPER_BUY':
            state['entryCostUsd'] = str(before-Decimal(state['cash']))
            state['entryHour'] = slot//3600
        if execution == 'PAPER_SELL':
            state['closed'] += 1
        if execution in ('PAPER_BUY', 'PAPER_SELL') and state.get('lastActiveDay') != slot//DAY:
            state['activeDays'] += 1
            state['lastActiveDay'] = slot//DAY
        equity = mark(state, book)['equityEur']
        if equity is not None:
            state['peakUsd'] = max(state['peakUsd'], equity)
            state['maxDrawdownPct'] = max(state['maxDrawdownPct'], 100*(1-equity/state['peakUsd']))
        results[name] = dict(action=action, reason=reason, execution=execution, equityUsd=equity,
                             netUsd=None if equity is None else equity-1000, closed=state['closed'],
                             activeDays=state['activeDays'], maxDrawdownPct=state['maxDrawdownPct'])
    report = dict(schema='MERIDIAN_USD_ROUND_V1', pair='BTC/USD', start=iso(start), at=iso(slot),
                  publishedAt=iso(now), arms=results)
    with db:
        db.execute('UPDATE slots SET record=? WHERE slot=?',
                   (json.dumps(dict(states=states, report=report, snapshot=snapshot, fillBook=book),
                               allow_nan=False), slot))
    return report


def run(volume, start):
    if not os.path.ismount(volume):
        raise ValueError('USD round requires a mounted persistent volume')
    key = os.environ['OPENAI_API_KEY']
    directory = volume / ('usd-round-' + str(start))
    directory.mkdir(exist_ok=True)
    end = start + 7*DAY
    with (directory/'writer.lock').open('a') as lock, closing(sqlite3.connect(directory/'round.sqlite')) as db:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        db.execute('CREATE TABLE IF NOT EXISTS slots (slot INTEGER PRIMARY KEY, record TEXT)')
        configure(db, start, time.time())
        while time.time() < end:
            now = time.time()
            if now < start:
                time.sleep(min(STEP, start-now))
                continue
            slot = int(now)//STEP*STEP
            budget = BudgetedFeeds(db, slot, end)
            report = tick(db, slot, start, lambda ctx: budget.decide(ctx, MODEL, key))
            if report:
                spent, reserved = db.execute(
                    'SELECT COALESCE(SUM(charge*settled),0), COALESCE(SUM(charge*(1-settled)),0) FROM calls'
                ).fetchone()
                report.update(modelCostUsd=spent/UNIT, modelReserveUsd=reserved/UNIT)
                print(json.dumps({'pilotAudit': {'usdRound': report}}, allow_nan=False), flush=True)
            time.sleep(max(0, min(slot+STEP, end)-time.time()))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--start', type=int, required=True)
    args = parser.parse_args()
    run(args.directory, args.start)
