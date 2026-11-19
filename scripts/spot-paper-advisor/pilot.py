"""Bounded seven-day live-market paper pilot. Timestamps and slots are UTC."""
import argparse
import fcntl
import json
import os
import sqlite3
import time
from pathlib import Path

import feeds
from pair_report import comparison
from worker import DAY, STEP, connect, cycle, iso

MODEL = 'gpt-4.1-mini-2025-04-14'
BUDGET = 30_000_000  # tenths of a micro-US dollar
# Standard prices in the same integer unit per token: input 4, cached 1, output 16.
# Reserve the model's entire context plus the configured max output before dispatch.
RESERVE = 1_047_576 * 4 + 1_024 * 16
UNIT = 10_000_000


def configure(db, start, now):
    if start % STEP or start <= 0:
        raise ValueError('start must be a positive UTC ten-minute boundary')
    with db:
        db.execute('CREATE TABLE IF NOT EXISTS pilot (id INTEGER PRIMARY KEY, start INTEGER NOT NULL)')
        row = db.execute('SELECT start FROM pilot WHERE id=1').fetchone()
        if row is None:
            if now >= start + STEP or db.execute('SELECT 1 FROM slots LIMIT 1').fetchone():
                raise ValueError('refusing to initialize late or reuse another ledger')
            db.execute('INSERT INTO pilot VALUES (1,?)', (start,))
        elif row[0] != start:
            raise ValueError('pilot epoch mismatch')
        db.execute('CREATE TABLE IF NOT EXISTS calls (slot INTEGER PRIMARY KEY, charge INTEGER NOT NULL, settled INTEGER NOT NULL)')


class BudgetedFeeds:
    FeedError = feeds.FeedError
    market = staticmethod(feeds.market)
    book = staticmethod(feeds.book)

    def __init__(self, db, slot, end):
        self.db = db
        self.slot = slot
        self.end = end

    def decide(self, context, model, key):
        if model != MODEL or time.time() >= self.end:
            raise feeds.FeedError('PILOT_EXPIRED_OR_MODEL_INVALID')
        with self.db:
            spent = self.db.execute('SELECT COALESCE(SUM(charge),0) FROM calls').fetchone()[0]
            if spent + RESERVE > BUDGET:
                raise feeds.FeedError('PILOT_BUDGET_LIMIT')
            self.db.execute('INSERT INTO calls VALUES (?,?,0)', (self.slot, RESERVE))
        # Leave the complete reservation in place if usage is unknown or the process dies.
        try:
            result = feeds.decide(context, model, key, service_tier='default')
        except feeds.FeedError as error:
            if error.usage is not None and str(error) != 'MODEL_SNAPSHOT_MISMATCH':
                self.settle(error.usage)
            raise
        self.settle(result[2])
        return result

    def settle(self, usage):
        charge = 4 * (usage['input'] - usage['cached']) + usage['cached'] + 16 * usage['output']
        with self.db:
            self.db.execute('UPDATE calls SET charge=?, settled=1 WHERE slot=?', (charge, self.slot))


def audit(db, start, slot, *, end=None):
    settled, unknown = db.execute('SELECT COALESCE(SUM(charge*settled),0), COALESCE(SUM(charge*(1-settled)),0) FROM calls').fetchone()
    # Read compact fields only. Rebuild from the committed ledger, including after a crash.
    rows = db.execute("""SELECT json_extract(record,'$.report.arms.model.equityEur'),
                         json_extract(record,'$.report.last.execution'), json_extract(record,'$.report.last.reason')
                         FROM slots WHERE record IS NOT NULL ORDER BY slot""")
    peak = 1000
    drawdown = 0
    closed = failures = completed = 0
    for equity, execution, reason in rows:
        completed += 1
        closed += execution == 'PAPER_SELL'
        failures += reason.startswith('MODEL_UNAVAILABLE')
        if equity is not None:
            peak = max(peak, equity)
            drawdown = max(drawdown, 1 - equity / peak)
    return dict(startUtc=iso(start), endUtc=iso(end if end is not None else start+7*DAY), completedSlots=completed,
                missingOrPendingSlots=1+(slot-start)//STEP-completed, closedModelTrades=closed,
                modelFailures=failures, maxObservedDrawdownPct=100*drawdown,
                modeledApiUsd=settled/UNIT, unresolvedReserveUsd=unknown/UNIT, apiBudgetUsd=BUDGET/UNIT)


