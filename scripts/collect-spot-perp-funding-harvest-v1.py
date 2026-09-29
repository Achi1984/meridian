#!/usr/bin/env python3
import csv, io, json, os, time, urllib.error, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed

SPOT='https://data.binance.vision/data/spot/monthly'
FUT='https://data.binance.vision/data/futures/um/monthly'
ASSETS=['OP','INJ','WLD','SEI','TIA','PENDLE','RUNE','ICP']
START=os.environ.get('SPOT_PERP_V1_START','2024-09')
END=os.environ.get('SPOT_PERP_V1_END','2025-08')
OUT=os.environ.get('SPOT_PERP_V1_DATA_DIR','/tmp/meridian-spot-perp-v1')
UA='ACHI-MERIDIAN-SPOT-PERP-FUNDING-HARVEST-V1/1'

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
            with urllib.request.urlopen(req,timeout=90) as r: raw=r.read()
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                names=[n for n in z.namelist() if not n.endswith('/')]
                if len(names)!=1: raise RuntimeError(f'unexpected archive members: {url}')
                return z.read(names[0]).decode('utf-8-sig').splitlines()
        except Exception as e:
            last=e
            if attempt<3: time.sleep(.7*(attempt+1))
    raise last

def ts_ms(v):
    x=int(float(v))
    while x>10**14:x//=1000
    return x

def parse_kline(lines):
    out=[]
    for row in csv.reader(lines):
        if not row: continue
        first=str(row[0]).strip().lower()
        if first in ('open_time','opentime','timestamp','time'): continue
        try:
            ot=ts_ms(row[0]); ct=ts_ms(row[6])
            o=float(row[1]); h=float(row[2]); l=float(row[3]); c=float(row[4])
        except (ValueError,IndexError,TypeError):
            continue
        out.append([ot,ct,o,h,l,c])
    return out

def parse_funding(lines):
    rows=list(csv.reader(lines)); out=[]
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
    if ti is None or ri is None: raise RuntimeError('unknown funding archive schema')
    for row in data:
        try: out.append([ts_ms(row[ti]),float(row[ri])])
        except (ValueError,IndexError,TypeError): continue
    return out

def url(asset,kind,ym):
    s=asset+'USDT'
    if kind=='spot':
        return f'{SPOT}/klines/{s}/8h/{s}-8h-{ym}.zip'
    if kind=='perp':
        return f'{FUT}/klines/{s}/8h/{s}-8h-{ym}.zip'
    if kind=='funding':
        return f'{FUT}/fundingRate/{s}/{s}-fundingRate-{ym}.zip'
    raise ValueError(kind)

def one(asset,kind,ym):
    u=url(asset,kind,ym)
    try: lines=fetch_zip(u)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'official archive missing {asset} {kind} {ym}: HTTP {e.code}') from e
    parser=parse_funding if kind=='funding' else parse_kline
    return asset,kind,ym,u,parser(lines)

os.makedirs(OUT,exist_ok=True)
months=list(month_range(START,END))
jobs=[(a,k,ym) for a in ASSETS for ym in months for k in ('spot','perp','funding')]
data={a:{'asset':a,'symbol':a+'USDT','spot':[],'perp':[],'funding':[],'sources':[]} for a in ASSETS}

with ThreadPoolExecutor(max_workers=16) as ex:
    futs={ex.submit(one,*job):job for job in jobs}
    done=0
    for fut in as_completed(futs):
        asset,kind,ym,u,rows=fut.result(); done+=1
        data[asset][kind].extend(rows)
        data[asset]['sources'].append({'kind':kind,'month':ym,'url':u,'rows':len(rows)})
        if done%48==0 or done==len(jobs): print(f'{done}/{len(jobs)} archives',flush=True)

manifest={
  'source':'Binance Vision public monthly archives',
  'ruleset':'SPOT-PERP-FUNDING-HARVEST-V1-DATA',
  'range':{'start':START,'end':END},
  'assets':ASSETS,
  'files':{}
}
for asset,d in data.items():
    d['spot'].sort(key=lambda x:x[0])
    d['perp'].sort(key=lambda x:x[0])
    d['funding'].sort(key=lambda x:x[0])
    d['sources'].sort(key=lambda x:(x['month'],x['kind']))
    p=os.path.join(OUT,asset+'.json')
    with open(p,'w') as f: json.dump(d,f,separators=(',',':'))
    manifest['files'][asset]={
      'path':p,'spotRows':len(d['spot']),'perpRows':len(d['perp']),
      'fundingRows':len(d['funding']),'sourceArchives':len(d['sources'])
    }

with open(os.path.join(OUT,'manifest.json'),'w') as f: json.dump(manifest,f,indent=2)
print(json.dumps(manifest['files'],sort_keys=True))
