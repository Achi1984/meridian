#!/usr/bin/env python3
"""Strategy-neutral quoteQty semantics diagnostic for Binance USD-M trades archives.

This diagnostic exists only because frozen Data V1.1 canaries failed the documented
quoteQty ~= price*qty invariant. It verifies official archive checksums, scans one
asset-month without using trade direction, and compares:
  1) source quoteQty,
  2) price*qty derived quote notional, and
  3) source quoteQty * 1e7
against official 1m kline quote volume.

It MUST NOT calculate order imbalance, forward returns, positions or PnL and it
MUST NOT authorize a Data gate.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import os
import re
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

BASE="https://data.binance.vision/data/futures/um/monthly"
ASSETS=("BTCUSDT","SOLUSDT")
MONTHS={"BTCUSDT":"2025-01","SOLUSDT":"2025-07"}
UA="MERIDIAN-QH-TRADES-QUOTE-SEMANTICS-DIAGNOSTIC/1"
CHUNK=8*1024*1024
REL_TOL=1e-8
ABS_TOL=1e-6
SCALE_CANDIDATE=10_000_000.0

ASSET=os.environ.get("QH_ASSET","")
MONTH=os.environ.get("QH_MONTH","")
OUT=Path(os.environ.get("QH_OUTPUT_DIR","research/results/qh-quote-semantics"))
if ASSET not in ASSETS or MONTH!=MONTHS.get(ASSET):
    raise SystemExit(f"invalid diagnostic shard {ASSET!r}/{MONTH!r}")

def month_bounds(ym):
    y,m=map(int,ym.split("-"))
    start=int(datetime(y,m,1,tzinfo=timezone.utc).timestamp()*1000)
    ny,nm=(y+1,1) if m==12 else (y,m+1)
    end=int(datetime(ny,nm,1,tzinfo=timezone.utc).timestamp()*1000)
    return start,end

START_MS,END_MS=month_bounds(MONTH)

class Kahan:
    def __init__(self):
        self.s=0.0
        self.c=0.0
    def add(self,x):
        y=x-self.c
        t=self.s+y
        self.c=(t-self.s)-y
        self.s=t
    @property
    def value(self):
        return self.s

def source_url(fam):
    if fam=="trades":
        return f"{BASE}/trades/{ASSET}/{ASSET}-trades-{MONTH}.zip"
    if fam=="klines":
        return f"{BASE}/klines/{ASSET}/1m/{ASSET}-1m-{MONTH}.zip"
    raise ValueError(fam)

def checksum(url):
    req=urllib.request.Request(url+".CHECKSUM",headers={"User-Agent":UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=60) as r:
        txt=r.read().decode("utf-8","replace")
    m=re.search(r"([0-9a-fA-F]{64})",txt)
    if not m:
        raise RuntimeError(f"missing SHA256 in checksum for {url}")
    return m.group(1).lower()

def download_verified(url,dst):
    expected=checksum(url)
    h=hashlib.sha256()
    n=0
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=300) as r,dst.open("wb") as f:
        while True:
            b=r.read(CHUNK)
            if not b:
                break
            f.write(b)
            h.update(b)
            n+=len(b)
    actual=h.hexdigest()
    if actual!=expected:
        raise RuntimeError(f"SHA256 mismatch {url}: {actual} != {expected}")
    return {"url":url,"sha256":actual,"bytes":n}

def open_csv(zpath):
    zf=zipfile.ZipFile(zpath)
    members=[x for x in zf.namelist() if not x.endswith("/")]
    if len(members)!=1:
        zf.close()
        raise RuntimeError(f"{zpath.name}: expected one ZIP member")
    raw=zf.open(members[0],"r")
    text=io.TextIOWrapper(raw,encoding="utf-8-sig",newline="")
    return zf,raw,text,csv.reader(text)

def close_all(zf,raw,text):
    if text: text.close()
    if raw: raw.close()
    if zf: zf.close()

def close_enough(a,b):
    d=abs(a-b)
    tol=max(ABS_TOL,abs(b)*REL_TOL)
    return {"a":a,"b":b,"absoluteError":d,
            "relativeError":d/max(abs(b),ABS_TOL),
            "tolerance":tol,"matches":d<=tol}

def strict_bool(v):
    s=str(v).strip().lower()
    if s in ("true","1"): return True
    if s in ("false","0"): return False
    raise RuntimeError(f"invalid isBuyerMaker value {v!r}")

def audit_trades(zpath):
    rows=0
    first_id=last_id=prev_id=None
    first_ts=last_ts=prev_ts=None
    id_gap_events=0
    id_gap_missing=0
    literal_matches=0
    scaled_1e7_matches=0
    zero_quote=0
    other_scale=0
    first_mismatches=[]
    first_other_scale=[]
    exponent_hist={}
    qty_sum=Kahan()
    raw_quote_sum=Kahan()
    derived_quote_sum=Kahan()
    scaled_quote_sum=Kahan()

    zf=raw=text=None
    try:
        zf,raw,text,reader=open_csv(zpath)
        for row in reader:
            if not row:
                continue
            if rows==0 and row[0].strip().lower().replace(" ","_") in ("id","trade_id","tradeid"):
                continue
            if len(row)<6:
                raise RuntimeError(f"trades short row: {len(row)}")
            trade_id=int(row[0])
            price=float(row[1]); qty=float(row[2]); quote=float(row[3])
            ts=int(float(row[4]))
            strict_bool(row[5])  # validate only; direction is never used
            if not all(math.isfinite(x) for x in (price,qty,quote)):
                raise RuntimeError(f"non-finite numeric at trade {trade_id}")
            if price<=0 or qty<=0 or quote<0:
                raise RuntimeError(f"invalid numeric sign at trade {trade_id}")
            if not START_MS<=ts<END_MS:
                raise RuntimeError(f"timestamp outside month at trade {trade_id}: {ts}")
            if prev_ts is not None and ts<prev_ts:
                raise RuntimeError(f"timestamp decreased at trade {trade_id}")
            if prev_id is not None:
                if trade_id<=prev_id:
                    raise RuntimeError(f"trade id not strictly increasing: {prev_id}->{trade_id}")
                if trade_id>prev_id+1:
                    id_gap_events+=1
                    id_gap_missing+=trade_id-prev_id-1

            derived=price*qty
            literal=abs(quote-derived)<=max(1e-8,abs(derived)*REL_TOL)
            scaled=quote*SCALE_CANDIDATE
            scale_match=abs(scaled-derived)<=max(ABS_TOL,abs(derived)*REL_TOL)
            literal_matches+=int(literal)
            scaled_1e7_matches+=int(scale_match)

            if not literal and len(first_mismatches)<8:
                first_mismatches.append({
                    "tradeId":trade_id,"price":row[1],"qty":row[2],"quoteQty":row[3],
                    "priceTimesQty":derived,
                    "derivedOverSource":None if quote==0 else derived/quote
                })

            if quote==0:
                zero_quote+=1
                bucket="ZERO_SOURCE_QUOTE"
            else:
                ratio=derived/quote
                exp=int(round(math.log10(ratio))) if ratio>0 else 999
                bucket=f"10^{exp:+d}"
                exponent_hist[bucket]=exponent_hist.get(bucket,0)+1
            if not literal and not scale_match:
                other_scale+=1
                if len(first_other_scale)<8:
                    first_other_scale.append({
                        "tradeId":trade_id,"price":row[1],"qty":row[2],"quoteQty":row[3],
                        "priceTimesQty":derived,
                        "derivedOverSource":None if quote==0 else derived/quote
                    })

            qty_sum.add(qty)
            raw_quote_sum.add(quote)
            derived_quote_sum.add(derived)
            scaled_quote_sum.add(scaled)
            if first_id is None:
                first_id,first_ts=trade_id,ts
            last_id,last_ts=trade_id,ts
            prev_id,prev_ts=trade_id,ts
            rows+=1
            if rows%5_000_000==0:
                print(f"{ASSET}/{MONTH}: scanned {rows:,} trades",flush=True)
    finally:
        close_all(zf,raw,text)

    if rows==0:
        raise RuntimeError("zero trade rows")
    return {
        "rows":rows,
        "firstTradeId":first_id,"lastTradeId":last_id,
        "firstTimestampMs":first_ts,"lastTimestampMs":last_ts,
        "tradeIdsStrictlyIncreasing":True,
        "tradeIdGapEvents":id_gap_events,
        "diagnosticMissingIdCount":id_gap_missing,
        "literalQuoteConsistencyMatches":literal_matches,
        "literalQuoteConsistencyShare":literal_matches/rows,
        "sourceQuoteTimes1e7Matches":scaled_1e7_matches,
        "sourceQuoteTimes1e7Share":scaled_1e7_matches/rows,
        "zeroSourceQuoteRows":zero_quote,
        "otherScaleRows":other_scale,
        "roundedLog10DerivedOverSourceHistogram":exponent_hist,
        "firstQuoteMismatches":first_mismatches,
        "firstNon1e7ScaleMismatches":first_other_scale,
        "baseQtySum":qty_sum.value,
        "sourceQuoteQtySum":raw_quote_sum.value,
        "derivedPriceTimesQtySum":derived_quote_sum.value,
        "sourceQuoteQtyTimes1e7Sum":scaled_quote_sum.value,
        "aggregateDerivedOverSource":None if raw_quote_sum.value==0 else derived_quote_sum.value/raw_quote_sum.value
    }

def audit_klines(zpath):
    rows=0
    first=last=prev=None
    trade_count=0
    base_sum=Kahan()
    quote_sum=Kahan()
    zf=raw=text=None
    try:
        zf,raw,text,reader=open_csv(zpath)
        for row in reader:
            if not row:
                continue
            first_field=row[0].strip().lower().replace(" ","_")
            if rows==0 and first_field in ("open_time","opentime","timestamp","time"):
                continue
            if len(row)<9:
                raise RuntimeError(f"kline short row: {len(row)}")
            t=int(float(row[0]))
            if not START_MS<=t<END_MS:
                raise RuntimeError(f"kline outside month: {t}")
            if prev is not None and t-prev!=60_000:
                raise RuntimeError(f"1m cadence gap {prev}->{t}")
            vol=float(row[5]); qvol=float(row[7]); n=float(row[8])
            if not all(math.isfinite(x) for x in (vol,qvol,n)) or vol<0 or qvol<0 or n<0 or not n.is_integer():
                raise RuntimeError(f"invalid kline numeric row at {t}")
            trade_count+=int(n)
            base_sum.add(vol)
            quote_sum.add(qvol)
            if first is None: first=t
            last=t; prev=t; rows+=1
    finally:
        close_all(zf,raw,text)
    return {
        "rows":rows,"firstOpenMs":first,"lastOpenMs":last,
        "reportedTradeCount":trade_count,
        "baseVolumeSum":base_sum.value,
        "quoteVolumeSum":quote_sum.value
    }

def run():
    OUT.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"qh-quote-semantics-{ASSET}-{MONTH}-") as td:
        td=Path(td)
        tp=td/"trades.zip"; kp=td/"klines.zip"
        downloads={
            "trades":download_verified(source_url("trades"),tp),
            "klines1m":download_verified(source_url("klines"),kp)
        }
        trades=audit_trades(tp)
        klines=audit_klines(kp)

    reconciliation={
        "rowCountMatchesKlineReportedTrades":trades["rows"]==klines["reportedTradeCount"],
        "baseQtyVsKlineBaseVolume":close_enough(trades["baseQtySum"],klines["baseVolumeSum"]),
        "sourceQuoteVsKlineQuoteVolume":close_enough(trades["sourceQuoteQtySum"],klines["quoteVolumeSum"]),
        "derivedPriceTimesQtyVsKlineQuoteVolume":close_enough(trades["derivedPriceTimesQtySum"],klines["quoteVolumeSum"]),
        "sourceQuoteTimes1e7VsKlineQuoteVolume":close_enough(trades["sourceQuoteQtyTimes1e7Sum"],klines["quoteVolumeSum"])
    }
    result={
        "schema":1,
        "family":"PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
        "stage":"INDIVIDUAL_TRADES_QUOTE_SEMANTICS_DIAGNOSTIC_V1",
        "asset":ASSET,"month":MONTH,
        "source":"Binance Vision official public USD-M monthly trades + 1m klines",
        "purpose":"Diagnose frozen Data V1.1 quoteQty invariant failures without changing that gate.",
        "downloads":downloads,
        "trades":trades,
        "klines1m":klines,
        "reconciliation":reconciliation,
        "decision":"DIAGNOSTIC_ONLY_NO_DATA_GATE_AUTHORIZATION",
        "directionalOrderImbalanceCalculated":False,
        "forwardReturnsCalculated":False,
        "signalReturnRelationshipCalculated":False,
        "positionsCalculated":False,
        "strategyPnlCalculated":False,
        "executionImpact":False,
        "paperAuthorized":False,
        "liveAuthorized":False,
        "rawArchivesRetained":False
    }
    out=OUT/f"{ASSET}-{MONTH}.json"
    out.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))

if __name__=="__main__":
    run()
