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
CANDIDATES=['ALGO','SAND','MANA','AXS','RUNE','SUSHI','DYDX','APE','ICP','THETA','EGLD','KAVA','CHZ','ZEC','COMP','MKR']
BENCHMARKS=['BTC','ETH','BNB','SOL','XRP']
START='2022-01'
END='2026-08'
MANDATORY_START='2023-01'
MANDATORY_END='2026-08'
OUT=os.environ.get('REVERSAL_V3_DATA_OUT','research/results/relative-value-reversal-v3-data-v1.json')
UA='ACHI-MERIDIAN-RELATIVE-VALUE-REVERSAL-V3-DATA/1'
DAY=24*60*60*1000
HOUR=60*60*1000

def month_range(a,b):
    y,m=map(int,a.split('-')); ey,em=map(int,b.split('-'))
    while y<ey or (y==ey and m<=em):
        yield f'{y:04d}-{m:02d}'
        m+=1
        if m==13:y,m=y+1,1

MONTHS=list(month_range(START,END))
MANDATORY_MONTHS=list(month_range(MANDATORY_START,MANDATORY_END))

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

def archive_url(asset,kind,ym):
    s=asset+'USDT'
    if kind=='price':
        return f'{BASE}/klines/{s}/1d/{s}-1d-{ym}.zip'
    if kind=='funding':
        return f'{BASE}/fundingRate/{s}/{s}-fundingRate-{ym}.zip'
    raise ValueError(kind)

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
    out=[];invalid=0
    for row in csv.reader(lines or []):
        if not row:continue
        if str(row[0]).strip().lower() in ('open_time','opentime','timestamp','time'):continue
        try:
            t=ts_ms(row[0]);o=float(row[1]);h=float(row[2]);l=float(row[3]);c=float(row[4])
            if not all(math.isfinite(x) and x>0 for x in (o,h,l,c)):raise ValueError('invalid')
            if h<max(o,c,l) or l>min(o,c,h):raise ValueError('ohlc')
            out.append((t,o,h,l,c))
        except Exception:
            invalid+=1
    return out,invalid

def parse_funding(lines):
    rows=list(csv.reader(lines or []));out=[];invalid=0
    if not rows:return out,0
    hdr=[x.strip() for x in rows[0]]
    if any(x in hdr for x in ('calc_time','fundingTime','last_funding_rate','fundingRate')):
        idx={k:i for i,k in enumerate(hdr)}
        ti=idx.get('calc_time',idx.get('fundingTime'))
        ri=idx.get('last_funding_rate',idx.get('fundingRate'))
        data=rows[1:]
        if ti is None or ri is None:return [],len(data) or 1
    else:
        ti,ri,data=0,2,rows
    for row in data:
        try:
            t=ts_ms(row[ti]);r=float(row[ri])
            if not math.isfinite(r):raise ValueError('invalid')
            out.append((t,r))
        except Exception:
            invalid+=1
    return out,invalid

def audit_price(asset,ym,url,lines):
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
    first=times[0] if times else None
    last=times[-1] if times else None
    if first!=s:reasons.append('START_NOT_MONTH_BOUNDARY')
    if last!=e-DAY:reasons.append('END_NOT_LAST_DAILY_SLOT')
    return {
        'asset':asset,'month':ym,'kind':'price','url':url,'pass':not reasons,'reasons':reasons,
        'rows':len(rows),'expectedRows':expected,'invalidRows':invalid,
        'firstTime':first,'lastTime':last,'exactDailyCadence':cadence
    }

def audit_funding(asset,ym,url,lines):
    s,e,_=bounds(ym)
    rows,invalid=parse_funding(lines)
    times=[x[0] for x in rows]
    reasons=[]
    duplicate=len(times)!=len(set(times))
    monotonic=all(times[i]>times[i-1] for i in range(1,len(times)))
    gaps=[]
    if times:
        gaps.append((times[0]-s)/HOUR)
        gaps.extend((times[i]-times[i-1])/HOUR for i in range(1,len(times)))
        gaps.append((e-times[-1])/HOUR)
    max_gap=max(gaps) if gaps else None
    if invalid:reasons.append('INVALID_ROWS')
    if duplicate:reasons.append('DUPLICATE_TIMESTAMP')
    if not monotonic:reasons.append('NON_MONOTONIC_TIMESTAMP')
    if len(rows)<60:reasons.append('ROWS_LT_60')
    if max_gap is None or max_gap>12:reasons.append('GAP_GT_12H')
    return {
        'asset':asset,'month':ym,'kind':'funding','url':url,'pass':not reasons,'reasons':reasons,
        'rows':len(rows),'invalidRows':invalid,'firstTime':times[0] if times else None,
        'lastTime':times[-1] if times else None,'maxGapHours':max_gap
    }

def job(args):
    asset,role,kind,ym=args
    url=archive_url(asset,kind,ym)
    status,lines,error=fetch_zip_lines(url)
    base={'asset':asset,'role':role,'month':ym,'kind':kind,'url':url}
    if status=='MISSING':
        return {**base,'transport':'MISSING','pass':False,'reasons':['MISSING_OFFICIAL_ARCHIVE'],'unexpectedError':None}
    if status=='ERROR':
        return {**base,'transport':'ERROR','pass':False,'reasons':['UNEXPECTED_TRANSPORT_ERROR'],'unexpectedError':error}
    r=audit_price(asset,ym,url,lines) if kind=='price' else audit_funding(asset,ym,url,lines)
    r['role']=role;r['transport']='OK';r['unexpectedError']=None
    return r

jobs=[]
for asset in CANDIDATES:
    for ym in MONTHS:
        jobs.append((asset,'candidate','price',ym))
        jobs.append((asset,'candidate','funding',ym))
