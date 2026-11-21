"""Replay fixed weekday BTC/ETH spot rules on monthly 5m ZIPs, separately per asset."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
from itertools import groupby
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from reclaim_history import candles
from worker import DAY, STEP, execute, initial

NY = ZoneInfo("America/New_York")


def trade_day(day, bars):
    """Signal at 09:30 New York using completed bars. Time exit at 15:50."""
    # Noon UTC falls on the session's local date throughout the year.
    local = datetime.fromtimestamp(day + DAY // 2, timezone.utc).astimezone(NY)
    if local.weekday() >= 5:
        return 'weekend', None
    entry = int(local.replace(hour=9, minute=30).timestamp())
    exit_slot = int(local.replace(hour=15, minute=50).timestamp())
    by_time = {bar[0]: bar for bar in bars}
    if any(slot not in by_time for slot in range(day, entry, STEP)):
        return 'missingSignal', None
    ratio = by_time[entry - STEP][4] / by_time[day][1]
    if .98 < ratio < 1.02:
        return 'noSignal', None
    side = 'afterDrop' if ratio <= .98 else 'afterRise'
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


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('symbol', choices=['BTCUSDT', 'ETHUSDT'])
    args = parser.parse_args()
    paths = sorted(args.root.glob(f'*/spot/{args.symbol}-5m-????-??.zip'))
    if not paths:
        parser.error('No monthly spot archives')
    print(json.dumps(replay(paths), indent=2))
