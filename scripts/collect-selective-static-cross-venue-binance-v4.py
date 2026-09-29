#!/usr/bin/env python3
import csv, io, json, os, time, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

BASE='https://data.binance.vision/data/futures/um/monthly'
ASSETS=['HBAR','SUI','NEAR','FIL','UNI','AAVE','ATOM','ARB']
START=datetime(2025,8,1,tzinfo=timezone.utc)
END=datetime(2026,9,1,tzinfo=timezone.utc)
OUT=os.environ.get('BINANCE_SELECTIVE_V4_ARCHIVE_INPUT','/tmp/meridian-selective-static-v4-binance.json')
UA='ACHI-MERIDIAN-SELECTIVE-STATIC-V4/1'

def months(start,end):
    y,m=start.year,start.month
    while (y,m)<(end.year,end.month):
        yield y,m
        m+=1
        if m==13:y,m=y+1,1

def fetch_zip(url):
    last=None
    for attempt in range(4):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Encoding':'identity'})
            with urllib.request.urlopen(req,timeout=75) as r:data=r.read()
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                names=[n for n in z.namelist() if not n.endswith('/')]
                if len(names)!=1:raise RuntimeError(f'unexpected archive members: {url}')
                return z.read(names[0]).decode('utf-8-sig').splitlines()
        except Exception as e:
            last=e
            if attempt<3:time.sleep(.7*(attempt+1))
    raise last

def ts_ms(v):
    x=int(float(v))
    while x>10**14:x//=1000
    return x

def parse_marks(lines):
    out=[]
    for row in csv.reader(lines):
        if not row:continue
        try:t=ts_ms(row[0]);close=float(row[4])
        except (ValueError,IndexError,TypeError):continue
        if close>0:out.append({'time':t,'close':close})
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
        try:out.append({'fundingTime':ts_ms(row[ti]),'fundingRate':float(row[ri])})
        except (ValueError,IndexError,TypeError):continue
    return out

def fetch_month(asset,y,m):
    symbol=asset+'USDT';ym=f'{y:04d}-{m:02d}'
    mark_url=f'{BASE}/markPriceKlines/{symbol}/8h/{symbol}-8h-{ym}.zip'
    fund_url=f'{BASE}/fundingRate/{symbol}/{symbol}-fundingRate-{ym}.zip'
    return asset,ym,mark_url,fund_url,parse_marks(fetch_zip(mark_url)),parse_funding(fetch_zip(fund_url))

payload={'source':'Binance Vision official public archive','start':START.isoformat(),'end':END.isoformat(),'assets':{}}
jobs=[(a,y,m) for a in ASSETS for y,m in months(START,END)]
data={a:{'binanceMarks':[],'binanceFunding':[],'sources':[]} for a in ASSETS}

with ThreadPoolExecutor(max_workers=12) as ex:
    futs={ex.submit(fetch_month,*j):j for j in jobs}
    done=0
    for fut in as_completed(futs):
        asset,ym,mark_url,fund_url,mm,ff=fut.result();done+=1
        data[asset]['binanceMarks'].extend(mm)
        data[asset]['binanceFunding'].extend(ff)
        data[asset]['sources'].append({'month':ym,'markUrl':mark_url,'fundingUrl':fund_url,'marks':len(mm),'funding':len(ff)})
        if done%30==0 or done==len(jobs):print(f'{done}/{len(jobs)} archives',flush=True)

for asset in ASSETS:
    d=data[asset]
    d['binanceMarks'].sort(key=lambda x:x['time'])
    d['binanceFunding'].sort(key=lambda x:x['fundingTime'])
    d['sources'].sort(key=lambda x:x['month'])
    payload['assets'][asset]={**d,'coverage':{'marks':len(d['binanceMarks']),'funding':len(d['binanceFunding'])}}

with open(OUT,'w') as f:json.dump(payload,f,separators=(',',':'))
print(json.dumps({a:payload['assets'][a]['coverage'] for a in ASSETS},sort_keys=True))
