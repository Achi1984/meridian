"""Bounded seven-day live-market paper pilot. Timestamps and slots are UTC."""
import argparse
import fcntl
import json
import os
import time
from pathlib import Path

import feeds
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
        result = feeds.decide(context, model, key)
        usage = result[2]
        charge = 4 * (usage['input'] - usage['cached']) + usage['cached'] + 16 * usage['output']
        with self.db:
            self.db.execute('UPDATE calls SET charge=?, settled=1 WHERE slot=?', (charge, self.slot))
        return result


def audit(db, start, slot):
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
    return dict(startUtc=iso(start), endUtc=iso(start+7*DAY), completedSlots=completed,
                missingOrPendingSlots=1+(slot-start)//STEP-completed, closedModelTrades=closed,
                modelFailures=failures, maxObservedDrawdownPct=100*drawdown,
                modeledApiUsd=settled/UNIT, unresolvedReserveUsd=unknown/UNIT, apiBudgetUsd=BUDGET/UNIT)


def run(directory, start, key):
    if not os.path.ismount(directory):
        raise ValueError('pilot directory must be a mounted persistent volume')
    end = start + 7 * DAY
    if time.time() >= end:
        print('PILOT_ENDED', flush=True)
        return
    with (directory/'pilot-writer.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        db = connect(directory/'pilot.sqlite', MODEL)
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
            if report is not None:
                summary = audit(db, start, slot)
                encoded = json.dumps(report, allow_nan=False, ensure_ascii=False)
                tmp = directory/'pilot-report.tmp'
                tmp.write_text(encoded)
                tmp.replace(directory/'pilot-report.json')
                print(json.dumps(dict(pilotAudit=summary, report=report), allow_nan=False), flush=True)
            time.sleep(max(0, min(slot+STEP, end)-time.time()))
        print('PILOT_ENDED', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--start', type=int, required=True)
    args = parser.parse_args()
    run(args.directory, args.start, os.environ['OPENAI_API_KEY'])
