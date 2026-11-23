"""Prospective matched newcomer comparison. Fixed mint list, public quotes, no orders."""
import argparse
from datetime import datetime
import json
import re
import time
from http.client import HTTPException
from urllib.error import HTTPError

from meme_paper_account import FEE, UNIT
from newcomer_research import ERRORS, discover, flow
from new_pool_watch import GT, SIZE, USDC, get, snapshot, spot_quote


HOLD_SECONDS = 600
EXIT_GRACE = 120


def emit(kind, **fields):
    print(json.dumps(dict(at=int(time.time()),event=kind,**fields)),flush=True)


def provider_error_fields(exc):
    fields = dict(reason=type(exc).__name__, status=getattr(exc, 'code', None))
    if not isinstance(exc, HTTPError):
        return fields
    try:
        body = exc.read(4097)
        if len(body) > 4096:
            return fields
        payload = json.loads(body)
    except (ValueError, OSError, HTTPException, RecursionError):
        return fields
    code = payload.get('errorCode') if isinstance(payload, dict) else None
    if isinstance(code, str) and re.fullmatch(r'[A-Z][A-Z0-9_]{0,63}', code):
        fields['providerErrorCode'] = code
    return fields


class Pair:
    def __init__(self,row,persistence=False):
        self.persistence = persistence
        self.row = row
        self.positions = {}
        self.reference_qty = self.previous_bid = None
        self.sold_into = False
        self.tripled_at = {}
        self.opened_at = {}
        self.expired = set()

    def tick(self,index,final,quote=spot_quote,fetch=get):
        mint = self.row['mint']
        cache = {}

        def bid(qty):
            if qty not in cache:
                cache[qty] = quote(mint,USDC,qty)
            return cache[qty]

        def enter(name):
            leg = 'buy'
            try:
                qty = quote(USDC,mint,SIZE)
                leg = 'initialResale'
                mark = bid(qty)
            except ERRORS as exc:
                emit('entryQuoteUnavailable', mint=mint, arm=name, leg=leg,
                     **provider_error_fields(exc))
                raise
            if mark < .95*SIZE:
                emit('costRejected',mint=mint,arm=name,usdcRaw=mark)
                return qty
            self.positions[name] = [qty,None]
            self.opened_at[name] = time.monotonic()
            emit('entry',mint=mint,arm=name,qty=qty,usdc=SIZE/UNIT,initialResaleRaw=mark)
            emit('resaleMark',mint=mint,arm=name,tick=index,qty=qty,usdcRaw=mark)
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
            if result is not None or name in self.expired:
                continue
            try:
                proceeds = bid(qty)
            except ERRORS as exc:
                held = time.monotonic() - self.opened_at[name]
                if held >= HOLD_SECONDS+EXIT_GRACE:
                    self.expired.add(name)
                emit('missingExitQuote', mint=mint, arm=name, qty=qty, heldSeconds=held,
                     **provider_error_fields(exc))
                continue
            net = proceeds-SIZE-2*FEE
            age = time.monotonic()-self.opened_at[name]
            if age>HOLD_SECONDS+EXIT_GRACE:
                self.expired.add(name)
                emit('lateExitQuote',mint=mint,arm=name,heldSeconds=age,usdcRaw=proceeds)
                continue
            emit('resaleMark',mint=mint,arm=name,tick=index,qty=qty,usdcRaw=proceeds)
            if age>=HOLD_SECONDS or net>=2*SIZE or net<=-.30*SIZE:
                self.positions[name][1] = net
                reason = 'target' if net>=2*SIZE else 'stop' if net<=-.30*SIZE else 'time'
                emit('exit',mint=mint,arm=name,netUsdc=net/UNIT,usdcRaw=proceeds,qty=qty,
                     heldSeconds=age,reason=reason)
                if net>=2*SIZE:
                    self.tripled_at[name] = time.time()
                    emit('quotedTriple',mint=mint,arm=name,usdcRaw=proceeds,qty=qty)
                    if final:
                        emit('tripleRecheckMissing',mint=mint,arm=name,ageSeconds=0)
                        del self.tripled_at[name]
        if index>=10 or final or 'wave' in self.positions:
            return
        if self.persistence and index == 1 and 'early' in self.positions:
            try:
                confirmation = bid(self.reference_qty)
                passed = confirmation >= self.previous_bid
                emit('persistenceCheck',mint=mint,qty=self.reference_qty,initialRaw=self.previous_bid,
                     confirmationRaw=confirmation,passed=passed)
                if passed:
                    enter('persistent')
            except ERRORS as exc:
                emit('persistenceUnavailable',mint=mint,arm='persistent',reason=type(exc).__name__)
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


