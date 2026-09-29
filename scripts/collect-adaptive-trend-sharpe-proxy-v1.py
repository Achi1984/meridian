#!/usr/bin/env python3
import csv, io, json, os, time, urllib.error, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

BASE='https://data.binance.vision/data/futures/um/monthly'
ASSETS=['BTC','BNB','DOGE','ADA','DOT','LTC','BCH','TRX','XLM','ETC','FIL','ATOM','NEAR']
START=datetime(2021,10,1,tzinfo=timezone.utc)
END=datetime(2026,9,1,tzinfo=timezone.utc)
OUT=os.environ.get('ADAPTIVE_TREND_INPUT','/tmp/meridian-adaptive-trend-v1.json')

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
            req=urllib.request.Request(url,headers={'User-Agent':'ACHI-MERIDIAN-ADAPTIVE-TREND/1'})
            with urllib.request.urlopen(req,timeout=60) as r:
                data=r.read()
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                names=[n for n in z.namelist() if not n.endswith('/')]
                if len(names)!=1:raise RuntimeError(f'unexpected archive members: {url}')
                return z.read(names[0]).decode('utf-8-sig').splitlines()
        except urllib.error.HTTPError as e:
            if e.code==404:return None
            last=e
            if e.code not in (429,500,502,503,504):raise
        except Exception as e:
            last=e
        if attempt<3:time.sleep(0.6*(attempt+1))
    raise last

def ts_ms(v):
    x=int(float(v))
    while x>10**14:x//=1000
    return x

def parse_klines(lines):
    out=[]
    if lines is None:return out
    for row in csv.reader(lines):
        if not row:continue
        try:
            ot=ts_ms(row[0]);op=float(row[1]);hi=float(row[2]);lo=float(row[3]);cl=float(row[4]);vol=float(row[5]);ct=ts_ms(row[6])
        except (ValueError,IndexError):
            continue
        if min(op,hi,lo,cl)>0:
            out.append({'openTime':ot,'open':op,'high':hi,'low':lo,'close':cl,'volume':vol,'closeTime':ct})
    return out

def parse_funding(lines):
    if lines is None:return []
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
        out.append({'fundingTime':t,'fundingRate':rate})
    return out

def dedupe(rows,key):
    d={x[key]:x for x in rows}
    return [d[k] for k in sorted(d)]

def fetch_month(asset,y,m):
    symbol=asset+'USDT';ym=f'{y:04d}-{m:02d}'
    kurl=f'{BASE}/klines/{symbol}/6h/{symbol}-6h-{ym}.zip'
    furl=f'{BASE}/fundingRate/{symbol}/{symbol}-fundingRate-{ym}.zip'
    klines=fetch_zip(kurl);funding=fetch_zip(furl)
    return asset,ym,parse_klines(klines),parse_funding(funding),klines is None,funding is None

payload={
  'source':'Binance Vision official public USD-M archives',
  'timeframe':'6h',
  'start':START.isoformat(),
  'end':END.isoformat(),
  'assets':{a:{'bars':[],'funding':[],'missingKlineMonths':[],'missingFundingMonths':[]} for a in ASSETS}
}
jobs=[(a,y,m) for a in ASSETS for y,m in months(START,END)]
with ThreadPoolExecutor(max_workers=12) as ex:
    futs={ex.submit(fetch_month,*job):job for job in jobs}
    for fut in as_completed(futs):
        asset,ym,bars,funding,kmiss,fmiss=fut.result()
        x=payload['assets'][asset]
        x['bars'].extend(bars);x['funding'].extend(funding)
        if kmiss:x['missingKlineMonths'].append(ym)
        if fmiss:x['missingFundingMonths'].append(ym)
        print(f'{asset} {ym} bars={len(bars)} funding={len(funding)} k404={kmiss} f404={fmiss}',flush=True)

for asset,x in payload['assets'].items():
    x['bars']=dedupe(x['bars'],'openTime')
    x['funding']=dedupe(x['funding'],'fundingTime')
    x['missingKlineMonths'].sort();x['missingFundingMonths'].sort()
    x['coverage']={
      'bars':len(x['bars']),
      'funding':len(x['funding']),
      'firstBar':x['bars'][0]['openTime'] if x['bars'] else None,
      'lastBar':x['bars'][-1]['openTime'] if x['bars'] else None,
      'firstFunding':x['funding'][0]['fundingTime'] if x['funding'] else None,
      'lastFunding':x['funding'][-1]['fundingTime'] if x['funding'] else None,
      'missingKlineMonths':len(x['missingKlineMonths']),
      'missingFundingMonths':len(x['missingFundingMonths'])
    }

with open(OUT,'w') as f:json.dump(payload,f,separators=(',',':'))
print(json.dumps({a:x['coverage'] for a,x in payload['assets'].items()},sort_keys=True))
