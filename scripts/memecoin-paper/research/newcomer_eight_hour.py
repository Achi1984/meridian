"""Collect one eight-hour comparison across runner handoff, accounting in micro-USDC."""
import argparse
from collections import Counter
import json
from pathlib import Path
import signal
from uuid import uuid4
from new_pool_watch import quote as raydium_quote
from campaign_ledger import reconcile, verify_journal
import time

from meme_paper_account import FEE, SIZE, START, UNIT
import newcomer_wave_pair as collector


class Account:
    def __init__(self, policy):
        self.policy = policy
        self.cash = self.peak = START
        self.drawdown = self.closed = self.missing = 0
        self.open = {}
        self.entries = {}
        self.by_mint = Counter()

    def update(self, row, session):
        mint = row.get('mint')
        key = (session, mint)
        kind = row['event']
        if kind == 'entry':
            signature = row['at'], row['qty']
            if key in self.entries:
                if self.entries[key] != signature:
                    raise ValueError(f'Conflicting entry {key}')
                return
            self.entries[key] = signature
        if kind == 'entry' and self.cash >= SIZE + FEE:
            self.cash -= SIZE + FEE
            self.open[key] = dict(positionId=f'{session}:wave:{mint}', mint=mint, qty=row['qty'], bid=None, markAt=None, marks=0, peakNet=0)
        pos = self.open.get(key)
        if pos is None:
            return
        if kind == 'entry' and self.policy == 'failedRecovery':
            pos.update(entryAt=row['at'], lossAt=None, sellAfter=None)
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
                elif self.policy in ('fixed', 'failedRecovery', 'smallPoolFixed'):
                    close_target = 10*net >= SIZE
            if self.policy == 'failedRecovery' and kind == 'resaleMark':
                at = row['at']
                if pos['sellAfter'] is not None:
                    close_target |= at > pos['sellAfter']
                elif net * 20 <= -SIZE and at > pos['entryAt']:
                    previous = pos['lossAt']
                    if previous is not None and 40 <= at-previous <= 90 and at-pos['entryAt'] >= 120:
                        pos['sellAfter'] = at
                    pos['lossAt'] = at
                else:
                    pos['lossAt'] = None
            if kind == 'exit' or close_target:
                self.cash += bid-FEE
                self.closed += 1
                self.by_mint[mint] += bid-SIZE-2*FEE
                del self.open[key]
            else:
                pos['marks'] += 1
        elif kind in ('missingExitQuote', 'lateExitQuote'):
            if self.policy == 'failedRecovery':
                pos['lossAt'] = None
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


class StagedAccount(Account):
    def __init__(self):
        super().__init__('staged')
        self.fills = []

    def update(self, row, session):
        kind = row['event']
        if kind not in ('entry', 'stagedMark', 'stagedMissing'):
            return
        key = (session, row['mint'])
        if kind == 'entry':
            if key in self.entries:
                super().update(row, session)
                return
            if self.cash >= SIZE + FEE:
                super().update(row, session)
                self.open[key].update(initialQty=row['qty'], basis=SIZE+FEE, stage=0)
            return
        pos = self.open.get(key)
        if pos is None:
            return
        if kind == 'stagedMissing':
            self.missing += 1
            pos.update(bid=None, markAt=None)
            return
        if kind != 'stagedMark':
            return
        qty, basis = pos['qty'], pos['basis']
        bid = row['bid']
        pos.update(bid=bid, markAt=row['at'])
        reason = None
        if row['held'] >= collector.HOLD_SECONDS:
            reason = 'time'
        elif pos['stage'] and bid-FEE <= basis:
            reason = 'breakeven'
        elif not pos['stage'] and 10*(bid-FEE-basis) <= -3*SIZE:
            reason = 'stop'
        amount, proceeds = qty, bid
        if reason is None and row.get('lotBid') is not None and pos['stage'] < 2:
            amount = self.next_lot(pos)
            allocated = basis*amount//qty
            target = (10,20)[pos['stage']]
            proceeds = row['lotBid']
            if 100*(proceeds-FEE-allocated)*pos['initialQty'] >= target*SIZE*amount:
                reason = 'tp1' if pos['stage'] == 0 else 'tp2'
        if reason:
            allocated = basis*amount//qty
            profit = proceeds-FEE-allocated
            self.cash += proceeds-FEE
            self.by_mint[row['mint']] += profit
            self.fills.append(dict(at=row['at'], mint=row['mint'], session=session, reason=reason,
                                   qty=amount, proceedsRaw=proceeds, netRaw=profit))
            if amount == qty:
                del self.open[key]
                self.closed += 1
            else:
                pos.update(qty=qty-amount, basis=basis-allocated, stage=pos['stage']+1,
                           bid=None, markAt=None)
        equity = self.equity()
        if equity is not None:
            self.peak = max(self.peak, equity)
            self.drawdown = max(self.drawdown, self.peak-equity)

    @staticmethod
    def next_lot(pos):
        return pos['initialQty']//(2 if pos['stage'] == 0 else 4)

    def snapshot(self):
        return dict(super().snapshot(), fills=self.fills)


