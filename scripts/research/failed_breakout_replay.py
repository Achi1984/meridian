"""Compare reversal and continuation after a one-hour return into a frozen range."""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
import sys

from spot_confirmation_audit import perp_candles, side
from top100_paper import FEE, SLIP, HOUR, ok


def observations(bars, rates, begin, end):
    rows = []
    for t in range(begin,end-4*HOUR,HOUR):
        direction = side(bars,t)
        if not direction:
            continue
        before = [bars[k] for k in range(t-25*HOUR,t-HOUR,HOUR)]
        floor = min(b[2] for b in before)
        ceiling = max(b[1] for b in before)
        confirm = bars[t][3]
        entry, exit_at = t+HOUR, t+4*HOUR
        move = 100*direction*(bars[exit_at][0]/bars[entry][0]-1)
        funding = 100*direction*sum(r for at,r in rates.items() if entry<at<=exit_at)
        cost = float(200*(FEE+SLIP))
        immediate = 100*direction*(bars[t+3*HOUR][0]/bars[t][0]-1)
        initial_funding = 100*direction*sum(r for at,r in rates.items() if t<at<=t+3*HOUR)
        rows.append(dict(immediateNetPct=immediate-initial_funding-cost,signal=t,direction=direction,inside=floor<=confirm<=ceiling,
                         firstHourGrossPct=100*direction*(bars[entry][0]/bars[t][0]-1),
                         continuationNetPct=move-funding-cost,reversalNetPct=-move+funding-cost))
    return rows


def sample(job):
    asset,month=job
    begin=int(datetime(2026,month,1,tzinfo=timezone.utc).timestamp())
    end=begin+24*24*HOUR
    bars=perp_candles(asset,begin-25*HOUR,end)
    if any(t not in bars for t in range(begin-25*HOUR,end,HOUR)):
        raise ValueError('incomplete OKX candles')
    name=asset+'-USDT-SWAP'
    funding=ok('public/funding-rate-history',instId=name,limit=100,after=(end+24*HOUR)*1000)
    rates={int(r['fundingTime'])//1000:float(r['realizedRate']) for r in funding if r['instId']==name}
    if any(t not in rates for t in range(begin,end,8*HOUR)):
        raise ValueError('incomplete funding')
    rows=[]
    for start in (begin,begin+12*24*HOUR):
        rows.extend(observations(bars,rates,start,start+12*24*HOUR))
    return [dict(asset=asset,month=month,**r) for r in rows]


def summary(rows):
    if not rows:
        return dict(n=0)
    vals=sorted(r['reversalNetPct'] for r in rows)
    return dict(n=len(vals),distinctHours=len({r['signal'] for r in rows}),wins=sum(v>0 for v in vals),
                meanReversalNetPct=mean(vals),withoutBestPct=mean(vals[:-1]) if len(vals)>1 else None,
                meanContinuationNetPct=mean(r['continuationNetPct'] for r in rows),
                firstHourGrossPct=mean(r['firstHourGrossPct'] for r in rows))


if __name__=='__main__':
    months=(9,10,11)
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows=[r for group in pool.map(sample,[(a,m) for m in months for a in ('BTC','ETH')]) for r in group]
    stats={str(m):dict(breakouts=sum(r['month']==m for r in rows),
                       immediateNetAllPct=mean(r['immediateNetPct'] for r in rows if r['month']==m),
                       delayedNetAllPct=mean(r['continuationNetPct'] for r in rows if r['month']==m),
                       reentry=summary([r for r in rows if r['month']==m and r['inside']]))
           for m in months}
    print(stats,flush=True)
    Path(sys.argv[1]).write_text(json.dumps(dict(summary=stats,signals=rows),indent=2)+'\n')
