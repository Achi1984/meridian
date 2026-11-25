"""Four consecutive prior 84-day periods with fixed notionals, fees and holding rules."""
import argparse
import csv
import hashlib
import io
import json
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from decimal import Decimal as D
from pathlib import Path
from urllib.request import urlopen

from matched_spot_carry import DAY, START, economics, series
from top100_paper import ok


def archive_month(job):
    asset,month=job
    inst=asset+'-USDT-SWAP'
    ts=int(datetime.fromisoformat(month+'-01T00:00:00+08:00').timestamp()*1000)
    page=ok('public/market-data-history',module=3,instType='SWAP',dateAggrType='monthly',
            begin=ts,end=ts,instFamilyList=asset+'-USDT')
    filename=f'{inst}-fundingrates-{month}.zip'
    urls={f['url'] for p in page for detail in p['details'] for f in detail['groupDetails']
          if f['filename']==filename}
    if len(urls)!=1:
        raise ValueError('missing or ambiguous archive '+filename)
    with urlopen(urls.pop(),timeout=35) as response:
        raw=response.read()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        if len(z.namelist())!=1:
            raise ValueError('unexpected archive members')
        with z.open(z.namelist()[0]) as stream:
            rates={}
            for r in csv.DictReader(io.TextIOWrapper(stream,encoding='utf-8-sig')):
                t=int(r['funding_time'])
                rate=D(r['funding_rate'])
                if r['instrument_name']!=inst or t in rates or not rate.is_finite():
                    raise ValueError('unexpected funding row')
                rates[t]=rate
    return asset,filename,hashlib.sha256(raw).hexdigest(),rates


def evaluate(job):
    asset,start,rates=job
    end=start+84*DAY
    spot=asset+'-USDT'
    swap=spot+'-SWAP'
    s=series('market/history-candles',spot,'1Dutc',start,end)
    p=series('market/history-candles',swap,'1Dutc',start,end)
    marks=series('market/history-mark-price-candles',swap,'4H',start,end)
    ticks={t:v for t,v in rates.items() if start<t<=end}
    if set(ticks)!=set(range(start+DAY//3,end+1,DAY//3)):
        raise ValueError('missing or changed settlement cadence')
    weighted=sum(marks[t]*r for t,r in ticks.items())
    result=economics(s[start],s[end],p[start],p[end],weighted)
    # Isolate turnover by preserving initial quantity on both sides at every rollover.
    reopen=D(0)
    for i in range(3):
        a=start+28*i*DAY
        b=a+28*DAY
        payments=sum(marks[t]*r for t,r in ticks.items() if a<t<=b)
        segment=economics(s[a],s[b],p[a],p[b],payments)
        reopen+=D(str(segment['netUsdt']))*s[a]/s[start]
    result.update(asset=asset,startMs=start,endMs=end,reopenSameQtyNetUsdt=float(reopen),
                  positiveSettlements=sum(r>0 for r in ticks.values()),settlements=len(ticks))
    return result


def run():
    starts=[START-84*i*DAY for i in range(4,0,-1)]
    local=timezone(timedelta(hours=8))
    months=sorted({datetime.fromtimestamp(t/1000,local).strftime('%Y-%m')
                   for t in range(starts[0],START+1,DAY)})
    rates={'BTC':{},'ETH':{}}
    receipts={}
    with ThreadPoolExecutor(4) as pool:
        for asset,name,digest,data in pool.map(archive_month,[(a,m) for a in rates for m in months]):
            if rates[asset].keys() & data.keys():
                raise ValueError('overlapping funding archives')
            rates[asset].update(data)
            receipts[name]=digest
        rows=list(pool.map(evaluate,[(a,t,rates[a]) for t in starts for a in rates]))
    return dict(capitalPerAssetUsdt=1000,archiveSHA256=receipts,windows=rows)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    res=run()
    args.output.write_text(json.dumps(res,indent=2)+'\n')
    print(res['windows'])
