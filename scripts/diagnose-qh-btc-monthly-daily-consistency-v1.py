#!/usr/bin/env python3
"""Strategy-neutral BTCUSDT Jan-2025 monthly/daily source consistency diagnostic.

Triggered after frozen individual-trades Data V1.1 failed and a full-month diagnostic
showed that BTCUSDT monthly trades do not reconcile with the monthly 1m kline archive.

This script:
- verifies official CHECKSUMs;
- scans the monthly trades archive once and aggregates by UTC day;
- scans the monthly 1m kline archive by UTC day;
- downloads each official daily 1m kline archive and compares it with the monthly
  kline rows and with monthly-trades-derived daily totals;
- records sparse malformed quoteQty counts but derives economic quote notional as
  price*qty for diagnostics only.

It never uses trade direction and never calculates signal, returns, positions or PnL.
"""
from __future__ import annotations
import csv, hashlib, io, json, math, re, tempfile, urllib.request, zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import defaultdict

UA="MERIDIAN-QH-BTC-MONTHLY-DAILY-CONSISTENCY-V1/1"
BASE="https://data.binance.vision/data/futures/um"
ASSET="BTCUSDT"
MONTH="2025-01"
OUT=Path("research/results/qh-btc-monthly-daily-consistency")
CHUNK=8*1024*1024
REL=1e-8
ABS=1e-6

class Kahan:
    def __init__(self): self.s=0.0; self.c=0.0
    def add(self,x):
        y=x-self.c; t=self.s+y; self.c=(t-self.s)-y; self.s=t
    @property
    def value(self): return self.s

def sha_for(url):
    req=urllib.request.Request(url+".CHECKSUM",headers={"User-Agent":UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=60) as r: txt=r.read().decode("utf-8","replace")
    m=re.search(r"([0-9a-fA-F]{64})",txt)
    if not m: raise RuntimeError("missing checksum: "+url)
    return m.group(1).lower()

def download(url,dst):
    want=sha_for(url); h=hashlib.sha256(); n=0
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=300) as r,dst.open("wb") as f:
        while True:
            b=r.read(CHUNK)
            if not b: break
            f.write(b); h.update(b); n+=len(b)
    got=h.hexdigest()
    if got!=want: raise RuntimeError(f"checksum mismatch {url}: {got} != {want}")
    return {"url":url,"sha256":got,"bytes":n}

def reader(zpath):
    zf=zipfile.ZipFile(zpath)
    names=[n for n in zf.namelist() if not n.endswith("/")]
    if len(names)!=1: raise RuntimeError(f"{zpath}: expected one member")
    raw=zf.open(names[0]); text=io.TextIOWrapper(raw,encoding="utf-8-sig",newline="")
    return zf,raw,text,csv.reader(text)

def day_key(ms): return datetime.fromtimestamp(ms/1000,tz=timezone.utc).strftime("%Y-%m-%d")
def metric(): return {"count":0,"base":Kahan(),"derivedQuote":Kahan(),"rawQuote":Kahan(),"badQuoteRows":0}

def add_trade(m,price,qty,quote):
    m["count"]+=1; m["base"].add(qty); m["derivedQuote"].add(price*qty); m["rawQuote"].add(quote)
    expected=price*qty
    if abs(quote-expected)>max(1e-8,abs(quote)*REL): m["badQuoteRows"]+=1

def freeze_metric(m):
    return {"count":m["count"],"base":m["base"].value,"derivedQuote":m["derivedQuote"].value,
            "rawQuote":m["rawQuote"].value,"badQuoteRows":m["badQuoteRows"]}

def scan_monthly_trades(path):
    days=defaultdict(metric); rows=0; zf=raw=text=None
    try:
        zf,raw,text,r=reader(path)
        for row in r:
            if not row: continue
            if rows==0 and row[0].strip().lower() in ("id","trade_id","tradeid"): continue
            if len(row)<6: raise RuntimeError("short trade row")
            price=float(row[1]); qty=float(row[2]); quote=float(row[3]); ts=int(float(row[4]))
            if not all(math.isfinite(x) for x in (price,qty,quote)) or price<=0 or qty<=0 or quote<0:
                raise RuntimeError(f"invalid trade numeric at {row[0]}")
            d=day_key(ts)
            if not d.startswith("2025-01-"): raise RuntimeError(f"outside month: {ts}")
            add_trade(days[d],price,qty,quote); rows+=1
            if rows%10_000_000==0: print(f"monthly trades: {rows:,}",flush=True)
    finally:
        if text: text.close()
        elif raw: raw.close()
        if zf: zf.close()
    return {d:freeze_metric(m) for d,m in sorted(days.items())}

def kmetric(): return {"minutes":0,"count":0,"base":Kahan(),"quote":Kahan()}

def scan_klines(path,expected_day=None):
    days=defaultdict(kmetric); rows=0; zf=raw=text=None
    try:
        zf,raw,text,r=reader(path)
        for row in r:
            if not row: continue
            first=row[0].strip().lower().replace(" ","_")
            if rows==0 and first in ("open_time","opentime","timestamp","time"): continue
            if len(row)<9: raise RuntimeError("short kline row")
            ts=int(float(row[0])); d=day_key(ts)
            if expected_day and d!=expected_day: raise RuntimeError(f"daily kline contains {d}, expected {expected_day}")
            vol=float(row[5]); q=float(row[7]); n=float(row[8])
            if not n.is_integer(): raise RuntimeError(f"non-integer trade count {n}")
            m=days[d]; m["minutes"]+=1; m["count"]+=int(n); m["base"].add(vol); m["quote"].add(q); rows+=1
    finally:
        if text: text.close()
        elif raw: raw.close()
        if zf: zf.close()
    return {d:{"minutes":m["minutes"],"count":m["count"],"base":m["base"].value,"quote":m["quote"].value} for d,m in sorted(days.items())}

