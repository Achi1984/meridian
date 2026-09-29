#!/usr/bin/env python3
import concurrent.futures, json, os, time, urllib.error, urllib.request
from datetime import datetime, timezone

BASE='https://data.binance.vision/data/futures/um/monthly'
ASSETS=['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','LINK','DOT','LTC','BCH','AVAX','HBAR','SUI']
KINDS={
  'klines4h':('klines','4h'),
  'premium4h':('premiumIndexKlines','4h'),
  'funding':('fundingRate',None),
}
START=(2021,1)
END=(2026,8)
CUTOFF=(2025,12)
OUT=os.environ.get('PERP_FACTOR_COVERAGE_OUT','research/results/perpetual-factor-data-v1-coverage.json')
UA='ACHI-MERIDIAN-PERP-FACTOR-COVERAGE/1'

def months(start=START,end=END):
    y,m=start; ey,em=end
    out=[]
    while y<ey or (y==ey and m<=em):
        out.append((y,m))
        m+=1
        if m==13:y,m=y+1,1
    return out

def ym(t): return f'{t[0]:04d}-{t[1]:02d}'

def archive_url(asset,kind,period):
    symbol=asset+'USDT'; yms=ym(period)
    path,interval=KINDS[kind]
    if interval:
        return f'{BASE}/{path}/{symbol}/{interval}/{symbol}-{interval}-{yms}.zip'
    return f'{BASE}/{path}/{symbol}/{symbol}-{path}-{yms}.zip'

def probe_url(url):
    last=None
    for attempt in range(3):
        try:
            req=urllib.request.Request(url,method='HEAD',headers={'User-Agent':UA,'Accept-Encoding':'identity'})
            with urllib.request.urlopen(req,timeout=30) as r:
                size=r.headers.get('Content-Length')
                return {'available':True,'status':int(r.status),'bytes':int(size) if size and size.isdigit() else None,'method':'HEAD'}
        except urllib.error.HTTPError as e:
            if e.code in (404,403):
                return {'available':False,'status':int(e.code),'bytes':None,'method':'HEAD'}
            if e.code==405:
                break
            last=e
        except Exception as e:
            last=e
        time.sleep(.4*(attempt+1))
    # Fallback: minimal ranged GET if HEAD is unsupported/transient.
    for attempt in range(3):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':UA,'Range':'bytes=0-0','Accept-Encoding':'identity'})
            with urllib.request.urlopen(req,timeout=30) as r:
                cr=r.headers.get('Content-Range')
                total=None
                if cr and '/' in cr:
                    tail=cr.rsplit('/',1)[-1]
                    if tail.isdigit(): total=int(tail)
                size=r.headers.get('Content-Length')
                return {'available':True,'status':int(r.status),'bytes':total or (int(size) if size and size.isdigit() else None),'method':'RANGE_GET'}
        except urllib.error.HTTPError as e:
            if e.code in (404,403):
                return {'available':False,'status':int(e.code),'bytes':None,'method':'RANGE_GET'}
            last=e
        except Exception as e:
            last=e
        time.sleep(.8*(attempt+1))
    return {'available':False,'status':None,'bytes':None,'method':'ERROR','error':type(last).__name__+': '+str(last) if last else 'UNKNOWN'}

def audit_one(args):
    asset,kind,period=args
    url=archive_url(asset,kind,period)
    p=probe_url(url)
    return {'asset':asset,'kind':kind,'month':ym(period),'url':url,**p}

def add_month(period):
    y,m=period
    return (y+1,1) if m==12 else (y,m+1)

def first_eligible_month(core_months,all_months):
    complete=set(core_months)
    for idx,period in enumerate(all_months):
        # Decision at start of this month uses completed months strictly before it.
        prior=all_months[:idx]
        if len(prior)<24: continue
        hist=[p for p in prior if ym(p) in complete]
        recent=prior[-12:]
        if len(hist)>=24 and all(ym(p) in complete for p in recent):
            return ym(period)
    # If eligibility starts after the audited final month, expose next month.
    prior=all_months
    if len(prior)>=24 and sum(1 for p in prior if ym(p) in complete)>=24 and all(ym(p) in complete for p in prior[-12:]):
        return ym(add_month(all_months[-1]))
    return None

all_months=months()
jobs=[(a,k,p) for a in ASSETS for p in all_months for k in KINDS]
rows=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=20) as ex:
    futs=[ex.submit(audit_one,j) for j in jobs]
    for i,fut in enumerate(concurrent.futures.as_completed(futs),1):
        row=fut.result(); rows.append(row)
        if i%100==0 or i==len(jobs):
            print(f'probed {i}/{len(jobs)}',flush=True)

rows.sort(key=lambda x:(ASSETS.index(x['asset']),x['month'],x['kind']))
by_asset={}
cutoff_ym=ym(CUTOFF)
for asset in ASSETS:
    ar=[x for x in rows if x['asset']==asset]
    core=[]
    month_rows={}
    for p in all_months:
        key=ym(p)
        rs=[x for x in ar if x['month']==key]
        state={x['kind']:x['available'] for x in rs}
        complete=all(state.get(k,False) for k in KINDS)
        month_rows[key]={'coreComplete':complete,**state}
        if complete:core.append(key)
    core_to_cutoff=[x for x in core if x<=cutoff_ym]
    by_asset[asset]={
      'coreCompleteMonths':len(core),
      'coreCompleteMonthsThrough2025_12':len(core_to_cutoff),
      'firstCoreCompleteMonth':core[0] if core else None,
      'lastCoreCompleteMonth':core[-1] if core else None,
      'firstEligibleMonth24m12mContinuity':first_eligible_month(core,all_months),
      'months':month_rows
    }

qualified=[a for a,v in by_asset.items() if v['coreCompleteMonthsThrough2025_12']>=24]
accept=(by_asset['BTC']['coreCompleteMonths']>=24 and by_asset['ETH']['coreCompleteMonths']>=24 and len(qualified)>=8)
errors=[x for x in rows if x.get('method')=='ERROR']
payload={
  'generatedAt':datetime.now(timezone.utc).isoformat(),
  'source':'Binance Vision official public USD-M monthly archives',
  'auditStart':ym(START),'auditEnd':ym(END),'cutoffForBreadth':'2025-12',
  'assets':ASSETS,'requiredKinds':list(KINDS),
  'requests':len(rows),'transportErrors':len(errors),
  'qualifiedAssetsThrough2025_12':qualified,
  'qualifiedCountThrough2025_12':len(qualified),
  'foundationPass':accept and not errors,
  'foundationReasons':([] if accept else ['BTC_ETH_OR_8_ASSET_24M_GATE_FAILED'])+(['TRANSPORT_ERRORS'] if errors else []),
  'byAsset':by_asset,
  'transportErrorRows':errors
}
os.makedirs(os.path.dirname(OUT),exist_ok=True)
with open(OUT,'w') as f: json.dump(payload,f,indent=2,sort_keys=False)
print(json.dumps({
  'foundationPass':payload['foundationPass'],
  'qualifiedAssetsThrough2025_12':qualified,
  'transportErrors':len(errors),
  'eligibility':{a:by_asset[a]['firstEligibleMonth24m12mContinuity'] for a in ASSETS}
},indent=2))
