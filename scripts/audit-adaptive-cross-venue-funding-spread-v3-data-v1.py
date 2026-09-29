#!/usr/bin/env python3
import concurrent.futures, json, math, os, time, urllib.error, urllib.request
from datetime import datetime, timezone

BINANCE='https://data.binance.vision/data/futures/um/monthly'
HL='https://api.hyperliquid.xyz/info'
ASSETS=['HBAR','SUI','NEAR','FIL','UNI','AAVE','ATOM','ARB']
START='2024-09'
END='2026-08'
OUT=os.environ.get('ADAPTIVE_CROSS_VENUE_V3_FOUNDATION_OUT','research/results/adaptive-cross-venue-funding-spread-v3-data-v1.json')
UA='ACHI-MERIDIAN-ADAPTIVE-CROSS-VENUE-V3-DATA/1'
HOUR=3600000

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

COMMON_START=month_bounds(START)[0]
COMMON_END=month_bounds(END)[1]

def binance_url(asset,kind,ym):
    s=asset+'USDT'
    if kind=='mark8h':
        return f'{BINANCE}/markPriceKlines/{s}/8h/{s}-8h-{ym}.zip'
    if kind=='funding':
        return f'{BINANCE}/fundingRate/{s}/{s}-fundingRate-{ym}.zip'
    raise ValueError(kind)

def probe(url):
    req=urllib.request.Request(url,method='HEAD',headers={'User-Agent':UA,'Accept-Encoding':'identity'})
    try:
        with urllib.request.urlopen(req,timeout=25) as r:
            return {'available':200<=r.status<400,'status':r.status,'bytes':int(r.headers.get('Content-Length') or 0),'method':'HEAD','error':None}
    except urllib.error.HTTPError as e:
        if e.code not in (403,405):
            return {'available':False,'status':e.code,'bytes':0,'method':'HEAD','error':None}
    except Exception as e:
        return {'available':False,'status':None,'bytes':0,'method':'HEAD','error':type(e).__name__+':'+str(e)}

    req=urllib.request.Request(url,headers={'User-Agent':UA,'Range':'bytes=0-0','Accept-Encoding':'identity'})
    try:
        with urllib.request.urlopen(req,timeout=25) as r:
            return {'available':r.status in (200,206),'status':r.status,'bytes':int(r.headers.get('Content-Length') or 0),'method':'RANGE_GET','error':None}
    except urllib.error.HTTPError as e:
        return {'available':False,'status':e.code,'bytes':0,'method':'RANGE_GET','error':None}
    except Exception as e:
        return {'available':False,'status':None,'bytes':0,'method':'RANGE_GET','error':type(e).__name__+':'+str(e)}

def audit_binance_job(job):
    asset,kind,ym=job
    url=binance_url(asset,kind,ym)
    return {'asset':asset,'kind':kind,'month':ym,'url':url,**probe(url)}

