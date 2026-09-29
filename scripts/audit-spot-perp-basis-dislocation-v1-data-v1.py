#!/usr/bin/env python3
import csv, io, json, math, os, time, urllib.error, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

SPOT='https://data.binance.vision/data/spot/monthly'
FUT='https://data.binance.vision/data/futures/um/monthly'
ASSETS=['APT','APE','CRV','SUSHI','DYDX','LDO','GALA','IMX']
START='2024-06'
END='2026-08'
OUT=os.environ.get(
    'SPOT_PERP_BASIS_V1_DATA_V1_OUT',
    'research/results/spot-perp-basis-dislocation-v1-data-v1.json'
)
UA='ACHI-MERIDIAN-SPOT-PERP-BASIS-V1-DATA/1'
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
    if kind=='perp8h':
        return f'{FUT}/klines/{s}/8h/{s}-8h-{ym}.zip'
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
            t=ts_ms(row[ti]);rate=float(row[ri])
            if not math.isfinite(rate):raise ValueError('non-finite')
            out.append((t,rate))
        except Exception:
            invalid+=1
    return out,invalid

def audit_8h(asset,kind,ym,url,lines):
    start,end=month_bounds(ym)
    expected=(end-start)//BAR8
    rows,invalid=parse_kline(lines)
    times=[x[0] for x in rows]
    closes=[x[4] for x in rows]
    reasons=[]
    duplicate=len(times)!=len(set(times))
    strictly=all(times[i]>times[i-1] for i in range(1,len(times)))
    exact=all(times[i]-times[i-1]==BAR8 for i in range(1,len(times)))
    if invalid:reasons.append('INVALID_ROWS')
    if duplicate:reasons.append('DUPLICATE_TIMESTAMP')
    if not strictly:reasons.append('NON_MONOTONIC_TIMESTAMP')
    if not exact:reasons.append('NON_8H_CADENCE')
    if len(rows)!=expected:reasons.append('ROWS_NE_'+str(expected))
    first=times[0] if times else None
    last=times[-1] if times else None
    if first!=start:reasons.append('FIRST_TIME_NE_MONTH_START')
    if last!=end-BAR8:reasons.append('LAST_TIME_NE_FINAL_8H_OPEN')
    return{
      'asset':asset,'kind':kind,'month':ym,'url':url,'pass':not reasons,'reasons':reasons,
      'rows':len(rows),'expectedRows':expected,'invalidRows':invalid,'duplicate':duplicate,
      'strictlyIncreasing':strictly,'exact8hCadence':exact,'firstTime':first,'lastTime':last,
      '_times':times,'_closes':closes
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
    first=times[0] if times else None
    last=times[-1] if times else None
    gaps=[]
    if times:
        gaps.append((times[0]-start)/HOUR)
        gaps.extend((times[i]-times[i-1])/HOUR for i in range(1,len(times)))
        gaps.append((end-times[-1])/HOUR)
    max_gap=max(gaps) if gaps else None
    if first is None or first-start>12*HOUR:reasons.append('START_BOUNDARY')
    if last is None or end-last>12*HOUR:reasons.append('END_BOUNDARY')
    if max_gap is None or max_gap>12:reasons.append('GAP_GT_12H')
    return{
      'asset':asset,'kind':'funding','month':ym,'url':url,'pass':not reasons,'reasons':reasons,
      'rows':len(rows),'invalidRows':invalid,'duplicate':duplicate,'strictlyIncreasing':strictly,
      'firstTime':first,'lastTime':last,'maxGapHours':max_gap
    }

def audit_job(job):
    asset,kind,ym=job
    url=source_url(asset,kind,ym)
    fetched=fetch_zip_lines(url)
    if fetched['status']=='MISSING':
        return{'asset':asset,'kind':kind,'month':ym,'url':url,'pass':False,
               'reasons':['MISSING_OFFICIAL_ARCHIVE'],'transport':'MISSING','unexpectedError':None}
    if fetched['status']=='ERROR':
        return{'asset':asset,'kind':kind,'month':ym,'url':url,'pass':False,
               'reasons':['UNEXPECTED_TRANSPORT_ERROR'],'transport':'ERROR','unexpectedError':fetched['error']}
    r=audit_8h(asset,kind,ym,url,fetched['lines']) if kind in ('spot8h','perp8h') else audit_funding(asset,ym,url,fetched['lines'])
    r['transport']='OK';r['unexpectedError']=None
    return r

def public_row(row):
    return{k:v for k,v in row.items() if not k.startswith('_')}

jobs=[(a,k,ym) for a in ASSETS for ym in MONTHS for k in ('spot8h','perp8h','funding')]
rows=[]
with ThreadPoolExecutor(max_workers=18) as ex:
    futs={ex.submit(audit_job,j):j for j in jobs}
    for i,f in enumerate(as_completed(futs),1):
        rows.append(f.result())
        if i%72==0 or i==len(futs):
            print(f'{i}/{len(futs)} archives',flush=True)

rows.sort(key=lambda x:(x['asset'],x['month'],x['kind']))
unexpected=[x for x in rows if x.get('unexpectedError')]
by_asset={}

for asset in ASSETS:
    monthly={}
    for ym in MONTHS:
        parts={x['kind']:x for x in rows if x['asset']==asset and x['month']==ym}
        spot=parts.get('spot8h');perp=parts.get('perp8h');fund=parts.get('funding')
        sync_reasons=[]
        sync_pass=False
        basis_finite=False
        if spot and perp and spot.get('transport')=='OK' and perp.get('transport')=='OK':
            st=spot.get('_times',[]);pt=perp.get('_times',[])
            sc=spot.get('_closes',[]);pc=perp.get('_closes',[])
            if st!=pt:sync_reasons.append('OPEN_TIME_SET_MISMATCH')
            if len(sc)!=len(pc):sync_reasons.append('CLOSE_COUNT_MISMATCH')
            if not sync_reasons:
                basis_finite=all(math.isfinite(p/s-1.0) for s,p in zip(sc,pc) if s>0 and p>0) and len(sc)==len(pc)
                if not basis_finite:sync_reasons.append('NON_FINITE_BASIS')
            sync_pass=not sync_reasons and basis_finite
        else:
            sync_reasons.append('SYNC_INPUT_UNAVAILABLE')

        complete=(
            set(parts)=={'spot8h','perp8h','funding'} and
            bool(spot and spot.get('pass')) and
            bool(perp and perp.get('pass')) and
            bool(fund and fund.get('pass')) and
            sync_pass
        )
        monthly[ym]={
          'jointCoreComplete':complete,
          'spot8h':public_row(spot) if spot else None,
          'perp8h':public_row(perp) if perp else None,
          'funding':public_row(fund) if fund else None,
          'synchronization':{
            'pass':sync_pass,
            'reasons':sync_reasons,
            'basisFiniteAtAllRows':basis_finite
          }
        }

    complete_count=sum(1 for ym in MONTHS if monthly[ym]['jointCoreComplete'])
    asset_unexpected=[x for x in unexpected if x['asset']==asset]
    qualified=complete_count==len(MONTHS) and not asset_unexpected
    by_asset[asset]={
      'jointCoreCompleteMonths':complete_count,
      'requiredMonths':len(MONTHS),
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
  'ruleset':'SPOT-PERP-BASIS-DISLOCATION-V1-DATA-V1-FROZEN',
  'generatedAt':datetime.now(timezone.utc).isoformat(),
  'sources':{'spot':SPOT,'futures':FUT},
  'interval':{'start':'2024-06-01T00:00:00Z','endExclusive':'2026-09-01T00:00:00Z','months':MONTHS},
  'assets':ASSETS,
  'qualifiedAssets':qualified,
  'qualifiedCount':len(qualified),
  'unexpectedTransportErrors':[public_row(x) for x in unexpected],
  'byAsset':by_asset,
  'gate':{'pass':passed,'reasons':reasons},
  'decision':'FOUNDATION_PASS' if passed else 'FOUNDATION_FAIL_DATA_REDESIGN',
  'strategyPnlCalculated':False,
  'basisThresholdInferred':False,
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
  'basisThresholdInferred':False,
  'fundingThresholdInferred':False
},indent=2))
