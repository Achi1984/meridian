#!/usr/bin/env python3
"""Strategy-neutral BTC Jan-2025 monthly-vs-daily individual-trades diagnostic.

Frozen after #348 showed that only 2025-01-14 and 2025-01-29 differ between the
official monthly individual-trades archive and both monthly/daily 1m klines.

This diagnostic compares, minute by minute, for those two days:
  - rows extracted from the official monthly individual-trades archive,
  - official daily individual-trades archives,
  - official daily 1m klines.

All archives are CHECKSUM-verified. Trade direction is validated syntactically but
never used. Quote notional is derived as price*qty for source reconciliation only.
No signal, return, position, PnL, Paper or live decision is calculated.
"""
from __future__ import annotations
import csv, hashlib, io, json, math, re, tempfile, urllib.request, zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

UA="MERIDIAN-QH-BTC-DAILY-TRADES-CONSISTENCY-V1/1"
ASSET="BTCUSDT"
MONTH="2025-01"
TARGET_DAYS=("2025-01-14","2025-01-29")
OUT=Path("research/results/qh-btc-daily-trades-consistency")
CHUNK=8*1024*1024
REL=1e-8
ABS=1e-6

class Kahan:
    def __init__(self): self.s=0.0; self.c=0.0
    def add(self,x):
        y=x-self.c; t=self.s+y; self.c=(t-self.s)-y; self.s=t
    @property
    def value(self): return self.s

def checksum(url):
    req=urllib.request.Request(url+".CHECKSUM",headers={"User-Agent":UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=60) as r: txt=r.read().decode("utf-8","replace")
    m=re.search(r"([0-9a-fA-F]{64})",txt)
    if not m: raise RuntimeError("missing checksum "+url)
    return m.group(1).lower()

def download(url,dst):
    want=checksum(url); h=hashlib.sha256(); n=0
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=300) as r,dst.open("wb") as f:
        while True:
            b=r.read(CHUNK)
            if not b: break
            f.write(b); h.update(b); n+=len(b)
    got=h.hexdigest()
    if got!=want: raise RuntimeError(f"checksum mismatch {url}: {got} != {want}")
    return {"url":url,"sha256":got,"bytes":n}

def csv_reader(path):
    zf=zipfile.ZipFile(path)
    names=[n for n in zf.namelist() if not n.endswith("/")]
    if len(names)!=1: raise RuntimeError(f"{path}: expected one member")
    raw=zf.open(names[0]); text=io.TextIOWrapper(raw,encoding="utf-8-sig",newline="")
    return zf,raw,text,csv.reader(text)

def strict_bool(v):
    s=str(v).strip().lower()
    if s in ("true","1"): return True
    if s in ("false","0"): return False
    raise RuntimeError(f"invalid isBuyerMaker {v!r}")

