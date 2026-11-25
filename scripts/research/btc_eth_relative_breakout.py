"""Fixed six-hour ETH/BTC relative breakout diagnostic using closed OKX perpetual candles."""
import argparse
import json
from pathlib import Path
from statistics import mean
from top100_paper import HOUR, ok


def load_candles(inst, start, end):
    candles = {}
    cursor = end * 1000
    while cursor > start * 1000:
        rows = ok('market/history-candles', instId=inst, bar='1H', after=cursor, limit=100)
        earliest = min(int(r[0]) for r in rows)
        if earliest >= cursor:
            raise ValueError('pagination stalled')
        for row in rows:
            at = int(row[0]) // 1000
            if row[-1] == '1' and start <= at < end:
                op,cl = float(row[1]),float(row[4])
                if not (op>0 and cl>0):
                    raise ValueError('invalid price')
                candles[at] = op,cl
        cursor = earliest
    if set(candles) != set(range(start,end,HOUR)):
        raise ValueError('missing confirmed hour')
    return candles


def study(btc,eth,begin,end):
    trades=[]
    for t in range(begin,end,6*HOUR):
        ratios=[eth[s][1]/btc[s][1] for s in range(t-25*HOUR,t,HOUR)]
        sign=int(ratios[-1]>max(ratios[:-1]))-int(ratios[-1]<min(ratios[:-1]))
        if not sign:
            continue
        # Skip a full hour after confirmation. Both legs start at the same later open.
        entry=t+HOUR
        exit_at=entry+6*HOUR
        change_eth=eth[exit_at][0]/eth[entry][0]-1
        change_btc=btc[exit_at][0]/btc[entry][0]-1
        trades.append(dict(signal=t,entry=entry,exit=exit_at,long='ETH' if sign==1 else 'BTC',
                           grossPct=50*sign*(change_eth-change_btc)))
    moves=[t['grossPct'] for t in trades]
    return dict(signals=len(trades),opportunities=(end-begin)//(6*HOUR),
                positive=sum(x>0 for x in moves),meanGrossPct=mean(moves) if moves else None,
                meanAfterModeledCostsPct=mean(moves)-.3 if moves else None,trades=trades)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('end',type=int,help='exclusive six-hour UTC signal boundary')
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    if args.end%(6*HOUR):
        parser.error('unaligned UTC end')
    middle=args.end-14*24*HOUR
    begin=middle-14*24*HOUR
    a,b=[load_candles(c,begin-25*HOUR,args.end+2*HOUR) for c in ('BTC-USDT-SWAP','ETH-USDT-SWAP')]
    results=dict(start=begin,end=args.end,metric='Percent of gross two-leg notional. Equal quote notionals. Independent round trips, 5 bp fee and 10 bp slippage per side per leg, funding and observed spread unavailable.',earlier=study(a,b,begin,middle),later=study(a,b,middle,args.end))
    args.output.write_text(json.dumps(results,indent=2)+'\n')
    print([(k,{n:v for n,v in r.items() if n!='trades'}) for k,r in results.items() if isinstance(r,dict)])
