#!/usr/bin/env python3
import csv, io, json, os, time, urllib.error, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE='https://data.binance.vision/data/futures/um/monthly'
ASSETS=['ADA','DOGE','LINK','DOT','LTC','BCH','AVAX','HBAR','TRX','ETC','XLM','ATOM','UNI','AAVE','FIL','NEAR','OP','INJ','APT','CRV','LDO','GALA','IMX']
START='2024-11'
END='2026-08'
OUT=os.environ.get('PERP_REVERSAL_V2_DATA_DIR','/tmp/meridian-perp-reversal-v2')
UA='ACHI-MERIDIAN-PERP-REVERSAL-V2/1'

def month_range(a,b):
    y,m=map(int,a.split('-')); ey,em=map(int,b.split('-'))
    while y<ey or (y==ey and m<=em):
        yield f'{y:04d}-{m:02d}'
        m+=1
        if m==13:y,m=y+1,1

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
            if attempt<3:time.sleep(.6*(attempt+1))
    raise last

def ts_ms(v):
    x=int(float(v))
    while x>10**14:x//=1000
    return x

def parse_kline(lines):
    out=[]
    for row in csv.reader(lines):
        if not row:continue
        if str(row[0]).strip().lower() in ('open_time','opentime','timestamp','time'):continue
        try:
            ot=ts_ms(row[0]);ct=ts_ms(row[6])
            o=float(row[1]);h=float(row[2]);l=float(row[3]);c=float(row[4])
        except (ValueError,IndexError,TypeError):continue
        out.append([ot,ct,o,h,l,c])
    return out

def parse_funding(lines):
    rows=list(csv.reader(lines));out=[]
    if not rows:return out
    header=[x.strip() for x in rows[0]]
    has_header=any(x in header for x in ('calc_time','fundingTime','last_funding_rate','fundingRate'))
    if has_header:
        idx={k:i for i,k in enumerate(header)}
        ti=idx.get('calc_time',idx.get('fundingTime'));ri=idx.get('last_funding_rate',idx.get('fundingRate'))
        data=rows[1:]
    else:
        ti,ri,data=0,2,rows
    if ti is None or ri is None:raise RuntimeError('unknown funding archive schema')
    for row in data:
        try:out.append([ts_ms(row[ti]),float(row[ri])])
        except (ValueError,IndexError,TypeError):continue
    return out

def url(asset,kind,ym):
    s=asset+'USDT'
    if kind=='price':return f'{BASE}/klines/{s}/1d/{s}-1d-{ym}.zip'
    if kind=='funding':return f'{BASE}/fundingRate/{s}/{s}-fundingRate-{ym}.zip'
    raise ValueError(kind)

def one(asset,kind,ym):
    u=url(asset,kind,ym)
    try:lines=fetch_zip(u)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'official archive missing {asset} {kind} {ym}: HTTP {e.code}') from e
    parser=parse_kline if kind=='price' else parse_funding
    return asset,kind,ym,u,parser(lines)

os.makedirs(OUT,exist_ok=True)
months=list(month_range(START,END))
jobs=[(a,k,ym) for a in ASSETS for ym in months for k in ('price','funding')]
data={a:{'asset':a,'symbol':a+'USDT','price':[],'funding':[],'sources':[]} for a in ASSETS}

with ThreadPoolExecutor(max_workers=16) as ex:
    futs={ex.submit(one,*job):job for job in jobs}
    done=0
    for fut in as_completed(futs):
        asset,kind,ym,u,rows=fut.result();done+=1
        data[asset][kind].extend(rows)
        data[asset]['sources'].append({'kind':kind,'month':ym,'url':u,'rows':len(rows)})
        if done%100==0 or done==len(jobs):print(f'{done}/{len(jobs)} archives',flush=True)

manifest={
  'source':'Binance Vision official public USD-M monthly archives',
  'ruleset':'HIGH-VOLATILITY-PERPETUAL-CROSS-SECTIONAL-REVERSAL-V2-VALIDATION-DATA',
  'range':{'start':START,'end':END},
  'stage':'INDEPENDENT_VALIDATION',
  'assets':ASSETS,
  'v1DiscoveryReloaded':False,
  'dataAfter2026_08Loaded':False,
  'files':{}
}
for asset,d in data.items():
    d['price'].sort(key=lambda x:x[0]);d['funding'].sort(key=lambda x:x[0])
    d['sources'].sort(key=lambda x:(x['month'],x['kind']))
    p=os.path.join(OUT,asset+'.json')
    with open(p,'w') as f:json.dump(d,f,separators=(',',':'))
    manifest['files'][asset]={
      'path':p,'priceRows':len(d['price']),'fundingRows':len(d['funding']),
      'sourceArchives':len(d['sources'])
    }

with open(os.path.join(OUT,'manifest.json'),'w') as f:json.dump(manifest,f,indent=2)
print(json.dumps({'range':manifest['range'],'stage':manifest['stage'],'files':manifest['files']},sort_keys=True))
