"""Attribute the 3% candidate veto to realized reference-account fills."""
import argparse
import json
from pathlib import Path
from meme_paper_account import FEE, UNIT


def attribute(events):
    opened = {}
    closed = []
    for row in events:
        for fill in row.get('fills',[]):
            if fill['account']!='C':
                continue
            key = fill['positionId']
            if fill['side']=='buy':
                if key in opened:
                    raise ValueError('duplicate open reference position')
                basis = fill['usdcRaw']
                resale = row.get('initialResaleRaw')
                veto = None if resale is None else (basis+2*FEE-resale)*100 > 3*basis
                opened[key] = dict(positionId=key,basis=basis,qty=fill['qty'],veto=veto)
            elif fill['side']=='sell':
                pos = opened.pop(key)
                if pos['qty']!=fill['qty']:
                    raise ValueError('unexpected partial reference close')
                closed.append(dict(positionId=key,veto=pos['veto'],
                                   netRaw=fill['usdcRaw']-pos['basis']-2*FEE))
            else:
                raise ValueError('unknown fill side')
    vetoed = [p['netRaw'] for p in closed if p['veto'] is True]
    losses = -sum(min(n,0) for n in vetoed)
    wins = sum(max(n,0) for n in vetoed)
    return dict(referenceClosed=len(closed),referenceOpen=len(opened),
                missingEntryQuoteClosed=sum(p['veto'] is None for p in closed),
                vetoedOpen=sum(p['veto'] is True for p in opened.values()),
                avoidedLosses=sum(n<0 for n in vetoed),avoidedLossUsdc=losses/UNIT,
                missedWins=sum(n>0 for n in vetoed),missedWinUsdc=wins/UNIT,
                closedVetoImpactUsdc=(losses-wins)/UNIT if any(p['veto'] is not None for p in closed) else None,
                closed=closed)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('journal',type=Path)
    args=p.parse_args()
    with args.journal.open() as stream:
        print(json.dumps(attribute(json.loads(line) for line in stream if line.strip()),indent=2))
