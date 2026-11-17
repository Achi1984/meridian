"""Evaluate local Coinbase Exchange BTC-EUR daily candle responses with the monthly rules."""
import argparse
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from momentum_reference import run


def load_coinbase(paths):
    bars = {}
    for path in paths:
        for ts, low, high, opening, close, volume in json.loads(path.read_text(), parse_float=Decimal):
            day = datetime.fromtimestamp(ts, timezone.utc).date()
            if ts % 86400 or not (0 < low <= min(opening, close) <= max(opening, close) <= high) or volume < 0:
                raise ValueError(f'invalid daily candle at {day}')
            pair = Decimal(opening), Decimal(close)
            if day in bars and bars[day] != pair:
                raise ValueError(f'conflicting rows at {day}')
            bars[day] = pair
    return bars


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('start', type=date.fromisoformat)
    parser.add_argument('end', type=date.fromisoformat, help='exclusive UTC date')
    parser.add_argument('responses', type=Path, nargs='+')
    args = parser.parse_args()
    if args.start >= args.end or args.start.day != 1 or args.end.day != 1:
        parser.error('use whole calendar months')
    bars = load_coinbase(args.responses)
    for fee in (Decimal('0.005'), Decimal('0.0075')):
        for mode in ('90d', 'score', 'hold', 'cash'):
            pnl, dd, trips, holding = run(bars, args.start, args.end, mode, fee)
            print(f'{fee} {mode} {pnl} {dd} {trips} {"BTC" if holding else "EUR"}')
