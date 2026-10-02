#!/usr/bin/env python3
"""Extract compact preregistered Strategy V1 inputs from validated Data V1.3 source archives.

No forward return, position, PnL, Paper, or live execution is calculated here.
"""
from __future__ import annotations
import bisect
import importlib.util
import json
import os
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ASSETS=("BTCUSDT","ETHUSDT","XRPUSDT","SOLUSDT","DOGEUSDT","ADAUSDT")
MONTHS=tuple(f"{y:04d}-{m:02d}" for y,ms in ((2025,range(1,13)),(2026,range(1,9))) for m in ms)
QUARTER_MS=15*60*1000
SIGNAL_MS=10*1000
EXEC_END_MS=60*1000

ASSET=os.environ.get("QH_ASSET","")
MONTH=os.environ.get("QH_MONTH","")
OUT=Path(os.environ.get("QH_STRATEGY_SHARD_OUTPUT_DIR","/tmp/meridian-qh-strategy-v1"))
SOURCE_LOCK_PATH=os.environ.get("QH_V13_SOURCE_LOCK","")
if ASSET not in ASSETS:raise SystemExit(f"invalid QH_ASSET {ASSET!r}")
if MONTH not in MONTHS:raise SystemExit(f"invalid QH_MONTH {MONTH!r}")

def load_source_lock(path):
    if not path:
        raise RuntimeError("QH_V13_SOURCE_LOCK is required for historical source extraction")
    x=json.loads(Path(path).read_text())
    if x.get("stage")!="INDIVIDUAL_TRADES_DATA_V1_3_EXACT_SOURCE_LOCK" or x.get("sourceRun")!=36690368732:
        raise RuntimeError("invalid V1.3 source lock")
    if x.get("expectedShards")!=120 or x.get("observedShards")!=120:
        raise RuntimeError("incomplete V1.3 source lock")
    key=f"{ASSET}:{MONTH}"
    record=x.get("records",{}).get(key)
    if not record:
        raise RuntimeError(f"missing V1.3 source lock record {key}")
    return record

def verify_source_lock(downloads,expected):
    for fam in ("trades","fundingRate"):
        got=downloads.get(fam,{})
        want=expected.get(fam,{})
        if got.get("sha256")!=want.get("sha256") or got.get("bytes")!=want.get("bytes"):
            raise RuntimeError(
                f"V1.3 source lock mismatch {fam}: "
                f"{got.get('sha256')} / {got.get('bytes')} != "
                f"{want.get('sha256')} / {want.get('bytes')}"
            )

def load_v13():
    path=ROOT/"scripts"/"audit-qh-individual-trades-data-v1-3-shard.py"
    spec=importlib.util.spec_from_file_location("meridian_qh_v13_source",path)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if mod.ASSET!=ASSET or mod.MONTH!=MONTH:
        raise RuntimeError("V1.3 parser environment mismatch")
    return mod

def read_funding(v13,zpath):
    events=[]
    zf=raw=text=None
    first=True;ti=ri=None;prev=None
    try:
        zf,raw,text,reader=v13.open_csv(zpath)
        for row in reader:
            if not row:continue
            if first:
                first=False
                if v13.is_header(row,"fundingRate"):
                    ti,ri=v13.funding_indices(row);continue
                ti,ri=0,2
            if len(row)<=max(ti,ri):raise RuntimeError("malformed funding row")
            ts,unit=v13.ts_ms(row[ti])
            if unit!="MILLISECOND":raise RuntimeError(f"unexpected funding timestamp unit {unit}")
            rate=v13.finite(row[ri])
            if not (v13.MONTH_START_MS<=ts<v13.MONTH_END_MS):raise RuntimeError("funding outside month")
            if prev is not None and ts<=prev:raise RuntimeError("funding not strictly increasing")
            events.append({"timestampMs":ts,"fundingRate":rate})
            prev=ts
    finally:
        if text:text.close()
        if raw:raw.close()
        if zf:zf.close()
    if not events:raise RuntimeError("zero funding rows")
    return events

