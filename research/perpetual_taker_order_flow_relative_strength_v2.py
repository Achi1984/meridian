"""Frozen Taker Order Flow Relative Strength V2 feature-validation engine.

Research only. This module forms no portfolio, computes no strategy PnL and
cannot authorize Paper/live execution.
"""
from __future__ import annotations

from math import isfinite, sqrt
from statistics import mean, median
from typing import Iterable

from perpetual_taker_order_flow_v1 import (
    ASSETS,
    WEEK,
    prepare_dataset,
    weekly_anchors,
)

RULESET = "PERPETUAL-TAKER-ORDER-FLOW-RELATIVE-STRENGTH-V2-FROZEN"
PARENT_V1_ENGINE_BLOB = "580f8885118aa1bfcccd6c77a431d5b7835e8bba"

VALIDATION_START = 1736553600000  # 2025-01-11T00:00:00Z
VALIDATION_END = 1787961600000    # 2026-08-29T00:00:00Z
EXPECTED_WEEKS = 85
REQUIRED_ASSETS = 12
TOP_BOTTOM_COUNT = 2
NW_LAG = 4
ONE_SIDED_T_MIN = 1.645
MIN_POSITIVE_BLOCKS = 3
CHRONOLOGICAL_BLOCKS = 5

PASS_DECISION = "FEATURE_VALIDATION_PASS_STRATEGY_DESIGN_ALLOWED"
FAIL_DECISION = "FEATURE_VALIDATION_FAIL_RESEARCH_STOP"


def _finite_float(v):
    x = float(v)
    if not isfinite(x):
        raise ValueError("NONFINITE_VALUE")
    return x


def average_ranks(values: Iterable[float]):
    """Return deterministic 1-based average ranks, ascending."""
    xs = [_finite_float(x) for x in values]
    order = sorted(range(len(xs)), key=lambda i: (xs[i], i))
    ranks = [0.0] * len(xs)
    k = 0
    while k < len(order):
        j = k + 1
        while j < len(order) and xs[order[j]] == xs[order[k]]:
            j += 1
        avg = ((k + 1) + j) / 2.0
        for pos in range(k, j):
            ranks[order[pos]] = avg
        k = j
    return ranks


def pearson(xs: Iterable[float], ys: Iterable[float]):
    a = [_finite_float(x) for x in xs]
    b = [_finite_float(y) for y in ys]
    if len(a) != len(b) or len(a) < 2:
        raise ValueError("PEARSON_LENGTH")
    ma, mb = mean(a), mean(b)
    da = [x - ma for x in a]
    db = [y - mb for y in b]
    va = sum(x * x for x in da)
    vb = sum(y * y for y in db)
    if va <= 0 or vb <= 0:
        return 0.0
    return sum(x * y for x, y in zip(da, db)) / sqrt(va * vb)


def spearman(xs: Iterable[float], ys: Iterable[float]):
    return pearson(average_ranks(xs), average_ranks(ys))


def newey_west_tstat(values: Iterable[float], lag: int = NW_LAG):
    """HAC t-statistic for H0 mean=0 using Bartlett weights."""
    xs = [_finite_float(x) for x in values]
    n = len(xs)
    if n < 2:
        return 0.0
    lag = max(0, min(int(lag), n - 1))
    m = mean(xs)
    z = [x - m for x in xs]
    gamma0 = sum(x * x for x in z) / n
    lrv = gamma0
    for ell in range(1, lag + 1):
        gamma = sum(z[t] * z[t - ell] for t in range(ell, n)) / n
        weight = 1.0 - ell / (lag + 1.0)
        lrv += 2.0 * weight * gamma
    if lrv <= 1e-18:
        if m > 0:
            return 99.0
        if m < 0:
            return -99.0
        return 0.0
    return m / sqrt(lrv / n)


def feature_week(dataset, t):
    rows = []
    for asset in ASSETS:
        signal = dataset[asset].flow_signal(t)
        outcome = dataset[asset].entry_exit_return(t)
        if signal is None or outcome is None:
            raise ValueError(f"{asset}:MISSING_SIGNAL_OR_OUTCOME")
        signal = _finite_float(signal)
        outcome = _finite_float(outcome)
        rows.append((asset, signal, outcome))

    if len(rows) != REQUIRED_ASSETS:
        raise ValueError(f"ELIGIBLE_ASSETS_NE_{REQUIRED_ASSETS}:{len(rows)}")

    signals = [x[1] for x in rows]
    outcomes = [x[2] for x in rows]
    ranked = sorted(rows, key=lambda x: (-x[1], x[0]))
    top = ranked[:TOP_BOTTOM_COUNT]
    bottom = ranked[-TOP_BOTTOM_COUNT:]
    spread = mean(x[2] for x in top) - mean(x[2] for x in bottom)

    return {
        "t": int(t),
        "assetCount": len(rows),
        "rankIc": spearman(signals, outcomes),
        "top2MinusBottom2": spread,
        "top2": [x[0] for x in top],
        "bottom2": [x[0] for x in bottom],
        "top2MeanReturn": mean(x[2] for x in top),
        "bottom2MeanReturn": mean(x[2] for x in bottom),
    }


