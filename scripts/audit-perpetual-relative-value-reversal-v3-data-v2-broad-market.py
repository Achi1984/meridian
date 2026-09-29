#!/usr/bin/env python3
import calendar
import csv
import io
import json
import math
import os
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

BASE='https://data.binance.vision/data/futures/um/monthly'
BENCHMARKS=['BTC','ETH','BNB','SOL','XRP']
START='2024-01'
END='2026-08'
OUT=os.environ.get('REVERSAL_V3_DATA_V2_OUT','research/results/perpetual-relative-value-reversal-v3-data-v2-broad-market.json')
UA='ACHI-MERIDIAN-REVERSAL-V3-DATA-V2/1'
DAY=24*60*60*1000

def month_range(a,b):
    y,m=map(int,a.split('-')); ey,em=map(int,b.split('-'))
    while y<ey or (y==ey and m<=em):
        yield f'{y:04d}-{m:02d}'
        m+=1
        if m==13:y,m=y+1,1

MONTHS=list(month_range(START,END))

def bounds(ym):
    y,m=map(int,ym.split('-'))
    s=int(datetime(y,m,1,tzinfo=timezone.utc).timestamp()*1000)
    if m==12:y2,m2=y+1,1
    else:y2,m2=y,m+1
    e=int(datetime(y2,m2,1,tzinfo=timezone.utc).timestamp()*1000)
    return s,e,calendar.monthrange(y,m)[1]

def ts_ms(v):
    x=int(float(v))
    while x>10**14:x//=1000
    return x

def archive_url(asset,ym):
    symbol=asset+'USDT'
    return f'{BASE}/klines/{symbol}/1d/{symbol}-1d-{ym}.zip'

def fetch_zip_lines(url):
    last=None
    for attempt in range(4):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Encoding':'identity'})
            with urllib.request.urlopen(req,timeout=75) as r:
                raw=r.read()
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                names=[n for n in z.namelist() if not n.endswith('/')]
                if len(names)!=1:
                    raise RuntimeError(f'unexpected archive members={len(names)}')
                return 'OK',z.read(names[0]).decode('utf-8-sig').splitlines(),None
        except urllib.error.HTTPError as e:
            if e.code==404:
                return 'MISSING',None,None
            last=e
        except Exception as e:
            last=e
        if attempt<3:
            time.sleep(.6*(attempt+1))
    return 'ERROR',None,type(last).__name__+':'+str(last)

def parse_price(lines):
    rows=[]; invalid=0
    for row in csv.reader(lines or []):
        if not row:continue
        if str(row[0]).strip().lower() in ('open_time','opentime','timestamp','time'):continue
        try:
            t=ts_ms(row[0]);o=float(row[1]);h=float(row[2]);l=float(row[3]);c=float(row[4])
            if not all(math.isfinite(x) and x>0 for x in (o,h,l,c)):raise ValueError('invalid')
            if h<max(o,c,l) or l>min(o,c,h):raise ValueError('ohlc')
            rows.append((t,o,h,l,c))
        except Exception:
            invalid+=1
    return rows,invalid

def audit(asset,ym):
    url=archive_url(asset,ym)
    status,lines,error=fetch_zip_lines(url)
    if status=='MISSING':
        return {'asset':asset,'month':ym,'url':url,'transport':'MISSING','pass':False,'reasons':['MISSING_OFFICIAL_ARCHIVE'],'unexpectedError':None}
    if status=='ERROR':
        return {'asset':asset,'month':ym,'url':url,'transport':'ERROR','pass':False,'reasons':['UNEXPECTED_TRANSPORT_ERROR'],'unexpectedError':error}

    s,e,expected=bounds(ym)
    rows,invalid=parse_price(lines)
    times=[x[0] for x in rows]
    reasons=[]
    duplicate=len(times)!=len(set(times))
    monotonic=all(times[i]>times[i-1] for i in range(1,len(times)))
    cadence=all(times[i]-times[i-1]==DAY for i in range(1,len(times)))
    if invalid:reasons.append('INVALID_ROWS')
    if duplicate:reasons.append('DUPLICATE_TIMESTAMP')
    if not monotonic:reasons.append('NON_MONOTONIC_TIMESTAMP')
    if rows and not cadence:reasons.append('NON_DAILY_CADENCE')
    if len(rows)!=expected:reasons.append('ROW_COUNT_NE_CALENDAR_DAYS')
    if not times or times[0]!=s:reasons.append('START_NOT_MONTH_BOUNDARY')
    if not times or times[-1]!=e-DAY:reasons.append('END_NOT_LAST_DAILY_SLOT')
    return {
        'asset':asset,'month':ym,'url':url,'transport':'OK','pass':not reasons,'reasons':reasons,
        'rows':len(rows),'expectedRows':expected,'invalidRows':invalid,
        'firstTime':times[0] if times else None,'lastTime':times[-1] if times else None,
        'exactDailyCadence':cadence,'unexpectedError':None
    }

