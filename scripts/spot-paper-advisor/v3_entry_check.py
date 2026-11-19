"""Read-only entry audit of executed V3 USD trades. Classify recorded trades, without new model calls."""
import argparse
from collections import Counter
from contextlib import closing
from decimal import Decimal
import json
from pathlib import Path
import re
import sqlite3

from usd_pullback import closed_bars, target_covers_cost, usable_book
from worker import DAY, STEP, iso


def entry_check(reason, snapshot, slot):
    """Replay proxy for two named long setups; ambiguous references stay unverified."""
    reason = (reason or '').casefold()
    breakout = any(term in reason for term in ('ausbruch', 'breakout', 'stundenhoch', 'hourly high'))
    recovery = any(term in reason for term in ('rebound', 'bodenbildung', 'erholung', 'recovery'))
    if not (breakout or recovery):
        return 'unverified', 'UNKNOWN_SETUP'
    ten = closed_bars(snapshot, 'ten', 2, slot, STEP)
    hour = closed_bars(snapshot, 'hour', 1, slot-slot%3600, 3600)
    if not ten or not hour:
        return 'unverified', 'MISSING_CANDLE'
    book = snapshot.get('book') or {}
    received = book.get('received')
    if type(received) not in (float, int) or not usable_book(book, received, slot):
        return 'unverified', 'MISSING_DECISION_BOOK'
    if received >= slot+90:
        return 'unverified', 'LATE_DECISION_BOOK'
    high = hour[-1][2]
    close = ten[-1][4]
    if breakout:
        # Explicit integer level as emitted in the audited V3 rationale.
        level = re.search(r'(?:stundenhoch|hourly high)\s*\((\d+)\)', reason)
        threshold = max(high, int(level[1])) if level else high
        if min(close, book['bid']) <= threshold:
            return 'blocked', 'BREAKOUT_UNCONFIRMED'
    if recovery:
        prev, last = ten
        if prev[4] >= prev[1] or close <= max(last[1], prev[2]):
            return 'blocked', 'RECOVERY_UNCONFIRMED'
    if breakout:
        # A broken high is no longer an upside target. Require an explicit target.
        match = re.search(r'(?:kursziel|target)\s*[:=]?\s*(\d+)(?:\s*usd)?(?=\s|$)', reason)
        if not match:
            return 'unverified', 'NO_VERIFIABLE_TARGET'
        target = int(match[1])
    else:
        target = high
    if not target_covers_cost(book['ask'], target):
        return 'blocked', 'TARGET_BELOW_COST'
    return 'confirmed', 'ENTRY_CONFIRMED'


def audit(db, *, first_day=False):
    start, = db.execute('SELECT start FROM pilot WHERE id=1').fetchone()
    entries = []
    totals = Counter()
    opened = None
    missing = observed = 0
    next_slot = start
    end = start + (DAY if first_day else 7*DAY)
    for slot, raw in db.execute('SELECT slot, record FROM slots WHERE slot>=? AND slot<? ORDER BY slot',
                                (start, end)):
        if (slot-start) % STEP:
            raise ValueError('off-grid slot')
        missing += (slot-next_slot)//STEP
        if slot != next_slot:
            opened = None
        next_slot = slot+STEP
        if raw is None:
            missing += 1
            opened = None
            continue
        record = json.loads(raw)
        report = record['report']
        if (report['pair'], report['schema'], report['start'], report['at']) != (
                'BTC/USD', 'MERIDIAN_USD_ROUND_V1', iso(start), iso(slot)):
            raise ValueError('unexpected round')
        observed += 1
        arm = report['arms']['v3']
        if arm['execution'] == 'PAPER_BUY':
            verdict, cause = entry_check(arm['reason'], record.get('snapshot'), slot)
            state = record['states']['v3']
            before = Decimal(state['cash']) + Decimal(state['entryCostUsd'])
            item = dict(at=iso(slot), verdict=verdict, reason=cause, realizedUsd=None)
            entries.append(item)
            opened = item, before
        elif arm['execution'] == 'PAPER_SELL' and opened:
            item, before = opened
            pnl = Decimal(record['states']['v3']['cash'])-before
            item['realizedUsd'] = float(pnl)
            totals[item['verdict']] += pnl
            opened = None
    return dict(observedSlots=observed, missingSlots=missing, entries=entries,
                closedPnlByVerdictUsd={key: float(value) for key, value in totals.items()})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ledger', type=Path, required=True)
    parser.add_argument('--first-day', action='store_true')
    args = parser.parse_args()
    with closing(sqlite3.connect(args.ledger.resolve().as_uri()+'?mode=ro', uri=True)) as db:
        db.execute('BEGIN')
        print(json.dumps(audit(db, first_day=args.first_day), allow_nan=False))