def publish(db, directory, start, slot, report=None, *, end=None):
    if report is None:
        row = db.execute('SELECT record FROM slots WHERE record IS NOT NULL ORDER BY slot DESC LIMIT 1').fetchone()
        report = json.loads(row[0])['report'] if row else None
    summary = audit(db, start, slot, end=end)
    payload = dict(pilotAudit=summary, report=report)
    for name, value in (('report', report), ('audit', payload)):
        tmp = directory/f'pilot-{name}.tmp'
        tmp.write_text(json.dumps(value, allow_nan=False, ensure_ascii=False))
        tmp.replace(directory/f'pilot-{name}.json')
    print(json.dumps(payload, allow_nan=False), flush=True)
    # Publish from the regular job stdout only when this is the baseline volume.
    if (directory/'challenger-v2'/'pilot.sqlite').is_file():
        publish_pair(directory.resolve(), slot)


def publish_pair(directory, slot):
    last_at = None
    # Allow the challenger to finish during the first 90 seconds of this slot.
    deadline = slot + 90
    while True:
        try:
            _, row = comparison(directory)
            if row and (row['at'], bool(row.get('v3Pending'))) != last_at:
                last_at = (row['at'], bool(row.get('v3Pending')))
                print(json.dumps({'pilotAudit': {'comparison': row}}, allow_nan=False), flush=True)
            if last_at == (iso(slot), False):
                return
        except (sqlite3.Error, ValueError, KeyError, TypeError):
            print('PAIR_REPORT_UNAVAILABLE', flush=True)
        remaining = deadline - time.time()
        if remaining <= 0:
            return
        time.sleep(min(5, remaining))


def paired_directory(volume, start, *, cost_aware=False):
    baseline = volume / 'pilot.sqlite'
    db = sqlite3.connect(baseline.as_uri() + '?mode=ro', uri=True)
    try:
        baseline_start, = db.execute('SELECT start FROM pilot WHERE id=1').fetchone()
    finally:
        db.close()
    end = baseline_start + 7 * DAY
    if not baseline_start <= start < end:
        raise ValueError('challenger start outside baseline pilot')
    directory = volume / ('challenger-v3' if cost_aware else 'challenger-v2')
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.resolve() != directory:
        raise ValueError('challenger directory must be isolated')
    return directory, end


def run(directory, start, key, *, challenger=False, paired=False, cost_aware=False):
    if not os.path.ismount(directory):
        raise ValueError('pilot directory must be a mounted persistent volume')
    end = start + 7 * DAY
    if paired:
        challenger = not cost_aware
        directory, end = paired_directory(directory.resolve(), start, cost_aware=cost_aware)
    if time.time() >= end and not (directory/'pilot.sqlite').is_file():
        print('PILOT_ENDED', flush=True)
        return
    with (directory/'pilot-writer.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        db = connect(directory/'pilot.sqlite', MODEL, challenger=challenger, cost_aware=cost_aware)
        configure(db, start, time.time())
        while time.time() < end:
            now = time.time()
            if now < start:
                time.sleep(min(STEP, start-now))
                continue
            slot = int(now)//STEP*STEP
            if slot >= end:
                break
            report = cycle(db, slot, MODEL, key, BudgetedFeeds(db, slot, end))
            publish(db, directory, start, slot, report, end=end)
            time.sleep(max(0, min(slot+STEP, end)-time.time()))
        publish(db, directory, start, end-STEP, end=end)
        db.close()
        print('PILOT_ENDED', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--start', type=int, required=True)
    policies = parser.add_mutually_exclusive_group()
    policies.add_argument('--cost-aware', action='store_true', help='Run v3 on its own mounted paper ledger')
    policies.add_argument('--challenger', action='store_true', help='Use v2 in a separate pilot volume')
    policies.add_argument('--paired-challenger', action='store_true',
                        help='Use isolated V2 files on the baseline volume and end at its cutoff')
    policies.add_argument('--paired-cost-aware', action='store_true',
                          help='Use isolated V3 files on the baseline volume and end at its cutoff')
    args = parser.parse_args()
    run(args.directory, args.start, os.environ['OPENAI_API_KEY'], challenger=args.challenger, paired=args.paired_challenger or args.paired_cost_aware,
        cost_aware=args.cost_aware or args.paired_cost_aware)