jobs=[(a,m) for a in BENCHMARKS for m in MONTHS]
rows=[]
with ThreadPoolExecutor(max_workers=16) as ex:
    futs={ex.submit(audit,a,m):(a,m) for a,m in jobs}
    for i,f in enumerate(as_completed(futs),1):
        rows.append(f.result())
        if i%40==0 or i==len(futs):
            print(f'{i}/{len(futs)} benchmark archives',flush=True)

rows.sort(key=lambda x:(x['asset'],x['month']))
unexpected=[r for r in rows if r.get('unexpectedError')]
by_asset={}
for asset in BENCHMARKS:
    asset_rows=[r for r in rows if r['asset']==asset]
    complete=[r['month'] for r in asset_rows if r.get('pass')]
    failed=[r['month'] for r in asset_rows if not r.get('pass')]
    asset_errors=[r for r in asset_rows if r.get('unexpectedError')]
    by_asset[asset]={
        'completeMonths':len(complete),
        'requiredMonths':len(MONTHS),
        'failedMonths':failed,
        'unexpectedErrors':asset_errors,
        'v3BroadMarketBenchmarkReady':len(complete)==len(MONTHS) and not asset_errors,
        'months':{r['month']:r for r in asset_rows}
    }

ready=[a for a in BENCHMARKS if by_asset[a]['v3BroadMarketBenchmarkReady']]
reasons=[]
if len(by_asset)!=5:reasons.append('BENCHMARK_OUTPUT_COUNT_NE_5')
if unexpected:reasons.append('UNEXPECTED_TRANSPORT_ERRORS')
if len(ready)!=5:reasons.append('BROAD_MARKET_BENCHMARK_READY_NE_5')

result={
    'ruleset':'PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-DATA-V2-BROAD-MARKET-FROZEN',
    'generatedAt':datetime.now(timezone.utc).isoformat(),
    'parentFoundation':'PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-DATA-V1-FROZEN',
    'parentFoundationDecision':'FOUNDATION_PASS',
    'inheritedCandidateUniverseChanged':False,
    'inheritedCandidateQualificationChanged':False,
    'source':BASE,
    'interval':{'start':START,'end':END,'months':MONTHS},
    'benchmarkAssets':BENCHMARKS,
    'readyBenchmarkAssets':ready,
    'readyBenchmarkCount':len(ready),
    'unexpectedTransportErrors':unexpected,
    'byAsset':by_asset,
    'gate':{'pass':not reasons,'reasons':reasons},
    'decision':'FOUNDATION_PASS_BROAD_MARKET_BENCHMARK' if not reasons else 'FOUNDATION_FAIL_BROAD_MARKET_DATA_REDESIGN',
    'marketFactorReturnCalculated':False,
    'betaCalculated':False,
    'residualReturnsCalculated':False,
    'reversalRanksCalculated':False,
    'portfolioWeightsCalculated':False,
    'strategyPnlCalculated':False,
    'syntheticBackfillUsed':False,
    'executionImpact':False,
    'autoPromotion':False
}

os.makedirs(os.path.dirname(OUT),exist_ok=True)
with open(OUT,'w') as f:
    json.dump(result,f,indent=2)

print(json.dumps({
    'decision':result['decision'],
    'readyBenchmarkCount':result['readyBenchmarkCount'],
    'readyBenchmarkAssets':result['readyBenchmarkAssets'],
    'failedBenchmarkAssets':[a for a in BENCHMARKS if a not in ready],
    'unexpectedTransportErrors':len(unexpected),
    'gate':result['gate'],
    'marketFactorReturnCalculated':False,
    'betaCalculated':False,
    'residualReturnsCalculated':False,
    'reversalRanksCalculated':False,
    'portfolioWeightsCalculated':False,
    'strategyPnlCalculated':False
},indent=2))
