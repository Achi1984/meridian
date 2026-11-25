"""Prospective Solana second-wave spot experiment. Only public data and quote requests."""
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from holder_signal import capture
from newcomer_research import ERRORS
from new_pool_watch import GT, SIZE, USDC, WSOL, get, snapshot, spot_quote
from meme_paper_account import FEE, UNIT

HOUR = 3600
START = 1000 * UNIT
WINDOW = 48 * HOUR
ARMS = ('fixed', 'runner')


def fresh(now):
    return dict(start=now, candidates={}, positions={}, retired={}, cash=dict.fromkeys(ARMS, START),
                errors={}, scans=0, observations=0, lastTick=now)


def count(s, name):
    s['errors'][name] = s['errors'].get(name, 0) + 1


def record(c, at, outcome, **evidence):
    diag = c.setdefault('diagnostics', {'counts': {}})
    counts = diag['counts']
    counts[outcome] = counts.get(outcome, 0) + 1
    diag['latest'] = dict(at=at, outcome=outcome, **evidence)


def wave(c, row, gates=None):
    price, liquidity = row['price'], row['liquidity']
    if price <= 0 or liquidity <= 0:
        return False
    # Check recovery against the prior high before recording a possible breakout.
    conditions = dict(rise=c['rose'], pullback=c['low'] <= 0.8*c['high'],
                      recovery=price >= (c['low']+c['high'])/2,
                      liquidity=liquidity >= 0.8*c['highLiquidity'])
    if gates is not None:
        gates.update(conditions)
    ready = all(conditions.values())
    if price >= c['high']:
        c.update(rose=c['rose'] or price > c['high'], high=price, low=price, highLiquidity=liquidity)
    else:
        c['low'] = min(c['low'], price)
    return ready


def trade_windows(c, rows, now):
    # Provider returns a limited recent trade page. Only join pages sharing a trade ID.
    events = {}
    for item in rows:
        a = item['attributes']
        t = int(datetime.fromisoformat(a['block_timestamp']).timestamp())
        pair = (a['from_token_address'], a['to_token_address'])
        direction = 0
        if not a.get('is_anomalous'):
            if pair == (c['quote'], c['mint']):
                direction = 1
            elif pair == (c['mint'], c['quote']):
                direction = -1
        if t <= now:
            events[item['id']] = [t, direction]
    if not events:
        return None
    prior = c.get('trades', {})
    earliest = min(v[0] for v in events.values())
    if events.keys() & prior.keys():
        earliest = min(earliest, c['coveredFrom'])
        events = {**prior, **events}
    # Keep enough evidence for the last two consecutive 15-minute intervals.
    start = now-1800
    c['coveredFrom'] = earliest
    c['trades'] = {k:v for k,v in events.items() if v[0] >= start-300}
    if earliest > start or max(v[0] for v in events.values()) < now-120:
        return None
    values = [[0, 0], [0, 0]]
    for t, direction in events.values():
        if start <= t < now and direction:
            values[int(t >= now-900)][int(direction < 0)] += 1
    return values


def bid(s, mint, qty, evidence=None):
    try:
        return spot_quote(mint, USDC, qty)
    except ERRORS as exc:
        if evidence is not None:
            evidence.update(error=type(exc).__name__, httpStatus=getattr(exc, 'code', None))
        count(s, 'missingResaleQuote')
        return None


def enter(s, c, signal, evidence=None):
    mint = c['mint']
    if min(s['cash'].values()) < SIZE+FEE:
        return 'insufficientCash'
    holder = capture(mint)
    qty = spot_quote(USDC, mint, SIZE)
    resale = bid(s, mint, qty, evidence)
    now = int(time.time())
    if qty < 2 or resale is None or resale < 19*UNIT or now-signal['at'] > 120:
        count(s, 'entryQuoteGate')
        if qty < 2:
            return 'invalidBuyQuantity'
        if resale is None:
            return 'missingResaleQuote'
        if resale < 19*UNIT:
            return 'resaleBelowMinimum'
        return 'staleSignal'
    if now >= s['start']+24*HOUR:
        return 'admissionsClosed'
    arms = {k:dict(left=qty, fills=[], pending=None, peak=None) for k in ARMS}
    s['positions'][mint] = dict(at=now, qty=qty, pool=c['pool'], signal=signal, holder=holder,
        entryBid=resale, arms=arms, marks=[], maxBid=resale, maxAt=now, expired=False)
    for k in ARMS:
        s['cash'][k] -= SIZE+FEE
    return 'entered'


