#!/usr/bin/env python3
"""Strategy-neutral sharded quality audit for Quarter-Hour Individual-Trades Data V1.1.

Processes one Binance USD-M asset-month. Verifies official CHECKSUMs, validates
individual trades plus 1m klines/funding continuity, emits compact metadata,
and deletes raw archives. It MUST NOT calculate directional imbalance, forward
returns, positions, or PnL.
"""
from __future__ import annotations

import csv, hashlib, io, json, math, os, re, tempfile, urllib.request, zipfile
from calendar import monthrange
from datetime import datetime, timezone
from pathlib import Path

BASE="https://data.binance.vision/data/futures/um/monthly"
ASSETS=("BTCUSDT","ETHUSDT","XRPUSDT","SOLUSDT","DOGEUSDT","ADAUSDT")
MONTHS=tuple(f"{y:04d}-{m:02d}" for y,ms in ((2025,range(1,13)),(2026,range(1,9))) for m in ms)
UA="MERIDIAN-QH-INDIVIDUAL-TRADES-DATA-V1-1/1"
CHUNK=8*1024*1024
FUND_MAX_GAP_MS=12*60*60*1000
QUOTE_REL_TOL=1e-8

ASSET=os.environ.get("QH_ASSET","")
MONTH=os.environ.get("QH_MONTH","")
OUT=Path(os.environ.get("QH_OUTPUT_DIR","/tmp/meridian-qh-individual-trades-v1-1"))
if ASSET not in ASSETS: raise SystemExit(f"invalid QH_ASSET {ASSET!r}")
if MONTH not in MONTHS: raise SystemExit(f"invalid QH_MONTH {MONTH!r}")

def month_bounds(ym):
    y,m=map(int,ym.split("-"))
    start=int(datetime(y,m,1,tzinfo=timezone.utc).timestamp()*1000)
    ny,nm=(y+1,1) if m==12 else (y,m+1)
    end=int(datetime(ny,nm,1,tzinfo=timezone.utc).timestamp()*1000)
    minutes=monthrange(y,m)[1]*24*60
    return start,end,minutes

MONTH_START_MS,MONTH_END_MS,EXPECTED_MINUTES=month_bounds(MONTH)
EXPECTED_QH_BINS=EXPECTED_MINUTES//15

def source_url(fam):
    if fam=="trades": return f"{BASE}/trades/{ASSET}/{ASSET}-trades-{MONTH}.zip"
    if fam=="klines1m": return f"{BASE}/klines/{ASSET}/1m/{ASSET}-1m-{MONTH}.zip"
    if fam=="fundingRate": return f"{BASE}/fundingRate/{ASSET}/{ASSET}-fundingRate-{MONTH}.zip"
    raise ValueError(fam)