def extract_compact(v13,trades_zip,funding_zip):
    funding=read_funding(v13,funding_zip)
    funding_times=[x["timestampMs"] for x in funding]
    funding_refs=[None]*len(funding)

    bins=(v13.MONTH_END_MS-v13.MONTH_START_MS)//QUARTER_MS
    signed=[0.0]*bins
    total=[0.0]*bins
    exec_ref=[None]*bins
    qh_rows=[0]*bins
    trade_rows=0
    last_trade=None
    units=set()
    zf=raw=text=None
    try:
        zf,raw,text,reader=v13.open_csv(trades_zip)
        for row in reader:
            if not row:continue
            if trade_rows==0 and v13.is_header(row,"trades"):continue
            if len(row)<6:raise RuntimeError(f"trades short row: {len(row)}")
            int(row[0])
            price=v13.finite(row[1],positive=True)
            qty=v13.finite(row[2],positive=True)
            v13.finite(row[3],nonnegative=True)
            ts,unit=v13.ts_ms(row[4]);units.add(unit)
            maker=v13.strict_bool(row[5])
            if not (v13.MONTH_START_MS<=ts<v13.MONTH_END_MS):
                raise RuntimeError(f"trade timestamp outside target month: {ts}")
            ordinal=trade_rows+1
            qh=(ts-v13.MONTH_START_MS)//QUARTER_MS
            if not (0<=qh<bins):raise RuntimeError("invalid quarter-hour bin")
            offset=(ts-v13.MONTH_START_MS)%QUARTER_MS
            qh_rows[qh]+=1
            if offset<SIGNAL_MS:
                total[qh]+=qty
                signed[qh]+=(-qty if maker else qty)
            elif offset<EXEC_END_MS:
                cur=exec_ref[qh]
                candidate=(ts,ordinal,price)
                if cur is None or candidate[:2]<cur[:2]:
                    exec_ref[qh]=candidate

            fi=bisect.bisect_left(funding_times,ts)
            if fi<len(funding_times):
                cur=funding_refs[fi]
                candidate=(ts,ordinal,price)
                if cur is None or candidate[:2]>cur[:2]:
                    funding_refs[fi]=candidate
            candidate=(ts,ordinal,price)
            if last_trade is None or candidate[:2]>last_trade[:2]:
                last_trade=candidate
            trade_rows+=1
    finally:
        if text:text.close()
        if raw:raw.close()
        if zf:zf.close()

    if trade_rows<=0:raise RuntimeError("zero trade rows")
    if units!={"MILLISECOND"}:raise RuntimeError(f"unexpected trade timestamp units: {sorted(units)}")
    empty_qh=sum(1 for x in qh_rows if x==0)
    if empty_qh:raise RuntimeError(f"quarter-hour source coverage failed: {empty_qh} empty bins")

    boundaries=[]
    missing_signal=missing_exec=0
    for i in range(bins):
        boundary=v13.MONTH_START_MS+i*QUARTER_MS
        oi=None if total[i]<=0 else max(-1.0,min(1.0,signed[i]/total[i]))
        if oi is None:missing_signal+=1
        e=exec_ref[i]
        if e is None:missing_exec+=1
        boundaries.append({
            "boundaryMs":boundary,
            "signedQty":signed[i],
            "totalQty":total[i],
            "oi":oi,
            "executionTimestampMs":e[0] if e else None,
            "executionSourceRecordOrdinal":e[1] if e else None,
            "executionPrice":e[2] if e else None,
        })

    funding_out=[]
    missing_funding_ref=0
    for f,ref in zip(funding,funding_refs):
        if ref is None:missing_funding_ref+=1
        funding_out.append({
            **f,
            "referenceTimestampMs":ref[0] if ref else None,
            "referenceSourceRecordOrdinal":ref[1] if ref else None,
            "referencePrice":ref[2] if ref else None,
        })
    return {
        "tradeRows":trade_rows,
        "quarterHourBins":bins,
        "missingSignalEvents":missing_signal,
        "missingExecutionReferences":missing_exec,
        "missingFundingReferences":missing_funding_ref,
        "boundaries":boundaries,
        "funding":funding_out,
        "lastTrade":{
            "timestampMs":last_trade[0],
            "sourceRecordOrdinal":last_trade[1],
            "price":last_trade[2],
        },
    }

def run():
    v13=load_v13()
    expected_source=load_source_lock(SOURCE_LOCK_PATH)
    OUT.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"meridian-qh-strategy-v1-{ASSET}-{MONTH}-") as td:
        td=Path(td)
        trades=td/"trades.zip";funding=td/"funding.zip"
        downloads={
            "trades":v13.download_verified(v13.source_url("trades"),trades),
            "fundingRate":v13.download_verified(v13.source_url("fundingRate"),funding),
        }
        verify_source_lock(downloads,expected_source)
        funding_audit=v13.audit_funding(funding)
        if funding_audit.get("coveragePass") is not True:
            raise RuntimeError("frozen V1.3 funding coverage invariant failed")
        compact=extract_compact(v13,trades,funding)
        trades.unlink(missing_ok=True);funding.unlink(missing_ok=True)
    result={
        "schema":1,
        "family":"PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
        "stage":"STRATEGY_V1_COMPACT_SOURCE_SHARD",
        "ruleset":"QUARTER-HOUR-BOUNDARY-IMBALANCE-STRATEGY-V1-FROZEN",
        "dataDependency":"INDIVIDUAL_TRADES_DATA_V1_3_120_OF_120_PASS",
        "asset":ASSET,"month":MONTH,
        "downloads":downloads,
        "exactV13SourceLockVerified":True,
        "fundingAudit":funding_audit,
        **compact,
        "directionalOrderImbalanceCalculated":True,
        "forwardReturnsCalculated":False,
        "positionsCalculated":False,
        "strategyPnlCalculated":False,
        "executionImpact":False,
        "paperAuthorized":False,
        "liveAuthorized":False,
        "rawArchivesRetained":False,
    }
    path=OUT/f"{ASSET}-{MONTH}.json"
    path.write_text(json.dumps(result,separators=(",",":"))+"\n")
    print(json.dumps({
        "asset":ASSET,"month":MONTH,"tradeRows":compact["tradeRows"],
        "quarterHourBins":compact["quarterHourBins"],
        "missingSignalEvents":compact["missingSignalEvents"],
        "missingExecutionReferences":compact["missingExecutionReferences"],
        "missingFundingReferences":compact["missingFundingReferences"],
        "output":str(path)
    },indent=2))

if __name__=="__main__":
    try:run()
    except Exception as exc:
        OUT.mkdir(parents=True,exist_ok=True)
        fail={
            "schema":1,"family":"PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
            "stage":"STRATEGY_V1_COMPACT_SOURCE_SHARD","asset":ASSET,"month":MONTH,
            "error":f"{type(exc).__name__}: {exc}","gate":{"pass":False,"reason":"SHARD_EXCEPTION"},
            "forwardReturnsCalculated":False,"positionsCalculated":False,"strategyPnlCalculated":False,
            "executionImpact":False,"paperAuthorized":False,"liveAuthorized":False
        }
        (OUT/f"{ASSET}-{MONTH}.json").write_text(json.dumps(fail,indent=2)+"\n")
        raise
