"""Compare fixed 10% warning exits against account C in archived campaign ZIPs."""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path

from exit_warning_replay import replay
from meme_paper_account import FEE, SIZE, START, UNIT


def legacy_fixed(events):
    """Reconstruct the historical wave/fixed account for pre-fill journals."""
    positions={}
    cash=START
    for source in events:
        row=dict(source,fills=[])
        if source.get('arm')=='wave' and source.get('mint'):
            key=f"{source['session']}:wave:{source['mint']}"
            row['positionId']=key
            kind=row['event']
            if kind=='entry' and cash>=SIZE+FEE:
                if key in positions:
                    raise ValueError('duplicate entry')
                positions[key]=[row['qty'],0]
                cash-=SIZE+FEE
                row['fills'].append(dict(account='C',positionId=key,side='buy',qty=row['qty'],usdcRaw=SIZE))
            elif key in positions and kind in ('exit','resaleMark'):
                qty,marks=positions[key]
                if qty!=row['qty']:
                    raise ValueError('reference quantity mismatch')
                bid=row['usdcRaw']
                if kind=='exit' or (marks>0 and 10*(bid-SIZE-2*FEE)>=SIZE):
                    row['fills'].append(dict(account='C',positionId=key,side='sell',qty=qty,usdcRaw=bid))
                    cash+=bid-FEE
                    del positions[key]
                else:
                    positions[key][1]+=1
        yield row


def review(path):
    with zipfile.ZipFile(path) as archive:
        events=list(map(json.loads,archive.read('events.jsonl').splitlines()))
        status=json.loads(archive.read('status.json'))
    legacy='fills' not in events[0]
    if any(('fills' not in r)!=legacy for r in events):
        raise ValueError('mixed journal formats')
    r=replay(legacy_fixed(events) if legacy else events)
    pnl=sum(p['baselineRaw'] for p in r['closed'])/UNIT
    account=status['accounts']['C']
    if (abs(pnl-account['realizedUsdc'])>0.0000005 or len(r['closed'])!=account['closedTrades']
            or len(r['open'])!=len(account['openPositions'])):
        raise ValueError('reference account does not reconcile')
    return dict(sourceSHA256=hashlib.sha256(path.read_bytes()).hexdigest(),stage=status['lastEvent'],
                firstAt=status['startedAt'],lastAt=status['updatedAt'],reconstructed=legacy,
                closed=len(r['closed']),open=len(r['open']),baselineUsdc=pnl,
                netChangeUsdc=r['netChangeUsdc'],positions=r['closed'])


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archives',nargs='+',type=Path)
    args=parser.parse_args()
    print(json.dumps({p.stem:review(p) for p in args.archives},indent=2))
