#!/usr/bin/env python3
import csv, io, json, math, os, time, urllib.error, urllib.request, zipfile
from bisect import bisect_left
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from pathlib import Path

BASE='https://data.binance.vision/data/futures/um/monthly'
ASSETS=['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','LINK','DOT','LTC','BCH','AVAX','HBAR','SUI']
FIRST_CORE={
  'BTC':'2021-01','ETH':'2021-01','BNB':'2021-01','SOL':'2021-01','XRP':'2021-01',
  'ADA':'2021-01','DOGE':'2021-01','LINK':'2021-01','DOT':'2021-01','LTC':'2021-01',
  'BCH':'2021-01','AVAX':'2021-01','HBAR':'2021-03','SUI':'2023-05'
}
ELIGIBLE={
  'BTC':'2023-01','ETH':'2023-01','BNB':'2023-01','SOL':'2023-01','XRP':'2023-01',
  'ADA':'2023-01','DOGE':'2023-01','LINK':'2023-01','DOT':'2023-01','LTC':'2023-01',
  'BCH':'2023-01','AVAX':'2023-01','HBAR':'2023-03','SUI':'2025-05'
}
END='2026-08'
FOUR_H=4*60*60*1000
WEEK=7*24*60*60*1000
MAX_FUND_GAP=12*60*60*1000
UA='ACHI-MERIDIAN-ROW-CONTINUITY-V1/1'
OUT=Path(os.environ.get('ROW_CONTINUITY_OUT','research/results/perpetual-factor-row-continuity-v1.json'))
MD=OUT.with_suffix('.md')

def month_range(a,b):
    y,m=map(int,a.split('-')); ey,em=map(int,b.split('-'))
    while y<ey or (y==ey and m<=em):
        yield f'{y:04d}-{m:02d}'
        m+=1
        if m==13:y,m=y+1,1

def ts_ms(v):
    x=int(float(v))
    while x>10**14:x//=1000
    return x

def fetch_zip(url):
    last=None
    for attempt in range(4):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Encoding':'identity'})
            with urllib.request.urlopen(req,timeout=90) as r:raw=r.read()
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                names=[n for n in z.namelist() if not n.endswith('/')]
                if len(names)!=1:raise RuntimeError(f'unexpected archive members: {url}')
                return z.read(names[0]).decode('utf-8-sig').splitlines()
        except Exception as e:
            last=e
            if attempt<3:time.sleep(.5*(attempt+1))
    raise last

def url(asset,kind,ym):
    s=asset+'USDT'
    if kind=='kline':return f'{BASE}/klines/{s}/4h/{s}-4h-{ym}.zip'
    if kind=='premium':return f'{BASE}/premiumIndexKlines/{s}/4h/{s}-4h-{ym}.zip'
    if kind=='funding':return f'{BASE}/fundingRate/{s}/{s}-fundingRate-{ym}.zip'
    raise ValueError(kind)

def parse_kline_times(lines):
    out=[]
    for row in csv.reader(lines):
        if not row:continue
        try:out.append(ts_ms(row[0]))
        except (ValueError,IndexError,TypeError):continue
    return out

def parse_funding_times(lines):
    rows=list(csv.reader(lines)); out=[]
    if not rows:return out
    header=[x.strip() for x in rows[0]]
    has=any(x in header for x in ('calc_time','fundingTime'))
    if has:
        idx={k:i for i,k in enumerate(header)}
        ti=idx.get('calc_time',idx.get('fundingTime')); data=rows[1:]
    else:
        ti=0; data=rows
    if ti is None:raise RuntimeError('unknown funding schema')
    for row in data:
        try:out.append(ts_ms(row[ti]))
        except (ValueError,IndexError,TypeError):continue
    return out

def fetch_one(asset,kind,ym):
    u=url(asset,kind,ym)
    try:lines=fetch_zip(u)
    except Exception as e:return {'ok':False,'asset':asset,'kind':kind,'month':ym,'url':u,'error':repr(e)}
    parser=parse_funding_times if kind=='funding' else parse_kline_times
    return {'ok':True,'asset':asset,'kind':kind,'month':ym,'url':u,'times':parser(lines)}

def gap_runs(missing):
    if not missing:return []
    rows=sorted(missing); runs=[]; start=prev=rows[0]; count=1
    for t in rows[1:]:
        if t-prev==FOUR_H:
            prev=t; count+=1; continue
        runs.append({'start':start,'end':prev,'missingBars':count,'durationHours':count*4})
        start=prev=t; count=1
    runs.append({'start':start,'end':prev,'missingBars':count,'durationHours':count*4})
    return runs