def hl_post(body):
    data=json.dumps(body,separators=(',',':')).encode()
    last=None
    for attempt in range(7):
        req=urllib.request.Request(
            HL,data=data,method='POST',
            headers={'User-Agent':UA,'Content-Type':'application/json','Accept':'application/json'}
        )
        try:
            with urllib.request.urlopen(req,timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            last=e
            if e.code!=429:raise
            time.sleep(10*(attempt+1))
        except Exception as e:
            last=e
            if attempt<6:time.sleep(2*(attempt+1))
    raise last

def audit_candles(asset):
    rows=hl_post({'type':'candleSnapshot','req':{'coin':asset,'interval':'8h','startTime':COMMON_START,'endTime':COMMON_END}})
    if not isinstance(rows,list):
        return {'pass':False,'reason':'INVALID_RESPONSE','count':0}
    times=[];invalid=0
    for x in rows:
        try:
            t=int(x.get('t')); c=float(x.get('c'))
            if not math.isfinite(c) or c<=0:
                invalid+=1;continue
            times.append(t)
        except Exception:
            invalid+=1
    duplicate=len(times)!=len(set(times))
    ordered=all(times[i]>times[i-1] for i in range(1,len(times)))
    max_gap=max(((times[i]-times[i-1])/HOUR for i in range(1,len(times))),default=None)
    first=min(times) if times else None
    last=max(times) if times else None
    ok=(
        len(times)>=2100 and invalid==0 and not duplicate and ordered and
        first is not None and first<=COMMON_START+8*HOUR and
        last is not None and last>=COMMON_END-24*HOUR and
        max_gap is not None and max_gap<=16
    )
    return {
        'pass':ok,'count':len(times),'invalidRows':invalid,'duplicate':duplicate,
        'strictlyIncreasing':ordered,'firstTime':first,'lastTime':last,'maxGapHours':max_gap,
        'source':{'endpoint':HL,'bodyType':'candleSnapshot','coin':asset,'interval':'8h','startTime':COMMON_START,'endTime':COMMON_END}
    }

def audit_full_funding(asset):
    rows=[];cursor=COMMON_START;pages=0
    while cursor<COMMON_END and pages<100:
        pages+=1
        page=hl_post({'type':'fundingHistory','coin':asset,'startTime':cursor,'endTime':COMMON_END-1})
        if not isinstance(page,list):
            return {'pass':False,'reason':'INVALID_RESPONSE','count':len(rows),'pages':pages}
        if not page:break
        rows.extend(page)
        valid_times=[]
        for x in page:
            try:valid_times.append(int(x.get('time')))
            except Exception:pass
        if not valid_times:break
        last=max(valid_times)
        if last<cursor:break
        cursor=last+1
        if len(page)<500:break
        time.sleep(2.5)

    parsed=[];invalid=0
    for x in rows:
        try:
            t=int(x.get('time')); rate=float(x.get('fundingRate'))
            if not math.isfinite(rate):
                invalid+=1;continue
            if COMMON_START<=t<COMMON_END:parsed.append((t,rate))
        except Exception:
            invalid+=1

    times=[x[0] for x in parsed]
    duplicate=len(times)!=len(set(times))
    ordered=all(times[i]>times[i-1] for i in range(1,len(times)))
    max_gap=max(((times[i]-times[i-1])/HOUR for i in range(1,len(times))),default=None)
    first=min(times) if times else None
    last=max(times) if times else None
    ok=(
        len(times)>=17000 and invalid==0 and not duplicate and ordered and
        first is not None and first-COMMON_START<=2*HOUR and
        last is not None and COMMON_END-last<=2*HOUR and
        max_gap is not None and max_gap<=2
    )
    return {
        'pass':ok,'count':len(times),'invalidRows':invalid,'duplicate':duplicate,
        'strictlyIncreasing':ordered,'firstTime':first,'lastTime':last,
        'maxGapHours':max_gap,'pages':pages,
        'source':{'endpoint':HL,'bodyType':'fundingHistory','coin':asset,'startTime':COMMON_START,'endTime':COMMON_END-1}
    }

jobs=[(a,k,ym) for a in ASSETS for ym in MONTHS for k in ('mark8h','funding')]
binance_rows=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as ex:
    futs=[ex.submit(audit_binance_job,j) for j in jobs]
    for i,f in enumerate(concurrent.futures.as_completed(futs),1):
        binance_rows.append(f.result())
        if i%80==0 or i==len(futs):print(f'binance {i}/{len(futs)}',flush=True)

meta=hl_post({'type':'meta'})
universe=meta.get('universe',[]) if isinstance(meta,dict) else []
meta_index={x.get('name'):i for i,x in enumerate(universe) if isinstance(x,dict) and x.get('name')}

by_asset={}
unexpected=[]
for idx,asset in enumerate(ASSETS,1):
    br=[x for x in binance_rows if x['asset']==asset]
    month_state={}
    for ym in MONTHS:
        rows=[x for x in br if x['month']==ym]
        complete=len(rows)==2 and all(x['available'] for x in rows)
        month_state[ym]={
            'coreComplete':complete,
            'mark8h':next((x for x in rows if x['kind']=='mark8h'),None),
            'funding':next((x for x in rows if x['kind']=='funding'),None)
        }
        for x in rows:
            if x.get('error'):unexpected.append({'asset':asset,'source':'binance','detail':x})

    listed=asset in meta_index

    if listed:
        try:
            candles=audit_candles(asset)
        except Exception as e:
            candles={'pass':False,'reason':type(e).__name__+':'+str(e),'count':0}
            unexpected.append({'asset':asset,'source':'hyperliquid_candles','error':candles['reason']})
        try:
            funding=audit_full_funding(asset)
        except Exception as e:
            funding={'pass':False,'reason':type(e).__name__+':'+str(e),'count':0}
            unexpected.append({'asset':asset,'source':'hyperliquid_full_funding','error':funding['reason']})
    else:
        candles={'pass':False,'reason':'NOT_IN_META','count':0}
        funding={'pass':False,'reason':'NOT_IN_META','count':0}

    binance_complete=sum(1 for ym in MONTHS if month_state[ym]['coreComplete'])
    candidate_unexpected=[x for x in unexpected if x.get('asset')==asset]
    qualified=(
        binance_complete==24 and listed and candles.get('pass') and funding.get('pass') and
        not candidate_unexpected
    )
    by_asset[asset]={
        'binanceCoreCompleteMonths':binance_complete,
        'binanceMonths':month_state,
        'hyperliquidMeta':{'listed':listed,'index':meta_index.get(asset),'source':{'endpoint':HL,'bodyType':'meta'}},
        'hyperliquidCandles':candles,
        'hyperliquidFullFunding':funding,
        'qualified':bool(qualified)
    }
    print(f'hyperliquid {idx}/{len(ASSETS)} {asset} qualified={qualified} funding_count={funding.get("count")}',flush=True)

qualified=[a for a in ASSETS if by_asset[a]['qualified']]
passed=(len(by_asset)==8 and not unexpected and len(qualified)>=5)
reasons=[]
if len(by_asset)!=8:reasons.append('ASSET_OUTPUT_COUNT_NE_8')
if unexpected:reasons.append('UNEXPECTED_TRANSPORT_ERRORS')
if len(qualified)<5:reasons.append('QUALIFIED_ASSETS_LT_5')

result={
    'ruleset':'ADAPTIVE-CROSS-VENUE-FUNDING-SPREAD-V3-DATA-V1-FROZEN',
    'generatedAt':datetime.now(timezone.utc).isoformat(),
    'source':{'binanceVision':BINANCE,'hyperliquidInfo':HL},
    'interval':{'start':'2024-09-01T00:00:00Z','endExclusive':'2026-09-01T00:00:00Z','months':MONTHS},
    'assets':ASSETS,
    'qualifiedAssets':qualified,
    'qualifiedCount':len(qualified),
    'unexpectedErrors':unexpected,
    'byAsset':by_asset,
    'gate':{'pass':passed,'reasons':reasons},
    'decision':'FOUNDATION_PASS' if passed else 'FOUNDATION_FAIL_DATA_REDESIGN',
    'strategyPnlCalculated':False,
    'directionInferred':False,
    'executionImpact':False,
    'autoPromotion':False
}

os.makedirs(os.path.dirname(OUT),exist_ok=True)
with open(OUT,'w') as f:json.dump(result,f,indent=2)

print(json.dumps({
    'decision':result['decision'],
    'qualifiedAssets':qualified,
    'qualifiedCount':len(qualified),
    'unexpectedErrors':len(unexpected),
    'gate':result['gate'],
    'strategyPnlCalculated':False,
    'directionInferred':False
},indent=2))
