#!/usr/bin/env python3
import calendar, csv, io, json, math, os, time, urllib.error, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

BASE='https://data.binance.vision/data/futures/um/monthly'
ASSETS=['ADA','DOGE','LINK','DOT','LTC','BCH','AVAX','HBAR','TRX','ETC','XLM','ATOM','UNI','AAVE','FIL','NEAR','OP','INJ','APT','CRV','LDO','GALA','IMX','ARB']
START='2022-01'
END='2026-08'
OUT=os.environ.get('REVERSAL_V1_DATA_OUT','research/results/perpetual-cross-sectional-reversal-v1-data-v1.json')
UA='ACHI-MERIDIAN-PERP-REVERSAL-V1-DATA/1'
DAY=24*60*60*1000
HOUR=60*60*1000

def month_range(a,b):
    y,m=map(int,a.split('-')); ey,em=map(int,b.split('-'))
    while y<ey or (y==ey and m<=em):
        yield f'{y:04d}-{m:02d}'
        m+=1
        if m==13:y,m=y+1,1

MONTHS=list(month_range(START,END))
MONTH_INDEX={m:i for i,m in enumerate(MONTHS)}

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

def url(asset,kind,ym):
    s=asset+'USDT'
    if kind=='price':
        return f'{BASE}/klines/{s}/1d/{s}-1d-{ym}.zip'
    if kind=='funding':
        return f'{BASE}/fundingRate/{s}/{s}-fundingRate-{ym}.zip'
    raise ValueError(kind)

def fetch_zip_lines(u):
    last=None
    for attempt in range(4):
        try:
            req=urllib.request.Request(u,headers={'User-Agent':UA,'Accept-Encoding':'identity'})
            with urllib.request.urlopen(req,timeout=75) as r:raw=r.read()
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                names=[n for n in z.namelist() if not n.endswith('/')]
                if len(names)!=1:raise RuntimeError(f'unexpected archive members={len(names)}')
                return 'OK',z.read(names[0]).decode('utf-8-sig').splitlines(),None
        except urllib.error.HTTPError as e:
            if e.code==404:return 'MISSING',None,None
            last=e
        except Exception as e:last=e
        if attempt<3:time.sleep(.6*(attempt+1))
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
        except Exception:invalid+=1
    return out,invalid

def parse_funding(lines):
    rows=list(csv.reader(lines or []));out=[];invalid=0
    if not rows:return out,0
    hdr=[x.strip() for x in rows[0]]
    if any(x in hdr for x in ('calc_time','fundingTime','last_funding_rate','fundingRate')):
        idx={k:i for i,k in enumerate(hdr)}
        ti=idx.get('calc_time',idx.get('fundingTime'));ri=idx.get('last_funding_rate',idx.get('fundingRate'))
        data=rows[1:]
        if ti is None or ri is None:return [],len(data) or 1
    else:
        ti,ri,data=0,2,rows
    for row in data:
        try:
            t=ts_ms(row[ti]);r=float(row[ri])
            if not math.isfinite(r):raise ValueError('invalid')
            out.append((t,r))
        except Exception:invalid+=1
    return out,invalid

def audit_price(asset,ym,u,lines):
    s,e,expected=bounds(ym)
    rows,invalid=parse_price(lines)
    times=[x[0] for x in rows]
    reasons=[]
    dup=len(times)!=len(set(times))
    mono=all(times[i]>times[i-1] for i in range(1,len(times)))
    cadence=all(times[i]-times[i-1]==DAY for i in range(1,len(times)))
    if invalid:reasons.append('INVALID_ROWS')
    if dup:reasons.append('DUPLICATE_TIMESTAMP')
    if not mono:reasons.append('NON_MONOTONIC_TIMESTAMP')
    if rows and not cadence:reasons.append('NON_DAILY_CADENCE')
    if len(rows)!=expected:reasons.append('ROW_COUNT_NE_CALENDAR_DAYS')
    first=times[0] if times else None; last=times[-1] if times else None
    if first!=s:reasons.append('START_NOT_MONTH_BOUNDARY')
    if last!=e-DAY:reasons.append('END_NOT_LAST_DAILY_SLOT')
    return {'asset':asset,'month':ym,'kind':'price','url':u,'pass':not reasons,'reasons':reasons,'rows':len(rows),'expectedRows':expected,'invalidRows':invalid,'firstTime':first,'lastTime':last,'exactDailyCadence':cadence}

