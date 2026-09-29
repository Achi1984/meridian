#!/usr/bin/env python3
import csv, io, json, os, time, urllib.error, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

BASE='https://data.binance.vision/data/futures/um/monthly'
SYMBOLS=['BNBUSDT','ADAUSDT','DOTUSDT','LTCUSDT','BCHUSDT','TRXUSDT','ETCUSDT']
START=datetime(2024,9,1,tzinfo=timezone.utc)
END=datetime(2026,9,1,tzinfo=timezone.utc)
OUT=os.environ.get('BINANCE_V2_ARCHIVE_INPUT','/tmp/meridian-cross-venue-binance-v2.json')

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
            req=urllib.request.Request(url,headers={'User-Agent':'ACHI-MERIDIAN-CROSS-VENUE-V2/1'})
            with urllib.request.urlopen(req,timeout=75) as r:data=r.read()
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                names=[n for n in z.namelist() if not n.endswith('/')]
                if len(names)!=1:raise RuntimeError(f'unexpected archive members: {url}')
                return z.read(names[0]).decode('utf-8-sig').splitlines()
        except Exception as e:
            last=e
            if attempt<3:time.sleep(.5*(attempt+1))
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

def dedupe(rows,key):
    d={x[key]:x for x in rows}
    return [d[k] for k in sorted(d)]

def fetch_month(symbol,y,m):
    ym=f'{y:04d}-{m:02d}'
    mark_url=f'{BASE}/markPriceKlines/{symbol}/8h/{symbol}-8h-{ym}.zip'
    fund_url=f'{BASE}/fundingRate/{symbol}/{symbol}-fundingRate-{ym}.zip'
    try:return ym,parse_marks(fetch_zip(mark_url)),parse_funding(fetch_zip(fund_url))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'official archive missing {symbol} {ym}: HTTP {e.code}') from e

payload={'source':'Binance Vision official public archive','start':START.isoformat(),'end':END.isoformat(),'assets':{}}
month_list=list(months(START,END))
for symbol in SYMBOLS:
    marks=[];funding=[]
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs={ex.submit(fetch_month,symbol,y,m):(y,m) for y,m in month_list}
        for fut in as_completed(futs):
            ym,mm,ff=fut.result()
            print(f'{symbol} {ym}',flush=True)
            marks.extend(mm);funding.extend(ff)
    dm=dedupe(marks,'time');df=dedupe(funding,'fundingTime')
    payload['assets'][symbol[:-4]]={
      'binanceMarks':dm,
      'binanceFunding':df,
      'coverage':{'marks':len(dm),'funding':len(df)}
    }

with open(OUT,'w') as f:json.dump(payload,f,separators=(',',':'))
print(json.dumps({k:v['coverage'] for k,v in payload['assets'].items()},sort_keys=True))
