"""Collect one eight-hour comparison across runner handoff, accounting in micro-USDC."""
import argparse
from collections import Counter
import json
from pathlib import Path
import signal
import time

from meme_paper_account import FEE, SIZE, START, UNIT
import newcomer_wave_pair as collector


class Account:
    def __init__(self, policy):
        self.policy = policy
        self.cash = self.peak = START
        self.drawdown = self.closed = self.missing = 0
        self.open = {}
        self.by_mint = Counter()

    def update(self, row, session):
        mint = row.get('mint')
        key = (session, mint)
        kind = row['event']
        if kind == 'entry' and self.cash >= SIZE + FEE:
            self.cash -= SIZE + FEE
            self.open[key] = dict(mint=mint, qty=row['qty'], bid=None, markAt=None, marks=0, peakNet=0)
        pos = self.open.get(key)
        if pos is None:
            return
        if kind in ('resaleMark', 'exit'):
            if pos['qty'] != row['qty']:
                raise ValueError('Exit quantity differs from entry')
            bid = row['usdcRaw']
            pos.update(bid=bid, markAt=row['at'])
            net = bid - SIZE - 2*FEE
            close_target = False
            if pos['marks'] > 0:
                if self.policy == 'trailing':
                    close_target = 10*pos['peakNet'] >= SIZE and 2*net <= pos['peakNet']
                    pos['peakNet'] = max(pos['peakNet'], net)
                elif self.policy == 'fixed':
                    close_target = 10*net >= SIZE
            if kind == 'exit' or close_target:
                self.cash += bid-FEE
                self.closed += 1
                self.by_mint[mint] += bid-SIZE-2*FEE
                del self.open[key]
            else:
                pos['marks'] += 1
        elif kind in ('missingExitQuote', 'lateExitQuote'):
            self.missing += 1
            pos.update(bid=None, markAt=None)
        equity = self.equity()
        if equity is not None:
            self.peak = max(self.peak, equity)
            self.drawdown = max(self.drawdown, self.peak-equity)

    def equity(self):
        if any(p['bid'] is None for p in self.open.values()):
            return None
        return self.cash + sum(p['bid']-FEE for p in self.open.values())

    def snapshot(self):
        equity = self.equity()
        net = sum(self.by_mint.values())
        return dict(policy=self.policy, cashUsdc=self.cash/UNIT, equityUsdc=None if equity is None else equity/UNIT,
                    realizedUsdc=net/UNIT, closedTrades=self.closed, openPositions=list(self.open.values()),
                    missingExitQuotes=self.missing, sampledMaxDrawdownUsdc=self.drawdown/UNIT,
                    cashIfOpenWorthZeroUsdc=self.cash/UNIT,
                    realizedWithoutBestMintUsdc=(net-max(self.by_mint.values()))/UNIT
                    if len(self.by_mint)>1 else None)


def run(directory, segment):
    directory.mkdir(exist_ok=True, parents=True)
    journal = directory/'events.jsonl'
    accounts = {name: Account(policy) for name, policy in
                [('A', 'trailing'), ('B', 'standard'), ('C', 'fixed')]}

    def apply(row):
        if row.get('arm') == 'wave':
            for account in accounts.values():
                account.update(row, row['session'])
        if row['event'] in ('sessionEnd', 'sessionInterrupted'):
            for account in accounts.values():
                for (s, _), pos in account.open.items():
                    if s == row['session']:
                        pos.update(bid=None, markAt=None)

    if segment == 1:
        started = int(time.time())
        with journal.open('x') as out:
            print(json.dumps(dict(event='start', at=started, session=0)), file=out)
        session = 0
    else:
        with journal.open() as src:
            first = json.loads(next(src))
            started, session = first['at'], 0
            for line in src:
                row = json.loads(line)
                session = row['session']
                apply(row)
    end = started + 8*3600
    handoff = started + 4*3600
    with journal.open('a', buffering=1) as out:
        def emit(kind, **fields):
            row = dict(event=kind, session=session, at=int(time.time()), **fields)
            print(json.dumps(row), file=out)
            apply(row)
            status = dict(startedAt=started, endsAt=end, updatedAt=row['at'], lastEvent=kind,
                          session=session, accounts={n:a.snapshot() for n,a in accounts.items()})
            temp = directory/'status.tmp'
            temp.write_text(json.dumps(status))
            temp.replace(directory/'status.json')
            if kind in ('entry','exit','sessionEnd','finished','sessionInterrupted','resume','ready'):
                for name, account in accounts.items():
                    print(json.dumps(dict(at=row['at'], event=kind, account=name,
                                          closed=account.closed, open=len(account.open),
                                          netUsdc=sum(account.by_mint.values())/UNIT,
                                          equityUsdc=account.snapshot()['equityUsdc'])), flush=True)

        def deadline(signum, frame):
            raise TimeoutErrorAtEnd()

        collector.emit = emit
        emit('ready' if segment == 1 else 'resume')
        signal.signal(signal.SIGALRM, deadline)
        if time.time() < end:
            signal.setitimer(signal.ITIMER_REAL, max(.001, end-time.time()))
        try:
            while time.time() < (handoff if segment == 1 else end):
                session += 1
                emit('sessionStart')
                try:
                    collector.run()
                except collector.ERRORS as exc:
                    emit('sessionInterrupted', reason=type(exc).__name__)
                else:
                    emit('sessionEnd')
                time.sleep(60)
        except TimeoutErrorAtEnd:
            emit('sessionInterrupted', reason='campaignDeadline')
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
        emit('handoff' if segment == 1 else 'finished')


class TimeoutErrorAtEnd(Exception):
    pass


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('directory', type=Path)
    cli.add_argument('segment', type=int, choices=(1,2))
    args = cli.parse_args()
    run(args.directory, args.segment)
