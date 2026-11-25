"""Compare fixed single-indicator gates in two nonoverlapping signal and outcome windows."""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from statistics import mean

from top100_paper import HOUR,features,ok
from breakout_indicators import flags,indicator_values


def collect(inst,end):
    rows=ok('market/candles',instId=inst,bar='1H',after=end*1000,limit=300)
    history={int(r[0])//1000:float(r[4]) for r in rows if r[-1]=='1'}
    records=[]
    for period,offset in [('earlier',75),('recent',0)]:
        for i in range(72):
            slot=end-(offset+74-i)*HOUR
            signal=features(rows,slot)
            side=signal['side']
            if not side:
                continue
            v=indicator_values(history,slot,signal)
            ret=100*side*(history[slot+2*HOUR]/signal['close']-1)
            records.append(dict(inst=inst,period=period,slot=slot,side=side,values=v,
                                flags=flags(v,side),gross3hPct=ret))
    return records


def summarize(rows):
    groups=defaultdict(list)
    for row in rows:
        groups['baseline'].append(row)
        for key,passed in row['flags'].items():
            if passed is not None:
                groups[key+(' yes' if passed else ' no')].append(row)
    result={}
    for name,items in groups.items():
        hours=defaultdict(list)
        for r in items:
            hours[r['slot']].append(r['gross3hPct'])
        result[name]=dict(n=len(items),hours=len(hours),meanPct=mean(r['gross3hPct'] for r in items),
                          hourMeanPct=mean(mean(a) for a in hours.values()))
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('universe',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    universe=json.loads(args.universe.read_text())
    end=universe['at']//HOUR*HOUR
    with ThreadPoolExecutor(max_workers=5) as pool:
        batches=pool.map(lambda i: collect(i,end),universe['specs'])
        records=[row for batch in batches for row in batch]
    results={p:summarize([r for r in records if r['period']==p]) for p in ('earlier','recent')}
    args.output.write_text(json.dumps(dict(end=end,instruments=len(universe['specs']),results=results),indent=2)+'\n')
    print(json.dumps(results))
