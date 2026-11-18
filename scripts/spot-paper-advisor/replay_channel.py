"""Replay the fixed channel rule against a read-only pilot ledger, from a UTC slot."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import sqlite3

from channel_comparator import channel_action
from worker import STEP, execute, forced, initial, mark


def replay(db, start):
    if start % STEP:
        raise ValueError('start must be a ten-minute UTC boundary')
    state = initial()
    buys = sells = slots = 0
    account = None
    for slot, raw in db.execute('SELECT slot, record FROM slots WHERE slot >= ? ORDER BY slot', (start,)):
        account = None
        if raw is None:
            continue
        record = json.loads(raw)
        at = datetime.fromisoformat(record['report']['asOf']).timestamp()
        book = record['executionBook']
        if not slot <= at < slot + STEP or (book and any(
                not 0 <= at - book[key] <= 5 for key in ('received', 'bidAt', 'askAt'))):
            book = None
        action = channel_action(record['inputs'], state, slot)
        if at < slot + 90 or forced(state, slot):
            result = execute(state, action, book, slot)
            buys += result == 'PAPER_BUY'
            sells += result == 'PAPER_SELL'
        account = mark(state, book)
        slots += 1
    return dict(processedSlots=slots, buys=buys, sells=sells, lastAccount=account)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ledger', type=Path)
    parser.add_argument('--start', type=int, required=True)
    args = parser.parse_args()
    db = sqlite3.connect(args.ledger.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        print(json.dumps(replay(db, args.start), allow_nan=False))
    finally:
        db.close()