def iso(ts):
    return datetime.fromtimestamp(ts/1000,timezone.utc).isoformat().replace('+00:00','Z')

def continuity(times,expected_start=None,expected_end=None):
    ordered=sorted(times)
    duplicates=len(ordered)-len(set(ordered))
    monotonic=all(ordered[i]>ordered[i-1] for i in range(1,len(ordered)))
    if not ordered:return {'rows':0,'duplicates':duplicates,'strict':monotonic,'missingCount':0,'gapRuns':[],'first':None,'last':None,'set':set()}
    s=expected_start if expected_start is not None else ordered[0]
    e=expected_end if expected_end is not None else ordered[-1]
    present=set(ordered)
    expected=range(s,e+1,FOUR_H)
    missing=[t for t in expected if t not in present]
    return {
      'rows':len(ordered),'duplicates':duplicates,'strict':monotonic,
      'missingCount':len(missing),
      'gapRuns':[{
        **r,'startIso':iso(r['start']),'endIso':iso(r['end'])
      } for r in gap_runs(missing)],
      'first':ordered[0],'last':ordered[-1],'set':present
    }

def funding_gaps(times):
    ordered=sorted(times); gaps=[]
    duplicates=len(ordered)-len(set(ordered))
    strict=all(ordered[i]>ordered[i-1] for i in range(1,len(ordered)))
    for a,b in zip(ordered,ordered[1:]):
        if b-a>MAX_FUND_GAP:
            gaps.append({'start':a,'end':b,'startIso':iso(a),'endIso':iso(b),'hours':(b-a)/3600000})
    return {'rows':len(ordered),'duplicates':duplicates,'strict':strict,'gapsOver12h':gaps,'gapCount':len(gaps),'set':set(ordered)}

def month_start_ms(ym):
    y,m=map(int,ym.split('-'))
    return int(datetime(y,m,1,tzinfo=timezone.utc).timestamp()*1000)

def monday_anchors(start_ym,end_ym):
    start=datetime.fromtimestamp(month_start_ms(start_ym)/1000,timezone.utc)
    while start.weekday()!=0:start+=timedelta(days=1)
    ey,em=map(int,end_ym.split('-'))
    if em==12:end=datetime(ey+1,1,1,tzinfo=timezone.utc)
    else:end=datetime(ey,em+1,1,tzinfo=timezone.utc)
    out=[]
    while start<end:
        out.append(int(start.timestamp()*1000)); start+=timedelta(days=7)
    return out

jobs=[]
for asset in ASSETS:
    for ym in month_range(FIRST_CORE[asset],END):
        for kind in ('kline','premium','funding'):jobs.append((asset,kind,ym))

transport=[]; monthly={}
with ThreadPoolExecutor(max_workers=16) as ex:
    futs={ex.submit(fetch_one,*j):j for j in jobs}
    done=0
    for fut in as_completed(futs):
        r=fut.result();done+=1
        if not r['ok']:transport.append(r)
        else:monthly[(r['asset'],r['kind'],r['month'])]=r['times']
        if done%100==0 or done==len(jobs):print(f'{done}/{len(jobs)} archives',flush=True)

