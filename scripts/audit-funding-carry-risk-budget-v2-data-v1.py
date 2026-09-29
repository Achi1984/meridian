#!/usr/bin/env python3
import concurrent.futures, json, os, time, urllib.error, urllib.request
from datetime import date

BASE='https://data.binance.vision/data/futures/um/monthly'
ASSETS=['TRX','ETC','XLM','ATOM','UNI','AAVE','FIL','NEAR']
KINDS={'klines4h':('klines','4h'),'funding':('fundingRate',None)}
START=(2021,1)
END=(2026,8)
CUTOFF='2025-12'
OUT=os.environ.get('FUNDING_V2_COVERAGE_OUT','research/results/funding-carry-risk-budget-v2-data-v1-coverage.json')
UA='ACHI-MERIDIAN-FUNDING-V2-DATA/1'

def months(start=START,end=END):
    y,m=start;ey,em=end
    out=[]
    while y<ey or (y==ey and m<=em):
        out.append((y,m));m+=1
        if m==13:y,m=y+1,1
    return out

def ym(p):return f'{p[0]:04d}-{p[1]:02d}'

def add_month(p):
    y,m=p
    return (y+1,1) if m==12 else (y,m+1)

def archive_url(asset,kind,period):
    symbol=asset+'USDT'; yms=ym(period); path,interval=KINDS[kind]
    if interval:
        return f'{BASE}/{path}/{symbol}/{interval}/{symbol}-{interval}-{yms}.zip'
    return f'{BASE}/{path}/{symbol}/{symbol}-{path}-{yms}.zip'

def probe_url(url):
    unexpected=[]
    for attempt in range(3):
        try:
            req=urllib.request.Request(url,method='HEAD',headers={'User-Agent':UA,'Accept-Encoding':'identity'})
            with urllib.request.urlopen(req,timeout=30) as r:
                size=r.headers.get('Content-Length')
                return {'available':True,'status':int(r.status),'bytes':int(size) if size and size.isdigit() else None,'method':'HEAD','error':None}
        except urllib.error.HTTPError as e:
            if e.code in (403,405,429,500,502,503,504):
                unexpected.append(f'HEAD_HTTP_{e.code}')
                if e.code==429:time.sleep(1.0*(attempt+1))
                continue
            if e.code==404:
                return {'available':False,'status':404,'bytes':None,'method':'HEAD','error':None}
            unexpected.append(f'HEAD_HTTP_{e.code}')
        except Exception as e:
            unexpected.append('HEAD_'+type(e).__name__)
        time.sleep(.25*(attempt+1))

    for attempt in range(3):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':UA,'Range':'bytes=0-0','Accept-Encoding':'identity'})
            with urllib.request.urlopen(req,timeout=30) as r:
                cr=r.headers.get('Content-Range')
                size=None
                if cr and '/' in cr:
                    tail=cr.rsplit('/',1)[1]
                    if tail.isdigit():size=int(tail)
                if size is None:
                    cl=r.headers.get('Content-Length')
                    if cl and cl.isdigit():size=int(cl)
                return {'available':True,'status':int(r.status),'bytes':size,'method':'RANGE_GET','error':None}
        except urllib.error.HTTPError as e:
            if e.code==404:
                return {'available':False,'status':404,'bytes':None,'method':'RANGE_GET','error':None}
            unexpected.append(f'RANGE_HTTP_{e.code}')
            if e.code==429:time.sleep(1.0*(attempt+1))
        except Exception as e:
            unexpected.append('RANGE_'+type(e).__name__)
        time.sleep(.4*(attempt+1))
    return {'available':False,'status':None,'bytes':None,'method':'FAILED','error':'|'.join(unexpected[-6:]) or 'UNKNOWN'}

def job(args):
    asset,kind,period=args
    url=archive_url(asset,kind,period)
    return {'asset':asset,'kind':kind,'month':ym(period),'url':url,**probe_url(url)}

