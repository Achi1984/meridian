"""Prospective full-position resale quotes and nearby pool liquidity observations."""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from buyer_persistence_pilot import pool_state, wait_until
from new_pool_watch import GT, USDC, WSOL, FEE, SIZE, get, qualifies, snapshot, spot_quote_amounts

ERRORS=(ValueError,KeyError,OSError,TypeError,IndexError)


def sample(first,born):
    pool=first['pool']
    row=dict(pool=pool,mint=first['mint'],firstLiquidityUsd=first['liquidity'],firstAt=born)
    try:
        current=pool_state(pool)
        row.update(signalAt=time.time(),signalLiquidityUsd=current['liquidity'])
        row['eligible']=qualifies(first,current,row['signalAt']-born)
        if not row['eligible']:
            return row
        _,qty=spot_quote_amounts(USDC,first['mint'],SIZE)
        row.update(qty=qty,entryAt=time.time(),marks=[])
        for minute in range(5):
            wait_until(row['entryAt']+minute*60)
            m=dict(minute=minute)
            try:
                state=pool_state(pool)
                if state['mint']!=first['mint'] or state['quote']!=first['quote']:
                    raise ValueError('pool tokens changed')
                m.update(liquidityUsd=state['liquidity'],liquidityObservedAt=time.time())
            except ERRORS as exc:
                m['liquidityError']=str(exc)
            try:
                expected,floor=spot_quote_amounts(first['mint'],USDC,qty)
                m.update(quotedAt=time.time(),expectedRaw=expected,floorRaw=floor,
                         conservativeNetUsdc=(floor-2*FEE-SIZE)/1_000_000)
            except ERRORS as exc:
                m['quoteError']=str(exc)
            row['marks'].append(m)
    except ERRORS as exc:
        row['error']=str(exc)
    return row


def shortlist(rows):
    deepest={}
    counts=dict(scanned=len(rows),supportedQuote=0,sufficientLiquidity=0,uniqueMints=0)
    for item in rows:
        p=snapshot(item)
        if p['quote'] not in (WSOL,USDC):
            continue
        counts['supportedQuote']+=1
        if p['liquidity']<10000:
            continue
        counts['sufficientLiquidity']+=1
        previous=deepest.get(p['mint'])
        if previous is None or p['liquidity']>previous['liquidity']:
            deepest[p['mint']]=p
    counts['uniqueMints']=len(deepest)
    return sorted(deepest.values(),key=lambda p:(-p['liquidity'],p['mint']))[:6],counts


def run(path):
    rows=get(GT+'/new_pools?page=1',120)['data']
    candidates,counts=shortlist(rows)
    born=time.time()
    if candidates:
        wait_until(born+75)
    with ThreadPoolExecutor(6) as workers:
        measured=list(workers.map(lambda p:sample(p,born),candidates))
    result=dict(**counts,candidates=len(candidates),eligible=sum(r.get('eligible') is True for r in measured),
                errors=sum('error' in r for r in measured),observations=measured)
    path.write_text(json.dumps(result,indent=2)+'\n')
    print({k:v for k,v in result.items() if k!='observations'})


if __name__=='__main__':
    run(Path(sys.argv[1]))