def _blocks(rows, parts=CHRONOLOGICAL_BLOCKS):
    out = []
    n = len(rows)
    for i in range(parts):
        a = n * i // parts
        b = n * (i + 1) // parts
        chunk = rows[a:b]
        out.append({
            "i": i + 1,
            "from": chunk[0]["t"] if chunk else None,
            "to": chunk[-1]["t"] if chunk else None,
            "weeks": len(chunk),
            "meanRankIc": mean(x["rankIc"] for x in chunk) if chunk else 0.0,
            "meanSpread": mean(x["top2MinusBottom2"] for x in chunk) if chunk else 0.0,
        })
    return out


def summarize_feature_rows(rows, expected_weeks=EXPECTED_WEEKS):
    xs = list(rows)
    ics = [_finite_float(x["rankIc"]) for x in xs]
    spreads = [_finite_float(x["top2MinusBottom2"]) for x in xs]
    blocks = _blocks(xs)
    positive_ic_blocks = sum(1 for x in blocks if x["meanRankIc"] > 0)
    positive_spread_blocks = sum(1 for x in blocks if x["meanSpread"] > 0)

    metrics = {
        "weeks": len(xs),
        "meanRankIc": mean(ics) if ics else 0.0,
        "medianRankIc": median(ics) if ics else 0.0,
        "positiveIcWeeks": sum(1 for x in ics if x > 0),
        "rankIcNeweyWestT": newey_west_tstat(ics, NW_LAG) if ics else 0.0,
        "meanTop2MinusBottom2": mean(spreads) if spreads else 0.0,
        "medianTop2MinusBottom2": median(spreads) if spreads else 0.0,
        "positiveSpreadWeeks": sum(1 for x in spreads if x > 0),
        "spreadNeweyWestT": newey_west_tstat(spreads, NW_LAG) if spreads else 0.0,
        "positiveIcBlocks": positive_ic_blocks,
        "positiveSpreadBlocks": positive_spread_blocks,
        "blocks": blocks,
    }

    reasons = []
    if len(xs) != int(expected_weeks):
        reasons.append(f"WEEKS_NE_{int(expected_weeks)}")
    if any(int(x.get("assetCount", 0)) != REQUIRED_ASSETS for x in xs):
        reasons.append(f"ASSET_COUNT_NE_{REQUIRED_ASSETS}")
    if not (metrics["meanRankIc"] > 0):
        reasons.append("MEAN_RANK_IC_NOT_POSITIVE")
    if metrics["rankIcNeweyWestT"] < ONE_SIDED_T_MIN:
        reasons.append("RANK_IC_NW_T_LT_1_645")
    if not (metrics["meanTop2MinusBottom2"] > 0):
        reasons.append("MEAN_TOP2_MINUS_BOTTOM2_NOT_POSITIVE")
    if metrics["spreadNeweyWestT"] < ONE_SIDED_T_MIN:
        reasons.append("SPREAD_NW_T_LT_1_645")
    if positive_ic_blocks < MIN_POSITIVE_BLOCKS:
        reasons.append("POSITIVE_IC_BLOCKS_LT_3_OF_5")
    if positive_spread_blocks < MIN_POSITIVE_BLOCKS:
        reasons.append("POSITIVE_SPREAD_BLOCKS_LT_3_OF_5")

    gate = {
        "pass": not reasons,
        "reasons": reasons,
        "expectedWeeks": int(expected_weeks),
        "requiredAssets": REQUIRED_ASSETS,
        "neweyWestLag": NW_LAG,
        "oneSidedTMin": ONE_SIDED_T_MIN,
        "minPositiveBlocks": MIN_POSITIVE_BLOCKS,
        "researchOnly": True,
        "executionImpact": False,
        "autoPromotion": False,
        "strategyPnlCalculated": False,
    }
    return metrics, gate


def run_feature_validation(raw_by_asset):
    try:
        dataset = prepare_dataset(raw_by_asset)
        rows = [
            feature_week(dataset, t)
            for t in weekly_anchors(VALIDATION_START, VALIDATION_END)
        ]
        metrics, gate = summarize_feature_rows(rows, EXPECTED_WEEKS)
        decision = PASS_DECISION if gate["pass"] else FAIL_DECISION
        return {
            "ruleset": RULESET,
            "stage": "INDEPENDENT_FEATURE_VALIDATION",
            "researchOnly": True,
            "executionImpact": False,
            "autoPromotion": False,
            "strategyPnlCalculated": False,
            "dataIntegrityFailure": False,
            "rows": rows,
            "metrics": metrics,
            "gate": gate,
            "decision": decision,
        }
    except Exception as exc:
        return {
            "ruleset": RULESET,
            "stage": "INDEPENDENT_FEATURE_VALIDATION",
            "researchOnly": True,
            "executionImpact": False,
            "autoPromotion": False,
            "strategyPnlCalculated": False,
            "dataIntegrityFailure": True,
            "error": str(exc),
            "rows": [],
            "metrics": None,
            "gate": {
                "pass": False,
                "reasons": ["DATA_INTEGRITY_FAILURE"],
                "researchOnly": True,
                "executionImpact": False,
                "autoPromotion": False,
                "strategyPnlCalculated": False,
            },
            "decision": FAIL_DECISION,
        }