def first_eligible_month(core_months,all_months):
    complete=set(core_months)
    for idx,p in enumerate(all_months):
        prior=all_months[:idx]
        if len([x for x in prior if ym(x) in complete])<24:continue
        if len(prior)<12:continue
        if all(ym(x) in complete for x in prior[-12:]):
            return ym(p)
    prior=all_months
    if len([x for x in prior if ym(x) in complete])>=24 and len(prior)>=12 and all(ym(x) in complete for x in prior[-12:]):
        return ym(add_month(all_months[-1]))
    return None

all_months=months()
jobs=[(a,k,p) for a in ASSETS for p in all_months for k in KINDS]
rows=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=20) as ex:
    futs=[ex.submit(job,j) for j in jobs]
    for i,f in enumerate(concurrent.futures.as_completed(futs),1):
        rows.append(f.result())
        if i%100==0 or i==len(futs):print(f'{i}/{len(futs)} probes',flush=True)

rows.sort(key=lambda x:(ASSETS.index(x['asset']),x['month'],x['kind']))
errors=[x for x in rows if x.get('error')]
by_asset={}
for asset in ASSETS:
    ar=[x for x in rows if x['asset']==asset]
    core=[]
    month_rows={}
    for p in all_months:
        key=ym(p)
        rs=[x for x in ar if x['month']==key]
        state={x['kind']:x['available'] for x in rs}
        complete=len(rs)==len(KINDS) and all(state.get(k,False) for k in KINDS)
        month_rows[key]={'coreComplete':complete,**state}
        if complete:core.append(key)
    through=[x for x in core if x<=CUTOFF]
    by_asset[asset]={
      'coreCompleteMonths':len(core),
      'coreCompleteMonthsThrough2025_12':len(through),
      'firstCoreCompleteMonth':core[0] if core else None,
      'lastCoreCompleteMonth':core[-1] if core else None,
      'firstEligibleMonth24m12mContinuity':first_eligible_month(core,all_months),
      'months':month_rows
    }

qualified24=[a for a,v in by_asset.items() if v['coreCompleteMonthsThrough2025_12']>=24]
eligibleBy2026=[a for a,v in by_asset.items() if v['firstEligibleMonth24m12mContinuity'] and v['firstEligibleMonth24m12mContinuity']<='2026-01']
accept=(len(by_asset)==8 and not errors and len(qualified24)>=6 and len(eligibleBy2026)>=6)
reasons=[]
if len(by_asset)!=8:reasons.append('ASSET_OUTPUT_COUNT_NE_8')
if errors:reasons.append('TRANSPORT_ERRORS')
if len(qualified24)<6:reasons.append('QUALIFIED_24M_LT_6')
if len(eligibleBy2026)<6:reasons.append('ELIGIBLE_BY_2026_01_LT_6')

payload={
  'ruleset':'FUNDING-CARRY-RISK-BUDGET-V2-DATA-V1-FROZEN',
  'generatedAt':date.today().isoformat(),
  'source':'Binance Vision official public USD-M monthly archives',
  'auditWindow':{'start':ym(all_months[0]),'end':ym(all_months[-1])},
  'assets':ASSETS,
  'requiredKinds':list(KINDS),
  'requests':len(rows),
  'transportErrors':len(errors),
  'qualifiedAssetsThrough2025_12':qualified24,
  'eligibleAssetsBy2026_01':eligibleBy2026,
  'foundationPass':accept,
  'foundationReasons':reasons,
  'byAsset':by_asset,
  'rows':rows,
  'researchOnly':True,
  'executionImpact':False,
  'strategyPnlCalculated':False
}
os.makedirs(os.path.dirname(OUT),exist_ok=True)
with open(OUT,'w') as f:json.dump(payload,f,indent=2)
print(json.dumps({
  'foundationPass':accept,
  'reasons':reasons,
  'transportErrors':len(errors),
  'qualifiedAssetsThrough2025_12':qualified24,
  'eligibleAssetsBy2026_01':eligibleBy2026,
  'eligibility':{a:by_asset[a]['firstEligibleMonth24m12mContinuity'] for a in ASSETS}
},indent=2))
