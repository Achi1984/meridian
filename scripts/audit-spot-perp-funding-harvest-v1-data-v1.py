#!/usr/bin/env python3
import csv, io, json, math, os, time, urllib.error, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

SPOT='https://data.binance.vision/data/spot/monthly'
FUT='https://data.binance.vision/data/futures/um/monthly'
ASSETS=['OP','INJ','WLD','SEI','TIA','PENDLE','RUNE','ICP']
START='2024-09'
END='2026-08'
OUT=os.environ.get(
    'SPOT_PERP_FUNDING_V1_DATA_OUT',
    'research/results/spot-perp-funding-harvest-v1-data-v1.json'
)
UA='ACHI-MERIDIAN-SPOT-PERP-FUNDING-V1-DATA/1'
HOUR=3600000
BAR8=8*HOUR

def month_range(a,b):
    y,m=map(int,a.split('-')); ey,em=map(int,b.split('-'))
    while y<ey or (y==ey and m<=em):
        yield f'{y:04d}-{m:02d}'
        m+=1
        if m==13:y,m=y+1,1

MONTHS=list(month_range(START,END))

def month_bounds(ym):
    y,m=map(int,ym.split('-'))
    start=int(datetime(y,m,1,tzinfo=timezone.utc).timestamp()*1000)
    if m==12:y2,m2=y+1,1
    else:y2,m2=y,m+1
    end=int(datetime(y2,m2,1,tzinfo=timezone.utc).timestamp()*1000)
    return start,end

def ts_ms(v):
    x=int(float(v))
    while x>10**14:x//=1000
    return x

def source_url(asset,kind,ym):
    s=asset+'USDT'
    if kind=='spot8h':
        return f'{SPOT}/klines/{s}/8h/{s}-8h-{ym}.zip'
    if kind=='mark8h':
        return f'{FUT}/markPriceKlines/{s}/8h/{s}-8h-{ym}.zip'
    if kind=='funding':
        return f'{FUT}/fundingRate/{s}/{s}-fundingRate-{ym}.zip'
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
                    raise RuntimeError(f'unexpected archive members: {len(names)}')
                return {'status':'OK','lines':z.read(names[0]).decode('utf-8-sig').splitlines(),'error':None}
        except urllib.error.HTTPError as e:
            if e.code==404:
                return {'status':'MISSING','lines':None,'error':None}
            last=e
        except Exception as e:
            last=e
        if attempt<3:
            time.sleep(.7*(attempt+1))
    return {'status':'ERROR','lines':None,'error':type(last).__name__+':'+str(last)}

def parse_kline(lines):
    out=[]; invalid=0
    for row in csv.reader(lines or []):
        if not row:continue
        first=str(row[0]).strip().lower()
        if first in ('open_time','opentime','timestamp','time'):
            continue
        try:
            ot=ts_ms(row[0])
            o=float(row[1]);h=float(row[2]);l=float(row[3]);c=float(row[4])
            if not all(math.isfinite(x) and x>0 for x in (o,h,l,c)):
                raise ValueError('non-finite/non-positive')
            if h<max(o,c,l) or l>min(o,c,h):
                raise ValueError('inconsistent OHLC')
            out.append((ot,o,h,l,c))
        except Exception:
            invalid+=1
    return out,invalid

def parse_funding(lines):
    rows=list(csv.reader(lines or [])); out=[]; invalid=0
    if not rows:return out,invalid
    header=[x.strip() for x in rows[0]]
    has_header=any(x in header for x in ('calc_time','fundingTime','last_funding_rate','fundingRate'))
    if has_header:
        idx={k:i for i,k in enumerate(header)}
        ti=idx.get('calc_time',idx.get('fundingTime'))
        ri=idx.get('last_funding_rate',idx.get('fundingRate'))
        data=rows[1:]
        if ti is None or ri is None:
            return [],len(data) or 1
    else:
        ti,ri,data=0,2,rows
    for row in data:
        try:
            t=ts_ms(row[ti]); rate=float(row[ri])
            if not math.isfinite(rate):raise ValueError('non-finite')
            out.append((t,rate))
        except Exception:
            invalid+=1
    return out,invalid

def audit_8h(asset,kind,ym,url,lines):
    start,end=month_bounds(ym)
    rows,invalid=parse_kline(lines)
    times=[x[0] for x in rows]
    reasons=[]
    duplicate=len(times)!=len(set(times))
    strictly=all(times[i]>times[i-1] for i in range(1,len(times)))
    exact=all(times[i]-times[i-1]==BAR8 for i in range(1,len(times)))
    if invalid:reasons.append('INVALID_ROWS')
    if duplicate:reasons.append('DUPLICATE_TIMESTAMP')
    if not strictly:reasons.append('NON_MONOTONIC_TIMESTAMP')
    if not exact:reasons.append('NON_8H_CADENCE')
    if len(rows)<84:reasons.append('ROWS_LT_84')
    first=min(times) if times else None
    last=max(times) if times else None
    if first is None or first-start>BAR8:reasons.append('START_BOUNDARY')
    if last is None or end-last>2*BAR8:reasons.append('END_BOUNDARY')
    return {
      'asset':asset,'kind':kind,'month':ym,'url':url,'pass':not reasons,'reasons':reasons,
      'rows':len(rows),'invalidRows':invalid,'duplicate':duplicate,'strictlyIncreasing':strictly,
      'exact8hCadence':exact,'firstTime':first,'lastTime':last
    }

