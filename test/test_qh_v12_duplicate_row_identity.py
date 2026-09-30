#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path

SCRIPT = Path("scripts/diagnose-qh-v12-duplicate-row-identity.py")
spec = importlib.util.spec_from_file_location("qh_v12_row_identity", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def row(full_fp, primary_fp):
    return {
        "fullRowFingerprint": full_fp,
        "primaryEventFingerprint": primary_fp,
    }


def test_literal_duplicate():
    rows = [row("a", "p"), row("a", "p")]
    assert module.classify_id(rows) == "LITERAL_DUPLICATE_ROW"


def test_distinct_primary_rows_share_id():
    rows = [row("a", "p1"), row("b", "p2")]
    assert module.classify_id(rows) == "DISTINCT_PRIMARY_ROWS_SHARE_ID"


def test_raw_only_difference():
    rows = [row("a", "p"), row("b", "p")]
    assert module.classify_id(rows) == "RAW_ROW_DIFFERS_PRIMARY_IDENTITY_SAME"


def test_insufficient():
    assert module.classify_id([row("a", "p")]) == "INSUFFICIENT_OCCURRENCES"


def test_target_contract():
    assert module.DATE == "2025-08-29"
    assert module.TARGETS["ETHUSDT"] == (6299136398, 6299136399, 6299136400)
    assert module.TARGETS["XRPUSDT"] == (2634782464,)
    assert module.TARGETS["ADAUSDT"] == (1691866636,)


if __name__ == "__main__":
    test_literal_duplicate()
    test_distinct_primary_rows_share_id()
    test_raw_only_difference()
    test_insufficient()
    test_target_contract()
    print("qh-v12 duplicate-row identity tests: PASS")
