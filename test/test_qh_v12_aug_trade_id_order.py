#!/usr/bin/env python3
from __future__ import annotations

import csv
import importlib.util
import tempfile
import zipfile
from pathlib import Path

SCRIPT = Path("scripts/diagnose-qh-v12-aug-trade-id-order.py")
spec = importlib.util.spec_from_file_location("qh_v12_aug_diag", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

BASE_TS = 1754006400000  # 2025-08-01T00:00:00Z


def make_zip(rows):
    td = tempfile.TemporaryDirectory()
    path = Path(td.name) / "sample.zip"
    csv_path = Path(td.name) / "sample.csv"
    with csv_path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["id", "price", "qty", "quoteQty", "time", "isBuyerMaker"])
        writer.writerows(rows)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(csv_path, arcname="sample.csv")
    return td, path


def row(trade_id, offset_ms):
    return [trade_id, "100", "1", "100", str(BASE_TS + offset_ms), "false"]


def test_duplicate_and_reversal():
    td, path = make_zip([
        row(100, 0),
        row(101, 1),
        row(101, 2),
        row(99, 3),
        row(102, 4),
    ])
    try:
        result = module.scan_archive(path)
    finally:
        td.cleanup()
    assert result["rows"] == 5
    assert result["nonIncreasingIdEvents"] == 2
    assert result["duplicateIdEvents"] == 1
    assert result["reverseIdEvents"] == 1
    assert result["timestampDecreaseEvents"] == 0
    assert result["maxReverseMagnitude"] == 2
    assert [x["kind"] for x in result["idOrderExamples"]] == ["DUPLICATE", "REVERSAL"]


def test_timestamp_decrease_is_separate():
    td, path = make_zip([
        row(200, 10),
        row(201, 5),
        row(202, 20),
    ])
    try:
        result = module.scan_archive(path)
    finally:
        td.cleanup()
    assert result["nonIncreasingIdEvents"] == 0
    assert result["timestampDecreaseEvents"] == 1


def test_classification_reproduced_pair():
    monthly = {
        "nonIncreasingIdEvents": 1,
        "idOrderExamples": [{
            "previous": {"tradeId": 10},
            "current": {"tradeId": 9},
        }],
    }
    daily = [{
        "scan": {
            "nonIncreasingIdEvents": 1,
            "idOrderExamples": [{
                "previous": {"tradeId": 10},
                "current": {"tradeId": 9},
            }],
        }
    }]
    assert module.classify(monthly, daily) == "DAILY_PACKAGE_REPRODUCES_MONTHLY_ID_ORDER_ANOMALY"


def test_classification_monthly_only():
    monthly = {
        "nonIncreasingIdEvents": 1,
        "idOrderExamples": [{
            "previous": {"tradeId": 10},
            "current": {"tradeId": 9},
        }],
    }
    daily = [{
        "scan": {
            "nonIncreasingIdEvents": 0,
            "idOrderExamples": [],
        }
    }]
    assert module.classify(monthly, daily) == "MONTHLY_ONLY_ID_ORDER_ANOMALY"


if __name__ == "__main__":
    test_duplicate_and_reversal()
    test_timestamp_decrease_is_separate()
    test_classification_reproduced_pair()
    test_classification_monthly_only()
    print("qh-v12 August trade-id diagnostic tests: PASS")
