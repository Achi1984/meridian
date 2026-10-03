#!/usr/bin/env python3
"""Collect prospective-only public source for frozen Low-Volatility V2 shadow.

Uses only Binance USD-M public market-data endpoints. No API key, account data,
orders, positions, balances, or exchange mutation are used.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime,timezone
from pathlib import Path

ASSETS=["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","LINK","DOT","LTC","BCH","AVAX"]
BASE="https://fapi.binance.com"
UA="ACHI-MERIDIAN-LOWVOL-V2-PROSPECTIVE-SHADOW/1"
HOUR=60*60*1000
WEEK=7*24*HOUR
PROSPECTIVE_START=1791590400000       # 2026-10-10T00:00:00Z
WARMUP_START=1789167600000            # 2026-09-11T23:00:00Z
OUT=Path(os.environ.get("LOWVOL_V2_PROSPECTIVE_DATA_DIR","/tmp/meridian-lowvol-v2-prospective"))


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical_json_bytes(obj):
    return json.dumps(obj,sort_keys=True,separators=(",",":")).encode()


def get_json(path,params=None):
    query=urllib.parse.urlencode(params or {})
    url=BASE+path+("?" + query if query else "")
    last=None
    for attempt in range(5):
        try:
            req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"application/json"})
            with urllib.request.urlopen(req,timeout=45) as resp:
                raw=resp.read()
            data=json.loads(raw.decode())
            return data,{"url":url,"sha256":sha256(raw),"bytes":len(raw)}
        except Exception as exc:
            last=exc
            if attempt<4:
                time.sleep(0.8*(attempt+1))
    raise RuntimeError(f"public Binance request failed: {url}: {last}")


def saturday_cutoff(now_ms):
    day=24*HOUR
    midnight=(int(now_ms)//day)*day
    weekday=(int(now_ms)//day+3)%7  # Monday=0; Saturday=5
    days_since_saturday=(weekday-5)%7
    return midnight-days_since_saturday*day


def fetch_klines(symbol,start_ms,end_ms):
    rows=[]
    receipts=[]
    cursor=int(start_ms)
    end=int(end_ms)
    while cursor<=end:
        page_end=min(end,cursor+(1499*HOUR))
        data,receipt=get_json("/fapi/v1/klines",{
            "symbol":symbol,"interval":"1h","startTime":cursor,"endTime":page_end,"limit":1500
        })
        receipts.append(receipt)
        if not isinstance(data,list):
            raise RuntimeError(f"{symbol}:unexpected kline payload")
        parsed=[]
        for r in data:
            if not isinstance(r,list) or len(r)<5:
                raise RuntimeError(f"{symbol}:malformed kline row")
            t=int(r[0])
            if cursor<=t<=page_end:
                parsed.append([t,float(r[1]),float(r[2]),float(r[3]),float(r[4])])
        parsed.sort(key=lambda x:x[0])
        if not parsed:
            raise RuntimeError(f"{symbol}:missing kline page {cursor}..{page_end}")
        rows.extend(parsed)
        cursor=page_end+HOUR
    dedup={int(r[0]):r for r in rows}
    out=[dedup[t] for t in sorted(dedup)]
    expected=((end-int(start_ms))//HOUR)+1
    if len(out)!=expected:
        raise RuntimeError(f"{symbol}:kline rows {len(out)} != {expected}")
    for i,r in enumerate(out):
        if int(r[0])!=int(start_ms)+i*HOUR:
            raise RuntimeError(f"{symbol}:non-contiguous kline source at {i}")
    return out,receipts


def fetch_funding(symbol,start_ms,end_ms,interval_hours):
    if end_ms<=start_ms:
        return [],[]
    data,receipt=get_json("/fapi/v1/fundingRate",{
        "symbol":symbol,"startTime":int(start_ms),"endTime":int(end_ms),"limit":1000
    })
    if not isinstance(data,list):
        raise RuntimeError(f"{symbol}:unexpected funding payload")
    rows=[]
    for r in data:
        if not isinstance(r,dict):
            raise RuntimeError(f"{symbol}:malformed funding row")
        rate_type=r.get("rateType")
        if rate_type not in (None,"Regular"):
            raise RuntimeError(f"{symbol}:unsupported funding rateType {rate_type}")
        t=int(r["fundingTime"])
        if int(start_ms)<=t<=int(end_ms):
            rows.append([t,int(interval_hours),float(r["fundingRate"])])
    rows.sort(key=lambda x:x[0])
    for a,b in zip(rows,rows[1:]):
        if b[0]<=a[0]:
            raise RuntimeError(f"{symbol}:nonmonotonic funding")

    # Each canonical weekly snapshot validates the newest completed week
    # against Binance's currently published interval. Older canonical weeks
    # remain preserved in the append-only evidence ledger and are not
    # retroactively reclassified when Binance later changes an interval.
    latest_start=max(int(start_ms),int(end_ms)-WEEK)
    recent=[x for x in rows if latest_start<x[0]<=int(end_ms)]
    if int(end_ms)>int(start_ms):
        allowed=int(interval_hours)*HOUR+1000
        if not recent:
            raise RuntimeError(f"{symbol}:missing latest-week funding")
        if recent[0][0]-latest_start>allowed:
            raise RuntimeError(f"{symbol}:latest-week funding head gap")
        for a,b in zip(recent,recent[1:]):
            if b[0]-a[0]>allowed:
                raise RuntimeError(f"{symbol}:latest-week funding internal gap")
        if int(end_ms)-recent[-1][0]>allowed:
            raise RuntimeError(f"{symbol}:latest-week funding tail gap")
    return rows,[receipt]


OUT.mkdir(parents=True,exist_ok=True)

server,server_receipt=get_json("/fapi/v1/time")
server_time=int(server["serverTime"])
cutoff=saturday_cutoff(server_time)
if cutoff>server_time:
    raise RuntimeError("computed prospective cutoff is in the future")
if cutoff<WARMUP_START:
    raise RuntimeError("server time predates frozen prospective warmup")

funding_info,fi_receipt=get_json("/fapi/v1/fundingInfo")
if not isinstance(funding_info,list):
    raise RuntimeError("unexpected fundingInfo payload")
intervals={}
for x in funding_info:
    if isinstance(x,dict) and x.get("symbol") in {a+"USDT" for a in ASSETS}:
        intervals[x["symbol"]]=int(x.get("fundingIntervalHours",8))

manifest={
    "schemaVersion":"MERIDIAN-LOWVOL-RANK-WEIGHTED-V2-PROSPECTIVE-SOURCE-1",
    "source":"Binance USD-M public REST market data",
    "stage":"PROSPECTIVE_PAPER_SHADOW_SOURCE",
    "ruleset":"LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN",
    "serverTime":server_time,
    "collectedAt":int(datetime.now(timezone.utc).timestamp()*1000),
    "cutoff":cutoff,
    "prospectiveStart":PROSPECTIVE_START,
    "warmupStart":WARMUP_START,
    "assets":ASSETS,
    "privateData":False,
    "credentialsUsed":False,
    "ordersPlaced":False,
    "exchangeMutation":False,
    "syntheticBackfill":False,
    "serverTimeReceipt":server_receipt,
    "fundingInfoReceipt":fi_receipt,
    "files":{},
}

for asset in ASSETS:
    symbol=asset+"USDT"
    hourly,k_receipts=fetch_klines(symbol,WARMUP_START,cutoff)
    interval=int(intervals.get(symbol,8))
    if interval<=0 or interval>24:
        raise RuntimeError(f"{symbol}:invalid current funding interval {interval}")
    funding,f_receipts=fetch_funding(symbol,PROSPECTIVE_START,cutoff,interval)

    payload={
        "asset":asset,
        "symbol":symbol,
        "hourly":hourly,
        "funding":funding,
        "fundingIntervalHours":interval,
        "sourceReceipts":{"klines":k_receipts,"funding":f_receipts},
    }
    p=OUT/(asset+".json")
    p.write_text(json.dumps(payload,separators=(",",":"))+"\n")
    manifest["files"][asset]={
        "path":p.name,
        "jsonSha256":sha256(p.read_bytes()),
        "hourlyRows":len(hourly),
        "fundingRows":len(funding),
        "firstHourly":hourly[0][0],
        "lastHourly":hourly[-1][0],
        "fundingIntervalHours":interval,
    }

manifest["manifestPayloadSha256"]=sha256(canonical_json_bytes({
    k:v for k,v in manifest.items() if k!="manifestPayloadSha256"
}))
(OUT/"manifest.json").write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n")
print(json.dumps({
    "schemaVersion":manifest["schemaVersion"],
    "serverTime":server_time,
    "cutoff":cutoff,
    "prospectiveStart":PROSPECTIVE_START,
    "completedObservationCapacity":max(0,(cutoff-PROSPECTIVE_START)//WEEK),
    "files":manifest["files"],
},sort_keys=True))