def monitor(s, mint, p, now, quote):
    held = now-p['at']
    arms = p['arms']
    if held >= WINDOW:
        p['expired'] = True
    cache = {}
    def price(q):
        if q not in cache:
            cache[q] = quote(q)
        return cache[q]
    full = None if p['expired'] else price(p['qty'])
    if not p['expired'] and full is not None and full > p['maxBid']:
        p.update(maxBid=full, maxAt=now)
    cost = SIZE+FEE
    for k,a in arms.items():
        qty = a['left']
        if not qty:
            continue
        amount = price(qty)
        reason = a['pending']
        if p['expired']:
            reason = '48h'
        if reason == 'half' and amount is not None and (amount-FEE)*4 <= cost*3:
            reason = 'loss'
        if amount is not None and reason is None:
            net = amount-FEE
            if qty == p['qty']:
                if net*4 <= cost*3:
                    reason = 'loss'
                elif net*2 >= cost*3:
                    reason = 'half' if k == 'runner' else 'target'
            else:
                a['peak'] = max(a['peak'] or 0, net)
                if net*4 <= a['peak']*3:
                    reason = 'trail'
        if reason is None:
            continue
        a['pending'] = reason
        sell = qty//2 if reason == 'half' else qty
        proceeds = price(sell)
        if proceeds is None:
            continue
        s['cash'][k] += proceeds-FEE
        a['left'] -= sell
        a['pending'] = None
        a['fills'].append(dict(at=now, qty=sell, gross=proceeds, fee=FEE, reason=reason))
        if reason == 'half':
            initial = price(a['left'])
            a['peak'] = None if initial is None else initial-FEE
    p['marks'].append([now, full, [[q,b] for q,b in cache.items() if q != p['qty'] or p['expired']]])


def reconcile(s):
    for arm in ARMS:
        cash = START
        for p in s['positions'].values():
            a = p['arms'][arm]
            assert a['left'] + sum(f['qty'] for f in a['fills']) == p['qty']
            cash += sum(f['gross']-f['fee'] for f in a['fills'])-SIZE-FEE
        assert cash == s['cash'][arm] >= 0


def cycle(s):
    now = int(time.time())
    for mint,p in s['positions'].items():
        if not p['expired'] or any(a['left'] for a in p['arms'].values()):
            monitor(s, mint, p, int(time.time()), lambda q: bid(s, mint, q))
    if now < s['start']+24*HOUR and len(s['positions']) < 30:
        scan(s, now)
    s['lastTick'] = int(time.time())
    reconcile(s)


