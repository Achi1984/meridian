#!/usr/bin/env python3
import csv, io, json, sys, urllib.request, zipfile
from datetime import datetime, timezone, timedelta

symbol=sys.argv[1]
start_ms=int(sys.argv[2])
end_ms=int(sys.argv[3])
interval='4h'
UA={'User-Agent':'MERIDIAN-Range-Reversion-V1/1.0'}

def dt(ms):
    return datetime.fromtimestamp(ms/1000,timezone.utc)

def next_month(d):
    return datetime(d.year+(1 if d.month==12 else 0),1 if d.month==12 else d.month+1,1,tzinfo=timezone.utc)

def fetch_zip(url):
    req=urllib.request.Request(url,headers=UA)
    try:
        with urllib.request.urlopen(req,timeout=30) as r:
            data=r.read()
    except Exception as e:
        code=getattr(e,'code',None)
        if code==404:return []
        raise
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        name=z.namelist()[0]
        text=z.read(name).decode('utf-8')
    out=[]
    for row in csv.reader(io.StringIO(text)):
        if not row or not row[0].isdigit():continue
        t=int(row[0])
        if t>10**14:t//=1000
        if start_ms<=t<end_ms:
            out.append({'t':t,'o':float(row[1]),'h':float(row[2]),'l':float(row[3]),'c':float(row[4])})
    return out

start=dt(start_ms)
end=dt(end_ms)
end_month=datetime(end.year,end.month,1,tzinfo=timezone.utc)
cursor=datetime(start.year,start.month,1,tzinfo=timezone.utc)
rows=[]

# Completed calendar months use Binance's monthly archive.
while cursor<end_month:
    stamp=cursor.strftime('%Y-%m')
    url=f'https://data.binance.vision/data/spot/monthly/klines/{symbol}/{interval}/{symbol}-{interval}-{stamp}.zip'
    rows.extend(fetch_zip(url))
    cursor=next_month(cursor)

# The partial final month is reconstructed from completed daily archives.
day=end_month
while day<end:
    stamp=day.strftime('%Y-%m-%d')
    url=f'https://data.binance.vision/data/spot/daily/klines/{symbol}/{interval}/{symbol}-{interval}-{stamp}.zip'
    rows.extend(fetch_zip(url))
    day+=timedelta(days=1)

rows.sort(key=lambda x:x['t'])
dedup=[]
last=None
for r in rows:
    if r['t']!=last:
        dedup.append(r);last=r['t']
print(json.dumps(dedup,separators=(',',':')))