for asset in BENCHMARKS:
    for ym in MONTHS:
        jobs.append((asset,'benchmark','price',ym))

rows=[]
with ThreadPoolExecutor(max_workers=20) as ex:
    futures={ex.submit(job,j):j for j in jobs}
    for i,f in enumerate(as_completed(futures),1):
        rows.append(f.result())
        if i%100==0 or i==len(futures):
            print(f'{i}/{len(futures)} archives',flush=True)

rows.sort(key=lambda x:(x['role'],x['asset'],x['month'],x['kind']))
unexpected=[r for r in rows if r.get('unexpectedError')]

candidate_output={}
for asset in CANDIDATES:
    monthly={}
    first_any_price=None
    for ym in MONTHS:
        p=next((r for r in rows if r['role']=='candidate' and r['asset']==asset and r['month']==ym and r['kind']=='price'),None)
        f=next((r for r in rows if r['role']=='candidate' and r['asset']==asset and r['month']==ym and r['kind']=='funding'),None)
        if p and p.get('transport')=='OK' and (p.get('rows') or 0)>0 and first_any_price is None:
            first_any_price=ym
        core=bool(p and f and p.get('pass') and f.get('pass'))
        monthly[ym]={'v3CandidateCoreComplete':core,'price':p,'funding':f}

    complete=[m for m in MONTHS if monthly[m]['v3CandidateCoreComplete']]
    mandatory_gaps=[m for m in MANDATORY_MONTHS if not monthly[m]['v3CandidateCoreComplete']]
    ready=(len(mandatory_gaps)==0 and len(MANDATORY_MONTHS)==44)
    candidate_output[asset]={
        'firstAnyPriceMonth':first_any_price,
        'firstCoreCompleteMonth':complete[0] if complete else None,
        'lastCoreCompleteMonth':complete[-1] if complete else None,
        'coreCompleteMonths':len(complete),
        'mandatoryInterval':{'start':MANDATORY_START,'end':MANDATORY_END,'months':44,'gaps':mandatory_gaps},
        'v3ReversalDataReady':ready,
        'months':monthly
    }

benchmark_output={}
for asset in BENCHMARKS:
    monthly={}
    for ym in MONTHS:
        p=next((r for r in rows if r['role']=='benchmark' and r['asset']==asset and r['month']==ym and r['kind']=='price'),None)
        monthly[ym]={'priceComplete':bool(p and p.get('pass')),'price':p}
    gaps=[m for m in MONTHS if not monthly[m]['priceComplete']]
    ready=(len(gaps)==0 and len(MONTHS)==56)
    benchmark_output[asset]={
        'completePriceMonths':sum(1 for m in MONTHS if monthly[m]['priceComplete']),
        'gaps':gaps,
        'v3MarketFactorReady':ready,
        'months':monthly
    }

ready_candidates=[a for a in CANDIDATES if candidate_output[a]['v3ReversalDataReady']]
ready_benchmarks=[a for a in BENCHMARKS if benchmark_output[a]['v3MarketFactorReady']]

reasons=[]
if len(candidate_output)!=16:reasons.append('CANDIDATE_OUTPUT_COUNT_NE_16')
if len(benchmark_output)!=5:reasons.append('BENCHMARK_OUTPUT_COUNT_NE_5')
if unexpected:reasons.append('UNEXPECTED_TRANSPORT_ERRORS')
if len(ready_candidates)<12:reasons.append('V3_REVERSAL_DATA_READY_LT_12')
if len(ready_benchmarks)!=5:reasons.append('V3_MARKET_FACTOR_READY_NE_5')

result={
    'ruleset':'RELATIVE-VALUE-REVERSAL-V3-DATA-V1-FROZEN',
    'generatedAt':datetime.now(timezone.utc).isoformat(),
    'source':BASE,
    'interval':{'start':START,'end':END,'months':MONTHS},
    'mandatoryCandidateInterval':{'start':MANDATORY_START,'end':MANDATORY_END,'months':MANDATORY_MONTHS},
    'candidateAssets':CANDIDATES,
    'benchmarkAssets':BENCHMARKS,
    'readyCandidateAssets':ready_candidates,
    'readyCandidateCount':len(ready_candidates),
    'readyBenchmarkAssets':ready_benchmarks,
    'readyBenchmarkCount':len(ready_benchmarks),
    'unexpectedTransportErrors':unexpected,
    'candidates':candidate_output,
    'benchmarks':benchmark_output,
    'gate':{'pass':not reasons,'reasons':reasons},
    'decision':'FOUNDATION_PASS' if not reasons else 'FOUNDATION_FAIL_DATA_REDESIGN',
    'strategyPnlCalculated':False,
    'reversalRanksCalculated':False,
    'betaEstimated':False,
    'residualReturnsCalculated':False,
    'portfolioWeightsCalculated':False,
    'syntheticBackfillUsed':False,
    'executionImpact':False,
    'autoPromotion':False
}

os.makedirs(os.path.dirname(OUT),exist_ok=True)
with open(OUT,'w') as f:
    json.dump(result,f,indent=2)

print(json.dumps({
    'decision':result['decision'],
    'readyCandidateCount':result['readyCandidateCount'],
    'readyCandidateAssets':result['readyCandidateAssets'],
    'readyBenchmarkCount':result['readyBenchmarkCount'],
    'readyBenchmarkAssets':result['readyBenchmarkAssets'],
    'unexpectedTransportErrors':len(unexpected),
    'gate':result['gate'],
    'strategyPnlCalculated':False,
    'reversalRanksCalculated':False,
    'betaEstimated':False,
    'residualReturnsCalculated':False,
    'portfolioWeightsCalculated':False
},indent=2))
