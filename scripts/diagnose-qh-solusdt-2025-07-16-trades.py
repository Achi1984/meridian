#!/usr/bin/env python3
"""Check SOLUSDT individual trades around the aggTrades anomaly on 2025-07-16.

Read-only source provenance diagnostic. No strategy calculations.
"""
import csv, hashlib, io, json, re, tempfile, urllib.request, zipfile
from pathlib import Path

URL="https://data.binance.vision/data/futures/um/daily/trades/SOLUSDT/SOLUSDT-trades-2025-07-16.zip"
UA="MERIDIAN-QH-SOL-TRADE-ID-DIAGNOSTIC/1"
LO=2468302184
HI=2468302195
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
    with urllib.request.urlopen(req,timeout=240) as r, dst.open("wb") as f:
        while True:
            b=r.read(8*1024*1024)
            if not b: break
            f.write(b);h.update(b);n+=len(b)
    got=h.hexdigest()
    if got!=exp: raise RuntimeError(f"checksum mismatch {got} != {exp}")
    return exp,n

with tempfile.TemporaryDirectory(prefix="meridian-sol-trades-") as td:
    p=Path(td)/"trades.zip"; sha,size=download(p)
    rows=0; selected=[]; prev_id=None; id_decreases=0; id_duplicates=0
    with zipfile.ZipFile(p) as z:
        names=[n for n in z.namelist() if not n.endswith("/")]
        if len(names)!=1: raise RuntimeError("unexpected members")
        with z.open(names[0]) as raw, io.TextIOWrapper(raw,encoding="utf-8-sig",newline="") as text:
            for row in csv.reader(text):
                if not row: continue
                if rows==0 and not row[0].lstrip("-").isdigit(): continue
                if len(row)<6: raise RuntimeError("short trades row")
                tid=int(row[0]); rows+=1
                if prev_id is not None:
                    if tid<prev_id:id_decreases+=1
                    if tid==prev_id:id_duplicates+=1
                prev_id=tid
                if LO<=tid<=HI:
                    selected.append({
                      "tradeId":tid,"price":row[1],"qty":row[2],
                      "quoteQty":row[3],"timestamp":int(float(row[4])),
                      "buyerMaker":str(row[5]).strip().lower()
                    })
                if tid>HI and selected:
                    break

ids=[x["tradeId"] for x in selected]
result={
  "schema":1,"stage":"DATA_V1_SOURCE_INDIVIDUAL_TRADE_COMPARE",
  "asset":"SOLUSDT","date":"2025-07-16","source":URL,
  "officialArchiveSha256":sha,"archiveBytes":size,
  "rowsScannedUntilNeighborhoodPassed":rows,
  "targetRange":[LO,HI],"rowsInTargetRange":selected,
  "observedTradeIds":ids,
  "missingTradeIds":[i for i in range(LO,HI+1) if i not in ids],
  "tradeIdDecreasesBeforeStop":id_decreases,
  "tradeIdDuplicatesBeforeStop":id_duplicates,
  "directionalOrderImbalanceCalculated":False,"forwardReturnsCalculated":False,
  "signalReturnRelationshipCalculated":False,"positionsCalculated":False,
  "strategyPnlCalculated":False,"executionImpact":False
}
(OUT/"qh-solusdt-2025-07-16-individual-trade-compare.json").write_text(json.dumps(result,indent=2)+"\n")
print(json.dumps(result,indent=2))
