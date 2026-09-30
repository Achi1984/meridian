#!/usr/bin/env python3
"""Strategy-neutral diagnosis of the frozen Data V1.2 August-2025 trade-ID failures.

This tool does not change Data V1.2. It only locates and classifies adjacent
non-increasing trade IDs in the three failed monthly individual-trades archives
and checks whether the corresponding official daily archives reproduce the same
ID-pair anomaly. It must not calculate direction, signals, returns, positions or
PnL.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

MONTHLY_BASE = "https://data.binance.vision/data/futures/um/monthly/trades"
DAILY_BASE = "https://data.binance.vision/data/futures/um/daily/trades"
UA = "MERIDIAN-QH-V12-AUG-TRADE-ID-DIAGNOSTIC/1"
CHUNK = 8 * 1024 * 1024
FAILED_ASSETS = ("ETHUSDT", "XRPUSDT", "ADAUSDT")
MONTH = "2025-08"
MAX_EXAMPLES = 32
MAX_DAILY_DATES = 8


def checksum(url: str) -> str:
    req = urllib.request.Request(
        url + ".CHECKSUM",
        headers={"User-Agent": UA, "Accept-Encoding": "identity"},
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        text = response.read().decode("utf-8", "replace")
    match = re.search(r"([0-9a-fA-F]{64})", text)
    if not match:
        raise RuntimeError(f"missing SHA256 in checksum: {url}")
    return match.group(1).lower()


def download_verified(url: str, destination: Path) -> dict:
    expected = checksum(url)
    digest = hashlib.sha256()
    size = 0
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept-Encoding": "identity"},
    )
    with urllib.request.urlopen(req, timeout=300) as response, destination.open("wb") as out:
        while True:
            chunk = response.read(CHUNK)
            if not chunk:
                break
            out.write(chunk)
            digest.update(chunk)
            size += len(chunk)
    actual = digest.hexdigest()
    if actual != expected:
        raise RuntimeError(f"SHA256 mismatch {url}: {actual} != {expected}")
    return {"url": url, "sha256": actual, "bytes": size}


def open_csv(zpath: Path):
    archive = zipfile.ZipFile(zpath)
    members = [name for name in archive.namelist() if not name.endswith("/")]
    if len(members) != 1:
        archive.close()
        raise RuntimeError(f"{zpath.name}: expected exactly one ZIP member")
    member = members[0]
    raw = archive.open(member, "r")
    text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
    return archive, raw, text, member, csv.reader(text)


def is_header(row) -> bool:
    if not row:
        return False
    first = row[0].strip().lower().replace(" ", "_")
    return first in ("id", "trade_id", "tradeid") or (
        "trade" in first and not first.lstrip("-").isdigit()
    )


def timestamp_ms(value: str):
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


def utc_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def utc_day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date().isoformat()


def scan_archive(zpath: Path) -> dict:
    physical_row = 0
    data_rows = 0
    first = None
    last = None
    prev = None
    units = set()
    non_increasing = 0
    duplicate_ids = 0
    reverse_ids = 0
    timestamp_decreases = 0
    same_timestamp_non_increasing = 0
    max_reverse_magnitude = 0
    examples = []
    timestamp_examples = []
    affected_dates = set()
    archive = raw = text = None
    member = None
    try:
        archive, raw, text, member, reader = open_csv(zpath)
        for row in reader:
            physical_row += 1
            if not row:
                continue
            if data_rows == 0 and is_header(row):
                continue
            if len(row) < 6:
                raise RuntimeError(f"trade row {physical_row} has only {len(row)} columns")
            trade_id = int(row[0])
            ts, unit = timestamp_ms(row[4])
            units.add(unit)
            current = {
                "csvRow": physical_row,
                "dataRow": data_rows + 1,
                "tradeId": trade_id,
                "timestampMs": ts,
                "timestampUtc": utc_iso(ts),
            }
            if prev is not None:
                if ts < prev["timestampMs"]:
                    timestamp_decreases += 1
                    if len(timestamp_examples) < MAX_EXAMPLES:
                        timestamp_examples.append({
                            "previous": prev,
                            "current": current,
                            "timestampDeltaMs": ts - prev["timestampMs"],
                        })
                if trade_id <= prev["tradeId"]:
                    non_increasing += 1
                    if trade_id == prev["tradeId"]:
                        duplicate_ids += 1
                        kind = "DUPLICATE"
                    else:
                        reverse_ids += 1
                        kind = "REVERSAL"
                        max_reverse_magnitude = max(
                            max_reverse_magnitude, prev["tradeId"] - trade_id
                        )
                    same_ts = ts == prev["timestampMs"]
                    if same_ts:
                        same_timestamp_non_increasing += 1
                    affected_dates.add(utc_day(prev["timestampMs"]))
                    affected_dates.add(utc_day(ts))
                    if len(examples) < MAX_EXAMPLES:
                        examples.append({
                            "kind": kind,
                            "previous": prev,
                            "current": current,
                            "tradeIdDelta": trade_id - prev["tradeId"],
                            "timestampDeltaMs": ts - prev["timestampMs"],
                            "sameTimestamp": same_ts,
                        })
            if first is None:
                first = current
            last = current
            prev = current
            data_rows += 1
    finally:
        if text is not None:
            text.close()
        if raw is not None:
            raw.close()
        if archive is not None:
            archive.close()
    if data_rows == 0:
        raise RuntimeError("trade archive has zero data rows")
    return {
        "zipMember": member,
        "rows": data_rows,
        "first": first,
        "last": last,
        "timestampUnitsDetected": sorted(units),
        "nonIncreasingIdEvents": non_increasing,
        "duplicateIdEvents": duplicate_ids,
        "reverseIdEvents": reverse_ids,
        "sameTimestampNonIncreasingEvents": same_timestamp_non_increasing,
        "maxReverseMagnitude": max_reverse_magnitude,
        "timestampDecreaseEvents": timestamp_decreases,
        "affectedUtcDates": sorted(affected_dates),
        "idOrderExamples": examples,
        "timestampDecreaseExamples": timestamp_examples,
    }


def pair_set(scan: dict):
    return {
        (item["previous"]["tradeId"], item["current"]["tradeId"])
        for item in scan.get("idOrderExamples", [])
    }


def classify(monthly: dict, daily: list[dict]) -> str:
    if monthly["nonIncreasingIdEvents"] == 0:
        return "MONTHLY_ANOMALY_NOT_REPRODUCED"
    monthly_pairs = pair_set(monthly)
    matched = 0
    daily_non_increasing = 0
    for item in daily:
        scan = item.get("scan")
        if not scan:
            continue
        daily_non_increasing += scan["nonIncreasingIdEvents"]
        matched += len(monthly_pairs & pair_set(scan))
    if matched > 0:
        return "DAILY_PACKAGE_REPRODUCES_MONTHLY_ID_ORDER_ANOMALY"
    if daily_non_increasing == 0:
        return "MONTHLY_ONLY_ID_ORDER_ANOMALY"
    return "DAILY_HAS_DIFFERENT_ID_ORDER_ANOMALY"


def run(asset: str, out_dir: Path) -> dict:
    if asset not in FAILED_ASSETS:
        raise SystemExit(f"invalid QH_ASSET {asset!r}")
    out_dir.mkdir(parents=True, exist_ok=True)
    downloads = {}
    daily_results = []
    with tempfile.TemporaryDirectory(prefix=f"meridian-qh-v12-id-{asset}-") as tmp:
        tmp = Path(tmp)
        monthly_url = f"{MONTHLY_BASE}/{asset}/{asset}-trades-{MONTH}.zip"
        monthly_zip = tmp / "monthly.zip"
        downloads["monthly"] = download_verified(monthly_url, monthly_zip)
        monthly_scan = scan_archive(monthly_zip)
        monthly_zip.unlink(missing_ok=True)

        affected_dates = monthly_scan["affectedUtcDates"]
        dates_truncated = len(affected_dates) > MAX_DAILY_DATES
        for day in affected_dates[:MAX_DAILY_DATES]:
            daily_url = f"{DAILY_BASE}/{asset}/{asset}-trades-{day}.zip"
            daily_zip = tmp / f"{day}.zip"
            entry = {"date": day}
            try:
                entry["download"] = download_verified(daily_url, daily_zip)
                entry["scan"] = scan_archive(daily_zip)
            except Exception as exc:
                entry["error"] = f"{type(exc).__name__}: {exc}"
            finally:
                daily_zip.unlink(missing_ok=True)
            daily_results.append(entry)

    diagnostic_complete = (
        not dates_truncated
        and all("scan" in item for item in daily_results)
    )
    result = {
        "schema": 1,
        "family": "PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
        "stage": "DATA_V1_2_AUGUST_TRADE_ID_ORDER_DIAGNOSTIC",
        "asset": asset,
        "month": MONTH,
        "frozenParentDecision": "INDIVIDUAL_TRADES_DATA_V1_2_FAIL_DATA_QUALITY",
        "scope": "STRATEGY_NEUTRAL_SOURCE_DIAGNOSTIC_ONLY",
        "downloads": downloads,
        "monthly": monthly_scan,
        "dailyCorroboration": daily_results,
        "dailyDatesTruncated": dates_truncated,
        "classification": classify(monthly_scan, daily_results),
        "diagnosticComplete": diagnostic_complete,
        "v12GateChanged": False,
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
    target = out_dir / f"{asset}-{MONTH}-trade-id-order.json"
    target.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    if not diagnostic_complete:
        raise SystemExit(2)
    return result


def main():
    run(
        os.environ.get("QH_ASSET", ""),
        Path(os.environ.get("QH_OUTPUT_DIR", "research/results/qh-v12-aug-trade-id-order")),
    )


if __name__ == "__main__":
    main()
