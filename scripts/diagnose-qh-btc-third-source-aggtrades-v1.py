#!/usr/bin/env python3
"""Third-source diagnostic for BTCUSDT Jan-2025 source divergence.

Frozen after #350 proved monthly and daily individual-trades packages are identical
while both disagree with daily/monthly 1m klines on two UTC days.

For exactly 2025-01-14 and 2025-01-29, compare three CHECKSUM-verified official
Binance USD-M sources minute-by-minute:
  1) daily individual trades,
  2) daily aggTrades,
  3) daily 1m klines.

No trade direction is used and no signal, return, position or PnL is calculated.
"""
from __future__ import annotations
import csv, hashlib, io, json, math, re, tempfile, urllib.request, zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

UA="MERIDIAN-QH-BTC-THIRD-SOURCE-AGGTRADES-V1/1"
ASSET="BTCUSDT"
DAYS=("2025-01-14","2025-01-29")
OUT=Path("research/results/qh-btc-third-source-aggtrades")
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

def open_csv(path):
    zf=zipfile.ZipFile(path); names=[n for n in zf.namelist() if not n.endswith("/")]
    if len(names)!=1: raise RuntimeError(f"{path}: expected one member")
    raw=zf.open(names[0]); text=io.TextIOWrapper(raw,encoding="utf-8-sig",newline="")
    return zf,raw,text,csv.reader(text)

def close_all(zf,raw,text):
    if text: text.close()
    elif raw: raw.close()
    if zf: zf.close()