class FilterComparison:
    """Attribute the actual C/F accounts at the granularity of one session and mint."""
    def __init__(self):
        self.groups = {}
        self.closed = Counter()
        self.gains = Counter()
        self.losses = Counter()

    def update(self, key, kind, eligible, prior, current, bid):
        if kind == 'entry' and current != (False, False):
            if current == (True, True):
                group = 'both'
            elif current == (False, True):
                group = 'fOnlyCapacity'
            else:
                group = 'cOnlyCapacity' if eligible else 'excludedByFilter'
            self.groups[key] = group
        if prior != current and current == (False, False) and key in self.groups:
            group = self.groups.pop(key)
            net = bid - SIZE - 2*FEE
            self.closed[group] += 1
            self.gains[group] += max(0, net)
            self.losses[group] += max(0, -net)

    def snapshot(self):
        unresolved = Counter(self.groups.values())
        return {group: dict(closed=self.closed[group], open=unresolved[group],
                            grossPositiveNetUsdc=self.gains[group]/UNIT,
                            grossNegativeNetUsdc=self.losses[group]/UNIT,
                            netUsdc=(self.gains[group]-self.losses[group])/UNIT)
                for group in ('both', 'excludedByFilter', 'cOnlyCapacity', 'fOnlyCapacity')}


class NextTickTarget:
    """Compare the target quote with the next scheduled full-position resale mark."""
    def __init__(self):
        self.pending = {}
        self.targets = self.pairs = self.lower = 0
        self.original = self.delayed = 0

    def observe(self, key, row, target):
        kind = row['event']
        if target:
            self.targets += 1
            self.pending[key] = row
        elif key in self.pending and kind in ('resaleMark', 'missingExitQuote', 'lateExitQuote'):
            first = self.pending.pop(key)
            if (kind == 'resaleMark' and row['tick'] == first['tick'] + 1
                    and row['qty'] == first['qty'] and row['at'] > first['at']):
                bid = row['usdcRaw']
                self.pairs += 1
                self.original += first['usdcRaw'] - SIZE - 2*FEE
                self.delayed += bid - SIZE - 2*FEE
                self.lower += bid < first['usdcRaw']

    def snapshot(self):
        return dict(targetExits=self.targets, paired=self.pairs, withoutNextQuote=self.targets-self.pairs,
                    lowerNextQuote=self.lower, pairedOriginalNetUsdc=self.original/UNIT if self.pairs else None,
                    pairedNextNetUsdc=self.delayed/UNIT if self.pairs else None)


