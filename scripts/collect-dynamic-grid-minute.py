#!/usr/bin/env python3
import io, os, time, urllib.error, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

BASE='https://data.binance.vision/data/spot/monthly/klines'
SYMBOLS=['BTCUSDT','ETHUSDT']
START=(2022,1)
END=(2024,7)
OUT=os.environ.get('DYNAMIC_GRID_DATA_DIR','/tmp/meridian-dynamic-grid')

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
            req=urllib.request.Request(url,headers={'User-Agent':'ACHI-MERIDIAN-DYNAMIC-GRID/1'})
            with urllib.request.urlopen(req,timeout=90) as r:
                return r.read()
        except Exception as e:
            last=e
            if attempt<3:time.sleep(0.75*(attempt+1))
    raise last

def one(symbol,y,m):
    ym=f'{y:04d}-{m:02d}'
    url=f'{BASE}/{symbol}/1m/{symbol}-1m-{ym}.zip'
    try:
        raw=fetch(url)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'official Binance Vision archive missing {symbol} {ym}: HTTP {e.code}') from e
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names=[n for n in z.namelist() if not n.endswith('/')]
        if len(names)!=1:raise RuntimeError(f'unexpected archive members {symbol} {ym}')
        data=z.read(names[0])
    d=os.path.join(OUT,symbol[:-4]);os.makedirs(d,exist_ok=True)
    p=os.path.join(d,ym+'.csv')
    with open(p,'wb') as f:f.write(data)
    return symbol,ym,len(data)

os.makedirs(OUT,exist_ok=True)
jobs=[(s,y,m) for s in SYMBOLS for y,m in months(START,END)]
with ThreadPoolExecutor(max_workers=8) as ex:
    futs={ex.submit(one,*j):j for j in jobs}
    done=0
    for fut in as_completed(futs):
        symbol,ym,size=fut.result();done+=1
        print(f'{done}/{len(jobs)} {symbol} {ym} {size}',flush=True)

with open(os.path.join(OUT,'SOURCE.txt'),'w') as f:
    f.write('Official Binance Vision spot monthly 1m klines\n')
    f.write('BTCUSDT, ETHUSDT\n')
    f.write('2022-01 through 2024-07 UTC\n')
print(f'complete files={len(jobs)} out={OUT}')
