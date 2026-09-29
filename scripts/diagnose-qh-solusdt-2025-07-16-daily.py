#!/usr/bin/env python3
"""Compare SOLUSDT 2025-07-16 daily aggTrades with the monthly anomaly.

Read-only source provenance check. No signals, returns, positions or PnL.
"""
import csv, hashlib, io, json, re, tempfile, urllib.request, zipfile
from pathlib import Path

URL="https://data.binance.vision/data/futures/um/daily/aggTrades/SOLUSDT/SOLUSDT-aggTrades-2025-07-16.zip"
UA="MERIDIAN-QH-SOL-2025-07-16-DAILY-COMPARE/1"
TARGET=926014272
OUT=Path("research/results"); OUT.mkdir(parents=True,exist_ok=True)

def checksum():
    req=urllib.request.Request(URL+".CHECKSUM",headers={"User-Agent":UA})
    with urllib.request.urlopen(req,timeout=60) as r: txt=r.read().decode("utf-8","replace")
    m=re.search(r"([0-9a-fA-F]{64})",txt)
    if not m: raise RuntimeError("missing checksum")
    return m.group(1).lower()

def download(dst):
    exp=checksum(); h=hashlib.sha256(); n=0
    req=urllib.request.Request(URL,headers={"User-Agent":UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=180) as r, dst.open("wb") as f:
        while True:
            b=r.read(8*1024*1024)
            if not b: break
            f.write(b); h.update(b); n+=len(b)
    got=h.hexdigest()
    if got!=exp: raise RuntimeError(f"checksum mismatch {got} != {exp}")
    return exp,n

def norm(row):
    return {
      "aggId":int(row[0]),"price":row[1],"qty":row[2],
      "firstTradeId":int(row[3]),"lastTradeId":int(row[4]),
      "timestamp":int(float(row[5])),"buyerMaker":str(row[6]).strip().lower()
    }

with tempfile.TemporaryDirectory(prefix="meridian-sol-daily-") as td:
    p=Path(td)/"daily.zip"; sha,size=download(p)
    with zipfile.ZipFile(p) as z:
        names=[n for n in z.namelist() if not n.endswith("/")]
        if len(names)!=1: raise RuntimeError("unexpected members")
        hits=[]; prev=None; duplicateIds=0; decreasingIds=0; timestampDecreases=0
        rows=0; neighborhood=[]
        with z.open(names[0]) as raw, io.TextIOWrapper(raw,encoding="utf-8-sig",newline="") as text:
            for row in csv.reader(text):
                if not row: continue
                if rows==0 and not row[0].lstrip("-").isdigit(): continue
                cur=norm(row); rows+=1
                if prev:
                    if cur["aggId"]==prev["aggId"]: duplicateIds+=1
                    if cur["aggId"]<prev["aggId"]: decreasingIds+=1
                    if cur["timestamp"]<prev["timestamp"]: timestampDecreases+=1
                if abs(cur["aggId"]-TARGET)<=2:
                    neighborhood.append({"row":rows,**cur})
                if cur["aggId"]==TARGET:
                    hits.append({"row":rows,**cur})
                prev=cur

result={
  "schema":1,"stage":"DATA_V1_SOURCE_DAILY_COMPARE",
  "asset":"SOLUSDT","date":"2025-07-16","source":URL,
  "officialArchiveSha256":sha,"archiveBytes":size,"rows":rows,
  "targetAggregateTradeId":TARGET,"targetOccurrences":len(hits),
  "targetRows":hits,"targetNeighborhood":neighborhood,
  "duplicateAggregateIds":duplicateIds,"decreasingAggregateIds":decreasingIds,
  "timestampDecreases":timestampDecreases,
  "directionalOrderImbalanceCalculated":False,"forwardReturnsCalculated":False,
  "signalReturnRelationshipCalculated":False,"positionsCalculated":False,
  "strategyPnlCalculated":False,"executionImpact":False
}
(OUT/"qh-solusdt-2025-07-16-daily-id-compare.json").write_text(json.dumps(result,indent=2)+"\n")
print(json.dumps(result,indent=2))
