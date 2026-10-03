#!/usr/bin/env python3
"""Collect prospective-only source from official Binance Vision USD-M archives.

Uses only public static archive files: completed monthly archives for prior
months and completed daily archives for the current cutoff month. No account,
credential, order, position, balance, or exchange-mutation endpoint is used.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime,timezone,timedelta
from pathlib import Path

BASE="https://data.binance.vision/data/futures/um"
ASSETS=["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","LINK","DOT","LTC","BCH","AVAX"]
UA="ACHI-MERIDIAN-LOWVOL-V2-PROSPECTIVE-VISION/1"
HOUR=60*60*1000
DAY=24*HOUR
WEEK=7*DAY
PROSPECTIVE_START=1791590400000       # 2026-10-10T00:00:00Z
WARMUP_START=1789167600000            # 2026-09-11T23:00:00Z
ARCHIVE_COMPLETION_LAG_MS=24*HOUR
OUT=Path(os.environ.get("LOWVOL_V2_PROSPECTIVE_DATA_DIR","/tmp/meridian-lowvol-v2-prospective"))


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical_json_bytes(obj):
    return json.dumps(obj,sort_keys=True,separators=(",",":")).encode()


def ts_ms(v):
    x=int(float(v))
    while x>10**14:
        x//=1000
    return x


def fetch_zip(url):
    last=None
    for attempt in range(5):
        try:
            req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept-Encoding":"identity"})
            with urllib.request.urlopen(req,timeout=60) as resp:
                raw=resp.read()
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                names=[n for n in z.namelist() if not n.endswith("/")]
                if len(names)!=1:
                    raise RuntimeError(f"unexpected archive members: {url}")
                lines=z.read(names[0]).decode("utf-8-sig").splitlines()
            return lines,{"url":url,"sha256":sha256(raw),"bytes":len(raw)}
        except Exception as exc:
            last=exc
            if attempt<4:
                time.sleep(0.7*(attempt+1))
    raise RuntimeError(f"official Binance Vision archive unavailable: {url}: {last}")


def parse_kline(lines):
    out=[]
    for row in csv.reader(lines):
        if not row:
            continue
        if str(row[0]).strip().lower() in ("open_time","opentime","timestamp","time"):
            continue
        try:
            if len(row)<5:
                raise ValueError("short row")
            t=ts_ms(row[0])
            o=float(row[1]);h=float(row[2]);l=float(row[3]);c=float(row[4])
        except (ValueError,IndexError,TypeError):
            continue
        out.append([t,o,h,l,c])
    return out


def parse_funding(lines):
    out=[]
    for row in csv.reader(lines):
        if not row:
            continue
        first=str(row[0]).strip().lower()
        if first in ("calc_time","calctime","timestamp","time"):
            continue
        try:
            if len(row)<3:
                raise ValueError("short row")
            t=ts_ms(row[0])
            interval=int(float(row[1]))
            rate=float(row[2])
        except (ValueError,IndexError,TypeError):
            continue
        out.append([t,interval,rate])
    return out


def saturday_cutoff(now_ms):
    midnight=(int(now_ms)//DAY)*DAY
    weekday=(int(now_ms)//DAY+3)%7  # Monday=0; Saturday=5
    latest=midnight-((weekday-5)%7)*DAY
    if int(now_ms)-latest<ARCHIVE_COMPLETION_LAG_MS:
        latest-=WEEK
    return latest


def month_key(ms):
    return datetime.fromtimestamp(int(ms)/1000,timezone.utc).strftime("%Y-%m")


def date_key(ms):
    return datetime.fromtimestamp(int(ms)/1000,timezone.utc).strftime("%Y-%m-%d")


def month_start(dt):
    return datetime(dt.year,dt.month,1,tzinfo=timezone.utc)


def next_month(dt):
    return datetime(dt.year+(1 if dt.month==12 else 0),1 if dt.month==12 else dt.month+1,1,tzinfo=timezone.utc)


def archive_plan(start_ms,end_ms,kind,symbol):
    """Completed prior months + daily archives for the cutoff month."""
    start_dt=datetime.fromtimestamp(int(start_ms)/1000,timezone.utc)
    end_dt=datetime.fromtimestamp(int(end_ms)/1000,timezone.utc)
    current_month=month_start(end_dt)
    plan=[]

    m=month_start(start_dt)
    while m<current_month:
        ym=m.strftime("%Y-%m")
        if kind=="kline":
            url=f"{BASE}/monthly/klines/{symbol}/1h/{symbol}-1h-{ym}.zip"
        else:
            url=f"{BASE}/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{ym}.zip"
        plan.append(("monthly",ym,url))
        m=next_month(m)

    day=max(start_dt,current_month).date()
    last=end_dt.date()
    while day<=last:
        ymd=day.isoformat()
        if kind=="kline":
            url=f"{BASE}/daily/klines/{symbol}/1h/{symbol}-1h-{ymd}.zip"
        else:
            url=f"{BASE}/daily/fundingRate/{symbol}/{symbol}-fundingRate-{ymd}.zip"
        plan.append(("daily",ymd,url))
        day+=timedelta(days=1)
    return plan


def load_rows(symbol,start_ms,end_ms,kind):
    parser=parse_kline if kind=="kline" else parse_funding
    rows=[]
    receipts=[]
    for scope,key,url in archive_plan(start_ms,end_ms,kind,symbol):
        lines,receipt=fetch_zip(url)
        parsed=parser(lines)
        receipt.update({"scope":scope,"key":key,"rows":len(parsed)})
        receipts.append(receipt)
        rows.extend(parsed)
    dedup={int(r[0]):r for r in rows if int(start_ms)<=int(r[0])<=int(end_ms)}
    return [dedup[t] for t in sorted(dedup)],receipts


def validate_latest_week_funding(symbol,rows,start_ms,end_ms):
    if int(end_ms)<=int(start_ms):
        return
    latest_start=max(int(start_ms),int(end_ms)-WEEK)
    recent=[x for x in rows if latest_start<x[0]<=int(end_ms)]
    if not recent:
        raise RuntimeError(f"{symbol}:missing latest-week funding")
    first=recent[0]
    if first[0]-latest_start>int(first[1])*HOUR+1000:
        raise RuntimeError(f"{symbol}:latest-week funding head gap")
    for a,b in zip(recent,recent[1:]):
        allowed=max(int(a[1]),int(b[1]))*HOUR+1000
        if b[0]-a[0]>allowed:
            raise RuntimeError(f"{symbol}:latest-week funding internal gap")
    last=recent[-1]
    if int(end_ms)-last[0]>int(last[1])*HOUR+1000:
        raise RuntimeError(f"{symbol}:latest-week funding tail gap")


OUT.mkdir(parents=True,exist_ok=True)
collected_at=int(datetime.now(timezone.utc).timestamp()*1000)
cutoff=saturday_cutoff(collected_at)
if cutoff<WARMUP_START:
    raise RuntimeError("current archive-safe cutoff predates prospective warmup")

manifest={
    "schemaVersion":"MERIDIAN-LOWVOL-RANK-WEIGHTED-V2-PROSPECTIVE-SOURCE-1",
    "source":"Binance Vision official public USD-M monthly+daily archives",
    "stage":"PROSPECTIVE_PAPER_SHADOW_SOURCE",
    "ruleset":"LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN",
    "serverTime":collected_at,
    "collectedAt":collected_at,
    "cutoff":cutoff,
    "prospectiveStart":PROSPECTIVE_START,
    "warmupStart":WARMUP_START,
    "archiveCompletionLagMs":ARCHIVE_COMPLETION_LAG_MS,
    "assets":ASSETS,
    "privateData":False,
    "credentialsUsed":False,
    "ordersPlaced":False,
    "exchangeMutation":False,
    "syntheticBackfill":False,
    "files":{},
}

for asset in ASSETS:
    symbol=asset+"USDT"
    hourly,k_receipts=load_rows(symbol,WARMUP_START,cutoff,"kline")
    expected=((cutoff-WARMUP_START)//HOUR)+1
    if len(hourly)!=expected:
        raise RuntimeError(f"{symbol}:hourly rows {len(hourly)} != {expected}")
    for i,row in enumerate(hourly):
        if int(row[0])!=WARMUP_START+i*HOUR:
            raise RuntimeError(f"{symbol}:non-contiguous hourly source at {i}")

    if cutoff>PROSPECTIVE_START:
        funding,f_receipts=load_rows(symbol,PROSPECTIVE_START,cutoff,"funding")
        validate_latest_week_funding(symbol,funding,PROSPECTIVE_START,cutoff)
    else:
        funding=[];f_receipts=[]

    payload={
        "asset":asset,
        "symbol":symbol,
        "hourly":hourly,
        "funding":funding,
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
        "klineArchiveCount":len(k_receipts),
        "fundingArchiveCount":len(f_receipts),
    }

manifest["manifestPayloadSha256"]=sha256(canonical_json_bytes({
    k:v for k,v in manifest.items() if k!="manifestPayloadSha256"
}))
(OUT/"manifest.json").write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n")
print(json.dumps({
    "schemaVersion":manifest["schemaVersion"],
    "source":manifest["source"],
    "collectedAt":collected_at,
    "cutoff":cutoff,
    "prospectiveStart":PROSPECTIVE_START,
    "completedObservationCapacity":max(0,(cutoff-PROSPECTIVE_START)//WEEK),
    "files":manifest["files"],
},sort_keys=True))