def audit_funding(asset,ym,url,lines):
    start,end=month_bounds(ym)
    rows,invalid=parse_funding(lines)
    times=[x[0] for x in rows]
    reasons=[]
    duplicate=len(times)!=len(set(times))
    strictly=all(times[i]>times[i-1] for i in range(1,len(times)))
    if invalid:reasons.append('INVALID_ROWS')
    if duplicate:reasons.append('DUPLICATE_TIMESTAMP')
    if not strictly:reasons.append('NON_MONOTONIC_TIMESTAMP')
    if len(rows)<60:reasons.append('ROWS_LT_60')
    first=min(times) if times else None
    last=max(times) if times else None
    gaps=[]
    if times:
        gaps.append((times[0]-start)/HOUR)
        gaps.extend((times[i]-times[i-1])/HOUR for i in range(1,len(times)))
        gaps.append((end-times[-1])/HOUR)
    max_gap=max(gaps) if gaps else None
    if first is None or first-start>12*HOUR:reasons.append('START_BOUNDARY')
    if last is None or end-last>12*HOUR:reasons.append('END_BOUNDARY')
    if max_gap is None or max_gap>12:reasons.append('GAP_GT_12H')
    return {
      'asset':asset,'kind':'funding','month':ym,'url':url,'pass':not reasons,'reasons':reasons,
      'rows':len(rows),'invalidRows':invalid,'duplicate':duplicate,'strictlyIncreasing':strictly,
      'firstTime':first,'lastTime':last,'maxGapHours':max_gap
    }

def audit_job(job):
    asset,kind,ym=job
    url=source_url(asset,kind,ym)
    fetched=fetch_zip_lines(url)
    if fetched['status']=='MISSING':
        return {
          'asset':asset,'kind':kind,'month':ym,'url':url,'pass':False,
          'reasons':['MISSING_OFFICIAL_ARCHIVE'],'transport':'MISSING','unexpectedError':None
        }
    if fetched['status']=='ERROR':
        return {
          'asset':asset,'kind':kind,'month':ym,'url':url,'pass':False,
          'reasons':['UNEXPECTED_TRANSPORT_ERROR'],'transport':'ERROR','unexpectedError':fetched['error']
        }
    if kind in ('spot8h','mark8h'):
        r=audit_8h(asset,kind,ym,url,fetched['lines'])
    else:
        r=audit_funding(asset,ym,url,fetched['lines'])
    r['transport']='OK';r['unexpectedError']=None
    return r

jobs=[(a,k,ym) for a in ASSETS for ym in MONTHS for k in ('spot8h','mark8h','funding')]
rows=[]
with ThreadPoolExecutor(max_workers=18) as ex:
    futs={ex.submit(audit_job,j):j for j in jobs}
    for i,f in enumerate(as_completed(futs),1):
        rows.append(f.result())
        if i%60==0 or i==len(futs):
            print(f'{i}/{len(futs)} archives',flush=True)

rows.sort(key=lambda x:(x['asset'],x['month'],x['kind']))
unexpected=[x for x in rows if x.get('unexpectedError')]
by_asset={}
for asset in ASSETS:
    monthly={}
    for ym in MONTHS:
        parts={x['kind']:x for x in rows if x['asset']==asset and x['month']==ym}
        complete=(
            set(parts)=={'spot8h','mark8h','funding'} and
            all(parts[k].get('pass') for k in ('spot8h','mark8h','funding'))
        )
        monthly[ym]={
          'jointCoreComplete':complete,
          'spot8h':parts.get('spot8h'),
          'mark8h':parts.get('mark8h'),
          'funding':parts.get('funding')
        }
    complete_count=sum(1 for ym in MONTHS if monthly[ym]['jointCoreComplete'])
    asset_unexpected=[x for x in unexpected if x['asset']==asset]
    qualified=complete_count==24 and not asset_unexpected
    by_asset[asset]={
      'jointCoreCompleteMonths':complete_count,
      'qualified':qualified,
      'months':monthly
    }

qualified=[a for a in ASSETS if by_asset[a]['qualified']]
reasons=[]
if len(by_asset)!=8:reasons.append('ASSET_OUTPUT_COUNT_NE_8')
if unexpected:reasons.append('UNEXPECTED_TRANSPORT_ERRORS')
if len(qualified)<6:reasons.append('QUALIFIED_ASSETS_LT_6')

passed=not reasons
result={
  'ruleset':'SPOT-PERP-FUNDING-HARVEST-V1-DATA-V1-FROZEN',
  'generatedAt':datetime.now(timezone.utc).isoformat(),
  'sources':{'spot':SPOT,'futures':FUT},
  'interval':{'start':'2024-09-01T00:00:00Z','endExclusive':'2026-09-01T00:00:00Z','months':MONTHS},
  'assets':ASSETS,
  'qualifiedAssets':qualified,
  'qualifiedCount':len(qualified),
  'unexpectedTransportErrors':unexpected,
  'byAsset':by_asset,
  'gate':{'pass':passed,'reasons':reasons},
  'decision':'FOUNDATION_PASS' if passed else 'FOUNDATION_FAIL_DATA_REDESIGN',
  'strategyPnlCalculated':False,
  'fundingThresholdInferred':False,
  'syntheticBackfillUsed':False,
  'executionImpact':False,
  'autoPromotion':False
}

os.makedirs(os.path.dirname(OUT),exist_ok=True)
with open(OUT,'w') as f:json.dump(result,f,indent=2)

print(json.dumps({
  'decision':result['decision'],
  'qualifiedAssets':qualified,
  'qualifiedCount':len(qualified),
  'unexpectedTransportErrors':len(unexpected),
  'gate':result['gate'],
  'strategyPnlCalculated':False,
  'fundingThresholdInferred':False
},indent=2))