def audit_funding(asset,ym,u,lines):
    s,e,_=bounds(ym)
    rows,invalid=parse_funding(lines)
    times=[x[0] for x in rows]
    reasons=[]
    dup=len(times)!=len(set(times))
    mono=all(times[i]>times[i-1] for i in range(1,len(times)))
    gaps=[]
    if times:
        gaps.append((times[0]-s)/HOUR)
        gaps.extend((times[i]-times[i-1])/HOUR for i in range(1,len(times)))
        gaps.append((e-times[-1])/HOUR)
    maxgap=max(gaps) if gaps else None
    if invalid:reasons.append('INVALID_ROWS')
    if dup:reasons.append('DUPLICATE_TIMESTAMP')
    if not mono:reasons.append('NON_MONOTONIC_TIMESTAMP')
    if len(rows)<60:reasons.append('ROWS_LT_60')
    if maxgap is None or maxgap>12:reasons.append('GAP_GT_12H')
    return {'asset':asset,'month':ym,'kind':'funding','url':u,'pass':not reasons,'reasons':reasons,'rows':len(rows),'invalidRows':invalid,'firstTime':times[0] if times else None,'lastTime':times[-1] if times else None,'maxGapHours':maxgap}

def job(args):
    asset,kind,ym=args;u=url(asset,kind,ym)
    status,lines,error=fetch_zip_lines(u)
    if status=='MISSING':
        return {'asset':asset,'month':ym,'kind':kind,'url':u,'transport':'MISSING','pass':False,'reasons':['MISSING_OFFICIAL_ARCHIVE'],'unexpectedError':None}
    if status=='ERROR':
        return {'asset':asset,'month':ym,'kind':kind,'url':u,'transport':'ERROR','pass':False,'reasons':['UNEXPECTED_TRANSPORT_ERROR'],'unexpectedError':error}
    r=audit_price(asset,ym,u,lines) if kind=='price' else audit_funding(asset,ym,u,lines)
    r['transport']='OK';r['unexpectedError']=None
    return r

def longest_run(complete):
    best=[];cur=[]
    for m in MONTHS:
        if complete.get(m,False):
            cur.append(m)
            if len(cur)>len(best):best=list(cur)
        else:cur=[]
    return best

def discovery_ready(complete):
    # Any 12-month consecutive core run ending no later than 2023-12,
    # followed by uninterrupted core coverage through 2024-12.
    cutoff=MONTH_INDEX['2023-12']; end2024=MONTH_INDEX['2024-12']
    for end_idx in range(11,cutoff+1):
        start_idx=end_idx-11
        if all(complete.get(MONTHS[i],False) for i in range(start_idx,end_idx+1)):
            if all(complete.get(MONTHS[i],False) for i in range(start_idx,end2024+1)):
                return True,MONTHS[start_idx],MONTHS[end_idx]
    return False,None,None

jobs=[(a,k,m) for a in ASSETS for m in MONTHS for k in ('price','funding')]
rows=[]
with ThreadPoolExecutor(max_workers=20) as ex:
    futs={ex.submit(job,j):j for j in jobs}
    for i,f in enumerate(as_completed(futs),1):
        rows.append(f.result())
        if i%100==0 or i==len(futs):print(f'{i}/{len(futs)} archives',flush=True)

rows.sort(key=lambda x:(x['asset'],x['month'],x['kind']))
unexpected=[r for r in rows if r.get('unexpectedError')]
by_asset={}

