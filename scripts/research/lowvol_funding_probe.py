"""Check official realized funding history availability independently of canonical snapshots."""
import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from top100_paper import get

ASSETS='BTC ETH BNB SOL XRP ADA DOGE LINK DOT LTC BCH AVAX'.split()
END=int(datetime(2026,11,21,tzinfo=timezone.utc).timestamp()*1000)
START=END-7*86400000


def probe(asset, start=START, end=END):
    symbol=asset+'USDT'
    try:
        data=get('https://fapi.binance.com/fapi/v1/fundingRate',symbol=symbol,startTime=start,
                 endTime=end,limit=1000)
        observed=[(int(r['fundingTime']),r['fundingRate']) for r in data if r['symbol']==symbol]
        stamps=[t for t,_ in observed]
        if not stamps or len(stamps)!=len(data) or stamps!=sorted(set(stamps)):
            raise ValueError('empty or inconsistent funding response')
        return dict(symbol=symbol,rows=len(stamps),first=stamps[0],last=stamps[-1],
                    largestGapHours=max(b-a for a,b in zip([start]+stamps,stamps+[end]))/3600000,
                    fundingEvents=observed,sha256=sha256(json.dumps(observed,separators=(',',':')).encode()).hexdigest())
    except (ValueError,KeyError,OSError,TypeError) as e:
        return dict(symbol=symbol,error=str(e))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    parser.add_argument('--cutoff',type=datetime.fromisoformat,default=datetime.fromtimestamp(END/1000,timezone.utc))
    args=parser.parse_args()
    if args.cutoff.tzinfo is None or args.cutoff.timestamp()>datetime.now(timezone.utc).timestamp():
        parser.error('cutoff must be a past timezone-aware time')
    end=int(args.cutoff.timestamp()*1000)
    start=end-7*86400000
    with ThreadPoolExecutor(4) as workers:
        result=list(workers.map(lambda asset:probe(asset,start,end),ASSETS))
    args.output.write_text(json.dumps(dict(retrievedAt=datetime.now(timezone.utc).isoformat(),
          startMs=start,endMs=end,scope='data-access probe, separate from canonical snapshots',assets=result),indent=2)+'\n')
    print([(r['symbol'],r.get('rows'),r.get('error')) for r in result])
