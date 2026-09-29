#!/usr/bin/env python3
"""Diagnose first individual-trade ID gap for one fixed Quarter-Hour canary.

Read-only Binance source provenance. No order imbalance, returns, positions or PnL.
"""
import csv, hashlib, io, json, os, re, tempfile, urllib.request, zipfile
from datetime import datetime, timezone
from pathlib import Path

ASSET=os.environ.get("QH_ASSET","")
MONTH=os.environ.get("QH_MONTH","")
ALLOWED={("BTCUSDT","2025-01"),("SOLUSDT","2025-07")}
if (ASSET,MONTH) not in ALLOWED: raise SystemExit("unsupported diagnostic target")
UA="MERIDIAN-QH-INDIVIDUAL-TRADE-GAP-DIAGNOSTIC/1"
BASE="https://data.binance.vision/data/futures/um"
OUT=Path("research/results");OUT.mkdir(parents=True,exist_ok=True)

def checksum(url):
    req=urllib.request.Request(url+".CHECKSUM",headers={"User-Agent":UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=60) as r:txt=r.read().decode("utf-8","replace")
    m=re.search(r"([0-9a-fA-F]{64})",txt)
    if not m:raise RuntimeError("missing checksum")
    return m.group(1).lower()

def download(url,dst):
    exp=checksum(url);h=hashlib.sha256();n=0
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=300) as r,dst.open("wb") as f:
        while True:
            b=r.read(8*1024*1024)
            if not b:break
            f.write(b);h.update(b);n+=len(b)
    got=h.hexdigest()
    if got!=exp:raise RuntimeError(f"checksum mismatch {got}!={exp}")
    return exp,n

def open_rows(path):
    z=zipfile.ZipFile(path); names=[n for n in z.namelist() if not n.endswith("/")]
    if len(names)!=1:raise RuntimeError("unexpected archive members")
    raw=z.open(names[0]); text=io.TextIOWrapper(raw,encoding="utf-8-sig",newline="")
    return z,raw,text,csv.reader(text)

def norm_ts(v):
    x=int(float(v))
    while x>=10**14:x//=1000
    return x

monthly_url=f"{BASE}/monthly/trades/{ASSET}/{ASSET}-trades-{MONTH}.zip"
with tempfile.TemporaryDirectory(prefix="qh-gap-diag-") as td:
    td=Path(td); mp=td/"monthly.zip"
    monthly_sha,monthly_bytes=download(monthly_url,mp)
    prev=None; gap=None; rows=0
    z=raw=text=None
    try:
        z,raw,text,reader=open_rows(mp)
        for row in reader:
            if not row:continue
            if rows==0 and not row[0].lstrip("-").isdigit():continue
            cur={"row":rows+1,"tradeId":int(row[0]),"price":row[1],"qty":row[2],
                 "quoteQty":row[3],"timestampMs":norm_ts(row[4]),
                 "buyerMaker":str(row[5]).strip().lower()}
            if prev and cur["tradeId"]!=prev["tradeId"]+1:
                gap={"previous":prev,"current":cur,
                     "missingIds":list(range(prev["tradeId"]+1,cur["tradeId"]))}
                break
            prev=cur;rows+=1
    finally:
        if text:text.close()
        if raw:raw.close()
        if z:z.close()
    if not gap:raise RuntimeError("no trade-id gap found")
    date=datetime.fromtimestamp(gap["previous"]["timestampMs"]/1000,tz=timezone.utc).strftime("%Y-%m-%d")

    daily_trades_url=f"{BASE}/daily/trades/{ASSET}/{ASSET}-trades-{date}.zip"
    dp=td/"daily-trades.zip";daily_sha,daily_bytes=download(daily_trades_url,dp)
    lo=gap["previous"]["tradeId"]-3;hi=gap["current"]["tradeId"]+3
    daily_neighborhood=[];daily_ids=set()
    z=raw=text=None
    try:
        z,raw,text,reader=open_rows(dp);n=0
        for row in reader:
            if not row:continue
            if n==0 and not row[0].lstrip("-").isdigit():continue
            tid=int(row[0]);n+=1
            if lo<=tid<=hi:
                daily_ids.add(tid)
                daily_neighborhood.append({"tradeId":tid,"price":row[1],"qty":row[2],
                    "quoteQty":row[3],"timestampMs":norm_ts(row[4]),
                    "buyerMaker":str(row[5]).strip().lower()})
            if tid>hi and daily_neighborhood:break
    finally:
        if text:text.close()
        if raw:raw.close()
        if z:z.close()

    daily_agg_url=f"{BASE}/daily/aggTrades/{ASSET}/{ASSET}-aggTrades-{date}.zip"
    ap=td/"daily-agg.zip";agg_sha,agg_bytes=download(daily_agg_url,ap)
    missing=set(gap["missingIds"]); agg_cover=[];agg_neighbor=[]
    z=raw=text=None
    try:
        z,raw,text,reader=open_rows(ap);n=0
        for row in reader:
            if not row:continue
            if n==0 and not row[0].lstrip("-").isdigit():continue
            n+=1;first=int(row[3]);last=int(row[4])
            rec={"aggId":int(row[0]),"price":row[1],"qty":row[2],
                 "firstTradeId":first,"lastTradeId":last,
                 "timestampMs":norm_ts(row[5]),"buyerMaker":str(row[6]).strip().lower()}
            if any(first<=m<=last for m in missing):agg_cover.append(rec)
            if last>=lo and first<=hi:agg_neighbor.append(rec)
            if first>hi and agg_neighbor:break
    finally:
        if text:text.close()
        if raw:raw.close()
        if z:z.close()

result={
 "schema":1,"stage":"INDIVIDUAL_TRADES_ID_GAP_SOURCE_DIAGNOSTIC",
 "asset":ASSET,"month":MONTH,"date":date,
 "monthly":{"url":monthly_url,"sha256":monthly_sha,"bytes":monthly_bytes,
            "rowsBeforeFirstGap":rows,"firstGap":gap},
 "dailyTrades":{"url":daily_trades_url,"sha256":daily_sha,"bytes":daily_bytes,
                "neighborhood":daily_neighborhood,
                "missingIdsPresent":[m for m in gap["missingIds"] if m in daily_ids]},
 "dailyAggTrades":{"url":daily_agg_url,"sha256":agg_sha,"bytes":agg_bytes,
                   "recordsCoveringMissingIds":agg_cover,"neighborhood":agg_neighbor},
 "interpretation":{
   "dailyTradesRepeatsGap":all(m not in daily_ids for m in gap["missingIds"]),
   "aggTradesReferencesMissingId":len(agg_cover)>0
 },
 "directionalOrderImbalanceCalculated":False,"forwardReturnsCalculated":False,
 "signalReturnRelationshipCalculated":False,"positionsCalculated":False,
 "strategyPnlCalculated":False,"executionImpact":False
}
(OUT/f"qh-{ASSET}-{MONTH}-trade-gap-diagnostic.json").write_text(json.dumps(result,indent=2)+"\n")
print(json.dumps(result,indent=2))
