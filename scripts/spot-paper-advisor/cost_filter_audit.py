"""Measure independent, hypothetical 60-minute round trips for recorded V3 cost vetoes."""
import argparse
from contextlib import closing
from datetime import datetime
from decimal import Decimal
import json
from pathlib import Path
import sqlite3

from feeds import COST_VERSION
from worker import DAY, STEP, execute, iso

STAGES = {
    'Stundenbandbreite deckt die Handelskosten nicht.': 'beforeModel',
    'Aktuelles Orderbuch deckt die Gewinnschwelle im Stundenband nicht.': 'afterBuySignal',
}


def replay_fill(state, action, slot, record, *, mandatory=False):
    if not record:
        return 'MISSING_RECORD'
    at = datetime.fromisoformat(record['report']['last']['at']).timestamp()
    if not slot <= at < slot + (STEP if mandatory else 90):
        return 'OUTSIDE_WINDOW'
    return execute(state, action, record.get('executionBook'), slot)


# Freeze the two new hypotheses before the first prospective decision.
FORWARD_START = int(datetime.fromisoformat('2026-11-19T09:00:00+00:00').timestamp())
NEW_SIGNALS = ('breakoutRetest', 'failedBreakdown')


def entry_signals(record, slot):
    bars = (record.get('inputs') or {}).get('ten', [])[-8:]
    if len(bars) != 8 or any(len(bar) != 5 or bar[0] != slot - (8-i)*STEP
                             for i, bar in enumerate(bars)):
        return dict.fromkeys(('confirmedBreakout', *NEW_SIGNALS))
    resistance = max(bar[2] for bar in bars[:6])
    support = min(bar[3] for bar in bars[:6])
    first, second = bars[-2:]
    return dict(
        confirmedBreakout=first[4] > resistance and second[4] > resistance,
        breakoutRetest=first[4] > resistance and second[3] <= resistance < second[4],
        failedBreakdown=first[3] < support < first[4] and second[4] > first[2],
    )


def confirmed_breakout(record, slot):
    return entry_signals(record, slot)['confirmedBreakout']


def forward_comparison(samples):
    comparison = {}
    for signal in NEW_SIGNALS:
        groups = {}
        for value, name in ((True, 'signal'), (False, 'noSignal'), (None, 'unknown')):
            subset = [sample for sample in samples if sample['entryAt'] >= iso(FORWARD_START)
                      and sample[signal] is value]
            pnl = [Decimal(sample['netEur']) for sample in subset if sample['status'] == 'MEASURED']
            pending = sum(sample['status'] == 'PENDING_EXIT' for sample in subset)
            groups[name] = dict(total=len(subset), measured=len(pnl), pending=pending,
                                unavailable=len(subset)-len(pnl)-pending,
                                meanNetEur=str(sum(pnl)/len(pnl)) if pnl else None)
        comparison[signal] = groups
    return dict(fromUtc=iso(FORWARD_START), groups=comparison)


def audit(db):
    records = {slot: json.loads(raw) if raw else None
               for slot, raw in db.execute('SELECT slot, record FROM slots ORDER BY slot')}
    latest = max(records, default=-1)
    samples = []
    for slot, record in records.items():
        if not record or record['promptVersion'] != COST_VERSION:
            continue
        last = record['report']['last']
        stage = STAGES.get(last['reason'])
        model = record['states']['model']
        if not stage or last['action'] != 'HOLD' or last['execution'] != 'HOLD' or Decimal(model['btc']):
            continue
        close = slot - slot % DAY + DAY - STEP
        exit_slot = min(slot + 6 * STEP, close)
        sample = dict(entryAt=iso(slot), exitAt=iso(exit_slot), stage=stage,
                      **entry_signals(record, slot))
        samples.append(sample)
        state = dict(model)
        entry = replay_fill(state, 'BUY', slot, record)
        if entry != 'PAPER_BUY':
            sample['status'] = 'ENTRY_' + entry
        elif exit_slot > latest:
            sample['status'] = 'PENDING_EXIT'
        else:
            sale = replay_fill(state, 'SELL', exit_slot, records.get(exit_slot), mandatory=exit_slot == close)
            if sale != 'PAPER_SELL':
                sample['status'] = 'EXIT_' + sale
                continue
            pnl = Decimal(state['cash']) - Decimal(model['cash'])
            sample.update(status='MEASURED', netEur=str(pnl))
    return dict(horizonMinutes=60, samples=samples, forwardComparison=forward_comparison(samples))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('journal', type=Path)
    args = parser.parse_args()
    with closing(sqlite3.connect(args.journal.resolve().as_uri() + '?mode=ro', uri=True)) as journal:
        print(json.dumps(audit(journal), indent=2))
