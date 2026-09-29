#!/usr/bin/env python3
"""Strategy-neutral sharded data-quality audit for Quarter-Hour Boundary Imbalance V1.

One invocation processes exactly one Binance USD-M perpetual asset-month shard.
It verifies published SHA-256 checksums, stream-parses aggTrades/1m klines/funding,
emits compact quality metadata, and deletes raw archives. It MUST NOT calculate
directional imbalance, forward returns, positions, or PnL.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import os
import re
import tempfile
import urllib.request
import zipfile
from calendar import monthrange
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://data.binance.vision/data/futures/um/monthly"
ALLOWED_ASSETS = ("BTCUSDT", "ETHUSDT", "XRPUSDT", "SOLUSDT", "DOGEUSDT", "ADAUSDT")
ALLOWED_MONTHS = tuple(
    f"{y:04d}-{m:02d}"
    for y, months in ((2025, range(1, 13)), (2026, range(1, 9)))
    for m in months
)
USER_AGENT = "MERIDIAN-QH-IMBALANCE-V1-DATA-V1/1"
CHUNK = 8 * 1024 * 1024
FUNDING_MAX_GAP_MS = 12 * 60 * 60 * 1000

ASSET = os.environ.get("QH_ASSET", "")
MONTH = os.environ.get("QH_MONTH", "")
OUT = Path(os.environ.get("QH_OUTPUT_DIR", "/tmp/meridian-qh-v1-data-v1"))

if ASSET not in ALLOWED_ASSETS:
    raise SystemExit(f"QH_ASSET must be one of {ALLOWED_ASSETS}, got {ASSET!r}")
if MONTH not in ALLOWED_MONTHS:
    raise SystemExit(f"QH_MONTH must be 2025-01..2026-08, got {MONTH!r}")


def month_bounds_ms(ym: str) -> tuple[int, int, int]:
    y, m = map(int, ym.split("-"))
    start = int(datetime(y, m, 1, tzinfo=timezone.utc).timestamp() * 1000)
    if m == 12:
        ny, nm = y + 1, 1
    else:
        ny, nm = y, m + 1
    end = int(datetime(ny, nm, 1, tzinfo=timezone.utc).timestamp() * 1000)
    minutes = monthrange(y, m)[1] * 24 * 60
    return start, end, minutes


MONTH_START_MS, MONTH_END_MS, EXPECTED_MINUTES = month_bounds_ms(MONTH)
EXPECTED_QH_BINS = EXPECTED_MINUTES // 15


def source_url(family: str) -> str:
    if family == "aggTrades":
        return f"{BASE}/aggTrades/{ASSET}/{ASSET}-aggTrades-{MONTH}.zip"
    if family == "klines1m":
        return f"{BASE}/klines/{ASSET}/1m/{ASSET}-1m-{MONTH}.zip"
    if family == "fundingRate":
        return f"{BASE}/fundingRate/{ASSET}/{ASSET}-fundingRate-{MONTH}.zip"
    raise ValueError(family)


def get_checksum(url: str) -> str:
    req = urllib.request.Request(url + ".CHECKSUM", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as response:
        text = response.read().decode("utf-8", "replace")
    match = re.search(r"([0-9a-fA-F]{64})", text)
    if not match:
        raise RuntimeError(f"checksum file lacks SHA-256: {url}")
    return match.group(1).lower()


def download_verified(url: str, dst: Path) -> dict:
    expected = get_checksum(url)
    h = hashlib.sha256()
    size = 0
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}
    )
    with urllib.request.urlopen(req, timeout=180) as response, dst.open("wb") as f:
        while True:
            chunk = response.read(CHUNK)
            if not chunk:
                break
            f.write(chunk)
            h.update(chunk)
            size += len(chunk)
    actual = h.hexdigest()
    if actual != expected:
        raise RuntimeError(
            f"SHA256 mismatch for {url}: expected {expected}, got {actual}"
        )
    return {"url": url, "sha256": actual, "bytes": size}


def open_single_csv(zpath: Path):
    zf = zipfile.ZipFile(zpath)
    members = [n for n in zf.namelist() if not n.endswith("/")]
    if len(members) != 1:
        zf.close()
        raise RuntimeError(f"{zpath.name}: expected exactly one archive member")
    raw = zf.open(members[0], "r")
    text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
    return zf, raw, text, csv.reader(text)


def normalize_timestamp_ms(value: str | int) -> tuple[int, str]:
    raw = int(float(value))
    if raw <= 0:
        raise ValueError("non-positive timestamp")
    if raw >= 10**17:
        unit = "NANOSECOND_OR_FINER"
        while raw >= 10**14:
            raw //= 1000
    elif raw >= 10**14:
        unit = "MICROSECOND"
        raw //= 1000
    else:
        unit = "MILLISECOND"
    return raw, unit


def parse_bool(value: str) -> bool:
    v = str(value).strip().lower()
    if v in ("true", "1"):
        return True
    if v in ("false", "0"):
        return False
    raise ValueError(f"invalid boolean {value!r}")


def finite_float(value: str, *, positive=False, nonnegative=False) -> float:
    x = float(value)
    if not math.isfinite(x):
        raise ValueError("non-finite numeric field")
    if positive and x <= 0:
        raise ValueError("expected positive numeric field")
    if nonnegative and x < 0:
        raise ValueError("expected non-negative numeric field")
    return x


def is_header(row: list[str], family: str) -> bool:
    if not row:
        return False
    first = row[0].strip().lower().replace(" ", "_")
    if family == "aggTrades":
        return first in {
            "agg_trade_id", "aggregate_tradeid", "aggregate_trade_id", "id"
        } or "trade" in first
    if family == "klines1m":
        return first in {"open_time", "opentime", "timestamp", "time"}
    if family == "fundingRate":
        joined = ",".join(x.lower() for x in row)
        return "funding" in joined or "calc_time" in joined
    return False


def audit_aggtrades(zpath: Path) -> dict:
    row_count = 0
    first_ts = last_ts = None
    first_id = last_id = None
    prev_ts = None
    prev_id = None
    prev_last_trade_id = None
    equal_aggregate_id_events = 0
    units = set()
    qh_counts = {}
    zf = raw = text = None
    try:
        zf, raw, text, reader = open_single_csv(zpath)
        for row in reader:
            if not row:
                continue
            if row_count == 0 and is_header(row, "aggTrades"):
                continue
            if len(row) < 7:
                raise RuntimeError(f"aggTrades short row: {len(row)} columns")
            agg_id = int(row[0])
            finite_float(row[1], positive=True)
            finite_float(row[2], positive=True)
            first_trade_id = int(row[3])
            last_trade_id = int(row[4])
            if first_trade_id > last_trade_id:
                raise RuntimeError("aggTrades first_trade_id > last_trade_id")
            ts, unit = normalize_timestamp_ms(row[5])
            units.add(unit)
            parse_bool(row[6])

            if not (MONTH_START_MS <= ts < MONTH_END_MS):
                raise RuntimeError(f"aggTrades timestamp outside month: {ts}")
            if prev_ts is not None and ts < prev_ts:
                raise RuntimeError("aggTrades timestamp decreased")
            if prev_id is not None and agg_id < prev_id:
                raise RuntimeError("aggTrades aggregate trade id decreased")
            if prev_id is not None and agg_id == prev_id:
                equal_aggregate_id_events += 1
            if prev_last_trade_id is not None and first_trade_id <= prev_last_trade_id:
                raise RuntimeError("aggTrades underlying trade id ranges overlap or do not advance")

            qh = (ts - MONTH_START_MS) // (15 * 60 * 1000)
            qh_counts[qh] = qh_counts.get(qh, 0) + 1

            if first_ts is None:
                first_ts, first_id = ts, agg_id
            last_ts, last_id = ts, agg_id
            prev_ts, prev_id, prev_last_trade_id = ts, agg_id, last_trade_id
            row_count += 1
    finally:
        if text:
            text.close()
        if raw:
            raw.close()
        if zf:
            zf.close()

    if row_count == 0:
        raise RuntimeError("aggTrades archive has zero data rows")
    if len(units) != 1:
        raise RuntimeError(f"aggTrades mixed timestamp units: {sorted(units)}")
    invalid_bins = [x for x in qh_counts if not (0 <= x < EXPECTED_QH_BINS)]
    if invalid_bins:
        raise RuntimeError("aggTrades produced invalid quarter-hour bin")

    empty = EXPECTED_QH_BINS - len(qh_counts)
    return {
        "rows": row_count,
        "firstTimestampMs": first_ts,
        "lastTimestampMs": last_ts,
        "firstAggregateTradeId": first_id,
        "lastAggregateTradeId": last_id,
        "equalAggregateTradeIdEvents": equal_aggregate_id_events,
        "timestampUnitDetected": next(iter(units)),
        "expectedQuarterHourBins": EXPECTED_QH_BINS,
        "nonEmptyQuarterHourBins": len(qh_counts),
        "emptyQuarterHourBins": empty,
        "minTradesPerNonEmptyQuarterHour": min(qh_counts.values()),
        "maxTradesPerQuarterHour": max(qh_counts.values()),
        "coveragePass": empty == 0,
    }


def audit_klines(zpath: Path) -> dict:
    row_count = 0
    first_open = last_open = None
    prev_open = None
    units = set()
    zf = raw = text = None
    try:
        zf, raw, text, reader = open_single_csv(zpath)
        for row in reader:
            if not row:
                continue
            if row_count == 0 and is_header(row, "klines1m"):
                continue
            if len(row) < 11:
                raise RuntimeError(f"1m kline short row: {len(row)} columns")
            ot, unit = normalize_timestamp_ms(row[0])
            units.add(unit)
            o = finite_float(row[1], positive=True)
            h = finite_float(row[2], positive=True)
            l = finite_float(row[3], positive=True)
            c = finite_float(row[4], positive=True)
            vol = finite_float(row[5], nonnegative=True)
            qvol = finite_float(row[7], nonnegative=True)
            finite_float(row[8], nonnegative=True)
            tb = finite_float(row[9], nonnegative=True)
            tq = finite_float(row[10], nonnegative=True)
            if h < max(o, c, l) or l > min(o, c, h):
                raise RuntimeError("1m kline inconsistent OHLC")
            if tb > vol + max(1e-10, abs(vol) * 1e-10):
                raise RuntimeError("1m kline taker-buy base > total volume")
            if tq > qvol + max(1e-8, abs(qvol) * 1e-10):
                raise RuntimeError("1m kline taker-buy quote > total quote volume")
            if not (MONTH_START_MS <= ot < MONTH_END_MS):
                raise RuntimeError(f"1m kline timestamp outside month: {ot}")
            if prev_open is not None and ot - prev_open != 60_000:
                raise RuntimeError(
                    f"1m kline cadence gap: previous={prev_open} current={ot}"
                )
            if first_open is None:
                first_open = ot
            last_open = ot
            prev_open = ot
            row_count += 1
    finally:
        if text:
            text.close()
        if raw:
            raw.close()
        if zf:
            zf.close()

    expected_last = MONTH_END_MS - 60_000
    coverage_pass = (
        row_count == EXPECTED_MINUTES
        and first_open == MONTH_START_MS
        and last_open == expected_last
        and len(units) == 1
    )
    return {
        "rows": row_count,
        "expectedRows": EXPECTED_MINUTES,
        "firstOpenMs": first_open,
        "lastOpenMs": last_open,
        "expectedFirstOpenMs": MONTH_START_MS,
        "expectedLastOpenMs": expected_last,
        "timestampUnitsDetected": sorted(units),
        "coveragePass": coverage_pass,
    }


def funding_indices(header: list[str]) -> tuple[int, int]:
    cleaned = [x.strip() for x in header]
    idx = {name: i for i, name in enumerate(cleaned)}
    ti = idx.get("calc_time", idx.get("fundingTime"))
    ri = idx.get("last_funding_rate", idx.get("fundingRate"))
    if ti is None or ri is None:
        raise RuntimeError(f"unknown funding header: {cleaned}")
    return ti, ri


def audit_funding(zpath: Path) -> dict:
    rows = 0
    first_ts = last_ts = None
    prev_ts = None
    units = set()
    max_gap = 0
    first_data = True
    ti = ri = None
    zf = raw = text = None
    try:
        zf, raw, text, reader = open_single_csv(zpath)
        for row in reader:
            if not row:
                continue
            if first_data:
                first_data = False
                if is_header(row, "fundingRate"):
                    ti, ri = funding_indices(row)
                    continue
                ti, ri = 0, 2
            if ti is None or ri is None or len(row) <= max(ti, ri):
                raise RuntimeError("malformed funding row")
            ts, unit = normalize_timestamp_ms(row[ti])
            units.add(unit)
            finite_float(row[ri])
            if not (MONTH_START_MS <= ts < MONTH_END_MS):
                raise RuntimeError(f"funding timestamp outside month: {ts}")
            if prev_ts is not None:
                gap = ts - prev_ts
                if gap <= 0:
                    raise RuntimeError("funding timestamps not strictly increasing")
                max_gap = max(max_gap, gap)
            if first_ts is None:
                first_ts = ts
            last_ts = ts
            prev_ts = ts
            rows += 1
    finally:
        if text:
            text.close()
        if raw:
            raw.close()
        if zf:
            zf.close()

    if rows == 0:
        raise RuntimeError("funding archive has zero rows")
    leading = first_ts - MONTH_START_MS
    trailing = MONTH_END_MS - last_ts
    coverage_pass = (
        len(units) == 1
        and 0 <= leading <= FUNDING_MAX_GAP_MS
        and 0 < trailing <= FUNDING_MAX_GAP_MS
        and max_gap <= FUNDING_MAX_GAP_MS
    )
    return {
        "rows": rows,
        "firstTimestampMs": first_ts,
        "lastTimestampMs": last_ts,
        "timestampUnitsDetected": sorted(units),
        "leadingBoundaryGapHours": leading / 3_600_000,
        "trailingBoundaryGapHours": trailing / 3_600_000,
        "maxInterEventGapHours": max_gap / 3_600_000 if rows > 1 else None,
        "maxAllowedGapHours": FUNDING_MAX_GAP_MS / 3_600_000,
        "coveragePass": coverage_pass,
    }


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"meridian-qh-{ASSET}-{MONTH}-") as td:
        td = Path(td)
        downloads = {}
        audits = {}
        for family, audit_fn in (
            ("aggTrades", audit_aggtrades),
            ("klines1m", audit_klines),
            ("fundingRate", audit_funding),
        ):
            path = td / f"{family}.zip"
            downloads[family] = download_verified(source_url(family), path)
            audits[family] = audit_fn(path)
            path.unlink(missing_ok=True)

    gate_reasons = []
    if not audits["aggTrades"]["coveragePass"]:
        gate_reasons.append("AGGTRADES_QUARTER_HOUR_COVERAGE_FAIL")
    if not audits["klines1m"]["coveragePass"]:
        gate_reasons.append("KLINE_1M_COVERAGE_FAIL")
    if not audits["fundingRate"]["coveragePass"]:
        gate_reasons.append("FUNDING_COVERAGE_FAIL")

    result = {
        "schema": 1,
        "family": "PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
        "stage": "DATA_V1_SHARD_QUALITY",
        "asset": ASSET,
        "month": MONTH,
        "source": "Binance Vision official public USD-M monthly archives",
        "downloads": downloads,
        "audits": audits,
        "gate": {
            "pass": not gate_reasons,
            "reasons": gate_reasons,
            "decision": (
                "DATA_V1_SHARD_PASS"
                if not gate_reasons
                else "DATA_V1_SHARD_FAIL_DATA_QUALITY"
            ),
        },
        "directionalOrderImbalanceCalculated": False,
        "forwardReturnsCalculated": False,
        "signalReturnRelationshipCalculated": False,
        "positionsCalculated": False,
        "strategyPnlCalculated": False,
        "executionImpact": False,
        "paperAuthorized": False,
        "liveAuthorized": False,
        "rawArchivesRetained": False,
    }
    path = OUT / f"{ASSET}-{MONTH}.json"
    path.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    if gate_reasons:
        raise SystemExit(2)


if __name__ == "__main__":
    try:
        run()
    except SystemExit:
        raise
    except Exception as exc:
        OUT.mkdir(parents=True, exist_ok=True)
        failure = {
            "schema": 1,
            "family": "PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
            "stage": "DATA_V1_SHARD_QUALITY",
            "asset": ASSET,
            "month": MONTH,
            "gate": {
                "pass": False,
                "reasons": ["SHARD_EXCEPTION"],
                "decision": "DATA_V1_SHARD_FAIL_DATA_QUALITY",
            },
            "error": f"{type(exc).__name__}: {exc}",
            "directionalOrderImbalanceCalculated": False,
            "forwardReturnsCalculated": False,
            "signalReturnRelationshipCalculated": False,
            "positionsCalculated": False,
            "strategyPnlCalculated": False,
            "executionImpact": False,
            "paperAuthorized": False,
            "liveAuthorized": False,
            "rawArchivesRetained": False,
        }
        (OUT / f"{ASSET}-{MONTH}.json").write_text(
            json.dumps(failure, indent=2) + "\n"
        )
        print(json.dumps(failure, indent=2))
        raise
