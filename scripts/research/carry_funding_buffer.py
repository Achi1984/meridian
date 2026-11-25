"""Summarize funding dependence for each fixed-capital two-asset period."""
import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


def summarize(rows):
    groups=defaultdict(list)
    for r in rows:
        groups[r['startMs']].append(r)
    result=[]
    for start,pair in sorted(groups.items()):
        if sorted(r['asset'] for r in pair)!=['BTC','ETH'] or pair[0]['endMs']!=pair[1]['endMs']:
            raise ValueError('incomplete paired period')
        funding=sum(r['fundingUsdt'] for r in pair)
        basis=sum(r['basisUsdt'] for r in pair)
        costs=sum(r['costUsdt'] for r in pair)
        result.append(dict(start=datetime.fromtimestamp(start/1000,timezone.utc).date().isoformat(),
                     end=datetime.fromtimestamp(pair[0]['endMs']/1000,timezone.utc).date().isoformat(),
                     netUsdt=basis+funding-costs,stressNetUsdt=basis+funding-2*costs,
                     halfFundingNetUsdt=basis+funding/2-costs,
                     fundingUsdt=funding,breakEvenFundingUsdt=costs-basis,
                     reopenNetUsdt=sum(r['reopenSameQtyNetUsdt'] for r in pair)))
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    result=summarize(json.loads(args.source.read_text())['windows'])
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(result)