class HalfRunner(Pair):
    """Shadow the immediate entry and extend half only after a normal time exit."""
    def __init__(self, row, persistence=False):
        super().__init__(row, persistence)
        self.half_sale = None
        self.finished = False

    def tick(self, index, final, quote=spot_quote, fetch=get):
        try:
            super().tick(index, final, quote, fetch)
        finally:
            self.observe(final, quote)

    def observe(self, final, quote):
        position = self.positions.get('early')
        if self.finished or position is None:
            return
        qty, net = position
        mint = self.row['mint']
        if 'early' in self.expired:
            self.finished = True
            emit('runnerUnresolved', mint=mint, remainingQty=qty, cashRaw=-SIZE-FEE)
            return
        if net is None:
            if final:
                self.finished = True
                emit('runnerUnresolved', mint=mint, remainingQty=qty, cashRaw=-SIZE-FEE)
            return
        if net >= 2*SIZE or net <= -.30*SIZE or qty < 2:
            self.finished = True
            emit('runnerSharedExit', mint=mint, netRaw=net)
            return
        age = lambda: time.monotonic() - self.opened_at['early']
        splitting = self.half_sale is None
        amount = qty//2 if splitting else qty-qty//2
        deadline = (600 if splitting else 1200) + EXIT_GRACE
        cash = -SIZE-FEE if splitting else self.half_sale-SIZE-2*FEE
        if age() <= deadline:
            try:
                mark = quote(mint, USDC, amount)
            except ERRORS as exc:
                emit('runnerMissingQuote', mint=mint, qty=amount, heldSeconds=age(),
                     leg='partialSale' if splitting else 'remainderSale', **provider_error_fields(exc))
            else:
                held = age()
                if held <= deadline:
                    emit('runnerMark', mint=mint, qty=amount, usdcRaw=mark, heldSeconds=held)
                    if splitting:
                        self.half_sale = mark
                        emit('runnerPartialSale', mint=mint, qty=amount, usdcRaw=mark, feeRaw=FEE)
                        if final:
                            self.finished = True
                            emit('runnerUnresolved', mint=mint, remainingQty=qty-amount,
                                 cashRaw=mark-SIZE-2*FEE)
                        return
                    value = cash + mark - FEE
                    allocated = SIZE*amount/qty
                    if held >= 1200 or mark-FEE <= .70*allocated or mark-FEE >= 3*allocated:
                        self.finished = True
                        emit('runnerExit', mint=mint, qty=amount, usdcRaw=mark,
                             netRaw=value, baselineNetRaw=net, heldSeconds=held)
                        return
        if final or age() > deadline:
            self.finished = True
            emit('runnerUnresolved', mint=mint, remainingQty=qty if splitting else amount,
                 cashRaw=cash)


def run(persistence=False, half_runner=False):
    arms = ('early','wave','persistent') if persistence else ('early','wave')
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
            studies.setdefault(row['mint'],(HalfRunner if half_runner else Pair)(row,persistence))
            if len(studies)==2:
                break
        emit('discovery', attempt=attempt+1, eligiblePools=len(candidates), watching=len(watch), selected=len(studies))
        if studies or attempt==2:
            break
        time.sleep(60)
    emit('cohort',mints=list(studies),holdingPolicy='tenMinutesFromEntry',arms=arms,halfRunner=half_runner)
    if studies:
        for i in range(25):
            start = time.monotonic()
            for study in studies.values():
                try:
                    study.tick(i,i==24)
                except ERRORS as exc:
                    emit('observationUnavailable',mint=study.row['mint'],reason=type(exc).__name__)
            if not any(s.reference_qty for s in studies.values()):
                break
            if i>=10 and not any(half_runner and "early" in s.positions and not s.finished for s in studies.values()) and not any(s.tripled_at or any(result is None and name not in s.expired
                    for name,(_,result) in s.positions.items()) for s in studies.values()):
                break
            if i<24:
                time.sleep(max(0,60-(time.monotonic()-start)))
    for arm in arms:
        emit('summary',**summary(studies.values(),arm))


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--persistence',action='store_true')
    parser.add_argument('--half-runner', action='store_true')
    args = parser.parse_args()
    run(args.persistence, args.half_runner)
