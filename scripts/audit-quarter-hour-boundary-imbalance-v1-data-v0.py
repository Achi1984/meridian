#!/usr/bin/env python3
"""Strategy-neutral archive availability audit for Quarter-Hour Boundary Imbalance V1.

This script MUST NOT download/parse market rows or calculate any signal/return/PnL.
It only checks official Binance Vision archive/checksum publication metadata.
"""
import json
import os
import re
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'research'/'results'
BASE='https://data.binance.vision/data/futures/um/monthly'
ASSETS=('BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','DOGEUSDT','ADAUSDT')
START=(2025,1)
END=(2026,8)
UA='MERIDIAN-QH-IMBALANCE-V1-DATA-V0/1'

def months(start,end):
    y,m=start
    ey,em=end
    while (y,m) <= (ey,em):
        yield f'{y:04d}-{m:02d}'
        m+=1
        if m==13:
            y,m=y+1,1

MONTHS=tuple(months(START,END))

def object_url(asset,family,ym):
    if family=='aggTrades':
        return f'{BASE}/aggTrades/{asset}/{asset}-aggTrades-{ym}.zip'
    if family=='klines1m':
        return f'{BASE}/klines/{asset}/1m/{asset}-1m-{ym}.zip'
    if family=='fundingRate':
        return f'{BASE}/fundingRate/{asset}/{asset}-fundingRate-{ym}.zip'
    raise ValueError(family)

def get_text(url):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Encoding':'identity'})
    with urllib.request.urlopen(req,timeout=30) as r:
        return r.read().decode('utf-8','replace'), dict(r.headers)

def head(url):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Encoding':'identity'},method='HEAD')
    try:
        with urllib.request.urlopen(req,timeout=30) as r:
            return int(r.headers.get('Content-Length') or 0), dict(r.headers)
    except urllib.error.HTTPError as e:
        if e.code not in (400,403,405):
            raise
    # Fallback: request one byte. Do not download archive contents.
    req=urllib.request.Request(
        url,
        headers={'User-Agent':UA,'Accept-Encoding':'identity','Range':'bytes=0-0'}
    )
    with urllib.request.urlopen(req,timeout=30) as r:
        total=r.headers.get('Content-Range','').split('/')[-1]
        return int(total) if total.isdigit() else int(r.headers.get('Content-Length') or 0), dict(r.headers)

def check(asset,family,ym):
    url=object_url(asset,family,ym)
    checksum_url=url+'.CHECKSUM'
    item={'asset':asset,'family':family,'month':ym,'url':url,'checksumUrl':checksum_url}
    try:
        checksum,cheaders=get_text(checksum_url)
        m=re.search(r'([0-9a-fA-F]{64})',checksum)
        if not m:
            raise RuntimeError('checksum file lacks SHA-256')
        size,zheaders=head(url)
        item.update({
            'available':True,
            'sha256':m.group(1).lower(),
            'contentLength':size,
            'etag':zheaders.get('ETag'),
        })
    except Exception as e:
        item.update({'available':False,'error':f'{type(e).__name__}: {e}'})
    return item

families=('aggTrades','klines1m','fundingRate')
jobs=[(a,f,m) for a in ASSETS for f in families for m in MONTHS]
items=[]

with ThreadPoolExecutor(max_workers=20) as ex:
    futs=[ex.submit(check,*job) for job in jobs]
    for i,fut in enumerate(as_completed(futs),1):
        items.append(fut.result())
        if i%60==0 or i==len(futs):
            print(f'checked {i}/{len(futs)} archive objects',flush=True)

items.sort(key=lambda x:(x['family'],x['asset'],x['month']))
available=[x for x in items if x['available']]
missing=[x for x in items if not x['available']]
by_family={}
for family in families:
    rows=[x for x in items if x['family']==family]
    by_family[family]={
        'expected':len(rows),
        'available':sum(1 for x in rows if x['available']),
        'missing':sum(1 for x in rows if not x['available']),
        'publishedBytes':sum(x.get('contentLength',0) for x in rows if x['available'])
    }

decision='FOUNDATION_V0_PASS_FULL_DATA_QUALITY_AUDIT_REQUIRED' if not missing else 'FOUNDATION_V0_FAIL_DATA_AVAILABILITY'
summary={
    'schema':1,
    'generatedAt':datetime.now(timezone.utc).isoformat(),
    'family':'PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1',
    'stage':'DATA_V0_ARCHIVE_AVAILABILITY',
    'source':'Binance Vision official public USD-M monthly archives',
    'assets':list(ASSETS),
    'months':list(MONTHS),
    'dataFamilies':list(families),
    'expectedObjects':len(jobs),
    'availableObjects':len(available),
    'missingObjects':len(missing),
    'byFamily':by_family,
    'missing':missing,
    'signalCalculated':False,
    'forwardReturnsCalculated':False,
    'strategyPnlCalculated':False,
    'positionsCalculated':False,
    'executionImpact':False,
    'paperAuthorized':False,
    'liveAuthorized':False,
    'decision':decision
}
full={'summary':summary,'objects':items}

OUT.mkdir(parents=True,exist_ok=True)
(OUT/'quarter-hour-boundary-imbalance-v1-data-v0-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
(OUT/'quarter-hour-boundary-imbalance-v1-data-v0-full.json').write_text(json.dumps(full,indent=2)+'\n')

print(json.dumps(summary,indent=2))
if missing:
    raise SystemExit(2)
