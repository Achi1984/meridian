#!/usr/bin/env python3
"""Collect the first authorized Low-Volatility V1 Discovery source.

Public Binance Vision USD-M monthly 1h klines only.
This script has no feature-result or strategy/PnL logic and is never run on PRs.
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
START="2025-01"
END="2026-01"
OUT=Path(os.environ.get("LOWVOL_V1_DISCOVERY_DATA_DIR","/tmp/meridian-lowvol-v1-discovery"))
UA="ACHI-MERIDIAN-LOWVOL-V1-DISCOVERY/1"
SOURCE_START_MS=1735941600000  # 2025-01-03T22:00:00Z
SOURCE_END_MS=1767398400000    # 2026-01-03T00:00:00Z inclusive


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


def url(asset,ym):
    s=asset+"USDT"
    return f"{BASE}/klines/{s}/1h/{s}-1h-{ym}.zip"


def one(asset,ym):
    u=url(asset,ym)
    try:raw,lines=fetch_zip(u)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"official archive missing {asset} {ym}: HTTP {exc.code}") from exc
    return asset,ym,u,sha256_bytes(raw),parse_kline(lines)


OUT.mkdir(parents=True,exist_ok=True)
months=list(month_range(START,END))
jobs=[(a,ym) for a in ASSETS for ym in months]
data={a:{"asset":a,"symbol":a+"USDT","hourly":[],"sources":[]} for a in ASSETS}

with ThreadPoolExecutor(max_workers=20) as ex:
    futs={ex.submit(one,*job):job for job in jobs}
    done=0
    for fut in as_completed(futs):
        asset,ym,u,digest,rows=fut.result();done+=1
        data[asset]["hourly"].extend(rows)
        data[asset]["sources"].append({"month":ym,"url":u,"rows":len(rows),"archiveSha256":digest})
        if done%48==0 or done==len(jobs):
            print(f"{done}/{len(jobs)} archives",flush=True)

manifest={
  "schemaVersion":"MERIDIAN-LOWVOL-V1-DISCOVERY-SOURCE-1",
  "source":"Binance Vision official public USD-M monthly archives",
  "ruleset":"CROSS-SECTIONAL-LOW-VOLATILITY-V1-FROZEN",
  "stage":"DISCOVERY_FEATURE_VALIDATION_SOURCE",
  "range":{"start":START,"end":END},
  "assets":ASSETS,
  "fundingLoaded":False,
  "strategyPnlCalculated":False,
  "privateData":False,
  "syntheticBackfill":False,
  "holdoutRowsRetained":False,
  "requiredHourlyStart":"2025-01-03T22:00:00Z",
  "requiredHourlyEndInclusive":"2026-01-03T00:00:00Z",
  "files":{}
}

for asset,d in data.items():
    d["hourly"].sort(key=lambda x:x[0])
    d["hourly"]=[r for r in d["hourly"] if SOURCE_START_MS<=int(r[0])<=SOURCE_END_MS]
    d["sources"].sort(key=lambda x:x["month"])
    p=OUT/(asset+".json")
    p.write_text(json.dumps(d,separators=(",",":"))+"\n")
    raw=p.read_bytes()
    manifest["files"][asset]={
      "path":p.name,
      "hourlyRows":len(d["hourly"]),
      "sourceArchives":len(d["sources"]),
      "firstHourly":d["hourly"][0][0] if d["hourly"] else None,
      "lastHourly":d["hourly"][-1][0] if d["hourly"] else None,
      "jsonSha256":sha256_bytes(raw)
    }

(OUT/"manifest.json").write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n")
print(json.dumps({
  "schemaVersion":manifest["schemaVersion"],
  "range":manifest["range"],
  "assets":manifest["assets"],
  "holdoutRowsRetained":manifest["holdoutRowsRetained"],
  "files":manifest["files"]
},sort_keys=True))
