"""Prospective matched newcomer comparison. Fixed mint list, public quotes, no orders."""
import json
import time

from meme_paper_account import FEE, UNIT
from newcomer_research import ERRORS, discover, flow
from new_pool_watch import GT, SIZE, USDC, get, spot_quote


def emit(kind, **fields):
    print(json.dumps(dict(at=int(time.time()),event=kind,**fields)),flush=True)


class Pair:
    def __init__(self,row):
        self.row = row
        self.positions = {}
        self.reference_qty = self.previous_bid = None
        self.sold_into = False

    def tick(self,index,final,quote=spot_quote,fetch=get):
        mint = self.row['mint']
        cache = {}

        def bid(qty):
            if qty not in cache:
                cache[qty] = quote(mint,USDC,qty)
            return cache[qty]

        def enter(name):
            qty = quote(USDC,mint,SIZE)
            mark = bid(qty)
            if mark < .95*SIZE:
                emit('costRejected',mint=mint,arm=name)
                return
            self.positions[name] = [qty,None]
            emit('entry',mint=mint,arm=name,qty=qty,usdc=SIZE/UNIT)
            return qty

        if index==0:
            self.reference_qty = enter('early')
            if self.reference_qty:
                self.previous_bid = bid(self.reference_qty)
            return
        if self.reference_qty is None:
            return
        for name,(qty,result) in self.positions.items():
            if result is not None:
                continue
            try:
                proceeds = bid(qty)
            except ERRORS as exc:
                emit('missingExitQuote',mint=mint,arm=name,reason=type(exc).__name__)
                continue
            net = proceeds-SIZE-2*FEE
            if final or net>=2*SIZE or net<=-.30*SIZE:
                self.positions[name][1] = net
                emit('exit',mint=mint,arm=name,netUsdc=net/UNIT)
        if final or 'wave' in self.positions:
            return
        current = bid(self.reference_qty)
        recovered = current > self.previous_bid
        self.previous_bid = current
        trades = fetch(f"{GT}/pools/{self.row['pool']}/trades",120)['data']
        stats = flow(trades,mint,self.row['quote'],int(time.time()))
        net = stats['netUsd'][1]
        if self.sold_into and recovered and net>0 and stats['newRecentBuyers']>=3 and stats['largestRecentBuyerShare']<=.50:
            enter('wave')
        self.sold_into |= net < 0


def summary(studies,arm):
    trades = [s.positions[arm][1] for s in studies if arm in s.positions]
    closed = [net for net in trades if net is not None]
    realized = sum(closed)/UNIT
    unresolved = len(trades)-len(closed)
    return dict(arm=arm,entries=len(trades),closed=len(closed),unresolved=unresolved,
                realizedUsdc=realized,startingUsdc=1000,
                equityIfUnresolvedWorthZero=1000+realized-unresolved*(SIZE+FEE)/UNIT)


def run():
    studies = {}
    for attempt in range(3):
        candidates = discover()
        for row in candidates:
            if row['buys'] >= 3*row['sells']:
                studies.setdefault(row['mint'],Pair(row))
            if len(studies)==2:
                break
        emit('discovery', attempt=attempt+1, eligiblePools=len(candidates), selected=len(studies))
        if studies or attempt==2:
            break
        time.sleep(60)
    emit('cohort',mints=list(studies))
    if studies:
        for i in range(11):
            start = time.monotonic()
            for study in studies.values():
                try:
                    study.tick(i,i==10)
                except ERRORS as exc:
                    emit('observationUnavailable',mint=study.row['mint'],reason=type(exc).__name__)
            if not any(s.positions for s in studies.values()):
                break
            if i<10:
                time.sleep(max(0,60-(time.monotonic()-start)))
    for arm in ('early','wave'):
        emit('summary',**summary(studies.values(),arm))


if __name__=='__main__':
    run()
