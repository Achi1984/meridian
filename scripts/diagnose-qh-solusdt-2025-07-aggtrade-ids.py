#!/usr/bin/env python3
"""Read-only diagnostic for SOLUSDT 2025-07 USD-M aggTrades ID ordering.

No signal, return, position or PnL calculation. Verifies the official archive
checksum, scans raw row order, and reports only identifier/timestamp anomalies.
"""
import csv, hashlib, io, json, re, tempfile, urllib.request, zipfile
from pathlib import Path

URL="https://data.binance.vision/data/futures/um/monthly/aggTrades/SOLUSDT/SOLUSDT-aggTrades-2025-07.zip"
UA="MERIDIAN-QH-SOL-2025-07-ID-DIAGNOSTIC/1"
OUT=Path("research/results")
OUT.mkdir(parents=True,exist_ok=True)

def checksum():
    req=urllib.request.Request(URL+".CHECKSUM",headers={"User-Agent":UA})
    with urllib.request.urlopen(req,timeout=60) as r:
        txt=r.read().decode("utf-8","replace")
    m=re.search(r"([0-9a-fA-F]{64})",txt)
    if not m: raise RuntimeError("missing official checksum")
    return m.group(1).lower()

def download(dst):
    expected=checksum(); h=hashlib.sha256(); n=0
    req=urllib.request.Request(URL,headers={"User-Agent":UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=240) as r, dst.open("wb") as f:
        while True:
            b=r.read(8*1024*1024)
            if not b: break
            f.write(b); h.update(b); n+=len(b)
    actual=h.hexdigest()
    if actual!=expected: raise RuntimeError(f"checksum mismatch {expected} != {actual}")
    return expected,n

def ts_ms(v):
    x=int(float(v))
    while x>=10**14: x//=1000
    return x

with tempfile.TemporaryDirectory(prefix="meridian-sol-id-diag-") as td:
    p=Path(td)/"agg.zip"
    sha,size=download(p)
    with zipfile.ZipFile(p) as z:
        names=[n for n in z.namelist() if not n.endswith("/")]
        if len(names)!=1: raise RuntimeError("archive must have one member")
        with z.open(names[0]) as raw, io.TextIOWrapper(raw,encoding="utf-8-sig",newline="") as text:
            reader=csv.reader(text)
            rows=0; prev=None
            duplicate_ids=0; decreasing_ids=0; timestamp_decreases=0
            underlying_overlap=0; exact_prev_row_duplicates=0
            anomalies=[]; first=None; last=None
            for row in reader:
                if not row: continue
                if rows==0 and not row[0].lstrip("-").isdigit():
                    continue
                if len(row)<7: raise RuntimeError(f"short row at data row {rows+1}")
                cur={
                    "row":rows+1,
                    "aggId":int(row[0]),
                    "price":row[1],
                    "qty":row[2],
                    "firstTradeId":int(row[3]),
                    "lastTradeId":int(row[4]),
                    "timestampMs":ts_ms(row[5]),
                    "buyerMaker":str(row[6]).strip().lower(),
                }
                if cur["firstTradeId"]>cur["lastTradeId"]:
                    raise RuntimeError(f"invalid trade-id interval at row {cur['row']}")
                if cur["buyerMaker"] not in ("true","false","1","0"):
                    raise RuntimeError(f"invalid buyerMaker at row {cur['row']}")
                if first is None: first=cur.copy()
                if prev is not None:
                    id_delta=cur["aggId"]-prev["aggId"]
                    ts_delta=cur["timestampMs"]-prev["timestampMs"]
                    if id_delta==0: duplicate_ids+=1
                    if id_delta<0: decreasing_ids+=1
                    if ts_delta<0: timestamp_decreases+=1
                    if cur["firstTradeId"]<=prev["lastTradeId"]: underlying_overlap+=1
                    if (
                        cur["aggId"]==prev["aggId"] and cur["price"]==prev["price"] and
                        cur["qty"]==prev["qty"] and cur["firstTradeId"]==prev["firstTradeId"] and
                        cur["lastTradeId"]==prev["lastTradeId"] and
                        cur["timestampMs"]==prev["timestampMs"] and
                        cur["buyerMaker"]==prev["buyerMaker"]
                    ):
                        exact_prev_row_duplicates+=1
                    if id_delta<=0 and len(anomalies)<50:
                        anomalies.append({
                            "previous":prev,
                            "current":cur,
                            "aggIdDelta":id_delta,
                            "timestampDeltaMs":ts_delta,
                            "underlyingTradeGap":cur["firstTradeId"]-prev["lastTradeId"]-1,
                        })
                prev=cur; last=cur.copy(); rows+=1

summary={
    "schema":1,
    "stage":"DATA_V1_SOURCE_DIAGNOSTIC",
    "asset":"SOLUSDT","month":"2025-07",
    "source":URL,
    "officialArchiveSha256":sha,
    "archiveBytes":size,
    "rows":rows,
    "firstRow":first,"lastRow":last,
    "duplicateAggregateIds":duplicate_ids,
    "decreasingAggregateIds":decreasing_ids,
    "timestampDecreases":timestamp_decreases,
    "underlyingTradeIntervalOverlaps":underlying_overlap,
    "exactAdjacentRowDuplicates":exact_prev_row_duplicates,
    "firstIdentifierAnomalies":anomalies,
    "directionalOrderImbalanceCalculated":False,
    "forwardReturnsCalculated":False,
    "signalReturnRelationshipCalculated":False,
    "positionsCalculated":False,
    "strategyPnlCalculated":False,
    "executionImpact":False
}
(OUT/"qh-solusdt-2025-07-aggtrade-id-diagnostic.json").write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps(summary,indent=2))
