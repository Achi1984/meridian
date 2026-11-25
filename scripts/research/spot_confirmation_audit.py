"""Two-venue breakout audit. Compare subsequent perp moves on aligned, closed UTC bars."""
import json
import argparse
from datetime import datetime,timezone
from statistics import mean
from pathlib import Path
from top100_paper import ok,get,HOUR


def candles(asset,begin,end):
    start=begin-25*HOUR
    raw=get('https://api.kraken.com/0/public/OHLC',pair=asset+'USD',interval=60,since=start)
    if raw['error']:
        raise ValueError(raw['error'])
    markets=[v for k,v in raw['result'].items() if k!='last']
    if len(markets)!=1:
        raise ValueError('ambiguous market')
    spot={int(r[0]):list(map(float,r[1:5])) for r in markets[0][:-1]}
    return spot, perp_candles(asset,start,end)


def perp_candles(asset,start,end):
    perp={}
    cursor=end*1000
    while cursor>start*1000:
        rows=ok('market/history-candles',instId=asset+'-USDT-SWAP',bar='1H',limit=100,after=cursor)
        earliest=min(int(r[0]) for r in rows)
        if earliest>=cursor:
            raise ValueError('pagination stalled')
        for row in rows:
            if row[-1]=='1':
                perp[int(row[0])//1000]=list(map(float,row[1:5]))
        cursor=earliest
    return perp


def side(bars,t):
    prior=[bars[k] for k in range(t-25*HOUR,t-HOUR,HOUR)]
    close=bars[t-HOUR][3]
    return int(close>max(b[1] for b in prior))-int(close<min(b[2] for b in prior))


def audit(spot,perp,begin,end):
    result=[]; missing=0
    for t in range(begin,end-4*HOUR,HOUR):
        try:
            s=side(perp,t)
            if not s:
                continue
            confirmation=side(spot,t)
            ret=100*s*(perp[t+4*HOUR][0]/perp[t+HOUR][0]-1)
        except KeyError:
            missing+=1
            continue
        result.append(dict(at=t,side=s,confirmed=s==confirmation,grossPct=ret))
    return result,missing


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('end',type=int)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    mid=args.end-12*24*HOUR
    begin=mid-12*24*HOUR
    records=[]; missing={}
    for asset in ('BTC','ETH'):
        spot,perp=candles(asset,begin,args.end)
        for label,start,stop in [('earlier',begin,mid),('later',mid,args.end)]:
            rows,lost=audit(spot,perp,start,stop)
            missing[asset+' '+label]=lost
            records.extend(dict(asset=asset,period=label,**r) for r in rows)
    summary={}
    for period in ('earlier','later'):
        for flag in (True,False):
            values=[r['grossPct'] for r in records if r['period']==period and r['confirmed']==flag]
            summary[f'{period} confirmed={flag}']=dict(n=len(values),meanGrossPct=mean(values) if values else None)
    args.output.write_text(json.dumps(dict(begin=begin,end=args.end,missing=missing,summary=summary,signals=records),indent=2)+'\n')
    print(summary,missing)
