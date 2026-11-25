"""Describe selection concentration and one open position per instrument."""
import argparse
import json
from pathlib import Path
from statistics import mean

from top100_paper import HOUR


def summarize(rows):
    rows = sorted(rows,key=lambda r:r['signalHour'])
    if not rows:
        return {'n':0}
    available = {}
    retained = []
    for r in rows:
        asset = r['asset']
        if r['signalHour'] >= available.get(asset,0):
            retained.append(r['netPct'])
            available[asset] = r['signalHour']+3*HOUR
    values = sorted(r['netPct'] for r in rows)
    return dict(n=len(rows), distinctUtcHours=len({r['signalHour'] for r in rows}),
                profitable=sum(v>0 for v in values), meanNetPct=mean(values),
                meanWithoutBestPct=mean(values[:-1]) if len(values)>1 else None,
                nonOverlappingPerInstrument=len(retained), meanNonOverlappingPct=mean(retained))


if __name__=='__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('ledger',type=Path)
    p.add_argument('output',type=Path)
    args = p.parse_args()
    rows = json.loads(args.ledger.read_text())['signals']
    result = {f'{direction} {period}':summarize([r for r in rows if r['passed']
              and r['direction']==side and (period=='combined' or r['period']==period)])
              for direction,side in [('long',1),('short',-1)] for period in ['earlier','later','combined']}
    args.output.write_text(json.dumps(result,indent=2)+'\n')
