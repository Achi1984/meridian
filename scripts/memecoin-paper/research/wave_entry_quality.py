"""Screen reference wave entries using two earlier resale marks and the new round trip."""
import argparse
import json
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile
from exit_warning_journal_check import legacy_fixed
from meme_paper_account import FEE, SIZE, UNIT


def cheap(proceeds):
    return 100*(SIZE+2*FEE-proceeds)<=3*SIZE


def review(events):
    early={}
    opened={}
    done=[]
    for r in events:
        t=r['at']
        key=(r.get('session'),r.get('mint'))
        kind=r['event']
        if r.get('arm')=='early':
            if kind=='entry':
                early[key]=[]
            elif kind in ('missingExitQuote','lateExitQuote','exit'):
                early.pop(key,None)
            elif kind=='resaleMark' and key in early:
                early[key]=(early[key]+[(t,r['qty'],r['usdcRaw'])])[-2:]
        for f in r['fills']:
            if f['account']=='C' and f['side']=='buy':
                marks=early.get(key,[])
                verified=(len(marks)==2 and marks[0][1]==marks[1][1] and
                          40<=marks[1][0]-marks[0][0]<=90 and 0<=t-marks[1][0]<=10)
                opened[f['positionId']]=dict(mint=key[1],time=t,qty=f['qty'],
                     persistence=all(cheap(m[2]) for m in marks) if verified else None,
                     entryCost=None)
        p=opened.get(r.get('positionId'))
        if (p and r.get('arm')=='wave' and kind=='resaleMark' and p['qty']==r['qty'] and
                p['entryCost'] is None and 0<=t-p['time']<=5):
            p['entryCost']=cheap(r['usdcRaw'])
        for f in r['fills']:
            if f['account']=='C' and f['side']=='sell':
                p=opened.pop(f['positionId'])
                p['netRaw']=f['usdcRaw']-SIZE-2*FEE
                done.append(p)
    return done,list(opened.values())


def summarize(closed,opened):
    selected=[p for p in closed if p['persistence'] and p['entryCost']]
    held=[p for p in opened if p['persistence'] and p['entryCost']]
    gains=defaultdict(int)
    for p in selected:
        gains[p['mint']]+=p['netRaw']
    net=sum(gains.values())
    return dict(referenceClosed=len(closed),earlyPersistencePassed=sum(p['persistence'] is True for p in closed),
                newRoundTripPassed=sum(p['entryCost'] is True for p in closed),referenceNet=sum(p['netRaw'] for p in closed)/UNIT,
                selectedClosed=len(selected),selectedOpen=len(held),uniqueSelectedClosed=len(gains),
                net=net/UNIT if selected else None,
                withoutBest=(net-max(gains.values()))/UNIT if gains else None,
                ifOpenWorthZero=(net-len(held)*(SIZE+FEE))/UNIT if selected or held else None,
                missingChecks=sum(p['persistence'] is None or p['entryCost'] is None for p in closed))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archives',nargs='+',type=Path)
    args=parser.parse_args()
    out={}; closed=[]; opened=[]
    for path in args.archives:
        with ZipFile(path) as z:
            rows=list(map(json.loads,z.read('events.jsonl').splitlines()))
            state=json.loads(z.read('status.json'))['accounts']['C']
        d,o=review(rows if 'fills' in rows[0] else legacy_fixed(rows))
        s=summarize(d,o)
        if s['referenceClosed']!=state['closedTrades'] or abs(s['referenceNet']-state['realizedUsdc'])>1e-6 or len(o)!=len(state['openPositions']):
            raise ValueError('reference does not reconcile')
        out[path.stem]=s
        closed+=d
        opened+=o
    out['combined']=summarize(closed,opened)
    print(json.dumps(out,indent=2))
