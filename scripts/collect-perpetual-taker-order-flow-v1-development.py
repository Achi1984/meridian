#!/usr/bin/env python3
import csv, io, json, os, time, urllib.error, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE='https://data.binance.vision/data/futures/um/monthly'
ASSETS=['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','LINK','DOT','LTC','BCH','AVAX']
START='2023-01'
END='2024-12'
OUT=os.environ.get('TAKER_FLOW_V1_DEVELOPMENT_DATA_DIR','/tmp/meridian-taker-flow-v1-development')
UA='ACHI-MERIDIAN-TAKER-FLOW-V1-DEVELOPMENT/1'

def month_range(a,b):
    y,m=map(int,a.split('-'));ey,em=map(int,b.split('-'))
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
            if len(row)<11:raise ValueError('short row')
            ot=ts_ms(row[0]);ct=ts_ms(row[6])
            o=float(row[1]);h=float(row[2]);l=float(row[3]);c=float(row[4])
            vol=float(row[5]);qvol=float(row[7]);trades=float(row[8])
            tb=float(row[9]);tq=float(row[10])
        except (ValueError,IndexError,TypeError):
            continue
        out.append([ot,ct,o,h,l,c,vol,qvol,trades,tb,tq])
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
        try:out.append([ts_ms(row[ti]),float(row[ri])])
        except (ValueError,IndexError,TypeError):continue
    return out

def url(asset,kind,ym):
    s=asset+'USDT'
    if kind=='hourly':return f'{BASE}/klines/{s}/1h/{s}-1h-{ym}.zip'
    if kind=='funding':return f'{BASE}/fundingRate/{s}/{s}-fundingRate-{ym}.zip'
    raise ValueError(kind)

def one(asset,kind,ym):
    u=url(asset,kind,ym)
    try:lines=fetch_zip(u)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'official archive missing {asset} {kind} {ym}: HTTP {e.code}') from e
    parser=parse_kline if kind=='hourly' else parse_funding
    return asset,kind,ym,u,parser(lines)

os.makedirs(OUT,exist_ok=True)
months=list(month_range(START,END))
jobs=[(a,k,ym) for a in ASSETS for ym in months for k in ('hourly','funding')]
data={a:{'asset':a,'symbol':a+'USDT','hourly':[],'funding':[],'sources':[]} for a in ASSETS}

with ThreadPoolExecutor(max_workers=20) as ex:
    futs={ex.submit(one,*job):job for job in jobs}
    done=0
    for fut in as_completed(futs):
        asset,kind,ym,u,rows=fut.result();done+=1
        data[asset][kind].extend(rows)
        data[asset]['sources'].append({'kind':kind,'month':ym,'url':u,'rows':len(rows)})
        if done%100==0 or done==len(jobs):print(f'{done}/{len(jobs)} archives',flush=True)

manifest={
  'source':'Binance Vision official public USD-M monthly archives',
  'ruleset':'PERPETUAL-TAKER-ORDER-FLOW-V1-DEVELOPMENT-DATA',
  'stage':'DEVELOPMENT',
  'range':{'start':START,'end':END},
  'assets':ASSETS,
  'holdoutLoaded':False,
  'postDevelopmentDataLoaded':False,
  'files':{}
}

for asset,d in data.items():
    d['hourly'].sort(key=lambda x:x[0]);d['funding'].sort(key=lambda x:x[0])
    d['sources'].sort(key=lambda x:(x['month'],x['kind']))
    p=os.path.join(OUT,asset+'.json')
    with open(p,'w') as f:json.dump(d,f,separators=(',',':'))
    manifest['files'][asset]={
      'path':p,'hourlyRows':len(d['hourly']),'fundingRows':len(d['funding']),
      'sourceArchives':len(d['sources']),
      'firstHourly':d['hourly'][0][0] if d['hourly'] else None,
      'lastHourly':d['hourly'][-1][0] if d['hourly'] else None
    }

with open(os.path.join(OUT,'manifest.json'),'w') as f:json.dump(manifest,f,indent=2)
print(json.dumps({
  'stage':manifest['stage'],'range':manifest['range'],'assets':manifest['assets'],
  'holdoutLoaded':manifest['holdoutLoaded'],
  'postDevelopmentDataLoaded':manifest['postDevelopmentDataLoaded'],
  'files':manifest['files']
},sort_keys=True))
