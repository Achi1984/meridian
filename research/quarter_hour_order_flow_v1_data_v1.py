"""Frozen strategy-neutral data foundation for Quarter-Hour Order-Flow V1."""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone

RULESET = "QUARTER-HOUR-ORDER-FLOW-V1-DATA-V1-FROZEN"
ASSETS = ("BTC","ETH","XRP","SOL","DOGE","ADA")
START_MONTH = "2025-01"
END_MONTH = "2026-08"
SENTINEL_DATES = ("2025-01-15","2026-08-15")
FUNDING_SENTINEL_MONTHS = ("2025-01","2026-08")
EXPECTED_MONTHS = 20
EXPECTED_ASSET_MONTHS = 120
EXPECTED_AGG_SENTINELS = 12
EXPECTED_FUNDING_SENTINELS = 12

_SHA_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def month_range(start=START_MONTH,end=END_MONTH):
    y,m=map(int,start.split("-"))
    ey,em=map(int,end.split("-"))
    out=[]
    while y<ey or (y==ey and m<=em):
        out.append(f"{y:04d}-{m:02d}")
        m+=1
        if m==13:
            y,m=y+1,1
    return out


def symbol(asset):
    if asset not in ASSETS:
        raise ValueError("UNKNOWN_ASSET:"+str(asset))
    return asset+"USDT"


def agg_monthly_url(asset,ym):
    s=symbol(asset)
    return f"https://data.binance.vision/data/futures/um/monthly/aggTrades/{s}/{s}-aggTrades-{ym}.zip"


def agg_daily_url(asset,day):
    s=symbol(asset)
    return f"https://data.binance.vision/data/futures/um/daily/aggTrades/{s}/{s}-aggTrades-{day}.zip"


def funding_monthly_url(asset,ym):
    s=symbol(asset)
    return f"https://data.binance.vision/data/futures/um/monthly/fundingRate/{s}/{s}-fundingRate-{ym}.zip"


def parse_checksum(text,expected_filename):
    parts=str(text).strip().split()
    if len(parts)<2:
        raise ValueError("MALFORMED_CHECKSUM")
    digest=parts[0].strip()
    name=parts[-1].strip().lstrip("*")
    if not _SHA_RE.match(digest):
        raise ValueError("INVALID_SHA256")
    if name!=expected_filename:
        raise ValueError(f"CHECKSUM_FILENAME_MISMATCH:{name}")
    return digest.lower()


def parse_bool(v):
    s=str(v).strip().lower()
    if s in ("true","1"):
        return True
    if s in ("false","0"):
        return False
    raise ValueError("INVALID_BOOLEAN:"+str(v))


def _looks_agg_header(row):
    if not row:
        return False
    first=str(row[0]).strip().lower().replace("_","")
    return first in ("aggtradeid","aggregate tradeid".replace(" ",""),"id")


@dataclass(frozen=True)
class AggTrade:
    agg_id:int
    price:float
    qty:float
    first_id:int
    last_id:int
    timestamp:int
    is_buyer_maker:bool


def parse_agg_row(row):
    if len(row)!=7:
        raise ValueError(f"AGG_FIELDS_NE_7:{len(row)}")
    try:
        rec=AggTrade(
            agg_id=int(row[0]),
            price=float(row[1]),
            qty=float(row[2]),
            first_id=int(row[3]),
            last_id=int(row[4]),
            timestamp=int(row[5]),
            is_buyer_maker=parse_bool(row[6]),
        )
    except Exception as exc:
        raise ValueError("AGG_PARSE_ERROR:"+str(exc)) from exc
    if not math.isfinite(rec.price) or rec.price<=0:
        raise ValueError("INVALID_AGG_PRICE")
    if not math.isfinite(rec.qty) or rec.qty<=0:
        raise ValueError("INVALID_AGG_QTY")
    if rec.first_id>rec.last_id:
        raise ValueError("AGG_TRADE_ID_RANGE")
    if not (10**12 <= rec.timestamp < 10**14):
        raise ValueError("AGG_TIMESTAMP_NOT_MS")
    return rec


def validate_agg_rows(rows,day):
    target=datetime.strptime(day,"%Y-%m-%d").replace(tzinfo=timezone.utc)
    start_ms=int(target.timestamp()*1000)
    end_ms=start_ms+24*60*60*1000
    count=0
    first=None
    last=None
    prior_id=None
    prior_ts=None
    for row in rows:
        if not row:
            continue
        if count==0 and _looks_agg_header(row):
            continue
        rec=parse_agg_row(row)
        if not (start_ms<=rec.timestamp<end_ms):
            raise ValueError("AGG_TIMESTAMP_OUTSIDE_SENTINEL_DAY")
        if prior_id is not None and rec.agg_id<=prior_id:
            raise ValueError("AGG_ID_NOT_STRICTLY_INCREASING")
        if prior_ts is not None and rec.timestamp<prior_ts:
            raise ValueError("AGG_TIMESTAMP_DECREASE")
        if first is None:first=rec
        last=rec
        prior_id=rec.agg_id
        prior_ts=rec.timestamp
        count+=1
    if count<=0:
        raise ValueError("EMPTY_AGG_SENTINEL")
    return {
        "rows":count,
        "firstAggId":first.agg_id,
        "lastAggId":last.agg_id,
        "firstTimestamp":first.timestamp,
        "lastTimestamp":last.timestamp,
    }


def validate_agg_csv(text,day):
    return validate_agg_rows(csv.reader(io.StringIO(text)),day)


def parse_funding_csv(text):
    reader=list(csv.reader(io.StringIO(text)))
    if not reader:
        raise ValueError("EMPTY_FUNDING_SENTINEL")
    header=[str(x).strip() for x in reader[0]]
    lower=[x.lower() for x in header]
    has_header=any(x in lower for x in ("calc_time","fundingtime","funding_time","last_funding_rate","fundingrate"))
    if has_header:
        idx={k.lower():i for i,k in enumerate(header)}
        ti=idx.get("calc_time",idx.get("fundingtime",idx.get("funding_time")))
        ri=idx.get("last_funding_rate",idx.get("fundingrate"))
        data=reader[1:]
    else:
        ti=0
        ri=2 if len(reader[0])>=3 else 1
        data=reader
    if ti is None or ri is None:
        raise ValueError("UNKNOWN_FUNDING_SCHEMA")
    count=0
    last_ts=None
    first_ts=None
    last_rate=None
    for row in data:
        if not row:continue
        try:
            ts=int(float(row[ti]))
            rate=float(row[ri])
        except Exception as exc:
            raise ValueError("FUNDING_PARSE_ERROR:"+str(exc)) from exc
        if not (10**12<=ts<10**14):
            raise ValueError("FUNDING_TIMESTAMP_NOT_MS")
        if not math.isfinite(rate):
            raise ValueError("NONFINITE_FUNDING_RATE")
        if last_ts is not None and ts<=last_ts:
            raise ValueError("FUNDING_TIMESTAMP_NOT_STRICT")
        if first_ts is None:first_ts=ts
        last_ts=ts
        last_rate=rate
        count+=1
    if count<=0:
        raise ValueError("EMPTY_FUNDING_SENTINEL")
    return {"rows":count,"firstTimestamp":first_ts,"lastTimestamp":last_ts,"lastRate":last_rate}


def frozen_counts():
    months=month_range()
    return {
        "assets":len(ASSETS),
        "months":len(months),
        "assetMonths":len(ASSETS)*len(months),
        "aggSentinels":len(ASSETS)*len(SENTINEL_DATES),
        "fundingSentinels":len(ASSETS)*len(FUNDING_SENTINEL_MONTHS),
    }
