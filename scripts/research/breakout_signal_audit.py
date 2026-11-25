"""Measure three-hour price follow-through independently of paper account capacity."""
import argparse
import json
from collections import defaultdict
from statistics import mean, median
from pathlib import Path
from top100_paper import HOUR


def audit(observations):
    by_time = {r['slot']:r.get('signals',{}) for r in observations}
    if len(by_time) != len(observations):
        raise ValueError('duplicate slot')
    groups = defaultdict(list)
    missing = 0
    for slot, signals in sorted(by_time.items()):
        for inst, f in signals.items():
            side = f.get('side')
            if side not in (-1, 1):
                continue
            path = [by_time.get(slot+n*HOUR,{}).get(inst,{}) for n in (1,2,3)]
            if any('close' not in bar for bar in path):
                missing += 1
                continue
            ret = side * (path[-1]['close']/f['close']-1)*100
            level = f['rangeHigh'] if side==1 else f['rangeLow']
            failed = any(side*(bar['close']-level)<=0 for bar in path)
            categories = ['all', 'long' if side==1 else 'short']
            if f.get('volumeRatio') is not None:
                categories.append('volume>=1' if f['volumeRatio']>=1 else 'volume<1')
            if inst!='BTC-USDT-SWAP' and f.get('relativeToBtc24h') is not None:
                categories.append('relative aligned' if side*f['relativeToBtc24h']>0 else 'relative other')
            for group in categories:
                groups[group].append((slot,ret,failed))
    result={}
    for group,rows in groups.items():
        clusters=defaultdict(list)
        for slot,ret,_ in rows:
            clusters[slot].append(ret)
        result[group]=dict(n=len(rows),hours=len(clusters),meanPct=mean(r[1] for r in rows),
                           medianPct=median(r[1] for r in rows),positive=sum(r[1]>0 for r in rows),
                           backInsideOrBeyond=sum(r[2] for r in rows),
                           equalHourMeanPct=mean(mean(v) for v in clusters.values()))
    return dict(unresolved=missing,groups=result)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('state',type=Path)
    args=parser.parse_args()
    print(json.dumps(audit(json.loads(args.state.read_text())['observations']),indent=2))