def scan(s, now):
    watch = s['candidates']
    for pool,c in list(watch.items()):
        if now-c['first'] > 6*HOUR or c['mint'] in s['positions']:
            s['retired'][pool] = dict(mint=c['mint'], first=c['first'], last=c.get('last'), samples=c['samples'])
            if 'diagnostics' in c:
                s['retired'][pool]['diagnostics'] = c['diagnostics']
            del watch[pool]
    try:
        items = get(GT+'/new_pools?page=1', 120)['data']
        s['scans'] += 1
        for item in items:
            if len(watch) >= 24:
                break
            try:
                r = snapshot(item)
                age = now-datetime.fromisoformat(r['created']).timestamp()
            except ERRORS:
                continue
            pool = r['pool']
            if (pool in watch or pool in s['retired'] or r['mint'] in s['positions'] or
                r['dex'] not in ('pump-fun','pumpswap') or r['quote'] not in (USDC,WSOL) or
                r['mint'] in (USDC,WSOL) or not 0 <= age <= HOUR or min(r['price'], r['liquidity']) <= 0):
                continue
            watch[pool] = dict(pool=pool, mint=r['mint'], quote=r['quote'], first=now, samples=0,
                               high=r['price'], low=r['price'], highLiquidity=r['liquidity'], rose=False)
    except ERRORS:
        count(s, 'discoveryUnavailable')
    if not watch:
        return
    # Pool identity is verified by snapshot; absent pools stay in the cohort.
    time.sleep(2.2)
    items = []
    pools = list(watch)
    for offset in range(0, len(pools), 12):
        if offset:
            time.sleep(2.2)
        try:
            items.extend(get(GT+'/pools/multi/'+','.join(pools[offset:offset+12]), 60)['data'])
        except ERRORS as exc:
            for pool in pools:
                record(watch[pool], now, 'snapshotBatchAborted', error=type(exc).__name__,
                       httpStatus=getattr(exc, 'code', None), failedGroup=pool in pools[offset:offset+12])
            raise
    batch_at = int(time.time())
    observed = set()
    for item in items:
        pool = str(item.get('id', '')).removeprefix('solana_') if isinstance(item, dict) else ''
        c = watch.get(pool)
        stage = 'snapshot'
        evidence = {}
        if c is not None:
            observed.add(pool)
        try:
            r = snapshot(item)
            c = watch.get(r['pool'])
            if not c:
                continue
            if (c['mint'],c['quote']) != (r['mint'],r['quote']):
                record(c, batch_at, 'poolIdentityMismatch')
                continue
            c['samples'] += 1
            s['observations'] += 1
            at = batch_at
            c['last'] = at
            before = (c['high'], min(c['low'],r['price']), c['highLiquidity'])
            gates = {}
            ready = wave(c, r, gates)
            evidence.update(ageSeconds=at-c['first'], market=gates)
            market_reason = next((k for k,v in gates.items() if not v), 'invalidMarketData')
            if not c['rose'] or at-c['first'] < 25*60 or c['mint'] in s['positions']:
                outcome = 'alreadyEntered' if c['mint'] in s['positions'] else (market_reason if not ready else 'warmingUp')
                record(c, at, outcome, **evidence)
                continue
            stage = 'trades'
            time.sleep(2.2)
            trades = get(GT+'/pools/'+r['pool']+'/trades', 60)['data']
            windows = trade_windows(c, trades, at)
            if not windows:
                count(s, 'flowWindowIncomplete')
            evidence['flowWindows'] = windows
            if not ready:
                outcome = market_reason
            elif at-c['first'] < HOUR:
                outcome = 'warmingUp'
            elif windows is None:
                outcome = 'incompleteFlow'
            elif not all(b > sell for b,sell in windows):
                outcome = 'buyImbalanceMissing'
            elif len(s['positions']) >= 30:
                outcome = 'cohortFull'
            else:
                stage = 'entry'
                outcome = enter(s,c,dict(at=at, windows=windows, price=r['price'], liquidity=r['liquidity'],
                                high=before[0], low=before[1], priorLiquidity=before[2], discovered=c['first']), evidence)
            record(c, at, outcome, **evidence)
        except ERRORS as exc:
            count(s, 'poolOrEntry'+type(exc).__name__)
            if c is not None:
                record(c, batch_at, stage+'Error', error=type(exc).__name__,
                       httpStatus=getattr(exc, 'code', None), **evidence)
    for pool in watch.keys()-observed:
        record(watch[pool], batch_at, 'poolAbsentFromSnapshot')


def tick(folder):
    folder.mkdir(parents=True, exist_ok=True)
    path = folder/'state.json'
    s = json.loads(path.read_text()) if path.exists() else fresh(int(time.time()))
    try:
        cycle(s)
    except ERRORS as exc:
        count(s,'cycle'+type(exc).__name__)
    reconcile(s)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(s, separators=(',',':'), allow_nan=False))
    os.replace(tmp,path)
    print(json.dumps(dict(scans=s['scans'], watched=len(s['candidates']), observations=s['observations'],
                          entries=len(s['positions']), cash=s['cash'], errors=s['errors'])), flush=True)


if __name__ == '__main__':
    tick(Path(sys.argv[1]))

