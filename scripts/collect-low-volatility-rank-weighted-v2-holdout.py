#!/usr/bin/env python3
"""Collect first-authorized Rank-Weighted V2 untouched Holdout source.

Official public Binance Vision USD-M monthly 1h klines and fundingRate archives.
Never run on pull requests.
"""
import csv
import hashlib
import io
import json
import os
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path

BASE="https://data.binance.vision/data/futures/um/monthly"
ASSETS=["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","LINK","DOT","LTC","BCH","AVAX"]
START="2025-12"
END="2026-08"
OUT=Path(os.environ.get("LOWVOL_RANK_V2_HOLDOUT_DATA_DIR","/tmp/meridian-lowvol-rank-v2-holdout"))
UA="ACHI-MERIDIAN-LOWVOL-RANK-V2-HOLDOUT/1"

KLINE_START_MS=1764975600000  # 2025-12-05T23:00:00Z
HOLDOUT_START_MS=1767398400000 # 2026-01-03T00:00:00Z
HOLDOUT_END_MS=1787961600000   # 2026-08-29T00:00:00Z inclusive terminal open


def month_range(a,b):
    y,m=map(int,a.split("-"));ey,em=map(int,b.split("-"))
    while y<ey or (y==ey and m<=em):
        yield f"{y:04d}-{m:02d}"
        m+=1
        if m==13:y,m=y+1,1


def fetch_zip(url):
    last=None
    for attempt in range(4):
        try:
            req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept-Encoding":"identity"})
            with urllib.request.urlopen(req,timeout=90) as r:raw=r.read()
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                names=[n for n in z.namelist() if not n.endswith("/")]
                if len(names)!=1:raise RuntimeError(f"unexpected archive members: {url}")
                return raw,z.read(names[0]).decode("utf-8-sig").splitlines()
        except Exception as exc:
            last=exc
            if attempt<3:time.sleep(.6*(attempt+1))
    raise last


def sha256_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def ts_ms(v):
    x=int(float(v))
    while x>10**14:x//=1000
    return x


def parse_kline(lines):
    out=[]
    for row in csv.reader(lines):
        if not row:continue
        if str(row[0]).strip().lower() in ("open_time","opentime","timestamp","time"):continue
        try:
            if len(row)<5:raise ValueError("short row")
            ot=ts_ms(row[0])
            o=float(row[1]);h=float(row[2]);l=float(row[3]);c=float(row[4])
        except (ValueError,IndexError,TypeError):
            continue
        out.append([ot,o,h,l,c])
    return out


def parse_funding(lines):
    out=[]
    for row in csv.reader(lines):
        if not row:continue
        first=str(row[0]).strip().lower()
        if first in ("calc_time","calctime","timestamp","time"):continue
        try:
            if len(row)<3:raise ValueError("short row")
            t=ts_ms(row[0])
            interval=int(float(row[1]))
            rate=float(row[2])
        except (ValueError,IndexError,TypeError):
            continue
        out.append([t,interval,rate])
    return out


def urls(asset,ym):
    s=asset+"USDT"
    k=f"{BASE}/klines/{s}/1h/{s}-1h-{ym}.zip"
    f=f"{BASE}/fundingRate/{s}/{s}-fundingRate-{ym}.zip"
    return k,f


def one(asset,ym,kind):
    k,f=urls(asset,ym)
    u=k if kind=="kline" else f
    try:raw,lines=fetch_zip(u)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"official archive missing {asset} {ym} {kind}: HTTP {exc.code}") from exc
    rows=parse_kline(lines) if kind=="kline" else parse_funding(lines)
    return asset,ym,kind,u,sha256_bytes(raw),rows


OUT.mkdir(parents=True,exist_ok=True)
months=list(month_range(START,END))
jobs=[(a,ym,kind) for a in ASSETS for ym in months for kind in ("kline","funding")]
data={
 a:{
   "asset":a,
   "symbol":a+"USDT",
   "hourly":[],
   "funding":[],
   "klineSources":[],
   "fundingSources":[]
 } for a in ASSETS
}

with ThreadPoolExecutor(max_workers=20) as ex:
    futs={ex.submit(one,*job):job for job in jobs}
    done=0
    for fut in as_completed(futs):
        asset,ym,kind,u,digest,rows=fut.result();done+=1
        if kind=="kline":
            data[asset]["hourly"].extend(rows)
            data[asset]["klineSources"].append({"month":ym,"url":u,"rows":len(rows),"archiveSha256":digest})
        else:
            data[asset]["funding"].extend(rows)
            data[asset]["fundingSources"].append({"month":ym,"url":u,"rows":len(rows),"archiveSha256":digest})
        if done%48==0 or done==len(jobs):
            print(f"{done}/{len(jobs)} archives",flush=True)

manifest={
  "schemaVersion":"MERIDIAN-LOWVOL-RANK-WEIGHTED-V2-HOLDOUT-SOURCE-1",
  "source":"Binance Vision official public USD-M monthly archives",
  "ruleset":"LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN",
  "stage":"UNTOUCHED_HOLDOUT_SOURCE",
  "range":{"start":START,"end":END},
  "assets":ASSETS,
  "privateData":False,
  "syntheticBackfill":False,
  "developmentMetricsIncluded":False,
  "paperOrLiveData":False,
  "requiredHourlyStart":"2025-12-05T23:00:00Z",
  "requiredHourlyEndInclusive":"2026-08-29T00:00:00Z",
  "holdoutFundingRetainedFrom":"2026-01-03T00:00:00Z",
  "holdoutFundingRetainedThrough":"2026-08-29T00:00:00Z",
  "files":{}
}

for asset,d in data.items():
    d["hourly"].sort(key=lambda x:x[0])
    d["hourly"]=[r for r in d["hourly"] if KLINE_START_MS<=int(r[0])<=HOLDOUT_END_MS]
    d["funding"].sort(key=lambda x:x[0])
    d["funding"]=[r for r in d["funding"] if HOLDOUT_START_MS<=int(r[0])<=HOLDOUT_END_MS]
    d["klineSources"].sort(key=lambda x:x["month"])
    d["fundingSources"].sort(key=lambda x:x["month"])

    p=OUT/(asset+".json")
    p.write_text(json.dumps(d,separators=(",",":"))+"\n")
    raw=p.read_bytes()
    manifest["files"][asset]={
      "path":p.name,
      "hourlyRows":len(d["hourly"]),
      "fundingRows":len(d["funding"]),
      "klineArchives":len(d["klineSources"]),
      "fundingArchives":len(d["fundingSources"]),
      "firstHourly":d["hourly"][0][0] if d["hourly"] else None,
      "lastHourly":d["hourly"][-1][0] if d["hourly"] else None,
      "firstFunding":d["funding"][0][0] if d["funding"] else None,
      "lastFunding":d["funding"][-1][0] if d["funding"] else None,
      "jsonSha256":sha256_bytes(raw),
    }

(OUT/"manifest.json").write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n")
print(json.dumps({
 "schemaVersion":manifest["schemaVersion"],
 "assets":manifest["assets"],
 "requiredHourlyStart":manifest["requiredHourlyStart"],
 "requiredHourlyEndInclusive":manifest["requiredHourlyEndInclusive"],
 "files":manifest["files"],
},sort_keys=True))
