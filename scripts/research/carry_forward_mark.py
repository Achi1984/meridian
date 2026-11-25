"""Mark a fixed research basket at observed OKX exit-side books and realized funding."""
import json
import sys
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal as D
from top100_paper import ok
from matched_spot_carry import SPOT_FEE, SWAP_FEE, SLIP, DAY, series


def exit_price(levels, size, bids):
    """Walk the observed book up to the frozen position size."""
    remaining=size
    value=D(0)
    previous=None
    if size<=0:
        raise ValueError('nonpositive size')
    for level in levels:
        price,amount=map(D,level[:2])
        if (not price.is_finite() or not amount.is_finite() or price<=0 or amount<=0
                or (previous is not None and (price>=previous if bids else price<=previous))):
            raise ValueError('invalid exit book')
        used=min(remaining,amount)
        value+=used*price
        remaining-=used
        if remaining==0:
            return value/size
        previous=price
    raise ValueError('insufficient exit-side depth')


def threshold(basis, funding, fees, slip, notional, at, due):
    net=basis+funding-fees-slip
    shortfall=max(D(0),-net)
    remaining=max(0,due//(DAY//3)-at//(DAY//3))
    required=10000*shortfall/(remaining*notional) if remaining else None
    return dict(basisUsdt=str(basis),feeUsdt=str(fees),slippageUsdt=str(slip),
                fundingUsdt=str(funding),costUsdt=str(fees+slip),netUsdt=str(net),
                fundingStillNeededUsdt=str(shortfall),remainingScheduledSettlements=remaining,
                requiredMeanFundingBps=None if required is None else str(required),
                netAtDoubleSlippageUsdt=str(net-slip),netAtDoubleCostsUsdt=str(net-fees-slip))


def mark(r):
    legs=(r['spotInst'],r['swapInst'])
    with ThreadPoolExecutor(2) as workers:
        a,b=workers.map(lambda inst:ok('market/books',instId=inst,sz=20)[0],legs)
    times=[int(q['ts']) for q in (a,b)]
    now=time.time()*1000
    if max(times)-min(times)>2000 or any(not 0<=now-t<10000 for t in times):
        raise ValueError('stale or unpaired exit quote')
    qty=D(r['qty'])
    s=exit_price(a['bids'],qty,True)
    p=exit_price(b['asks'],D(r['contracts']),False)
    start=r['perpTs']
    stop=times[1]
    cursor=stop+1
    funding={}
    while cursor>start:
        page=ok('public/funding-rate-history',instId=legs[1],after=cursor,limit=100)
        earliest=min(int(x['fundingTime']) for x in page)
        if earliest>=cursor:
            raise ValueError('non-advancing funding page')
        funding.update({int(x['fundingTime']):D(x['realizedRate']) for x in page
                        if start<int(x['fundingTime'])<=stop and x['instId']==legs[1]})
        cursor=earliest
    # BTC/ETH pilot assumes eight-hour settlements. Fail visibly on cadence changes.
    cadence=DAY//3
    if set(funding)!=set(range((start//cadence+1)*cadence,stop+1,cadence)):
        raise ValueError('incomplete or changed funding cadence')
    weighted=D(0)
    if funding:
        marks=series('market/history-mark-price-candles',legs[1],'4H',min(funding),max(funding))
        weighted=sum(marks[t]*rate for t,rate in funding.items())
    s0,p0=D(r['spotAsk']),D(r['perpBid'])
    basis=qty*(s-s0+p0-p)
    fees=qty*((s+s0)*SPOT_FEE+(p+p0)*SWAP_FEE)
    slip=qty*(s+s0+p+p0)*SLIP
    return dict(asset=r['asset'],spotTs=times[0],swapTs=stop,spotBid=str(s),swapAsk=str(p),
                spotBestBid=a['bids'][0][0],swapBestAsk=b['asks'][0][0],
                settlements=len(funding),secondsFromDue=(max(times)-r['exitDueMs'])/1000,
                **threshold(basis,qty*weighted,fees,slip,qty*p,stop,r['exitDueMs']))



if __name__=='__main__':
    entries=json.loads(Path(sys.argv[1]).read_text())['records']
    with ThreadPoolExecutor(2) as workers:
        rows=list(workers.map(mark,entries))
    with Path(sys.argv[2]).open('x') as stream:
        json.dump(rows,stream,indent=2)
        stream.write('\n')
    print(rows)
