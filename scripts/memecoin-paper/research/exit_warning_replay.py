"""Replay a fixed 10% loss warning; act only at the next observed full-size quote."""
import argparse
import json
from pathlib import Path

from meme_paper_account import FEE, UNIT


def replay(events):
    active = {}
    closed = []
    for r in events:
        key = r.get('positionId')
        for f in r['fills']:
            if f['account']=='C' and f['side']=='buy':
                active[f['positionId']] = dict(positionId=f['positionId'],qty=f['qty'],
                                               basisRaw=f['usdcRaw']+2*FEE,entryAt=r['at'],missing=0)
        if key in active:
            p = active[key]
            if r['event']=='missingExitQuote' and r.get('qty')==p['qty']:
                p['missing']+=1
            if r['event']=='resaleMark' and r.get('qty')==p['qty']:
                net=r['usdcRaw']-p['basisRaw']
                if 'warningAt' not in p and net<=-(p['basisRaw']-2*FEE)//10:
                    p.update(warningAt=r['at'],signalNetRaw=net)
                elif 'warningAt' in p and r['at']>p['warningAt'] and 'nextNetRaw' not in p:
                    p.update(nextNetRaw=net,nextAt=r['at'])
        for f in r['fills']:
            if f['account']=='C' and f['side']=='sell':
                p=active.pop(f['positionId'])
                if p['qty']!=f['qty']:
                    raise ValueError('partial reference sale')
                baseline=f['usdcRaw']-p['basisRaw']
                alternative=p.get('nextNetRaw',baseline)
                p.update(baselineRaw=baseline,deltaUsdc=(alternative-baseline)/UNIT)
                closed.append(p)
    return dict(closed=closed,open=list(active.values()),netChangeUsdc=sum(r['deltaUsdc'] for r in closed))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('journal',type=Path)
    args=p.parse_args()
    with args.journal.open() as stream:
        print(json.dumps(replay(json.loads(l) for l in stream),indent=2))
