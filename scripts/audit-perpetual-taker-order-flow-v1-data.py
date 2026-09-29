#!/usr/bin/env python3
import calendar, csv, io, json, math, os, time, urllib.error, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

BASE='https://data.binance.vision/data/futures/um/monthly'
ASSETS=['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','LINK','DOT','LTC','BCH','AVAX']
START='2023-01'
END='2026-08'
OUT=os.environ.get('TAKER_FLOW_V1_DATA_OUT','research/results/perpetual-taker-order-flow-v1-data.json')
UA='ACHI-MERIDIAN-TAKER-FLOW-V1-DATA/1'
HOUR=60*60*1000
TOL=1e-8

def month_range(a,b):
    y,m=map(int,a.split('-'));ey,em=map(int,b.split('-'))
    while y<ey or (y==ey and m<=em):
        yield f'{y:04d}-{m:02d}'
        m+=1
        if m==13:y,m=y+1,1

MONTHS=list(month_range(START,END))

def bounds(ym):
    y,m=map(int,ym.split('-'))
    start=int(datetime(y,m,1,tzinfo=timezone.utc).timestamp()*1000)
    if m==12:y2,m2=y+1,1
    else:y2,m2=y,m+1
    end=int(datetime(y2,m2,1,tzinfo=timezone.utc).timestamp()*1000)
    return start,end,calendar.monthrange(y,m)[1]*24

def ts_ms(v):
    x=int(float(v))
    while x>10**14:x//=1000
    return x

def url(asset,kind,ym):
    s=asset+'USDT'
    if kind=='kline':
        return f'{BASE}/klines/{s}/1h/{s}-1h-{ym}.zip'
    if kind=='funding':
        return f'{BASE}/fundingRate/{s}/{s}-fundingRate-{ym}.zip'
    raise ValueError(kind)

def fetch_lines(u):
    last=None
    for attempt in range(4):
        try:
            req=urllib.request.Request(u,headers={'User-Agent':UA,'Accept-Encoding':'identity'})
            with urllib.request.urlopen(req,timeout=90) as r:raw=r.read()
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

def parse_kline(lines):
    out=[];invalid=0
    for row in csv.reader(lines or []):
        if not row:continue
        if str(row[0]).strip().lower() in ('open_time','opentime','timestamp','time'):continue
        try:
            if len(row)<11:raise ValueError('short row')
            t=ts_ms(row[0])
            o,h,l,c=map(float,row[1:5])
            vol=float(row[5]); close_t=ts_ms(row[6]); qvol=float(row[7])
            trades=float(row[8]); tb=float(row[9]); tq=float(row[10])
            vals=(o,h,l,c,vol,qvol,trades,tb,tq)
            if not all(math.isfinite(x) for x in vals):raise ValueError('nonfinite')
            if not all(x>0 for x in (o,h,l,c)):raise ValueError('ohlc')
            if h<max(o,c,l) or l>min(o,c,h):raise ValueError('ohlc-consistency')
            if min(vol,qvol,trades,tb,tq)<0:raise ValueError('negative')
            if tb>vol+max(TOL,abs(vol)*1e-10):raise ValueError('taker-base-gt-total')
            if tq>qvol+max(TOL,abs(qvol)*1e-10):raise ValueError('taker-quote-gt-total')
            out.append((t,close_t,o,h,l,c,vol,qvol,trades,tb,tq))
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
            if not math.isfinite(r):raise ValueError('nonfinite')
            out.append((t,r))
        except Exception:invalid+=1
    return out,invalid

def audit_kline(asset,ym,u,lines):
    start,end,expected=bounds(ym)
    rows,invalid=parse_kline(lines)
    times=[x[0] for x in rows]
    reasons=[]
    if invalid:reasons.append('INVALID_ROWS')
    if len(times)!=len(set(times)):reasons.append('DUPLICATE_TIMESTAMP')
    if not all(times[i]>times[i-1] for i in range(1,len(times))):reasons.append('NON_MONOTONIC_TIMESTAMP')
    if rows and not all(times[i]-times[i-1]==HOUR for i in range(1,len(times))):reasons.append('NON_HOURLY_CADENCE')
    if len(rows)!=expected:reasons.append('ROW_COUNT_NE_CALENDAR_HOURS')
    if not times or times[0]!=start:reasons.append('START_NOT_MONTH_BOUNDARY')
    if not times or times[-1]!=end-HOUR:reasons.append('END_NOT_FINAL_HOUR')
    return {'asset':asset,'month':ym,'kind':'kline1h','url':u,'pass':not reasons,
            'reasons':reasons,'rows':len(rows),'expectedRows':expected,'invalidRows':invalid,
            'firstTime':times[0] if times else None,'lastTime':times[-1] if times else None}

