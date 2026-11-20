"""Read-only entry audit of executed V3 USD trades. Classify recorded trades, without new model calls."""
import argparse
from collections import Counter
from contextlib import closing
from decimal import Decimal
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3

from usd_pullback import closed_bars, target_covers_cost, usable_book
from worker import DAY, STEP, execute, forced, iso


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


# The entry rule was published in PR 1481 at 21:07:52 UTC.
RULE_PUBLISHED = datetime(2026, 11, 19, 21, 7, 52, tzinfo=timezone.utc)
DESIGN_ENTRY = datetime(2026, 11, 19, 20, 30, tzinfo=timezone.utc)


def filter_outcomes(entries):
    """Compare skipping only blocked entries with keeping their recorded V3 exits."""
    groups = {}
    for label in ('designTrade', 'otherHistorical', 'afterRulePublication'):
        groups[label] = dict(entries=0, confirmed=0, blocked=0, unverified=0,
                             blockedClosed=0, blockedWithoutExit=0, avoidedLossUsd=Decimal(0),
                             missedProfitUsd=Decimal(0))
    for entry in entries:
        at = datetime.fromisoformat(entry['at'])
        if at == DESIGN_ENTRY:
            label = 'designTrade'
        elif at < RULE_PUBLISHED:
            label = 'otherHistorical'
        else:
            label = 'afterRulePublication'
        group = groups[label]
        group['entries'] += 1
        group[entry['verdict']] += 1
        if entry['verdict'] != 'blocked':
            continue
        value = entry['realizedUsd']
        if value is None:
            group['blockedWithoutExit'] += 1
            continue
        group['blockedClosed'] += 1
        pnl = Decimal(str(value))
        group['avoidedLossUsd'] += max(-pnl, Decimal(0))
        group['missedProfitUsd'] += max(pnl, Decimal(0))
    for group in groups.values():
        avoided = group['avoidedLossUsd']
        missed = group['missedProfitUsd']
        group.update(avoidedLossUsd=float(avoided), missedProfitUsd=float(missed),
                     differenceOnClosedTradesUsd=float(avoided-missed))
    return groups


def delayed_exit(state, record, slot, original_cash):
    """Value the same lot at the next observed execution book, after all paper costs."""
    report = record['report']
    if report['arms']['v3']['execution'] == 'PAPER_BUY':
        return dict(status='REENTRY_CONFLICT')
    published = datetime.fromisoformat(report['publishedAt'])
    if published.tzinfo is None:
        return dict(status='UNKNOWN_EXECUTION_TIME')
    now = published.timestamp()
    if not slot <= now < slot+90:
        return dict(status='OUTSIDE_EXECUTION_WINDOW')
    book = usable_book(record.get('fillBook'), now, slot)
    candidate = state.copy()
    execution = execute(candidate, 'SELL', book, slot)
    if execution != 'PAPER_SELL':
        return dict(status=execution)
    cash = Decimal(candidate['cash'])
    return dict(status='PRICED', at=iso(slot), bidUsd=book['bid'],
                realizedUsd=float(cash-Decimal(state['cash'])-Decimal(state['entryCostUsd'])),
                differenceUsd=float(cash-original_cash))


def exit_summary(entries):
    paired = []
    excluded = Counter()
    for entry in entries:
        exit_result = entry.get('delayedExit')
        if exit_result is None:
            excluded['NO_MATCHED_SALE'] += 1
        elif exit_result['status'] != 'PRICED':
            excluded[exit_result['status']] += 1
        else:
            paired.append(Decimal(str(exit_result['differenceUsd'])))
    return dict(paired=len(paired), better=sum(x > 0 for x in paired),
                worse=sum(x < 0 for x in paired), unchanged=paired.count(0),
                differenceUsd=float(sum(paired)) if paired else None, excluded=dict(excluded))


def audit(db, *, first_day=False):
    start, = db.execute('SELECT start FROM pilot WHERE id=1').fetchone()
    entries = []
    totals = Counter()
    opened = pending_exit = None
    missing = observed = 0
    next_slot = start
    end = start + (DAY if first_day else 7*DAY)
    for slot, raw in db.execute('SELECT slot, record FROM slots WHERE slot>=? AND slot<? ORDER BY slot',
                                (start, end)):
        if (slot-start) % STEP:
            raise ValueError('off-grid slot')
        missing += (slot-next_slot)//STEP
        if slot != next_slot:
            opened = pending_exit = None
        next_slot = slot+STEP
        if raw is None:
            missing += 1
            opened = pending_exit = None
            continue
        record = json.loads(raw)
        report = record['report']
        if (report['pair'], report['schema'], report['start'], report['at']) != (
                'BTC/USD', 'MERIDIAN_USD_ROUND_V1', iso(start), iso(slot)):
            raise ValueError('unexpected round')
        observed += 1
        arm = report['arms']['v3']
        if pending_exit:
            item, state, actual_cash = pending_exit
            item['delayedExit'] = delayed_exit(state, record, slot, actual_cash)
            pending_exit = None
        if arm['execution'] == 'PAPER_BUY':
            verdict, cause = entry_check(arm['reason'], record.get('snapshot'), slot)
            state = record['states']['v3']
            before = Decimal(state['cash']) + Decimal(state['entryCostUsd'])
            item = dict(at=iso(slot), verdict=verdict, reason=cause, realizedUsd=None)
            entries.append(item)
            opened = item, before, state
        elif arm['execution'] == 'PAPER_SELL' and opened:
            item, before, state = opened
            pnl = Decimal(record['states']['v3']['cash'])-before
            item['realizedUsd'] = float(pnl)
            if forced(state, slot):
                item['delayedExit'] = dict(status='MANDATORY_EXIT')
            else:
                item['delayedExit'] = dict(status='NEXT_SLOT_UNAVAILABLE')
                pending_exit = item, state, Decimal(record['states']['v3']['cash'])
            totals[item['verdict']] += pnl
            opened = None
    return dict(observedSlots=observed, missingSlots=missing, entries=entries,
                rulePublishedAt=RULE_PUBLISHED.isoformat(), outcomes=filter_outcomes(entries),
                delayedExitSummary=exit_summary(entries),
                closedPnlByVerdictUsd={key: float(value) for key, value in totals.items()})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ledger', type=Path, required=True)
    parser.add_argument('--first-day', action='store_true')
    args = parser.parse_args()
    with closing(sqlite3.connect(args.ledger.resolve().as_uri()+'?mode=ro', uri=True)) as db:
        db.execute('BEGIN')
        print(json.dumps(audit(db, first_day=args.first_day), allow_nan=False))
