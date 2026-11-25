"""Mark a fixed research basket at observed OKX exit-side books and realized funding."""
import json
import sys
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal as D
from top100_paper import ok
from matched_spot_carry import SPOT_FEE, SWAP_FEE, SLIP, DAY, series


def mark(r):
    legs=(r['spotInst'],r['swapInst'])
    with ThreadPoolExecutor(2) as workers:
        a,b=workers.map(lambda inst:ok('market/books',instId=inst,sz=1)[0],legs)
    times=[int(q['ts']) for q in (a,b)]
    if max(times)-min(times)>2000 or not 0<=time.time()*1000-max(times)<10000:
        raise ValueError('stale or unpaired exit quote')
    s,avail=map(D,a['bids'][0][:2])
    p,depth=map(D,b['asks'][0][:2])
    qty=D(r['qty'])
    if avail<qty or depth<D(r['contracts']):
        raise ValueError('insufficient exit-side depth')
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
    fees=qty*((s+s0)*(SPOT_FEE+SLIP)+(p+p0)*(SWAP_FEE+SLIP))
    return dict(asset=r['asset'],spotTs=times[0],swapTs=stop,spotBid=str(s),swapAsk=str(p),
                settlements=len(funding),fundingUsdt=str(qty*weighted),costUsdt=str(fees),
                netUsdt=str(basis+qty*weighted-fees),secondsFromDue=(max(times)-r['exitDueMs'])/1000)


if __name__=='__main__':
    entries=json.loads(Path(sys.argv[1]).read_text())['records']
    with ThreadPoolExecutor(2) as workers:
        rows=list(workers.map(mark,entries))
    with Path(sys.argv[2]).open('x') as stream:
        json.dump(rows,stream,indent=2)
        stream.write('\n')
    print(rows)
