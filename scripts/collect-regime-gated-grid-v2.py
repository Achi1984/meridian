#!/usr/bin/env python3
import io, os, time, urllib.error, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE='https://data.binance.vision/data/spot/monthly/klines'
SYMBOLS=['BTCUSDT','ETHUSDT']
OUT=os.environ.get('REGIME_GRID_DATA_DIR','/tmp/meridian-regime-grid')

def months(start,end):
    y,m=start
    ey,em=end
    while (y,m)<=(ey,em):
        yield y,m
        m+=1
        if m==13:y,m=y+1,1

def fetch(url):
    last=None
    for attempt in range(4):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'ACHI-MERIDIAN-REGIME-GRID/2'})
            with urllib.request.urlopen(req,timeout=90) as r:return r.read()
        except Exception as e:
            last=e
            if attempt<3:time.sleep(.75*(attempt+1))
    raise last

def one(symbol,interval,y,m):
    ym=f'{y:04d}-{m:02d}'
    url=f'{BASE}/{symbol}/{interval}/{symbol}-{interval}-{ym}.zip'
    try:raw=fetch(url)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'official Binance Vision archive missing {symbol} {interval} {ym}: HTTP {e.code}') from e
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names=[n for n in z.namelist() if not n.endswith('/')]
        if len(names)!=1:raise RuntimeError(f'unexpected archive members {symbol} {interval} {ym}')
        data=z.read(names[0])
    d=os.path.join(OUT,symbol[:-4],interval);os.makedirs(d,exist_ok=True)
    p=os.path.join(d,ym+'.csv')
    with open(p,'wb') as f:f.write(data)
    return symbol,interval,ym,len(data)

jobs=[]
for s in SYMBOLS:
    jobs += [(s,'1m',y,m) for y,m in months((2024,1),(2026,8))]
    jobs += [(s,'1d',y,m) for y,m in months((2023,6),(2026,8))]

os.makedirs(OUT,exist_ok=True)
with ThreadPoolExecutor(max_workers=8) as ex:
    futs={ex.submit(one,*j):j for j in jobs}
    done=0
    for fut in as_completed(futs):
        symbol,interval,ym,size=fut.result();done+=1
        print(f'{done}/{len(jobs)} {symbol} {interval} {ym} {size}',flush=True)

with open(os.path.join(OUT,'SOURCE.txt'),'w') as f:
    f.write('Official Binance Vision Spot monthly klines\n')
    f.write('1m: 2024-01 through 2026-08\n')
    f.write('1d: 2023-06 through 2026-08\n')
print(f'complete files={len(jobs)} out={OUT}')
