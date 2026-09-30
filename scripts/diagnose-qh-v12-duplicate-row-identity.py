#!/usr/bin/env python3
"""Strategy-neutral row-identity diagnostic for frozen Data V1.2 duplicate trade IDs.

The parent Data V1.2 result remains immutable FAIL. This diagnostic answers one
narrow source question before any successor protocol is designed: when Binance
reuses a trade ID in the affected 2025-08-29 daily archives, are those rows
literal duplicates or distinct source rows that merely share an ID?

No directional imbalance, returns, positions, PnL, Paper, or live execution.
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
from pathlib import Path

BASE = "https://data.binance.vision/data/futures/um/daily/trades"
UA = "MERIDIAN-QH-V12-DUPLICATE-ROW-IDENTITY/1"
CHUNK = 8 * 1024 * 1024
DATE = "2025-08-29"
TARGETS = {
    "ETHUSDT": (6299136398, 6299136399, 6299136400),
    "XRPUSDT": (2634782464,),
    "ADAUSDT": (1691866636,),
}

ASSET = os.environ.get("QH_ASSET", "")
OUT = Path(os.environ.get(
    "QH_OUTPUT_DIR",
    "research/results/qh-v12-aug-duplicate-row-identity",
))

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


def sha_row(values) -> str:
    payload = json.dumps(list(values), ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def normalized_match(row, csv_row: int, data_row: int) -> dict:
    if len(row) < 6:
        raise RuntimeError(f"trade row {csv_row} has only {len(row)} columns")
    trade_id = int(row[0])
    # Parse only for schema/identity. No directional arithmetic is performed.
    price = row[1].strip()
    qty = row[2].strip()
    quote_qty = row[3].strip()
    timestamp = int(float(row[4]))
    maker = row[5].strip().lower()
    if maker not in ("true", "false", "1", "0"):
        raise RuntimeError(f"invalid isBuyerMaker at row {csv_row}: {row[5]!r}")
    full = [str(trade_id), price, qty, quote_qty, str(timestamp), maker]
    primary = [str(trade_id), price, qty, str(timestamp), maker]
    return {
        "csvRow": csv_row,
        "dataRow": data_row,
        "tradeId": trade_id,
        "price": price,
        "qty": qty,
        "quoteQty": quote_qty,
        "timestampRaw": str(timestamp),
        "isBuyerMaker": maker,
        "fullRowFingerprint": sha_row(full),
        "primaryEventFingerprint": sha_row(primary),
    }


def classify_id(rows: list[dict]) -> str:
    if len(rows) < 2:
        return "INSUFFICIENT_OCCURRENCES"
    full = {row["fullRowFingerprint"] for row in rows}
    primary = {row["primaryEventFingerprint"] for row in rows}
    if len(full) == 1:
        return "LITERAL_DUPLICATE_ROW"
    if len(primary) > 1:
        return "DISTINCT_PRIMARY_ROWS_SHARE_ID"
    return "RAW_ROW_DIFFERS_PRIMARY_IDENTITY_SAME"


def scan(zpath: Path) -> dict:
    targets = set(TARGETS[ASSET])
    found = {trade_id: [] for trade_id in TARGETS[ASSET]}
    csv_row = 0
    data_row = 0
    archive = raw = text = None
    member = None
    try:
        archive, raw, text, member, reader = open_csv(zpath)
        for row in reader:
            csv_row += 1
            if not row:
                continue
            if data_row == 0 and is_header(row):
                continue
            data_row += 1
            if len(row) < 1:
                continue
            trade_id = int(row[0])
            if trade_id in targets:
                found[trade_id].append(normalized_match(row, csv_row, data_row))
    finally:
        if text is not None:
            text.close()
        if raw is not None:
            raw.close()
        if archive is not None:
            archive.close()

    ids = {}
    for trade_id, rows in found.items():
        ids[str(trade_id)] = {
            "occurrenceCount": len(rows),
            "uniqueFullRowFingerprints": len({r["fullRowFingerprint"] for r in rows}),
            "uniquePrimaryEventFingerprints": len({r["primaryEventFingerprint"] for r in rows}),
            "uniqueTimestamps": len({r["timestampRaw"] for r in rows}),
            "classification": classify_id(rows),
            "rows": rows,
        }

    classes = {entry["classification"] for entry in ids.values()}
    if classes == {"DISTINCT_PRIMARY_ROWS_SHARE_ID"}:
        overall = "SOURCE_ID_REUSE_WITH_DISTINCT_PRIMARY_ROWS"
    elif classes == {"LITERAL_DUPLICATE_ROW"}:
        overall = "SOURCE_LITERAL_DUPLICATE_ROWS"
    elif "INSUFFICIENT_OCCURRENCES" in classes:
        overall = "SOURCE_IDENTITY_INCOMPLETE"
    else:
        overall = "SOURCE_IDENTITY_MIXED"

    return {
        "zipMember": member,
        "rowsScanned": data_row,
        "targetIds": list(TARGETS[ASSET]),
        "ids": ids,
        "overallClassification": overall,
        "allTargetsObservedAtLeastTwice": all(
            entry["occurrenceCount"] >= 2 for entry in ids.values()
        ),
    }


def run():
    if ASSET not in TARGETS:
        raise SystemExit(f"invalid QH_ASSET {ASSET!r}")
    OUT.mkdir(parents=True, exist_ok=True)
    url = f"{BASE}/{ASSET}/{ASSET}-trades-{DATE}.zip"
    with tempfile.TemporaryDirectory(prefix=f"meridian-qh-v12-row-id-{ASSET}-") as td:
        zpath = Path(td) / "daily.zip"
        download = download_verified(url, zpath)
        source = scan(zpath)

    result = {
        "schema": 1,
        "family": "PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
        "stage": "DATA_V1_2_DUPLICATE_ID_ROW_IDENTITY_DIAGNOSTIC",
        "asset": ASSET,
        "date": DATE,
        "frozenParentDecision": "INDIVIDUAL_TRADES_DATA_V1_2_FAIL_DATA_QUALITY",
        "scope": "STRATEGY_NEUTRAL_SOURCE_DIAGNOSTIC_ONLY",
        "download": download,
        "source": source,
        "diagnosticComplete": source["allTargetsObservedAtLeastTwice"],
        "v12GateChanged": False,
        "successorProtocolSelected": False,
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
    target = OUT / f"{ASSET}-{DATE}-duplicate-row-identity.json"
    target.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    if not result["diagnosticComplete"]:
        raise SystemExit(2)


if __name__ == "__main__":
    run()
