#!/usr/bin/env python3
import csv, io, json, os, time, urllib.error, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

BASE='https://data.binance.vision/data/futures/um/monthly'
ASSETS=['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','LINK','DOT','LTC','BCH','AVAX','HBAR','SUI']
FIRST={
  'BTC':(2021,1),'ETH':(2021,1),'BNB':(2021,1),'SOL':(2021,1),'XRP':(2021,1),'ADA':(2021,1),
  'DOGE':(2021,1),'LINK':(2021,1),'DOT':(2021,1),'LTC':(2021,1),'BCH':(2021,1),'AVAX':(2021,1),
  'HBAR':(2021,3),'SUI':(2023,5)
}
END=(2026,8)
OUT=os.environ.get('SELF_HISTORY_PERPETUAL_DATA_DIR','/tmp/meridian-self-history-perpetual')

def months(start,end):
    y,m=start;ey,em=end
    while (y,m)<=(ey,em):
        yield y,m
        m+=1
        if m==13:y,m=y+1,1

def fetch_zip(url):
    last=None
    for attempt in range(4):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'ACHI-MERIDIAN-SELF-HISTORY-MULTIFACTOR/1'})
            with urllib.request.urlopen(req,timeout=90) as r:raw=r.read()
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                names=[n for n in z.namelist() if not n.endswith('/')]
                if len(names)!=1:raise RuntimeError(f'unexpected archive members: {url}')
                return z.read(names[0]).decode('utf-8-sig').splitlines()
        except Exception as e:
            last=e
            if attempt<3:time.sleep(.75*(attempt+1))
    raise last

def ts_ms(v):
    x=int(float(v))
    while x>10**14:x//=1000
    return x

def parse_klines(lines,premium=False):
    out=[]
    for row in csv.reader(lines):
        if not row:continue
        try:
            t=ts_ms(row[0]);o=float(row[1]);h=float(row[2]);l=float(row[3]);c=float(row[4])
        except (ValueError,IndexError):continue
        if premium:
            out.append({'openTime':t,'close':c})
        elif min(o,h,l,c)>0:
            out.append({'openTime':t,'open':o,'high':h,'low':l,'close':c})
    return out

def parse_funding(lines):
    rows=list(csv.reader(lines));out=[]
    if not rows:return out
    header=[x.strip() for x in rows[0]]
    has_header=any(x in header for x in ('calc_time','fundingTime','last_funding_rate','fundingRate'))
    if has_header:
        idx={k:i for i,k in enumerate(header)}
        ti=idx.get('calc_time',idx.get('fundingTime'))
        ri=idx.get('last_funding_rate',idx.get('fundingRate'))
        data=rows[1:]
    else:
        ti,ri,data=0,2,rows
    if ti is None or ri is None:raise RuntimeError('unknown funding archive schema')
    for row in data:
        try:t=ts_ms(row[ti]);rate=float(row[ri])
        except (ValueError,IndexError,TypeError):continue
        out.append({'time':t,'rate':rate})
    return out

def dedupe(rows,key):
    d={x[key]:x for x in rows}
    return [d[k] for k in sorted(d)]

def fetch_month(asset,y,m):
    symbol=asset+'USDT';ym=f'{y:04d}-{m:02d}'
    ku=f'{BASE}/klines/{symbol}/4h/{symbol}-4h-{ym}.zip'
    pu=f'{BASE}/premiumIndexKlines/{symbol}/4h/{symbol}-4h-{ym}.zip'
    fu=f'{BASE}/fundingRate/{symbol}/{symbol}-fundingRate-{ym}.zip'
    try:
        k=parse_klines(fetch_zip(ku),False)
        p=parse_klines(fetch_zip(pu),True)
        f=parse_funding(fetch_zip(fu))
        return ym,k,p,f
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'official CORE archive missing {asset} {ym}: HTTP {e.code}') from e

os.makedirs(OUT,exist_ok=True)
manifest={
  'source':'Binance Vision official public USD-M monthly archives',
  'foundation':'PERPETUAL-FACTOR-DATA-V1',
  'required':['klines4h','premium4h','funding'],
  'end':'2026-08','assets':ASSETS,'files':{}
}

for asset in ASSETS:
    bars=[];premium=[];funding=[]
    ms=list(months(FIRST[asset],END))
    with ThreadPoolExecutor(max_workers=10) as ex:
        futs={ex.submit(fetch_month,asset,y,m):(y,m) for y,m in ms}
        done=0
        for fut in as_completed(futs):
            ym,k,p,f=fut.result();done+=1
            bars.extend(k);premium.extend(p);funding.extend(f)
            print(f'{asset} {done}/{len(ms)} {ym} k={len(k)} p={len(p)} f={len(f)}',flush=True)
    bars=dedupe(bars,'openTime');premium=dedupe(premium,'openTime');funding=dedupe(funding,'time')
    payload={
      'source':manifest['source'],'foundation':manifest['foundation'],'asset':asset,'symbol':asset+'USDT',
      'firstCoreMonth':f'{FIRST[asset][0]:04d}-{FIRST[asset][1]:02d}','lastCoreMonth':'2026-08',
      'coverage':{'bars4h':len(bars),'premium4h':len(premium),'funding':len(funding)},
      'bars':bars,'premium':premium,'funding':funding
    }
    fn=asset+'USDT.json'
    with open(os.path.join(OUT,fn),'w') as f:json.dump(payload,f,separators=(',',':'))
    manifest['files'][asset]=payload['coverage']
    print(json.dumps({asset:payload['coverage']}),flush=True)

manifest['generatedAt']=datetime.now(timezone.utc).isoformat()
with open(os.path.join(OUT,'MANIFEST.json'),'w') as f:json.dump(manifest,f,separators=(',',':'))
print(f'complete assets={len(ASSETS)} out={OUT}',flush=True)
