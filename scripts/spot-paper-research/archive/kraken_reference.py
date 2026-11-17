"""Offline monthly replay and quote preflight on saved Kraken public BTC/EUR responses."""
import argparse
import json
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

from momentum_reference import run


def payload(raw):
    message = json.loads(raw)
    if message.get('error') != []:
        raise ValueError('Kraken response error')
    return message['result']['XXBTZEUR']


def completed_bars(raw, as_of):
    rows = payload(raw)
    bars = {}
    previous = -1
    for ts, opening, high, low, closing, vwap, volume, count in rows:
        if not isinstance(ts, int) or ts <= previous or ts % 86400:
            raise ValueError('unordered daily UTC candle')
        previous = ts
        day = datetime.fromtimestamp(ts, timezone.utc).date()
        opening, high, low, closing = map(Decimal, (opening, high, low, closing))
        if not 0 < low <= min(opening, closing) <= max(opening, closing) <= high:
            raise ValueError('invalid Kraken daily candle')
        # Kraken always includes an uncommitted trailing row, even on a cached response.
        if ts != rows[-1][0] and day < as_of:
            bars[day] = opening, closing
    return bars


def quote_check(raw, observed_at):
    book = payload(raw)
    levels = []
    for side in ('bids', 'asks'):
        price, size, updated = book[side][0]
        price, size = Decimal(price), Decimal(size)
        if not (price.is_finite() and size.is_finite() and price > 0 and size > 0):
            raise ValueError('invalid top level')
        levels.append((price, size, updated))
    bid, ask = levels
    if bid[0] > ask[0]:
        raise ValueError('crossed book')
    ages = [observed_at - level[2] for level in levels]
    if min(ages) < 0:
        return 'FUTURE_LEVEL'
    if max(ages) > 5:
        return 'STALE_LEVEL'
    # Match the reference ledger's fee-inclusive 100 EUR entry and adverse slippage.
    cost_per_btc = ask[0] * Decimal('1.001') * Decimal('1.005')
    if ask[1] * cost_per_btc < 100:
        return 'INSUFFICIENT_ASK_SIZE'
    return 'ENTRY_BOOK_QUALIFIED'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ohlc', type=Path)
    parser.add_argument('start', type=date.fromisoformat)
    parser.add_argument('end', type=date.fromisoformat, help='exclusive UTC month boundary')
    parser.add_argument('--book', type=Path)
    parser.add_argument('--observed-at', type=int, help='actual UTC epoch second of quote receipt')
    args = parser.parse_args()
    if args.start >= args.end or args.start.day != 1 or args.end.day != 1:
        parser.error('whole calendar months required')
    if bool(args.book) != (args.observed_at is not None):
        parser.error('book and observation time must be supplied together')
    bars = completed_bars(args.ohlc.read_bytes(), args.end)
    for fee in map(Decimal, ('0.005', '0.0075')):
        for arm in ('90d', 'score', 'hold', 'cash'):
            print(fee, arm, *run(bars,args.start,args.end,arm,fee))
    if args.book:
        print('Book preflight:', quote_check(args.book.read_bytes(), args.observed_at))