def checksum(url):
    req=urllib.request.Request(url+".CHECKSUM",headers={"User-Agent":UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=60) as r: txt=r.read().decode("utf-8","replace")
    m=re.search(r"([0-9a-fA-F]{64})",txt)
    if not m: raise RuntimeError(f"missing SHA256 in checksum: {url}")
    return m.group(1).lower()

def download_verified(url,dst):
    expected=checksum(url); h=hashlib.sha256(); n=0
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept-Encoding":"identity"})
    with urllib.request.urlopen(req,timeout=300) as r,dst.open("wb") as f:
        while True:
            b=r.read(CHUNK)
            if not b: break
            f.write(b); h.update(b); n+=len(b)
    actual=h.hexdigest()
    if actual!=expected: raise RuntimeError(f"SHA256 mismatch {url}: {actual} != {expected}")
    return {"url":url,"sha256":actual,"bytes":n}

def open_csv(zpath):
    zf=zipfile.ZipFile(zpath)
    members=[n for n in zf.namelist() if not n.endswith("/")]
    if len(members)!=1:
        zf.close(); raise RuntimeError(f"{zpath.name}: expected one member")
    raw=zf.open(members[0],"r")
    text=io.TextIOWrapper(raw,encoding="utf-8-sig",newline="")
    return zf,raw,text,csv.reader(text)

def ts_ms(v):
    raw=int(float(v))
    if raw<=0: raise ValueError("non-positive timestamp")
    if raw>=10**17:
        unit="NANOSECOND_OR_FINER"
        while raw>=10**14: raw//=1000
    elif raw>=10**14:
        unit="MICROSECOND"; raw//=1000
    else: unit="MILLISECOND"
    return raw,unit

def finite(v,positive=False,nonnegative=False):
    x=float(v)
    if not math.isfinite(x): raise ValueError("non-finite numeric field")
    if positive and x<=0: raise ValueError("expected positive field")
    if nonnegative and x<0: raise ValueError("expected nonnegative field")
    return x

def strict_bool(v):
    s=str(v).strip().lower()
    if s in ("true","1"): return True
    if s in ("false","0"): return False
    raise ValueError(f"invalid Boolean {v!r}")

def is_header(row,fam):
    if not row:return False
    first=row[0].strip().lower().replace(" ","_")
    if fam=="trades": return first in ("id","trade_id","tradeid") or ("trade" in first and not first.lstrip("-").isdigit())
    if fam=="klines1m": return first in ("open_time","opentime","timestamp","time")
    if fam=="fundingRate":
        joined=",".join(x.lower() for x in row)
        return "funding" in joined or "calc_time" in joined
    return False

def audit_trades(zpath):
    rows=0; first_id=last_id=first_ts=last_ts=None; prev_id=prev_ts=None
    units=set(); qh_counts={}; max_quote_err=0.0; id_gap_events=0; missing_id_count=0; max_id_step=1
    zf=raw=text=None
    try:
        zf,raw,text,reader=open_csv(zpath)
        for row in reader:
            if not row: continue
            if rows==0 and is_header(row,"trades"): continue
            if len(row)<6: raise RuntimeError(f"trades short row: {len(row)}")
            trade_id=int(row[0])
            price=finite(row[1],positive=True)
            qty=finite(row[2],positive=True)
            quote=finite(row[3],nonnegative=True)
            ts,unit=ts_ms(row[4]); units.add(unit)
            strict_bool(row[5])
            if not (MONTH_START_MS<=ts<MONTH_END_MS):
                raise RuntimeError(f"trade timestamp outside target month: {ts}")
            if prev_ts is not None and ts<prev_ts:
                raise RuntimeError("trade timestamp decreased")
            if prev_id is not None:
                if trade_id<=prev_id: raise RuntimeError("trade id not strictly increasing")
                step=trade_id-prev_id\n                max_id_step=max(max_id_step,step)\n                if step>1:\n                    id_gap_events+=1\n                    missing_id_count+=step-1
            expected_quote=price*qty
            err=abs(quote-expected_quote)
            max_quote_err=max(max_quote_err,err)
            if err>max(1e-8,abs(quote)*QUOTE_REL_TOL):
                raise RuntimeError(f"quoteQty inconsistent with price*qty at trade {trade_id}")
            qh=(ts-MONTH_START_MS)//(15*60*1000)
            if not (0<=qh<EXPECTED_QH_BINS): raise RuntimeError("invalid quarter-hour bin")
            qh_counts[qh]=qh_counts.get(qh,0)+1
            if first_id is None: first_id,first_ts=trade_id,ts
            last_id,last_ts=trade_id,ts; prev_id,prev_ts=trade_id,ts; rows+=1
    finally:
        if text:text.close()
        if raw:raw.close()
        if zf:zf.close()
    if rows==0: raise RuntimeError("trades archive has zero rows")
    if len(units)!=1: raise RuntimeError(f"mixed trades timestamp units: {sorted(units)}")
    if last_id-first_id+1!=rows: raise RuntimeError("trade-id span does not match row count")
    empty=EXPECTED_QH_BINS-len(qh_counts)
    return {
      "rows":rows,"firstTradeId":first_id,"lastTradeId":last_id,
      "firstTimestampMs":first_ts,"lastTimestampMs":last_ts,
      "timestampUnitDetected":next(iter(units)),
      "tradeIdSpanRows":last_id-first_id+1,
      "tradeIdsContiguous":True,
      "expectedQuarterHourBins":EXPECTED_QH_BINS,
      "nonEmptyQuarterHourBins":len(qh_counts),"emptyQuarterHourBins":empty,
      "minTradesPerNonEmptyQuarterHour":min(qh_counts.values()),
      "maxTradesPerQuarterHour":max(qh_counts.values()),
      "maxAbsoluteQuoteConsistencyError":max_quote_err,
      "coveragePass":empty==0
    }

def audit_klines(zpath):
    rows=0; first=last=prev=None; units=set()
    zf=raw=text=None
    try:
        zf,raw,text,reader=open_csv(zpath)
        for row in reader:
            if not row:continue
            if rows==0 and is_header(row,"klines1m"):continue
            if len(row)<11: raise RuntimeError("1m kline short row")
            t,u=ts_ms(row[0]); units.add(u)
            o=finite(row[1],positive=True); h=finite(row[2],positive=True)
            l=finite(row[3],positive=True); c=finite(row[4],positive=True)
            vol=finite(row[5],nonnegative=True); qvol=finite(row[7],nonnegative=True)
            finite(row[8],nonnegative=True); tb=finite(row[9],nonnegative=True); tq=finite(row[10],nonnegative=True)
            if h<max(o,c,l) or l>min(o,c,h):raise RuntimeError("inconsistent OHLC")
            if tb>vol+max(1e-10,abs(vol)*1e-10):raise RuntimeError("taker base > volume")
            if tq>qvol+max(1e-8,abs(qvol)*1e-10):raise RuntimeError("taker quote > quote volume")
            if not (MONTH_START_MS<=t<MONTH_END_MS):raise RuntimeError("kline outside month")
            if prev is not None and t-prev!=60_000:raise RuntimeError(f"1m cadence gap {prev}->{t}")
            if first is None:first=t
            last=t;prev=t;rows+=1
    finally:
        if text:text.close()
        if raw:raw.close()
        if zf:zf.close()
    expected_last=MONTH_END_MS-60_000
    ok=rows==EXPECTED_MINUTES and first==MONTH_START_MS and last==expected_last and units=={"MILLISECOND"}
    return {"rows":rows,"expectedRows":EXPECTED_MINUTES,"firstOpenMs":first,"lastOpenMs":last,
      "timestampUnitsDetected":sorted(units),"coveragePass":ok}

def funding_indices(header):
    idx={x.strip():i for i,x in enumerate(header)}
    ti=idx.get("calc_time",idx.get("fundingTime"))
    ri=idx.get("last_funding_rate",idx.get("fundingRate"))
    if ti is None or ri is None:raise RuntimeError(f"unknown funding header {header}")
    return ti,ri

def audit_funding(zpath):
    rows=0; first=last=prev=None; units=set(); max_gap=0; ti=ri=None; first_data=True
    zf=raw=text=None
    try:
        zf,raw,text,reader=open_csv(zpath)
        for row in reader:
            if not row:continue
            if first_data:
                first_data=False
                if is_header(row,"fundingRate"):
                    ti,ri=funding_indices(row);continue
                ti,ri=0,2
            if len(row)<=max(ti,ri):raise RuntimeError("malformed funding row")
            t,u=ts_ms(row[ti]);units.add(u);finite(row[ri])
            if not (MONTH_START_MS<=t<MONTH_END_MS):raise RuntimeError("funding outside month")
            if prev is not None:
                gap=t-prev
                if gap<=0:raise RuntimeError("funding not strictly increasing")
                max_gap=max(max_gap,gap)
            if first is None:first=t
            last=t;prev=t;rows+=1
    finally:
        if text:text.close()
        if raw:raw.close()
        if zf:zf.close()
    if rows==0:raise RuntimeError("zero funding rows")
    leading=first-MONTH_START_MS; trailing=MONTH_END_MS-last
    ok=units=={"MILLISECOND"} and 0<=leading<=FUND_MAX_GAP_MS and 0<trailing<=FUND_MAX_GAP_MS and max_gap<=FUND_MAX_GAP_MS
    return {"rows":rows,"firstTimestampMs":first,"lastTimestampMs":last,
      "timestampUnitsDetected":sorted(units),"leadingBoundaryGapHours":leading/3_600_000,
      "trailingBoundaryGapHours":trailing/3_600_000,
      "maxInterEventGapHours":max_gap/3_600_000 if rows>1 else None,
      "coveragePass":ok}

def run():
    OUT.mkdir(parents=True,exist_ok=True)
    downloads={};audits={}
    with tempfile.TemporaryDirectory(prefix=f"meridian-qh-trades-{ASSET}-{MONTH}-") as td:
        td=Path(td)
        for fam,fn in (("trades",audit_trades),("klines1m",audit_klines),("fundingRate",audit_funding)):
            p=td/f"{fam}.zip"
            downloads[fam]=download_verified(source_url(fam),p)
            audits[fam]=fn(p)
            p.unlink(missing_ok=True)
    reasons=[]
    if not audits["trades"]["coveragePass"]: reasons.append("TRADES_QUARTER_HOUR_COVERAGE_FAIL")
    if not audits["trades"]["tradeIdsContiguous"]: reasons.append("TRADE_ID_CONTINUITY_FAIL")
    if audits["trades"]["timestampUnitDetected"]!="MILLISECOND": reasons.append("UNEXPECTED_TRADES_TIMESTAMP_UNIT")
    if not audits["klines1m"]["coveragePass"]: reasons.append("KLINE_1M_COVERAGE_FAIL")
    if not audits["fundingRate"]["coveragePass"]: reasons.append("FUNDING_COVERAGE_FAIL")
    result={
      "schema":1,"family":"PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
      "stage":"INDIVIDUAL_TRADES_DATA_V1_1_SHARD_QUALITY","asset":ASSET,"month":MONTH,
      "source":"Binance Vision official public USD-M monthly trades/klines/funding archives",
      "downloads":downloads,"audits":audits,
      "gate":{"pass":not reasons,"reasons":reasons,
              "decision":"DATA_V1_1_SHARD_PASS" if not reasons else "DATA_V1_1_SHARD_FAIL_DATA_QUALITY"},
      "directionalOrderImbalanceCalculated":False,"forwardReturnsCalculated":False,
      "signalReturnRelationshipCalculated":False,"positionsCalculated":False,
      "strategyPnlCalculated":False,"executionImpact":False,
      "paperAuthorized":False,"liveAuthorized":False,"rawArchivesRetained":False
    }
    (OUT/f"{ASSET}-{MONTH}.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))
    if reasons:raise SystemExit(2)

if __name__=="__main__":
    try:run()
    except SystemExit:raise
    except Exception as exc:
        OUT.mkdir(parents=True,exist_ok=True)
        fail={"schema":1,"family":"PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
          "stage":"INDIVIDUAL_TRADES_DATA_V1_1_SHARD_QUALITY","asset":ASSET,"month":MONTH,
          "gate":{"pass":False,"reasons":["SHARD_EXCEPTION"],"decision":"DATA_V1_1_SHARD_FAIL_DATA_QUALITY"},
          "error":f"{type(exc).__name__}: {exc}",
          "directionalOrderImbalanceCalculated":False,"forwardReturnsCalculated":False,
          "signalReturnRelationshipCalculated":False,"positionsCalculated":False,
          "strategyPnlCalculated":False,"executionImpact":False,
          "paperAuthorized":False,"liveAuthorized":False,"rawArchivesRetained":False}
        (OUT/f"{ASSET}-{MONTH}.json").write_text(json.dumps(fail,indent=2)+"\n")
        print(json.dumps(fail,indent=2));raise
