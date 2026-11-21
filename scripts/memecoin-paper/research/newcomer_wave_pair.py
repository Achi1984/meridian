"""Prospective matched newcomer comparison. Fixed mint list, public quotes, no orders."""
from datetime import datetime
import json
import time

from meme_paper_account import FEE, UNIT
from newcomer_research import ERRORS, discover, flow
from new_pool_watch import GT, SIZE, USDC, get, snapshot, spot_quote


def emit(kind, **fields):
    print(json.dumps(dict(at=int(time.time()),event=kind,**fields)),flush=True)


class Pair:
    def __init__(self,row):
        self.row = row
        self.positions = {}
        self.reference_qty = self.previous_bid = None
        self.sold_into = False
        self.tripled_at = {}

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
                emit('costRejected',mint=mint,arm=name,usdcRaw=mark)
                return qty
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
        for name,at in list(self.tripled_at.items()):
            age = time.time()-at
            if 60<=age<=180:
                qty = self.positions[name][0]
                try:
                    proceeds = bid(qty)
                except ERRORS:
                    pass
                else:
                    age = time.time()-at
                    if age<=180:
                        emit('tripleRecheck',mint=mint,arm=name,qty=qty,usdcRaw=proceeds,
                             stillTriple=proceeds-2*FEE>=3*SIZE,ageSeconds=age)
                        del self.tripled_at[name]
                        continue
            if final or age>180:
                emit('tripleRecheckMissing',mint=mint,arm=name,ageSeconds=age)
                del self.tripled_at[name]
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
                emit('exit',mint=mint,arm=name,netUsdc=net/UNIT,usdcRaw=proceeds,qty=qty)
                if net>=2*SIZE:
                    self.tripled_at[name] = time.time()
                    emit('quotedTriple',mint=mint,arm=name,usdcRaw=proceeds,qty=qty)
                    if final:
                        emit('tripleRecheckMissing',mint=mint,arm=name,ageSeconds=0)
                        del self.tripled_at[name]
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


def scan(watch):
    fresh = {r['pool']:r for r in discover(min_age=0)}
    missing = [p for p in watch if p not in fresh]
    if missing:
        try:
            items = get(GT+'/pools/multi/'+','.join(missing),120)['data']
            for item in items:
                try:
                    r = snapshot(item)
                except ERRORS:
                    continue
                if watch.get(r['pool']) == (r['mint'], r['quote']):
                    fresh[r['pool']] = r
        except ERRORS as exc:
            emit('refreshUnavailable',reason=type(exc).__name__)
    now = time.time()
    eligible, following = [], {}
    for r in sorted(fresh.values(),key=lambda r:r['volume'],reverse=True):
        age = now-datetime.fromisoformat(r['created']).timestamp()
        if (age<0 or age>3600 or r['liquidity']<5000 or r['sells']<3
                or r['dex'] not in ('pump-fun','pumpswap')):
            continue
        if age>=120 and r['buys']>=1.5*r['sells']:
            eligible.append(r)
        elif len(following)<25:
            following[r['pool']] = (r['mint'],r['quote'])
    watch.clear()
    watch.update(following)
    return eligible


def run():
    studies, watch = {}, {}
    for attempt in range(3):
        try:
            candidates = scan(watch)
        except ERRORS as exc:
            emit('discoveryUnavailable',attempt=attempt+1,reason=type(exc).__name__,status=getattr(exc,'code',None))
            if attempt==2:
                raise
            delay = (getattr(exc,'headers',{}) or {}).get('Retry-After','60')
            if not delay.isdigit() or int(delay)>180:
                raise
            time.sleep(max(60,int(delay)))
            continue
        bands = set()
        for row in candidates:
            band = 'strong' if row['buys']>=3*row['sells'] else 'moderate'
            if band in bands or row['mint'] in studies:
                continue
            bands.add(band)
            emit('cohortSelection',mint=row['mint'],pool=row['pool'],band=band,
                 entryLiquidityUsd=row['liquidity'],buys=row['buys'],sells=row['sells'])
            studies.setdefault(row['mint'],Pair(row))
            if len(studies)==2:
                break
        emit('discovery', attempt=attempt+1, eligiblePools=len(candidates), watching=len(watch), selected=len(studies))
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
            if not any(s.reference_qty for s in studies.values()):
                break
            if i<10:
                time.sleep(max(0,60-(time.monotonic()-start)))
    for arm in ('early','wave'):
        emit('summary',**summary(studies.values(),arm))


if __name__=='__main__':
    run()