def minute_key(ms): return (ms//60000)*60000
def day_key(ms): return datetime.fromtimestamp(ms/1000,tz=timezone.utc).strftime("%Y-%m-%d")

def parse_bool(v):
    s=str(v).strip().lower()
    if s in ("true","1"): return True
    if s in ("false","0"): return False
    raise RuntimeError(f"invalid boolean {v!r}")

def new_trade_metric():
    return {"rows":0,"base":Kahan(),"quote":Kahan(),"firstTradeId":None,"lastTradeId":None}

def new_agg_metric():
    return {"rows":0,"declaredUnderlyingTrades":0,"base":Kahan(),"quote":Kahan(),
            "firstAggId":None,"lastAggId":None,"firstTradeId":None,"lastTradeId":None,
            "rangeOverlapEvents":0,"rangeGapEvents":0,"prevLastTradeId":None}

def freeze_trade(m):
    return {"rows":m["rows"],"base":m["base"].value,"derivedQuote":m["quote"].value,
            "firstTradeId":m["firstTradeId"],"lastTradeId":m["lastTradeId"]}

def freeze_agg(m):
    return {"rows":m["rows"],"declaredUnderlyingTrades":m["declaredUnderlyingTrades"],
            "base":m["base"].value,"derivedQuote":m["quote"].value,
            "firstAggId":m["firstAggId"],"lastAggId":m["lastAggId"],
            "firstTradeId":m["firstTradeId"],"lastTradeId":m["lastTradeId"],
            "rangeOverlapEvents":m["rangeOverlapEvents"],"rangeGapEvents":m["rangeGapEvents"]}

def scan_trades(path,day):
    mins=defaultdict(new_trade_metric); rows=0; prev_id=None; prev_ts=None
    zf=raw=text=None
    try:
        zf,raw,text,r=open_csv(path)
        for row in r:
            if not row: continue
            if rows==0 and row[0].strip().lower().replace(" ","_") in ("id","trade_id","tradeid"): continue
            if len(row)<6: raise RuntimeError("short trades row")
            tid=int(row[0]); price=float(row[1]); qty=float(row[2]); ts=int(float(row[4])); parse_bool(row[5])
            if not all(math.isfinite(x) for x in (price,qty)) or price<=0 or qty<=0: raise RuntimeError("invalid trades numeric")
            if day_key(ts)!=day: raise RuntimeError(f"trades outside {day}: {ts}")
            if prev_id is not None and tid<=prev_id: raise RuntimeError(f"trade id not strictly increasing {prev_id}->{tid}")
            if prev_ts is not None and ts<prev_ts: raise RuntimeError("trade timestamp decreased")
            m=mins[minute_key(ts)]; m["rows"]+=1; m["base"].add(qty); m["quote"].add(price*qty)
            if m["firstTradeId"] is None: m["firstTradeId"]=tid
            m["lastTradeId"]=tid
            prev_id,prev_ts=tid,ts; rows+=1
    finally: close_all(zf,raw,text)
    return rows,{t:freeze_trade(m) for t,m in mins.items()}

def is_agg_header(row):
    if not row: return False
    first=row[0].strip().lower().replace(" ","_")
    return first in ("agg_trade_id","aggregate_tradeid","aggregate_trade_id","id") or ("trade" in first and not first.lstrip("-").isdigit())

def scan_agg(path,day):
    mins=defaultdict(new_agg_metric); rows=0; prev_agg=None; prev_ts=None
    zf=raw=text=None
    try:
        zf,raw,text,r=open_csv(path)
        for row in r:
            if not row: continue
            if rows==0 and is_agg_header(row): continue
            if len(row)<7: raise RuntimeError("short aggTrades row")
            aid=int(row[0]); price=float(row[1]); qty=float(row[2]); first=int(row[3]); last=int(row[4]); ts=int(float(row[5])); parse_bool(row[6])
            if not all(math.isfinite(x) for x in (price,qty)) or price<=0 or qty<=0: raise RuntimeError("invalid aggTrades numeric")
            if first>last: raise RuntimeError("aggTrades firstTradeId>lastTradeId")
            if day_key(ts)!=day: raise RuntimeError(f"aggTrades outside {day}: {ts}")
            if prev_agg is not None and aid<=prev_agg: raise RuntimeError(f"agg id not strictly increasing {prev_agg}->{aid}")
            if prev_ts is not None and ts<prev_ts: raise RuntimeError("aggTrades timestamp decreased")
            m=mins[minute_key(ts)]
            m["rows"]+=1; m["declaredUnderlyingTrades"]+=last-first+1; m["base"].add(qty); m["quote"].add(price*qty)
            if m["firstAggId"] is None: m["firstAggId"]=aid
            m["lastAggId"]=aid
            if m["firstTradeId"] is None: m["firstTradeId"]=first
            if m["prevLastTradeId"] is not None:
                if first<=m["prevLastTradeId"]: m["rangeOverlapEvents"]+=1
                elif first>m["prevLastTradeId"]+1: m["rangeGapEvents"]+=1
            m["prevLastTradeId"]=last; m["lastTradeId"]=last
            prev_agg,prev_ts=aid,ts; rows+=1
    finally: close_all(zf,raw,text)
    return rows,{t:freeze_agg(m) for t,m in mins.items()}

def scan_kline(path,day):
    mins={}; zf=raw=text=None
    try:
        zf,raw,text,r=open_csv(path)
        for row in r:
            if not row: continue
            first=row[0].strip().lower().replace(" ","_")
            if not mins and first in ("open_time","opentime","timestamp","time"): continue
            if len(row)<9: raise RuntimeError("short kline row")
            ts=int(float(row[0]))
            if day_key(ts)!=day: raise RuntimeError(f"kline outside {day}: {ts}")
            mins[ts]={"reportedTrades":int(float(row[8])),"base":float(row[5]),"quote":float(row[7]),
                      "open":float(row[1]),"high":float(row[2]),"low":float(row[3]),"close":float(row[4])}
    finally: close_all(zf,raw,text)
    if len(mins)!=1440: raise RuntimeError(f"{day}: expected 1440 kline rows, got {len(mins)}")
    return mins

def near(a,b):
    err=abs(a-b); tol=max(ABS,abs(b)*REL)
    return {"matches":err<=tol,"a":a,"b":b,"absoluteError":err,
            "relativeError":err/max(abs(b),ABS),"tolerance":tol}

def classify(tr,ag,kl):
    ai=near(ag["base"],tr["base"])["matches"] and near(ag["derivedQuote"],tr["derivedQuote"])["matches"]
    ak=near(ag["base"],kl["base"])["matches"] and near(ag["derivedQuote"],kl["quote"])["matches"]
    ik=near(tr["base"],kl["base"])["matches"] and near(tr["derivedQuote"],kl["quote"])["matches"]
    if ai and ik: return "ALL_VOLUME_RECONCILE"
    if ai and not ik: return "AGGTRADES_AND_INDIVIDUAL_ALIGN_KLINE_DIVERGES"
    if ak and not ai: return "AGGTRADES_AND_KLINE_ALIGN_INDIVIDUAL_DIVERGES"
    if ik and not ai: return "INDIVIDUAL_AND_KLINE_ALIGN_AGGTRADES_DIVERGES"
    return "THREE_WAY_OR_PARTIAL_DIVERGENCE"

def run():
    OUT.mkdir(parents=True,exist_ok=True)
    results={}; downloads={}
    with tempfile.TemporaryDirectory(prefix="qh-btc-third-source-") as td:
        td=Path(td)
        for day in DAYS:
            urls={
              "trades":f"https://data.binance.vision/data/futures/um/daily/trades/{ASSET}/{ASSET}-trades-{day}.zip",
              "aggTrades":f"https://data.binance.vision/data/futures/um/daily/aggTrades/{ASSET}/{ASSET}-aggTrades-{day}.zip",
              "klines1m":f"https://data.binance.vision/data/futures/um/daily/klines/{ASSET}/1m/{ASSET}-1m-{day}.zip"
            }
            paths={k:td/f"{day}-{k}.zip" for k in urls}
            downloads[day]={k:download(urls[k],paths[k]) for k in urls}
            tr_rows,tr=scan_trades(paths["trades"],day)
            ag_rows,ag=scan_agg(paths["aggTrades"],day)
            kl=scan_kline(paths["klines1m"],day)
            rows=[]; counts=defaultdict(int)
            for t in sorted(kl):
                T=tr.get(t,{"rows":0,"base":0.0,"derivedQuote":0.0,"firstTradeId":None,"lastTradeId":None})
                A=ag.get(t,{"rows":0,"declaredUnderlyingTrades":0,"base":0.0,"derivedQuote":0.0,
                            "firstAggId":None,"lastAggId":None,"firstTradeId":None,"lastTradeId":None,
                            "rangeOverlapEvents":0,"rangeGapEvents":0})
                K=kl[t]; cls=classify(T,A,K); counts[cls]+=1
                if cls!="ALL_VOLUME_RECONCILE":
                    rows.append({
                      "minuteOpenMs":t,"minuteUtc":datetime.fromtimestamp(t/1000,tz=timezone.utc).isoformat(),
                      "classification":cls,"individualTrades":T,"aggTrades":A,"kline":K,
                      "aggVsIndividualBase":near(A["base"],T["base"]),
                      "aggVsIndividualQuote":near(A["derivedQuote"],T["derivedQuote"]),
                      "aggVsKlineBase":near(A["base"],K["base"]),
                      "aggVsKlineQuote":near(A["derivedQuote"],K["quote"]),
                      "individualVsKlineBase":near(T["base"],K["base"]),
                      "individualVsKlineQuote":near(T["derivedQuote"],K["quote"]),
                      "declaredUnderlyingCountVsIndividualRows":{
                        "matches":A["declaredUnderlyingTrades"]==T["rows"],
                        "delta":A["declaredUnderlyingTrades"]-T["rows"]
                      },
                      "declaredUnderlyingCountVsKlineReportedTrades":{
                        "matches":A["declaredUnderlyingTrades"]==K["reportedTrades"],
                        "delta":A["declaredUnderlyingTrades"]-K["reportedTrades"]
                      }
                    })
            tr_total={"rows":sum(x["rows"] for x in tr.values()),
                      "base":sum(x["base"] for x in tr.values()),
                      "derivedQuote":sum(x["derivedQuote"] for x in tr.values())}
            ag_total={"rows":sum(x["rows"] for x in ag.values()),
                      "declaredUnderlyingTrades":sum(x["declaredUnderlyingTrades"] for x in ag.values()),
                      "base":sum(x["base"] for x in ag.values()),
                      "derivedQuote":sum(x["derivedQuote"] for x in ag.values())}
            kl_total={"reportedTrades":sum(x["reportedTrades"] for x in kl.values()),
                      "base":sum(x["base"] for x in kl.values()),
                      "quote":sum(x["quote"] for x in kl.values())}
            daily_cls=classify(tr_total,ag_total,kl_total)
            results[day]={
              "individualRows":tr_rows,"aggTradeRows":ag_rows,
              "dailyTotals":{"individualTrades":tr_total,"aggTrades":ag_total,"kline":kl_total,
                             "classification":daily_cls,
                             "aggVsIndividualBase":near(ag_total["base"],tr_total["base"]),
                             "aggVsIndividualQuote":near(ag_total["derivedQuote"],tr_total["derivedQuote"]),
                             "aggVsKlineBase":near(ag_total["base"],kl_total["base"]),
                             "aggVsKlineQuote":near(ag_total["derivedQuote"],kl_total["quote"]),
                             "individualVsKlineBase":near(tr_total["base"],kl_total["base"]),
                             "individualVsKlineQuote":near(tr_total["derivedQuote"],kl_total["quote"])},
              "minuteClassificationNote":"Minute-level aggTrades timestamp bucketing can shift volume across adjacent minutes when an aggregate spans a minute boundary; dailyTotals.classification is the primary source-family discriminator.",
              "classificationCounts":dict(sorted(counts.items())),
              "nonReconciledMinuteCount":len(rows),
              "nonReconciledMinutes":rows
            }
            print(json.dumps({"day":day,"individualRows":tr_rows,"aggTradeRows":ag_rows,
                              "dailyVolumeClassification":daily_cls,
                              "dailyTotals":results[day]["dailyTotals"],
                              "classificationCounts":results[day]["classificationCounts"],
                              "nonReconciledMinuteCount":len(rows)},sort_keys=True),flush=True)

    all_non=[m for d in results.values() for m in d["nonReconciledMinutes"]]
    kline_div=all(d["dailyTotals"]["classification"]=="AGGTRADES_AND_INDIVIDUAL_ALIGN_KLINE_DIVERGES" for d in results.values())
    result={
      "schema":1,"family":"PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
      "stage":"BTC_THIRD_SOURCE_AGGTRADES_DIAGNOSTIC_V1","asset":ASSET,"days":list(DAYS),
      "downloads":downloads,"results":results,
      "allObservedDivergenceClassifiedAsKlineOnly":kline_div,
      "decision":"DIAGNOSTIC_ONLY_NO_DATA_GATE_AUTHORIZATION",
      "directionalOrderImbalanceCalculated":False,"forwardReturnsCalculated":False,
      "positionsCalculated":False,"strategyPnlCalculated":False,
      "executionImpact":False,"paperAuthorized":False,"liveAuthorized":False,"rawArchivesRetained":False
    }
    (OUT/"BTCUSDT-2025-01-third-source.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({"allObservedDivergenceClassifiedAsKlineOnly":kline_div,
                      "days":{d:{"dailyVolumeClassification":x["dailyTotals"]["classification"],
                                 "dailyTotals":x["dailyTotals"],
                                 "classificationCounts":x["classificationCounts"],
                                 "nonReconciledMinuteCount":x["nonReconciledMinuteCount"]} for d,x in results.items()},
                      "decision":result["decision"],
                      "directionalOrderImbalanceCalculated":False,"forwardReturnsCalculated":False,
                      "positionsCalculated":False,"strategyPnlCalculated":False},indent=2))

if __name__=="__main__": run()
