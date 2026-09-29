#!/usr/bin/env python3
"""Strategy-neutral availability/size audit for Binance USD-M individual trades.

Checks 120 monthly archive + CHECKSUM objects only. Does not download archive
contents, parse trades, calculate order imbalance, returns, positions, or PnL.
"""
import json, os, re, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

BASE="https://data.binance.vision/data/futures/um/monthly/trades"
ASSETS=("BTCUSDT","ETHUSDT","XRPUSDT","SOLUSDT","DOGEUSDT","ADAUSDT")
MONTHS=tuple(
    f"{y:04d}-{m:02d}"
    for y, ms in ((2025,range(1,13)),(2026,range(1,9)))
    for m in ms
)
UA="MERIDIAN-QH-INDIVIDUAL-TRADES-SOURCE-V0-1/1"
OUT=Path(os.environ.get("QH_TRADES_SOURCE_OUT","research/results"))
OUT.mkdir(parents=True,exist_ok=True)

def url(asset,ym):
    return f"{BASE}/{asset}/{asset}-trades-{ym}.zip"

def get_text(u):
    req=urllib.request.Request(u,headers={"User-Agent":UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=30) as r:
        return r.read().decode("utf-8","replace")

def content_length(u):
    req=urllib.request.Request(u,headers={"User-Agent":UA,"Accept-Encoding":"identity"},method="HEAD")
    try:
        with urllib.request.urlopen(req,timeout=30) as r:
            return int(r.headers.get("Content-Length") or 0)
    except urllib.error.HTTPError as e:
        if e.code not in (400,403,405): raise
    req=urllib.request.Request(u,headers={
        "User-Agent":UA,"Accept-Encoding":"identity","Range":"bytes=0-0"
    })
    with urllib.request.urlopen(req,timeout=30) as r:
        cr=r.headers.get("Content-Range","").split("/")[-1]
        return int(cr) if cr.isdigit() else int(r.headers.get("Content-Length") or 0)

def check(asset,ym):
    u=url(asset,ym)
    item={"asset":asset,"month":ym,"url":u,"checksumUrl":u+".CHECKSUM"}
    try:
        txt=get_text(u+".CHECKSUM")
        m=re.search(r"([0-9a-fA-F]{64})",txt)
        if not m: raise RuntimeError("checksum file lacks SHA-256")
        size=content_length(u)
        if size<=0: raise RuntimeError("archive content length unavailable/non-positive")
        item.update({"available":True,"sha256":m.group(1).lower(),"contentLength":size})
    except Exception as e:
        item.update({"available":False,"error":f"{type(e).__name__}: {e}"})
    return item

jobs=[(a,m) for a in ASSETS for m in MONTHS]
items=[]
with ThreadPoolExecutor(max_workers=20) as ex:
    futs=[ex.submit(check,*j) for j in jobs]
    for i,f in enumerate(as_completed(futs),1):
        items.append(f.result())
        if i%20==0 or i==len(futs):
            print(f"checked {i}/{len(futs)} monthly trades archives",flush=True)

items.sort(key=lambda x:(x["asset"],x["month"]))
missing=[x for x in items if not x["available"]]
by_asset={}
for a in ASSETS:
    rows=[x for x in items if x["asset"]==a]
    by_asset[a]={
        "expected":20,
        "available":sum(1 for x in rows if x["available"]),
        "missing":sum(1 for x in rows if not x["available"]),
        "publishedBytes":sum(x.get("contentLength",0) for x in rows if x["available"])
    }

summary={
    "schema":1,
    "generatedAt":datetime.now(timezone.utc).isoformat(),
    "family":"PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
    "stage":"INDIVIDUAL_TRADES_SOURCE_V0_1_AVAILABILITY",
    "source":"Binance Vision official public USD-M monthly trades archives",
    "assets":list(ASSETS),"months":list(MONTHS),
    "expectedObjects":120,"availableObjects":120-len(missing),"missingObjects":len(missing),
    "publishedBytes":sum(x.get("contentLength",0) for x in items if x["available"]),
    "byAsset":by_asset,"missing":missing,
    "marketRowsParsed":False,
    "directionalOrderImbalanceCalculated":False,
    "forwardReturnsCalculated":False,
    "signalReturnRelationshipCalculated":False,
    "positionsCalculated":False,
    "strategyPnlCalculated":False,
    "executionImpact":False,"paperAuthorized":False,"liveAuthorized":False,
    "decision":"INDIVIDUAL_TRADES_SOURCE_V0_1_PASS_DATA_QUALITY_PROTOCOL_REQUIRED" if not missing
               else "INDIVIDUAL_TRADES_SOURCE_V0_1_FAIL_AVAILABILITY"
}
(OUT/"qh-individual-trades-source-v0-1-summary.json").write_text(json.dumps(summary,indent=2)+"\n")
(OUT/"qh-individual-trades-source-v0-1-full.json").write_text(json.dumps({"summary":summary,"objects":items},indent=2)+"\n")
print(json.dumps(summary,indent=2))
if missing: raise SystemExit(2)
