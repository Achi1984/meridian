"""Fixed UTC overnight range strategies. Spot signals, perpetual fills, 100 USDT notional."""
import argparse
import json
from collections import defaultdict
from itertools import groupby
from pathlib import Path

from breakout_perp_history import FUNDING_STEP, load_market
from reclaim_history import candles
from regime_breakout import Account
from worker import DAY, STEP


def candidate(day, bars):
    """First qualifying completed bar from 08:00 to 12:00, entry at next open."""
    by_time = {b[0]: b for b in bars}
    night = [by_time.get(t) for t in range(day, day + 8 * 3600, STEP)]
    if any(b is None for b in night):
        return
    high, low = max(b[2] for b in night), min(b[3] for b in night)
    change = night[-1][4] / night[0][1] - 1
    narrow = high / low <= 1.02
    if not narrow and abs(change) < .03:
        return
    for t in range(day + 8 * 3600, day + 12 * 3600, STEP):
        b = by_time.get(t)
        if b is None:
            return
        if narrow:
            side = int(b[4] > high) - int(b[4] < low)
            name = 'breakout'
        else:
            side = int(change < 0 and b[3] < low and b[4] > low) - int(
                change > 0 and b[2] > high and b[4] < high)
            name = 'reversal'
        if side:
            return name, side, t + STEP


def simulate(side, entry, prices, marks, rates):
    account = Account()
    if entry not in prices:
        return None
    initial = prices[entry]
    account.target(side, initial)
    for t in range(entry + STEP, entry + 3 * 3600 + STEP, STEP):
        if t not in prices:
            return None
        if t % FUNDING_STEP == 0:
            if t not in marks or t not in rates:
                return None
            account.settle(rates[t], marks[t], prices[t])
        # Scheduled time exit or market exit on first observed ten-minute opening
        # at least 1% adverse. Gaps execute at that observation.
        if side * (prices[t] / initial - 1) <= -.01 or t == entry + 3 * 3600:
            account.target(0, prices[t])
            return account


def replay(paths):
    rows = defaultdict(lambda: dict(trades=0, missing=0, wins=0, net=0., executionCost=0., funding=0., best=None))
    for path in paths:
        market = load_market([path], path.parent.parent)
        for day, bars in groupby(candles([path]), key=lambda b: b[0] // DAY * DAY):
            signal = candidate(day, bars)
            if signal is None:
                continue
            name, side, entry = signal
            row = rows[f'{path.parent.parent.name}/{name}']
            account = simulate(side, entry, *market)
            if account is None:
                row['missing'] += 1
                continue
            net = account.net
            row['executionCost'] += account.cost
            row['funding'] += account.funding
            row['trades'] += 1
            row['wins'] += net > 0
            row['net'] += net
            row['best'] = net if row['best'] is None else max(net, row['best'])
    return dict(rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('symbol', choices=['BTCUSDT', 'ETHUSDT'])
    args = parser.parse_args()
    paths = sorted(p for p in args.root.glob(f'*/spot/{args.symbol}-5m-????-??.zip')
                   if int(p.parent.parent.name) >= 2021)
    if not paths:
        parser.error('No monthly archives since 2021')
    print(json.dumps(replay(paths), indent=2))
