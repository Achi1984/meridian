"""Independent 28-day OKX carry diagnostic, using matched spot and swap quantities."""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from decimal import Decimal as D
from pathlib import Path
import sys
from top100_paper import ok

DAY=86400000
START=int(datetime(2026,9,1,tzinfo=timezone.utc).timestamp()*1000)
SPOT_FEE=D('.001')
SWAP_FEE=D('.0005')
SLIP=D('.0003')


def series(path,inst,bar,start,end):
    values={}
    cursor=end+1
    while cursor>start:
        rows=ok(path,instId=inst,bar=bar,after=cursor,limit=100)
        earliest=min(int(r[0]) for r in rows)
        if earliest>=cursor:
            raise ValueError('stalled pagination')
        for r in rows:
            t=int(r[0])
            if start<=t<=end and str(r[-1])=='1':
                values[t]=D(r[1])
        cursor=earliest
    return values


def economics(s0,s1,p0,p1,weighted_rates):
    qty=D(500)/s0
    basis=qty*((s1-s0)+(p0-p1))
    funding=qty*weighted_rates
    costs=qty*((s0+s1)*(SPOT_FEE+SLIP)+(p0+p1)*(SWAP_FEE+SLIP))
    return {k:float(v) for k,v in dict(basisUsdt=basis,fundingUsdt=funding,costUsdt=costs,
                netUsdt=basis+funding-costs,stressNetUsdt=basis+funding-2*costs).items()}


def collect(asset):
    end=START+84*DAY
    spot=asset+'-USDT'
    perp=spot+'-SWAP'
    s=series('market/history-candles',spot,'1Dutc',START,end)
    p=series('market/history-candles',perp,'1Dutc',START,end)
    marks=series('market/history-mark-price-candles',perp,'4H',START,end)
    windows=[]
    for i in range(3):
        t=START+i*28*DAY
        stop=t+28*DAY
        rows=ok('public/funding-rate-history',instId=perp,limit=100,after=stop+1)
        rates={int(r['fundingTime']):D(r['realizedRate']) for r in rows
               if r['instId']==perp and t<int(r['fundingTime'])<=stop}
        if set(rates)!=set(range(t+DAY//3,stop+1,DAY//3)):
            raise ValueError('incomplete or unexpected settlement schedule')
        result=economics(s[t],s[stop],p[t],p[stop],sum(marks[k]*v for k,v in rates.items()))
        windows.append(dict(asset=asset,startMs=t,endMs=stop,settlements=len(rates),
                     spotEntry=str(s[t]),spotExit=str(s[stop]),swapEntry=str(p[t]),swapExit=str(p[stop]),**result))
    return windows


if __name__=='__main__':
    with ThreadPoolExecutor(2) as pool:
        rows=[r for group in pool.map(collect,['BTC','ETH']) for r in group]
    print(rows)
    Path(sys.argv[1]).write_text(json.dumps(dict(startingCapitalPerAsset=1000,windows=rows),indent=2)+'\n')