def close(a,b):
    err=abs(a-b); tol=max(ABS,abs(b)*REL)
    return {"matches":err<=tol,"a":a,"b":b,"absoluteError":err,"relativeError":err/max(abs(b),ABS),"tolerance":tol}

def compare_trades_kline(t,k):
    return {
      "countMatches":t["count"]==k["count"],
      "countDelta":t["count"]-k["count"],
      "base":close(t["base"],k["base"]),
      "derivedQuote":close(t["derivedQuote"],k["quote"]),
      "rawQuote":close(t["rawQuote"],k["quote"]),
      "badQuoteRows":t["badQuoteRows"]
    }

def compare_klines(a,b):
    return {
      "minutesMatch":a["minutes"]==b["minutes"],
      "countMatches":a["count"]==b["count"],
      "countDelta":a["count"]-b["count"],
      "base":close(a["base"],b["base"]),
      "quote":close(a["quote"],b["quote"])
    }

def run():
    OUT.mkdir(parents=True,exist_ok=True)
    month_trade_url=f"https://data.binance.vision/data/futures/um/monthly/trades/{ASSET}/{ASSET}-trades-{MONTH}.zip"
    month_kline_url=f"https://data.binance.vision/data/futures/um/monthly/klines/{ASSET}/1m/{ASSET}-1m-{MONTH}.zip"
    with tempfile.TemporaryDirectory(prefix="qh-btc-consistency-") as td:
        td=Path(td); mt=td/"trades.zip"; mk=td/"klines.zip"
        downloads={"monthlyTrades":download(month_trade_url,mt),"monthlyKlines1m":download(month_kline_url,mk),"dailyKlines1m":[]}
        trades=scan_monthly_trades(mt); monthly=scan_klines(mk)
        daily={}
        start=datetime(2025,1,1,tzinfo=timezone.utc)
        for i in range(31):
            d=(start+timedelta(days=i)).strftime("%Y-%m-%d")
            url=f"https://data.binance.vision/data/futures/um/daily/klines/{ASSET}/1m/{ASSET}-1m-{d}.zip"
            p=td/f"k-{d}.zip"
            meta=download(url,p); downloads["dailyKlines1m"].append(meta)
            one=scan_klines(p,d)
            if d not in one: raise RuntimeError(f"no rows in daily kline {d}")
            daily[d]=one[d]
            print(f"daily kline checked {d}",flush=True)

    days=[]; classifications=defaultdict(int)
    all_days=sorted(set(trades)|set(monthly)|set(daily))
    for d in all_days:
        t=trades.get(d); m=monthly.get(d); q=daily.get(d)
        if not (t and m and q):
            cls="MISSING_DAY_IN_ONE_SOURCE"
            row={"day":d,"classification":cls,"trades":t,"monthlyKline":m,"dailyKline":q}
        else:
            tm=compare_trades_kline(t,m); td=compare_trades_kline(t,q); md=compare_klines(m,q)
            trades_month_ok=tm["countMatches"] and tm["base"]["matches"] and tm["derivedQuote"]["matches"]
            trades_daily_ok=td["countMatches"] and td["base"]["matches"] and td["derivedQuote"]["matches"]
            month_daily_ok=md["minutesMatch"] and md["countMatches"] and md["base"]["matches"] and md["quote"]["matches"]
            if trades_month_ok and month_daily_ok: cls="ALL_RECONCILE"
            elif trades_daily_ok and not month_daily_ok: cls="MONTHLY_KLINE_DIFFERS_DAILY_MATCHES_TRADES"
            elif month_daily_ok and not trades_month_ok: cls="MONTHLY_TRADES_DIFFER_FROM_BOTH_KLINES"
            elif not month_daily_ok and not trades_daily_ok: cls="THREE_WAY_DIVERGENCE"
            else: cls="OTHER_DIVERGENCE"
            row={"day":d,"classification":cls,"trades":t,"monthlyKline":m,"dailyKline":q,
                 "tradesVsMonthlyKline":tm,"tradesVsDailyKline":td,"monthlyVsDailyKline":md}
        classifications[cls]+=1; days.append(row)

    result={
      "schema":1,"family":"PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
      "stage":"BTC_MONTHLY_DAILY_SOURCE_CONSISTENCY_DIAGNOSTIC_V1",
      "asset":ASSET,"month":MONTH,
      "downloads":downloads,
      "classificationCounts":dict(sorted(classifications.items())),
      "mismatchDays":[x["day"] for x in days if x["classification"]!="ALL_RECONCILE"],
      "days":days,
      "decision":"DIAGNOSTIC_ONLY_NO_DATA_GATE_AUTHORIZATION",
      "directionalOrderImbalanceCalculated":False,"forwardReturnsCalculated":False,
      "positionsCalculated":False,"strategyPnlCalculated":False,
      "executionImpact":False,"paperAuthorized":False,"liveAuthorized":False,
      "rawArchivesRetained":False
    }
    (OUT/"BTCUSDT-2025-01.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({"asset":ASSET,"month":MONTH,"classificationCounts":result["classificationCounts"],
      "mismatchDays":result["mismatchDays"],"decision":result["decision"],
      "directionalOrderImbalanceCalculated":False,"forwardReturnsCalculated":False,
      "positionsCalculated":False,"strategyPnlCalculated":False},indent=2))

if __name__=="__main__": run()