def audit_funding(asset,ym,u,lines):
    start,end,_=bounds(ym)
    rows,invalid=parse_funding(lines)
    times=[x[0] for x in rows]
    gaps=[]
    if times:
        gaps.append((times[0]-start)/HOUR)
        gaps += [(times[i]-times[i-1])/HOUR for i in range(1,len(times))]
        gaps.append((end-times[-1])/HOUR)
    maxgap=max(gaps) if gaps else None
    reasons=[]
    if invalid:reasons.append('INVALID_ROWS')
    if len(times)!=len(set(times)):reasons.append('DUPLICATE_TIMESTAMP')
    if not all(times[i]>times[i-1] for i in range(1,len(times))):reasons.append('NON_MONOTONIC_TIMESTAMP')
    if len(rows)<60:reasons.append('ROWS_LT_60')
    if maxgap is None or maxgap>12:reasons.append('GAP_GT_12H')
    return {'asset':asset,'month':ym,'kind':'funding','url':u,'pass':not reasons,
            'reasons':reasons,'rows':len(rows),'invalidRows':invalid,'maxGapHours':maxgap,
            'firstTime':times[0] if times else None,'lastTime':times[-1] if times else None}

def job(args):
    asset,kind,ym=args
    u=url(asset,kind,ym)
    status,lines,error=fetch_lines(u)
    if status=='MISSING':
        return {'asset':asset,'month':ym,'kind':kind,'url':u,'transport':'MISSING','pass':False,
                'reasons':['MISSING_OFFICIAL_ARCHIVE'],'unexpectedError':None}
    if status=='ERROR':
        return {'asset':asset,'month':ym,'kind':kind,'url':u,'transport':'ERROR','pass':False,
                'reasons':['UNEXPECTED_TRANSPORT_ERROR'],'unexpectedError':error}
    r=audit_kline(asset,ym,u,lines) if kind=='kline' else audit_funding(asset,ym,u,lines)
    r['transport']='OK';r['unexpectedError']=None
    return r

jobs=[(a,k,m) for a in ASSETS for m in MONTHS for k in ('kline','funding')]
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
    months={}
    for ym in MONTHS:
        k=next((r for r in rows if r['asset']==asset and r['month']==ym and r['kind']=='kline1h'),None)
        f=next((r for r in rows if r['asset']==asset and r['month']==ym and r['kind']=='funding'),None)
        core=bool(k and f and k.get('pass') and f.get('pass'))
        months[ym]={'coreComplete':core,'kline1h':k,'funding':f}
    complete=sum(1 for ym in MONTHS if months[ym]['coreComplete'])
    errs=[x for x in unexpected if x['asset']==asset]
    by_asset[asset]={
      'completeMonths':complete,'requiredMonths':len(MONTHS),
      'failedMonths':[ym for ym in MONTHS if not months[ym]['coreComplete']],
      'unexpectedErrors':errs,'qualified':complete==len(MONTHS) and not errs,
      'months':months
    }

qualified=[a for a in ASSETS if by_asset[a]['qualified']]
reasons=[]
if len(by_asset)!=12:reasons.append('ASSET_OUTPUT_COUNT_NE_12')
if unexpected:reasons.append('UNEXPECTED_TRANSPORT_ERRORS')
if len(qualified)<10:reasons.append('QUALIFIED_ASSETS_LT_10')

result={
  'ruleset':'PERPETUAL-TAKER-ORDER-FLOW-V1-DATA-FROZEN',
  'generatedAt':datetime.now(timezone.utc).isoformat(),
  'source':BASE,
  'interval':{'start':START,'end':END,'months':MONTHS},
  'candidateAssets':ASSETS,
  'qualifiedAssets':qualified,
  'qualifiedCount':len(qualified),
  'unexpectedTransportErrors':unexpected,
  'byAsset':by_asset,
  'gate':{'pass':not reasons,'reasons':reasons},
  'decision':'FOUNDATION_PASS_STRATEGY_PREREGISTRATION_ALLOWED' if not reasons else 'FOUNDATION_FAIL_DATA_REDESIGN',
  'takerImbalanceCalculated':False,
  'orderFlowScoreCalculated':False,
  'returnPredictabilityCalculated':False,
  'strategyPnlCalculated':False,
  'syntheticBackfillUsed':False,
  'executionImpact':False,
  'autoPromotion':False
}
os.makedirs(os.path.dirname(OUT),exist_ok=True)
with open(OUT,'w') as f:json.dump(result,f,indent=2)
print(json.dumps({
  'decision':result['decision'],'candidateCount':len(ASSETS),'qualifiedCount':len(qualified),
  'qualifiedAssets':qualified,'failedAssets':[a for a in ASSETS if a not in qualified],
  'unexpectedTransportErrors':len(unexpected),'gate':result['gate'],
  'takerImbalanceCalculated':False,'strategyPnlCalculated':False
},indent=2))