def run(directory, segment, holder_test=False, roundtrip_test=False):
    directory.mkdir(exist_ok=True, parents=True)
    journal = directory/'events.jsonl'
    accounts = {name: Account(policy) for name, policy in
                [('A', 'trailing'), ('B', 'standard'), ('C', 'fixed'), ('E', 'failedRecovery')]}

    if holder_test:
        from holder_signal import HolderSampler, LARGE_LOSS_BPS, HIGH_BPS
        sampler = HolderSampler()
        accounts['H'] = Account('fixed')
    if roundtrip_test:
        accounts['R'] = Account('fixed')
    admissions = Counter()
    holder_states = Counter()
    blocked = set()
    avoided_losses = set()
    missed_triples = set()
    admitted_blocked = set()
    comparison = FilterComparison()
    next_tick = NextTickTarget()
    smaller_pools = set()
    accounts['F'] = Account('smallPoolFixed')

    staged = accounts['D'] = StagedAccount()

    class StagedPair(collector.Pair):
        @property
        def staged_pending(self):
            return ((session, self.row['mint']) in staged.open and
                    time.monotonic()-self.opened_at['wave'] <= collector.HOLD_SECONDS+collector.EXIT_GRACE)

        def tick(self, index, final):
            if holder_test:
                sampler.refresh(self.row['mint'])
            cache = {}
            def quote(src, dst, amount):
                key = (src, dst, amount)
                if key not in cache:
                    cache[key] = collector.spot_quote(src, dst, amount)
                return cache[key]

            try:
                super().tick(index, final, quote)
            finally:
                self.observe_staged(quote)

        def observe_staged(self, quote):
            mint = self.row['mint']
            pos = staged.open.get((session, mint))
            if pos is None:
                return
            def age():
                return time.monotonic()-self.opened_at['wave']
            try:
                bid = quote(mint, collector.USDC, pos['qty'])
            except collector.ERRORS:
                emit('stagedMissing', mint=mint)
                return
            lot_bid = None
            lot = staged.next_lot(pos)
            if pos['stage'] < 2 and lot and age() < collector.HOLD_SECONDS:
                try:
                    lot_bid = quote(mint, collector.USDC, lot)
                except collector.ERRORS:
                    pass
            held = age()
            if held > collector.HOLD_SECONDS+collector.EXIT_GRACE:
                emit('stagedMissing', mint=mint)
            else:
                emit('stagedMark', mint=mint, bid=bid, lotBid=lot_bid, held=held)

    seen = {}
    fills = []

    def apply(row):
        event_id = row.get('eventId')
        if event_id is not None:
            if event_id in seen:
                if seen[event_id] != row:
                    raise ValueError(f'Conflicting event {event_id}')
                return []
            seen[event_id] = row
        key = row['session'], row.get('mint')
        quantities = {name: account.open.get(key, {}).get('qty', 0)
                      for name, account in accounts.items()}
        if row['event'] == 'carryQuote':
            origin = row['originSession'], row['mint']
            for account in accounts.values():
                pos = account.open.get(origin)
                if pos and pos['qty'] == row['qty']:
                    pos.update(bid=row['usdcRaw'], markAt=row['at'] if row['usdcRaw'] else None)
        for account in accounts.values():
            for pos in account.open.values():
                if pos['markAt'] is not None and row['at']-pos['markAt'] > 90:
                    pos.update(bid=None, markAt=None)
        if row['event'] in ('stagedMissing', 'stagedMark'):
            staged.update(row, row['session'])
        key = row['session'], row.get('mint')
        if row['event'] == 'cohortSelection' and 0 < row['entryLiquidityUsd'] < 20_000:
            smaller_pools.add(key)
        if row.get('arm') == 'wave':
            if holder_test and row['event'] == 'entry':
                state = row['holderEvidence']['state']
                holder_states[state] += 1
                if state == 'high':
                    blocked.add(key)
            prior = key in accounts['C'].open, key in accounts['F'].open
            for name, account in accounts.items():
                if name == 'R' and row['event'] == 'entry':
                    proceeds = row['initialResaleRaw']
                    passed = (SIZE + 2 * FEE - proceeds) * 100 <= 3 * SIZE
                    admissions['passed' if passed else 'vetoed'] += 1
                    if not passed or key not in accounts['C'].open:
                        continue
                if name == 'H' and key in blocked:
                    continue
                if name == 'F' and key not in smaller_pools:
                    continue
                account.update(row, row['session'])
            current = key in accounts['C'].open, key in accounts['F'].open
            if holder_test and key in blocked and key in accounts['C'].entries:
                if prior[0] and not current[0]:
                    net = row['usdcRaw'] - SIZE - 2*FEE
                    if -net * 10000 >= LARGE_LOSS_BPS * SIZE:
                        avoided_losses.add(key)
                if (row['event'] == 'quotedTriple' and
                        (key in admitted_blocked)):
                    missed_triples.add(key)
                if current[0]:
                    admitted_blocked.add(key)
            next_tick.observe(key, row, prior[1] and not current[1] and row['event'] == 'resaleMark')
            comparison.update(key, row['event'], key in smaller_pools, prior, current, row.get('usdcRaw'))
        if row['event'] in ('sessionEnd', 'sessionInterrupted'):
            for account in accounts.values():
                for (s, _), pos in account.open.items():
                    if s == row['session']:
                        pos.update(bid=None, markAt=None)

        changes = []
        for name, account in accounts.items():
            after = account.open.get(key, {}).get('qty', 0)
            before = quantities[name]
            if before == after:
                continue
            if before == 0:
                raw = SIZE
            elif row['event'] == 'stagedMark':
                raw = row['lotBid'] if after else row['bid']
            else:
                raw = row['usdcRaw']
            changes.append(dict(account=name, positionId=f'{key[0]}:wave:{key[1]}',
                                side='buy' if after > before else 'sell',
                                qty=abs(after-before), usdcRaw=raw))
        return changes

    if segment == 1:
        started = int(time.time())
        with journal.open('x') as out:
            print(json.dumps(dict(event='start', eventId=uuid4().hex, fills=[], at=started, session=0)), file=out)
        identified = True
        session = 0
    else:
        with journal.open() as src:
            first = json.loads(next(src))
            started, session = first['at'], 0
            identified = 'eventId' in first
            replayed = set()
            for line in src:
                row = json.loads(line)
                session = row['session']
                computed = apply(row)
                if 'fills' in row and row['fills'] != computed:
                    if row.get('eventId') in replayed and not computed:
                        continue
                    raise ValueError('Journal fills differ on replay')
                fills.extend(computed)
                replayed.add(row.get('eventId'))
    end = started + 8*3600
    handoff = started + 4*3600
    sampled_sessions = set()
    with journal.open('a', buffering=1) as out:
        def emit(kind, **fields):
            row = dict(event=kind, eventId=uuid4().hex, session=session, at=int(time.time()), **fields)
            if row.get('arm') == 'wave' or kind in ('stagedMark', 'stagedMissing', 'carryQuote'):
                if row.get('mint'):
                    origin = row.get('originSession', session)
                    row['positionId'] = f"{origin}:wave:{row['mint']}"
            if kind in ('entry','resaleMark','exit'):
                buying = kind == 'entry'
                row.update(provider='Jupiter', inputMint=collector.USDC if buying else row['mint'],
                           outputMint=row['mint'] if buying else collector.USDC,
                           inputRaw=SIZE if buying else row['qty'])
            if holder_test and kind == 'entry' and row.get('arm') == 'wave':
                row['holderEvidence'] = sampler.at_entry(row['mint'], time.time())
            changes = apply(row)
            row['fills'] = changes
            fills.extend(changes)
            print(json.dumps(row), file=out)
            status = dict(startedAt=started, endsAt=end, updatedAt=row['at'], lastEvent=kind,
                          session=session, accounts={n:a.snapshot() for n,a in accounts.items()})
            if holder_test:
                status['holderComparison'] = dict(
                    reference='C', filtered='H', thresholdBps=HIGH_BPS, largeLossBps=LARGE_LOSS_BPS,
                    entryStates=dict(holder_states), skippedReferenceEntries=len(admitted_blocked),
                    avoidedLargeLosses=len(avoided_losses), skippedQuotedTriples=len(missed_triples),
                    realizedDeltaUsdc=(sum(accounts['H'].by_mint.values()) -
                                       sum(accounts['C'].by_mint.values())) / UNIT)
            if roundtrip_test:
                status['roundtripComparison'] = dict(reference='C', filtered='R', maxLossBps=300,
                                                     decisions=dict(admissions))
            status['fTargetNextTick'] = next_tick.snapshot()
            status['filterComparison'] = comparison.snapshot()
            if kind in ('sessionEnd','sessionInterrupted','handoff','finished','resume'):
                reconcile(fills, status['accounts'], START, FEE)
                if identified:
                    verify_journal(journal, status['accounts'], START, FEE)
                status['ledgerVerified'] = identified
            temp = directory/'status.tmp'
            temp.write_text(json.dumps(status))
            temp.replace(directory/'status.json')
            if kind == 'resaleMark' and row.get('arm') == 'wave' and session not in sampled_sessions:
                sampled_sessions.add(session)
                try:
                    reference = raydium_quote(row['mint'], collector.USDC, row['qty'])
                except collector.ERRORS:
                    reference = None
                emit('quoteComparison', sourceEventId=row['eventId'], provider='Raydium',
                     inputMint=row['mint'], outputMint=collector.USDC, inputRaw=row['qty'],
                     primaryAt=row['at'], primaryRaw=row['usdcRaw'], referenceRaw=reference)
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
                if holder_test:
                    sampler.latest.clear()
                    sampler.pending.clear()
                emit('sessionStart')
                try:
                    pending = {(origin, mint, pos['qty']) for account in accounts.values()
                               for (origin, mint), pos in account.open.items() if origin < session}
                    for origin, mint, qty in sorted(pending):
                        try:
                            raw = collector.spot_quote(mint, collector.USDC, qty)
                        except collector.ERRORS:
                            raw = None
                        emit('carryQuote', originSession=origin, mint=mint, qty=qty, usdcRaw=raw,
                             provider='Jupiter', inputMint=mint, outputMint=collector.USDC)
                    collector.run(pair_type=StagedPair)
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
    cli.add_argument('--holder-test', action='store_true')
    cli.add_argument('--roundtrip-test', action='store_true')
    args = cli.parse_args()
    run(args.directory, args.segment, args.holder_test, args.roundtrip_test)

