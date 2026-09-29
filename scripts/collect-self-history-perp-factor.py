#!/usr/bin/env python3
import csv, io, json, os, time, urllib.error, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

BASE='https://data.binance.vision/data/futures/um/monthly'
DISCOVERY=[
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT',
  'DOGEUSDT','LINKUSDT','AVAXUSDT','DOTUSDT','LTCUSDT','BCHUSDT'
]
TRANSFER=['TRXUSDT','ETCUSDT','XLMUSDT','ATOMUSDT','UNIUSDT','AAVEUSDT','FILUSDT','NEARUSDT']
START=(2021,1)
END=(2026,8)
OUT=os.environ.get('SELF_HISTORY_DATA_DIR','/tmp/meridian-self-history-factor')
SET=os.environ.get('SELF_HISTORY_SYMBOL_SET','DISCOVERY').upper()
SYMBOLS=DISCOVERY if SET=='DISCOVERY' else TRANSFER if SET=='TRANSFER' else None
if SYMBOLS is None:
    raise SystemExit('SELF_HISTORY_SYMBOL_SET must be DISCOVERY or TRANSFER')

def months(start,end):
    y,m=start; ey,em=end
    while (y,m)<=(ey,em):
        yield y,m
        m+=1
        if m==13:y,m=y+1,1

def fetch_zip(url):
    last=None
    for attempt in range(4):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'ACHI-MERIDIAN-SELF-HISTORY/1'})
            with urllib.request.urlopen(req,timeout=90) as r:
                raw=r.read()
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                names=[n for n in z.namelist() if not n.endswith('/')]
                if len(names)!=1: raise RuntimeError(f'unexpected archive members: {url}')
                return z.read(names[0]).decode('utf-8-sig').splitlines()
        except Exception as e:
            last=e
            if attempt<3:time.sleep(.75*(attempt+1))
    raise last

def ts_ms(v):
    x=int(float(v))
    while x>10**14:x//=1000
    return x

def parse_klines(lines):
    out=[]
    for row in csv.reader(lines):
        if not row:continue
        try:
            t=ts_ms(row[0]);o=float(row[1]);h=float(row[2]);l=float(row[3]);c=float(row[4]);ct=ts_ms(row[6])
        except (ValueError,IndexError):
            continue
        if min(o,h,l,c)>0:
            out.append({'openTime':t,'closeTime':ct,'open':o,'high':h,'low':l,'close':c})
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

def month_pair(symbol,y,m):
    ym=f'{y:04d}-{m:02d}'
    ku=f'{BASE}/klines/{symbol}/8h/{symbol}-8h-{ym}.zip'
    fu=f'{BASE}/fundingRate/{symbol}/{symbol}-fundingRate-{ym}.zip'
    try:
        return symbol,ym,parse_klines(fetch_zip(ku)),parse_funding(fetch_zip(fu))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'official archive missing {symbol} {ym}: HTTP {e.code}') from e

os.makedirs(OUT,exist_ok=True)
month_list=list(months(START,END))

for symbol in SYMBOLS:
    bars=[];funding=[]
    with ThreadPoolExecutor(max_workers=10) as ex:
        futs={ex.submit(month_pair,symbol,y,m):(y,m) for y,m in month_list}
        done=0
        for fut in as_completed(futs):
            _,ym,b,f=fut.result();done+=1
            bars.extend(b);funding.extend(f)
            print(f'{symbol} {done}/{len(month_list)} {ym} bars={len(b)} funding={len(f)}',flush=True)
    bars=dedupe(bars,'openTime');funding=dedupe(funding,'time')
    payload={
      'source':'Binance Vision official public USD-M monthly archives',
      'symbol':symbol,
      'set':SET,
      'coverage':{'start':'2021-01','end':'2026-08','bars':len(bars),'funding':len(funding)},
      'bars':bars,
      'funding':funding
    }
    with open(os.path.join(OUT,symbol+'.json'),'w') as f:json.dump(payload,f,separators=(',',':'))
    print(json.dumps({symbol:payload['coverage']}),flush=True)

with open(os.path.join(OUT,'MANIFEST.json'),'w') as f:
    json.dump({
      'source':'Binance Vision official public USD-M monthly archives',
      'set':SET,'symbols':SYMBOLS,'start':'2021-01','end':'2026-08',
      'generatedAt':datetime.now(timezone.utc).isoformat()
    },f,separators=(',',':'))
print(f'complete set={SET} symbols={len(SYMBOLS)} out={OUT}',flush=True)
