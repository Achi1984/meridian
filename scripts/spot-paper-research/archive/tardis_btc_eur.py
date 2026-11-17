"""Normalize one hash-pinned Kraken BTC/EUR development day for offline research."""
import argparse
import csv
import gzip
import hashlib
import io
import json
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

MINUTE = 60_000_000
DEADLINE = 5_000_000
FIELDS = {
    'trades': 'exchange symbol timestamp local_timestamp id side price amount',
    'quotes': 'exchange symbol timestamp local_timestamp ask_amount ask_price bid_price bid_amount',
}


def positive(value):
    try:
        number = Decimal(value)
        return number.is_finite() and number > 0
    except (InvalidOperation, TypeError):
        return False


def rows(path, kind, digest):
    with open(path, 'rb') as source:
        if hashlib.file_digest(source, 'sha256').hexdigest() != digest:
            raise ValueError(f'{kind} archive hash mismatch')
        source.seek(0)
        with gzip.GzipFile(fileobj=source) as archive, io.TextIOWrapper(archive) as stream:
            reader = csv.DictReader(stream)
            if reader.fieldnames != FIELDS[kind].split():
                raise ValueError(f'unexpected {kind} columns')
            previous = -1
            for row in reader:
                if None in row or None in row.values() or (row['exchange'], row['symbol']) != ('kraken', 'BTC/EUR'):
                    raise ValueError(f'invalid {kind} record')
                at, received = int(row['timestamp']), int(row['local_timestamp'])
                if received < previous or min(received, at) < 0:
                    raise ValueError(f'invalid {kind} clock')
                previous = received
                yield at, received, row


def normalize(day, trades, quotes, trade_hash, quote_hash):
    midnight = int(datetime.combine(day, datetime.min.time(), timezone.utc).timestamp()) * 1_000_000
    warm = midnight + 390 * MINUTE
    start = midnight + 480 * MINUTE
    bars = [None] * 570
    decisions = [dict(decision_us=start + i * MINUTE, last_closed_bar=89 + i, quote=None,
                      quote_status='no_eligible_update') for i in range(480)]
    bounds = {}
    for at, received, row in rows(trades, 'trades', trade_hash):
        i = (at - warm) // MINUTE
        if not 0 <= i < len(bars) or not at <= received < warm + (i + 1) * MINUTE:
            continue
        if not positive(row['price']) or not positive(row['amount']):
            raise ValueError('invalid trade')
        price = row['price']
        if bars[i] is None:
            bars[i] = dict(start_us=warm + i * MINUTE, open=price, high=price, low=price, close=price,
                           first_exchange_us=at, last_exchange_us=at, last_receive_us=received, trades=0)
            bounds[i] = [Decimal(price), Decimal(price)]
        bar = bars[i]
        if at < bar['first_exchange_us']:
            bar.update(first_exchange_us=at, open=price)
        if at >= bar['last_exchange_us']:
            bar.update(last_exchange_us=at, close=price)
        numeric = Decimal(price)
        if numeric < bounds[i][0]:
            bounds[i][0], bar['low'] = numeric, price
        if numeric > bounds[i][1]:
            bounds[i][1], bar['high'] = numeric, price
        bar['trades'] += 1
        bar['last_receive_us'] = received
    for at, received, row in rows(quotes, 'quotes', quote_hash):
        i = (received - start) // MINUTE
        if not 0 <= i < len(decisions):
            continue
        slot = decisions[i]
        if slot['quote'] is not None or received - slot['decision_us'] > DEADLINE or not 0 <= received - at <= DEADLINE:
            continue
        if not all(positive(row[key]) for key in ('bid_price', 'ask_price', 'bid_amount', 'ask_amount')):
            continue
        if Decimal(row['bid_price']) > Decimal(row['ask_price']):
            continue
        slot['quote_status'] = 'eligible'
        slot['quote'] = dict(exchange_us=at, receive_us=received,
                             **{k: row[k] for k in ('bid_price', 'ask_price', 'bid_amount', 'ask_amount')})
    return dict(schema='tardis-kraken-btc-eur-development-v1', day=day.isoformat(),
                trades_sha256=trade_hash, quotes_sha256=quote_hash, continuity='unverified',
                first_bar_us=warm, bar_interval_us=MINUTE, quote_deadline_us=DEADLINE,
                bars=bars, decisions=decisions)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('day', choices=['2026-08-01', '2026-09-01', '2026-10-01'])
    for field in ('trades', 'quotes', 'trade_hash', 'quote_hash'):
        parser.add_argument(field)
    args = parser.parse_args()
    print(json.dumps(normalize(date.fromisoformat(args.day), Path(args.trades), Path(args.quotes),
                               args.trade_hash, args.quote_hash), separators=(',', ':')))
