"""Replay fixed weekday BTC/ETH spot rules on monthly 5m ZIPs, separately per asset."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
from itertools import groupby
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from breakout_perp_history import FUNDING_STEP, load_market
from regime_breakout import Account
from reclaim_history import candles
from worker import DAY, STEP, execute, initial

NY = ZoneInfo("America/New_York")


def signal(day, by_time):
    """Signal at 09:30 New York using completed bars. Time exit at 15:50."""
    # Noon UTC falls on the session's local date throughout the year.
    local = datetime.fromtimestamp(day + DAY // 2, timezone.utc).astimezone(NY)
    if local.weekday() >= 5:
        return 'weekend', None
    entry = int(local.replace(hour=9, minute=30).timestamp())
    exit_slot = int(local.replace(hour=15, minute=50).timestamp())
    if any(slot not in by_time for slot in range(day, entry, STEP)):
        return 'missingSignal', None
    ratio = by_time[entry - STEP][4] / by_time[day][1]
    if .98 < ratio < 1.02:
        return 'noSignal', None
    side = 'afterDrop' if ratio <= .98 else 'afterRise'
    return side, (entry, exit_slot)


def trade_day(day, bars):
    by_time = {bar[0]: bar for bar in bars}
    side, window = signal(day, by_time)
    if window is None:
        return side, None
    entry, exit_slot = window
    if entry not in by_time or exit_slot not in by_time:
        return side, None
    state = initial()
    for slot, action in ((entry, 'BUY'), (exit_slot, 'SELL')):
        mid = by_time[slot][1]
        book = dict(bid=mid * .9999, ask=mid * 1.0001, bidSize=1e6, askSize=1e6)
        execute(state, action, book, slot)
    gross = 100 * (by_time[exit_slot][1] / by_time[entry][1] - 1)
    return side, (float(state['cash']) - 1000, gross)


def replay(paths):
    stats = defaultdict(lambda: dict(days=0, priced=0, wins=0, net=0.0, gross=0.0))
    for day, bars in groupby(candles(paths), key=lambda bar: bar[0] // DAY * DAY):
        year = datetime.fromtimestamp(day, timezone.utc).year
        label, outcome = trade_day(day, list(bars))
        row = stats[f'{year}/{label}']
        row['days'] += 1
        if outcome is not None:
            net, gross = outcome
            row['gross'] += gross
            row['priced'] += 1
            row['wins'] += net > 0
            row['net'] += net
    return dict(stats)


def replay_futures(paths):
    results = {}
    for path in paths:
        prices, marks, rates = load_market([path], path.parent.parent)
        for day, bars in groupby(candles([path]), key=lambda bar: bar[0] // DAY * DAY):
            label, window = signal(day, {bar[0]: bar for bar in bars})
            if window is None:
                continue
            entry, close = window
            funding_slots = range((entry // FUNDING_STEP + 1) * FUNDING_STEP, close + 1, FUNDING_STEP)
            for direction, name in ((1, 'long'), (-1, 'short')):
                key = f'{path.parent.parent.name}/{label}/{name}'
                row = results.setdefault(key, dict(trades=0, missing=0, wins=0, net=0., costs=0., funding=0.))
                if (entry not in prices or close not in prices or
                        any(t not in rates or t not in marks for t in funding_slots)):
                    row['missing'] += 1
                    continue
                account = Account()
                account.target(direction, prices[entry])
                for t in funding_slots:
                    account.settle(rates[t], marks[t], marks[t])
                account.target(0, prices[close])
                row['trades'] += 1
                row['wins'] += account.wins
                row['net'] += account.net
                row['costs'] += account.cost
                row['funding'] += account.funding
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('symbol', choices=['BTCUSDT', 'ETHUSDT'])
    parser.add_argument('--futures', action='store_true')
    parser.add_argument('--first-year', type=int, default=0)
    args = parser.parse_args()
    paths = sorted(args.root.glob(f'*/spot/{args.symbol}-5m-????-??.zip'))
    paths = [p for p in paths if int(p.parent.parent.name) >= args.first_year]
    if not paths:
        parser.error('No monthly spot archives')
    print(json.dumps((replay_futures if args.futures else replay)(paths), indent=2))
