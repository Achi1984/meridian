#!/usr/bin/env python3
"""Strategy-neutral diagnostic for SOLUSDT 2025-07 aggTrade ID ordering.

Downloads the official Binance Vision USD-M monthly aggTrades archive, verifies
its published SHA-256, then records aggregate-trade-ID ordering anomalies.
No direction aggregation, returns, positions, or PnL are calculated.
"""
import csv, hashlib, io, json, re, tempfile, urllib.request, zipfile
from pathlib import Path

ASSET="SOLUSDT"
MONTH="2025-07"
BASE="https://data.binance.vision/data/futures/um/monthly/aggTrades"
URL=f"{BASE}/{ASSET}/{ASSET}-aggTrades-{MONTH}.zip"
UA="MERIDIAN-QH-V1-SOL-ID-DIAGNOSTIC/1"
OUT=Path("research/results")
CHUNK=8*1024*1024

def checksum():
    req=urllib.request.Request(URL+".CHECKSUM",headers={"User-Agent":UA})
    with urllib.request.urlopen(req,timeout=60) as r:
        s=r.read().decode("utf-8","replace")
    m=re.search(r"([0-9a-fA-F]{64})",s)
    if not m: raise RuntimeError("checksum missing")
    return m.group(1).lower()

def download(dst):
    expected=checksum(); h=hashlib.sha256(); n=0
    req=urllib.request.Request(URL,headers={"User-Agent":UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=180) as r, dst.open("wb") as f:
        while True:
            b=r.read(CHUNK)
            if not b: break
            f.write(b); h.update(b); n+=len(b)
    actual=h.hexdigest()
    if actual!=expected: raise RuntimeError(f"checksum mismatch {expected} != {actual}")
    return expected,n

def is_header(row):
    if not row:return False
    x=row[0].strip().lower().replace(" ","_")
    return x in {"agg_trade_id","aggregate_tradeid","aggregate_trade_id","id"} or "trade" in x

def run():
    OUT.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="qh-sol-id-") as td:
        zp=Path(td)/"data.zip"
        sha,size=download(zp)
        with zipfile.ZipFile(zp) as z:
            members=[n for n in z.namelist() if not n.endswith("/")]
            if len(members)!=1: raise RuntimeError(f"expected one member, got {members}")
            raw=z.open(members[0],"r")
            txt=io.TextIOWrapper(raw,encoding="utf-8-sig",newline="")
            reader=csv.reader(txt)
            prev=None; rows=0; decreases=0; equals=0; anomalies=[]
            first_id=last_id=None; first_ts=last_ts=None
            for row in reader:
                if not row: continue
                if rows==0 and is_header(row): continue
                if len(row)<7: raise RuntimeError(f"short row at data row {rows+1}: {len(row)}")
                aid=int(row[0]); ts=int(float(row[5]))
                if first_id is None: first_id,first_ts=aid,ts
                if prev is not None:
                    pa,pts,prow=prev
                    if aid<=pa:
                        kind="EQUAL" if aid==pa else "DECREASE"
                        if kind=="EQUAL": equals+=1
                        else: decreases+=1
                        if len(anomalies)<50:
                            anomalies.append({
                                "kind":kind,
                                "previousDataRow":rows,
                                "currentDataRow":rows+1,
                                "previousAggTradeId":pa,
                                "currentAggTradeId":aid,
                                "deltaId":aid-pa,
                                "previousTimestamp":pts,
                                "currentTimestamp":ts,
                                "deltaTimestampMs":ts-pts,
                                "previousRow":prow,
                                "currentRow":row
                            })
                prev=(aid,ts,row)
                last_id,last_ts=aid,ts
                rows+=1
            txt.close(); raw.close()

    result={
      "schema":1,
      "family":"PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
      "stage":"DATA_V1_SOURCE_DIAGNOSTIC",
      "asset":ASSET,"month":MONTH,
      "sourceUrl":URL,"sha256":sha,"downloadedBytes":size,
      "rows":rows,"firstAggTradeId":first_id,"lastAggTradeId":last_id,
      "firstTimestamp":first_ts,"lastTimestamp":last_ts,
      "nonIncreasingEvents":decreases+equals,
      "decreaseEvents":decreases,"equalEvents":equals,
      "sampleAnomalies":anomalies,
      "directionalOrderImbalanceCalculated":False,
      "forwardReturnsCalculated":False,
      "signalReturnRelationshipCalculated":False,
      "positionsCalculated":False,
      "strategyPnlCalculated":False,
      "executionImpact":False
    }
    p=OUT/"qh-v1-solusdt-2025-07-aggtrade-id-diagnostic.json"
    p.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))

if __name__=="__main__":
    run()
