#!/usr/bin/env python3
import csv, io, json, os, sys, urllib.request, zipfile
from datetime import datetime, timezone

BASE='https://data.binance.vision/data'
SYMBOL='ETHUSDT'
START=datetime(2024,1,1,tzinfo=timezone.utc)
END=datetime(2026,6,1,tzinfo=timezone.utc)
OUT=os.environ.get('ETH_HOLDOUT_INPUT','/tmp/meridian-eth-holdout-input.json')

def months(start,end):
    y,m=start.year,start.month
    while (y,m) <= (end.year,end.month):
        yield y,m
        m+=1
        if m==13: y,m=y+1,1

def fetch_zip(url):
    req=urllib.request.Request(url,headers={'User-Agent':'ACHI-MERIDIAN-ETH-HOLDOUT/1'})
    with urllib.request.urlopen(req,timeout=60) as r:
        data=r.read()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names=[n for n in z.namelist() if not n.endswith('/')]
        if len(names)!=1: raise RuntimeError(f'unexpected archive members: {url}')
        return z.read(names[0]).decode('utf-8-sig').splitlines()

def ts_ms(v):
    x=int(float(v))
    while x>10**14: x//=1000
    return x

def parse_klines(lines):
    out=[]
    for row in csv.reader(lines):
        if not row: continue
        try:
            close=float(row[4]); close_ts=ts_ms(row[6])
        except (ValueError,IndexError):
            continue
        if close>0: out.append({'ts':close_ts,'close':close})
    return out

def parse_funding(lines):
    out=[]
    reader=csv.reader(lines)
    rows=list(reader)
    if not rows: return out
    header=[x.strip() for x in rows[0]]
    has_header=any(x in header for x in ('calc_time','fundingTime','last_funding_rate','fundingRate'))
    if has_header:
        idx={k:i for i,k in enumerate(header)}
        ti=idx.get('calc_time',idx.get('fundingTime'))
        ri=idx.get('last_funding_rate',idx.get('fundingRate'))
        data=rows[1:]
    else:
        # Historical Binance Vision USD-M fundingRate files use calc_time,
        # funding_interval_hours, last_funding_rate.
        ti,ri,data=0,2,rows
    if ti is None or ri is None: raise RuntimeError('unknown funding archive schema')
    for row in data:
        try:
            t=ts_ms(row[ti]); rate=float(row[ri])
        except (ValueError,IndexError,TypeError):
            continue
        out.append({'ts':t,'rate':rate})
    return out

def month_url(market,dataset,year,month,interval=None):
    ym=f'{year:04d}-{month:02d}'
    if dataset in ('klines','markPriceKlines'):
        return f'{BASE}/{market}/monthly/{dataset}/{SYMBOL}/{interval}/{SYMBOL}-{interval}-{ym}.zip'
    return f'{BASE}/{market}/monthly/{dataset}/{SYMBOL}/{SYMBOL}-{dataset}-{ym}.zip'

def download_klines(market,year,month,dataset='klines'):
    return parse_klines(fetch_zip(month_url(market,dataset,year,month,'1h')))

def at_or_before(rows,t):
    best=None
    for x in rows:
        if x['ts']<=t and (best is None or x['ts']>best['ts']): best=x
    return best

# Perpetual 1h closes are needed across the full holdout because funding is paid
# on fixed base quantity and therefore scales with mark/notional through time.
perp=download_klines('futures/um',2023,12)
mark=[]
funding=[]
for y,m in months(START,datetime(2026,5,1,tzinfo=timezone.utc)):
    sys.stderr.write(f'archive {y:04d}-{m:02d}\n')
    perp.extend(download_klines('futures/um',y,m))
    mark.extend(download_klines('futures/um',y,m,'markPriceKlines'))
    funding.extend(parse_funding(fetch_zip(month_url('futures/um','fundingRate',y,m))))

# Spot is only needed at frozen window boundaries for basis P&L.
spot=[]
for y,m in [(2023,12),(2024,12),(2025,12),(2026,5)]:
    spot.extend(download_klines('spot',y,m))

def dedupe(rows,key='ts'):
    d={x[key]:x for x in rows}
    return [d[k] for k in sorted(d)]

perp=dedupe(perp); mark=dedupe(mark); funding=dedupe(funding); spot=dedupe(spot)
start_ms=int(START.timestamp()*1000); end_ms=int(END.timestamp()*1000)

# Attach the closest preceding official Mark Price kline close to each funding
# settlement. Binance Vision funding archives contain rate/time but not mark price.
priced=[]
for x in funding:
    if not (start_ms < x['ts'] <= end_ms): continue
    p=at_or_before(mark,x['ts'])
    if p is None: raise RuntimeError(f'missing mark price before funding {x["ts"]}')
    priced.append({'ts':x['ts'],'rate':x['rate'],'markPrice':p['close']})

payload={
  'source':'Binance Vision official public archive',
  'symbol':SYMBOL,
  'spot':spot,
  'perp':perp,
  'funding':priced,
  'coverage':{
    'start':START.isoformat(),
    'end':END.isoformat(),
    'spotRows':len(spot),
    'perpRows':len(perp),
    'markPriceRows':len(mark),
    'fundingRows':len(priced)
  }
}
with open(OUT,'w') as f: json.dump(payload,f,separators=(',',':'))
print(json.dumps(payload['coverage']))