by_asset={}
premium_missing_counts={}
for asset in ASSETS:
    ks=[]; ps=[]; fs=[]
    for ym in month_range(FIRST_CORE[asset],END):
        ks.extend(monthly.get((asset,'kline',ym),[]))
        ps.extend(monthly.get((asset,'premium',ym),[]))
        fs.extend(monthly.get((asset,'funding',ym),[]))
    k=continuity(ks)
    if not ks:
        by_asset[asset]={'error':'NO_KLINES'};continue
    p=continuity(ps,expected_start=min(ks),expected_end=max(ks))
    f=funding_gaps(fs)
    expected=range(min(ks),max(ks)+1,FOUR_H)
    cls={'BOTH_PRESENT':0,'KLINE_ONLY':0,'PREMIUM_ONLY':0,'BOTH_MISSING':0}
    kset=k['set']; pset=p['set']
    premium_missing=[]
    for t in expected:
        kp=t in kset; pp=t in pset
        key=('BOTH_PRESENT' if kp and pp else 'KLINE_ONLY' if kp else 'PREMIUM_ONLY' if pp else 'BOTH_MISSING')
        cls[key]+=1
        if not pp:
            premium_missing.append(t)
            premium_missing_counts.setdefault(t,[]).append(asset)

    anchors=monday_anchors(ELIGIBLE[asset],END)
    weekly={'anchors':len(anchors),'factorReady':0,'priceFailures':0,'momentumFailures':0,'premiumFailures':0,'fundingFailures':0}
    for t in anchors:
        price_ok=(t-FOUR_H in kset)
        mom_ok=price_ok and (t-12*WEEK-FOUR_H in kset)
        expected_p=[t-WEEK+i*FOUR_H for i in range(42)]
        prem_ok=all(x in pset for x in expected_p)
        rows=[x for x in f['set'] if t-WEEK <= x < t]
        rows.sort()
        pts=[t-WEEK]+[x for x in rows if t-WEEK<x<t]+[t]
        fund_ok=bool(rows) and all(0<pts[i]-pts[i-1]<=MAX_FUND_GAP for i in range(1,len(pts)))
        if not price_ok:weekly['priceFailures']+=1
        if not mom_ok:weekly['momentumFailures']+=1
        if not prem_ok:weekly['premiumFailures']+=1
        if not fund_ok:weekly['fundingFailures']+=1
        if price_ok and mom_ok and prem_ok and fund_ok:weekly['factorReady']+=1
    weekly['factorReadyPct']=100*weekly['factorReady']/weekly['anchors'] if weekly['anchors'] else 0

    by_asset[asset]={
      'listingStartIso':iso(min(ks)),'lastKlineIso':iso(max(ks)),
      'kline':{x:y for x,y in k.items() if x!='set'},
      'premium':{x:y for x,y in p.items() if x!='set'},
      'funding':{x:y for x,y in f.items() if x!='set'},
      'classification':cls,
      'weeklyDiagnostics':weekly
    }

sync=[]
for t,missing_assets in sorted(premium_missing_counts.items()):
    listed=[a for a in ASSETS if a in by_asset and 'error' not in by_asset[a] and
            by_asset[a]['listingStartIso'] <= iso(t) <= by_asset[a]['lastKlineIso']]
    if not listed:continue
    missing=[a for a in listed if a in missing_assets]
    if len(missing)>=math.ceil(len(listed)/2):
        kline_present=[]
        for a in missing:
            ks=[]
            for ym in month_range(FIRST_CORE[a],END):ks.extend(monthly.get((a,'kline',ym),[]))
            if t in set(ks):kline_present.append(a)
        sync.append({
          'timestamp':t,'timestampIso':iso(t),'listedAssets':len(listed),
          'premiumMissingAssets':missing,'premiumMissingCount':len(missing),
          'missingPct':100*len(missing)/len(listed),
          'regularKlinePresentForMissing':kline_present
        })

decision='ROW_CONTINUITY_CHARACTERIZED' if not transport else 'ROW_CONTINUITY_INCOMPLETE'
payload={
  'generatedAt':datetime.now(timezone.utc).isoformat(),
  'ruleset':'PERPETUAL-FACTOR-ROW-CONTINUITY-V1',
  'source':'Binance Vision official public USD-M monthly archives',
  'auditRange':{'start':'2021-01','end':END},
  'assets':ASSETS,
  'requests':len(jobs),'transportErrors':transport,
  'decision':decision,'executionImpact':False,
  'byAsset':by_asset,'synchronizedPremiumGaps':sync
}
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps(payload,indent=2)+'\n')

rows=[]
for a in ASSETS:
    v=by_asset[a]
    if 'error' in v:
        rows.append(f'| {a} | error | error | error | error |')
    else:
        rows.append(f"| {a} | {v['kline']['missingCount']} | {v['premium']['missingCount']} | {v['funding']['gapCount']} | {v['weeklyDiagnostics']['factorReadyPct']:.1f}% |")
MD.write_text(f"""# Perpetual Factor Row Continuity V1 — Result

Generated: {payload['generatedAt']}

**Decision:** {decision}

Transport errors: **{len(transport)}**

| Asset | Missing 4h klines | Missing premium 4h | Funding gaps >12h | Factor-ready eligible Mondays |
|---|---:|---:|---:|---:|
{chr(10).join(rows)}

Synchronized premium-gap timestamps affecting at least half of then-listed assets: **{len(sync)}**

No interpolation, strategy PnL or promotion decision is performed by this diagnostic.
""")
print(json.dumps({
  'decision':decision,'transportErrors':len(transport),
  'assets':{a:{
    'klineMissing':by_asset[a].get('kline',{}).get('missingCount'),
    'premiumMissing':by_asset[a].get('premium',{}).get('missingCount'),
    'fundingGaps':by_asset[a].get('funding',{}).get('gapCount'),
    'factorReadyPct':by_asset[a].get('weeklyDiagnostics',{}).get('factorReadyPct')
  } for a in ASSETS},
  'synchronizedPremiumGaps':len(sync)
},indent=2))