def day_key(ms): return datetime.fromtimestamp(ms/1000,tz=timezone.utc).strftime("%Y-%m-%d")
def minute_key(ms): return (ms//60000)*60000

def new_metric():
    return {"count":0,"base":Kahan(),"quote":Kahan(),"rawQuote":Kahan(),
            "badQuoteRows":0,"firstTradeId":None,"lastTradeId":None}

def add_trade(m,trade_id,price,qty,quote):
    m["count"]+=1; m["base"].add(qty); m["quote"].add(price*qty); m["rawQuote"].add(quote)
    if abs(quote-price*qty)>max(1e-8,abs(quote)*REL): m["badQuoteRows"]+=1
    if m["firstTradeId"] is None: m["firstTradeId"]=trade_id
    m["lastTradeId"]=trade_id

def freeze(m):
    return {"count":m["count"],"base":m["base"].value,"derivedQuote":m["quote"].value,
            "rawQuote":m["rawQuote"].value,"badQuoteRows":m["badQuoteRows"],
            "firstTradeId":m["firstTradeId"],"lastTradeId":m["lastTradeId"]}

def scan_trades(path,only_days=None,stop_after_day=None):
    per_minute=defaultdict(new_metric); per_day=defaultdict(new_metric)
    rows=0; prev_id=None; prev_ts=None; id_non_increasing=0; ts_decreases=0
    zf=raw=text=None
    try:
        zf,raw,text,r=csv_reader(path)
        for row in r:
            if not row: continue
            if rows==0 and row[0].strip().lower().replace(" ","_") in ("id","trade_id","tradeid"): continue
            if len(row)<6: raise RuntimeError("short trade row")
            trade_id=int(row[0]); price=float(row[1]); qty=float(row[2]); quote=float(row[3]); ts=int(float(row[4]))
            strict_bool(row[5])
            if not all(math.isfinite(x) for x in (price,qty,quote)) or price<=0 or qty<=0 or quote<0:
                raise RuntimeError(f"invalid numeric at trade {trade_id}")
            if prev_id is not None and trade_id<=prev_id: id_non_increasing+=1
            if prev_ts is not None and ts<prev_ts: ts_decreases+=1
            prev_id,prev_ts=trade_id,ts
            d=day_key(ts)
            if stop_after_day and d>stop_after_day: break
            if only_days is None or d in only_days:
                add_trade(per_day[d],trade_id,price,qty,quote)
                add_trade(per_minute[(d,minute_key(ts))],trade_id,price,qty,quote)
            rows+=1
            if rows%10_000_000==0: print(f"scanned {rows:,} source rows",flush=True)
    finally:
        if text: text.close()
        elif raw: raw.close()
        if zf: zf.close()
    return {
      "scannedSourceRows":rows,"idNonIncreasing":id_non_increasing,"timestampDecreases":ts_decreases,
      "days":{d:freeze(m) for d,m in sorted(per_day.items())},
      "minutes":{f"{d}|{t}":freeze(m) for (d,t),m in sorted(per_minute.items())}
    }

def scan_kline(path,expected_day):
    out={}
    zf=raw=text=None
    try:
        zf,raw,text,r=csv_reader(path)
        for row in r:
            if not row: continue
            first=row[0].strip().lower().replace(" ","_")
            if not out and first in ("open_time","opentime","timestamp","time"): continue
            if len(row)<9: raise RuntimeError("short kline row")
            t=int(float(row[0])); d=day_key(t)
            if d!=expected_day: raise RuntimeError(f"kline day mismatch {d} != {expected_day}")
            vol=float(row[5]); q=float(row[7]); n=float(row[8])
            if not n.is_integer(): raise RuntimeError(f"non-integer kline trade count {n}")
            out[t]={"count":int(n),"base":vol,"derivedQuote":q}
    finally:
        if text: text.close()
        elif raw: raw.close()
        if zf: zf.close()
    if len(out)!=1440: raise RuntimeError(f"{expected_day}: expected 1440 klines, got {len(out)}")
    return out

def close(a,b):
    err=abs(a-b); tol=max(ABS,abs(b)*REL)
    return {"matches":err<=tol,"a":a,"b":b,"absoluteError":err,
            "relativeError":err/max(abs(b),ABS),"tolerance":tol}

def compare_metric(a,b):
    return {
      "countMatches":a.get("count",0)==b.get("count",0),
      "countDelta":a.get("count",0)-b.get("count",0),
      "base":close(a.get("base",0.0),b.get("base",0.0)),
      "derivedQuote":close(a.get("derivedQuote",0.0),b.get("derivedQuote",0.0))
    }

def summarize_minutes(monthly,daily,klines,day):
    mismatches=[]
    all_months={k.split("|",1)[1]:v for k,v in monthly["minutes"].items() if k.startswith(day+"|")}
    all_daily={k.split("|",1)[1]:v for k,v in daily["minutes"].items() if k.startswith(day+"|")}
    for t in sorted(klines):
        key=str(t); m=all_months.get(key,{"count":0,"base":0.0,"derivedQuote":0.0})
        d=all_daily.get(key,{"count":0,"base":0.0,"derivedQuote":0.0})
        k=klines[t]
        md=compare_metric(m,d); dk=compare_metric(d,k); mk=compare_metric(m,k)
        if not (md["countMatches"] and md["base"]["matches"] and md["derivedQuote"]["matches"] and
                dk["countMatches"] and dk["base"]["matches"] and dk["derivedQuote"]["matches"]):
            mismatches.append({
              "minuteOpenMs":t,
              "minuteUtc":datetime.fromtimestamp(t/1000,tz=timezone.utc).isoformat(),
              "monthlyTrades":m,"dailyTrades":d,"kline":k,
              "monthlyVsDailyTrades":md,"dailyTradesVsKline":dk,"monthlyTradesVsKline":mk
            })
    return mismatches

def run():
    OUT.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="qh-btc-daily-trades-") as td:
        td=Path(td)
        month_url=f"https://data.binance.vision/data/futures/um/monthly/trades/{ASSET}/{ASSET}-trades-{MONTH}.zip"
        month_path=td/"monthly-trades.zip"
        downloads={"monthlyTrades":download(month_url,month_path),"dailyTrades":{},"dailyKlines1m":{}}
        monthly=scan_trades(month_path,set(TARGET_DAYS),stop_after_day="2025-01-29")
        daily_results={}; kline_results={}; mismatch_minutes={}
        for day in TARGET_DAYS:
            durl=f"https://data.binance.vision/data/futures/um/daily/trades/{ASSET}/{ASSET}-trades-{day}.zip"
            kurl=f"https://data.binance.vision/data/futures/um/daily/klines/{ASSET}/1m/{ASSET}-1m-{day}.zip"
            dp=td/f"trades-{day}.zip"; kp=td/f"kline-{day}.zip"
            downloads["dailyTrades"][day]=download(durl,dp)
            downloads["dailyKlines1m"][day]=download(kurl,kp)
            daily_results[day]=scan_trades(dp,{day})
            kline_results[day]=scan_kline(kp,day)
            mismatch_minutes[day]=summarize_minutes(monthly,daily_results[day],kline_results[day],day)
            print(f"{day}: mismatch minutes={len(mismatch_minutes[day])}",flush=True)

    days={}
    for day in TARGET_DAYS:
        m=monthly["days"].get(day,{"count":0,"base":0.0,"derivedQuote":0.0})
        d=daily_results[day]["days"].get(day,{"count":0,"base":0.0,"derivedQuote":0.0})
        ksum={"count":sum(x["count"] for x in kline_results[day].values()),
              "base":sum(x["base"] for x in kline_results[day].values()),
              "derivedQuote":sum(x["derivedQuote"] for x in kline_results[day].values())}
        daily_vs_k=compare_metric(d,ksum)
        month_vs_daily=compare_metric(m,d)
        classification=("DAILY_TRADES_RECONCILE_KLINES_MONTHLY_TRADES_PACKAGE_DIFFERS"
                        if daily_vs_k["countMatches"] and daily_vs_k["base"]["matches"] and daily_vs_k["derivedQuote"]["matches"]
                        and not (month_vs_daily["countMatches"] and month_vs_daily["base"]["matches"] and month_vs_daily["derivedQuote"]["matches"])
                        else "OTHER")
        days[day]={
          "classification":classification,
          "monthlyTrades":m,"dailyTrades":d,"dailyKlineAggregate":ksum,
          "monthlyVsDailyTrades":month_vs_daily,"dailyTradesVsKlines":daily_vs_k,
          "mismatchMinuteCount":len(mismatch_minutes[day]),
          "mismatchMinutes":mismatch_minutes[day]
        }

    package_only=all(x["classification"]=="DAILY_TRADES_RECONCILE_KLINES_MONTHLY_TRADES_PACKAGE_DIFFERS" for x in days.values())
    result={
      "schema":1,"family":"PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
      "stage":"BTC_DAILY_TRADES_SOURCE_CONSISTENCY_DIAGNOSTIC_V1",
      "asset":ASSET,"month":MONTH,"targetDays":list(TARGET_DAYS),
      "downloads":downloads,
      "monthlyScan":{"scannedSourceRows":monthly["scannedSourceRows"],
                     "idNonIncreasing":monthly["idNonIncreasing"],
                     "timestampDecreases":monthly["timestampDecreases"]},
      "days":days,
      "packageOnlyMismatchEstablished":package_only,
      "decision":"DIAGNOSTIC_ONLY_NO_DATA_GATE_AUTHORIZATION",
      "directionalOrderImbalanceCalculated":False,"forwardReturnsCalculated":False,
      "positionsCalculated":False,"strategyPnlCalculated":False,
      "executionImpact":False,"paperAuthorized":False,"liveAuthorized":False,
      "rawArchivesRetained":False
    }
    (OUT/"BTCUSDT-2025-01-target-days.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({
      "targetDays":{d:{"classification":x["classification"],
                       "monthlyCount":x["monthlyTrades"]["count"],
                       "dailyCount":x["dailyTrades"]["count"],
                       "klineCount":x["dailyKlineAggregate"]["count"],
                       "countDeltaMonthlyVsDaily":x["monthlyVsDailyTrades"]["countDelta"],
                       "mismatchMinuteCount":x["mismatchMinuteCount"]}
                    for d,x in days.items()},
      "packageOnlyMismatchEstablished":package_only,
      "decision":result["decision"],
      "directionalOrderImbalanceCalculated":False,"forwardReturnsCalculated":False,
      "positionsCalculated":False,"strategyPnlCalculated":False
    },indent=2))

if __name__=="__main__": run()