for asset in ASSETS:
    monthly={}
    first_any_price=None
    for ym in MONTHS:
        p=next((r for r in rows if r['asset']==asset and r['month']==ym and r['kind']=='price'),None)
        f=next((r for r in rows if r['asset']==asset and r['month']==ym and r['kind']=='funding'),None)
        if p and p.get('transport')=='OK' and (p.get('rows') or 0)>0 and first_any_price is None:first_any_price=ym
        core=bool(p and f and p.get('pass') and f.get('pass'))
        monthly[ym]={
          'reversalCoreCompleteV1':core,
          'price':p,
          'funding':f
        }

    complete={m:monthly[m]['reversalCoreCompleteV1'] for m in MONTHS}
    complete_months=[m for m in MONTHS if complete[m]]
    first_complete=complete_months[0] if complete_months else None
    last_complete=complete_months[-1] if complete_months else None
    run=longest_run(complete)
    internal_gaps=[]
    if first_complete:
        a=MONTH_INDEX[first_complete];b=MONTH_INDEX[last_complete]
        internal_gaps=[MONTHS[i] for i in range(a,b+1) if not complete[MONTHS[i]]]
    through_end=bool(last_complete==END and first_complete and not any(not complete[m] for m in MONTHS[MONTH_INDEX[first_complete]:]))
    trailing=[]
    for m in reversed(MONTHS):
        if complete[m]:trailing.append(m)
        else:break
    trailing=list(reversed(trailing))
    long_ready=len(trailing)>=24
    disc_ready,disc_start,disc_end=discovery_ready(complete)

    by_asset[asset]={
      'firstAnyPriceMonth':first_any_price,
      'firstCoreCompleteMonth':first_complete,
      'lastCoreCompleteMonth':last_complete,
      'coreCompleteMonths':len(complete_months),
      'longestConsecutiveCoreMonths':len(run),
      'longestRunStart':run[0] if run else None,
      'longestRunEnd':run[-1] if run else None,
      'internalCoreGaps':internal_gaps,
      'completeThrough2026_08':through_end,
      'trailingCompleteMonthsThrough2026_08':len(trailing),
      'longHistoryReady':long_ready,
      'discovery2024Ready':disc_ready,
      'discoveryReadyHistoryStart':disc_start,
      'discoveryReadyHistoryEnd':disc_end,
      'months':monthly
    }

long_ready=[a for a in ASSETS if by_asset[a]['longHistoryReady']]
disc_ready=[a for a in ASSETS if by_asset[a]['discovery2024Ready']]
reasons=[]
if len(by_asset)!=24:reasons.append('ASSET_OUTPUT_COUNT_NE_24')
if unexpected:reasons.append('UNEXPECTED_TRANSPORT_ERRORS')
if len(long_ready)<18:reasons.append('LONG_HISTORY_READY_LT_18')
if len(disc_ready)<12:reasons.append('DISCOVERY_2024_READY_LT_12')

result={
  'ruleset':'PERPETUAL-CROSS-SECTIONAL-REVERSAL-V1-DATA-V1-FROZEN',
  'generatedAt':datetime.now(timezone.utc).isoformat(),
  'source':BASE,
  'interval':{'start':'2022-01','end':'2026-08','months':MONTHS},
  'assets':ASSETS,
  'longHistoryReadyAssets':long_ready,
  'longHistoryReadyCount':len(long_ready),
  'discovery2024ReadyAssets':disc_ready,
  'discovery2024ReadyCount':len(disc_ready),
  'unexpectedTransportErrors':unexpected,
  'byAsset':by_asset,
  'gate':{'pass':not reasons,'reasons':reasons},
  'decision':'FOUNDATION_PASS' if not reasons else 'FOUNDATION_FAIL_DATA_REDESIGN',
  'strategyPnlCalculated':False,
  'reversalRanksCalculated':False,
  'volatilityConditionedReturnsCalculated':False,
  'syntheticBackfillUsed':False,
  'executionImpact':False,
  'autoPromotion':False
}

os.makedirs(os.path.dirname(OUT),exist_ok=True)
with open(OUT,'w') as f:json.dump(result,f,indent=2)

print(json.dumps({
  'decision':result['decision'],
  'longHistoryReadyCount':len(long_ready),
  'longHistoryReadyAssets':long_ready,
  'discovery2024ReadyCount':len(disc_ready),
  'discovery2024ReadyAssets':disc_ready,
  'unexpectedTransportErrors':len(unexpected),
  'gate':result['gate'],
  'strategyPnlCalculated':False,
  'reversalRanksCalculated':False
},indent=2))
