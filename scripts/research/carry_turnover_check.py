"""Post-hoc turnover diagnostic: hold the original hedge across the two rollover dates."""
import json
import sys
from pathlib import Path
from decimal import Decimal as D
from matched_spot_carry import economics

def compare(rows):
    first,last=rows[0],rows[-1]
    if any(a['endMs']!=b['startMs'] or a['asset']!=b['asset'] for a,b in zip(rows,rows[1:])):
        raise ValueError('non-contiguous windows')
    # Reverse each window's unit sizing to aggregate funding per coin held.
    weighted=sum(D(str(r['fundingUsdt']))*D(r['spotEntry'])/D(500) for r in rows)
    result=economics(D(first['spotEntry']),D(last['spotExit']),D(first['swapEntry']),D(last['swapExit']),weighted)
    result.update(resetEvery28dUsdt=sum(r['netUsdt'] for r in rows),
                  reopenSameQuantityEvery28dUsdt=float(sum(D(str(r['netUsdt']))*D(r['spotEntry'])/D(first['spotEntry']) for r in rows)))
    return result

if __name__=='__main__':
    data=json.loads(Path(sys.argv[1]).read_text())
    result={asset:compare([r for r in data['windows'] if r['asset']==asset]) for asset in ('BTC','ETH')}
    Path(sys.argv[2]).write_text(json.dumps(result,indent=2)+'\n')
    print(result)
