"""Frozen Cross-Sectional Low-Volatility V1 feature-validation engine.

Research only. This module forms no trading portfolio, computes no strategy PnL,
and cannot authorize Paper/live execution.
"""
from __future__ import annotations

from math import isfinite, log, sqrt
from statistics import mean, median
from typing import Iterable

RULESET = "CROSS-SECTIONAL-LOW-VOLATILITY-V1-FROZEN"
PREREGISTRATION_BLOB = "7c72162b7cf2f3dd5b22ef2aecc30936de52f4c8"

ASSETS = (
    "BTC", "ETH", "BNB", "SOL", "XRP", "ADA",
    "DOGE", "LINK", "DOT", "LTC", "BCH", "AVAX",
)
REQUIRED_ASSETS = 12

HOUR = 60 * 60 * 1000
DAY = 24 * HOUR
WEEK = 7 * DAY
FORMATION_HOURS = 28 * 24
FORMATION_ROWS = FORMATION_HOURS + 1
TOP_BOTTOM_COUNT = 2

DISCOVERY_START = 1738368000000  # 2025-02-01T00:00:00Z
DISCOVERY_END = 1767398400000    # 2026-01-03T00:00:00Z exclusive
DISCOVERY_EXPECTED_WEEKS = 48

HOLDOUT_START = 1767398400000    # 2026-01-03T00:00:00Z
HOLDOUT_END = 1787961600000      # 2026-08-29T00:00:00Z exclusive
HOLDOUT_EXPECTED_WEEKS = 34

NW_LAG = 4
ONE_SIDED_T_MIN = 1.645
DISCOVERY_BLOCKS = 4
MIN_POSITIVE_DISCOVERY_BLOCKS = 3

DISCOVERY_PASS = "DISCOVERY_PASS_HOLDOUT_ALLOWED"
DISCOVERY_FAIL = "DISCOVERY_FAIL_RESEARCH_STOP"
HOLDOUT_PASS = "HOLDOUT_PASS_STRATEGY_DESIGN_ALLOWED"
HOLDOUT_FAIL = "HOLDOUT_FAIL_RESEARCH_STOP"


def _finite_float(value):
    x = float(value)
    if not isfinite(x):
        raise ValueError("NONFINITE_VALUE")
    return x


def weekly_anchors(start, end):
    if start % WEEK != 2 * DAY:  # Unix epoch Thursday -> Saturday offset
        raise ValueError("ANCHOR_NOT_SATURDAY_UTC")
    if end <= start or (end - start) % WEEK:
        raise ValueError("INVALID_ANCHOR_RANGE")
    return range(int(start), int(end), WEEK)


def average_ranks(values: Iterable[float]):
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


class HourlySeries:
    def __init__(self, rows):
        by_ts = {}
        for row in rows:
            if len(row) < 5:
                raise ValueError("HOURLY_ROW_TOO_SHORT")
            ts = int(row[0])
            if ts in by_ts:
                raise ValueError(f"DUPLICATE_HOURLY_TIMESTAMP:{ts}")
            open_px = _finite_float(row[1])
            close_px = _finite_float(row[4])
            if open_px <= 0 or close_px <= 0:
                raise ValueError(f"NONPOSITIVE_PRICE:{ts}")
            by_ts[ts] = (open_px, close_px)
        self.by_ts = by_ts

    def lowvol_signal(self, t):
        first = int(t) - FORMATION_ROWS * HOUR
        stamps = [first + i * HOUR for i in range(FORMATION_ROWS)]
        try:
            closes = [self.by_ts[s][1] for s in stamps]
        except KeyError as exc:
            raise ValueError(f"MISSING_FORMATION_HOUR:{int(exc.args[0])}") from None
        returns = [log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
        if len(returns) != FORMATION_HOURS:
            raise ValueError("FORMATION_RETURNS_NE_672")
        rv28 = sqrt(sum(r * r for r in returns))
        return -rv28

    def entry_exit_return(self, t):
        entry_t = int(t)
        exit_t = entry_t + WEEK
        if entry_t not in self.by_ts:
            raise ValueError(f"MISSING_ENTRY_OPEN:{entry_t}")
        if exit_t not in self.by_ts:
            raise ValueError(f"MISSING_EXIT_OPEN:{exit_t}")
        entry = self.by_ts[entry_t][0]
        exit_px = self.by_ts[exit_t][0]
        return exit_px / entry - 1.0


def prepare_dataset(raw_by_asset):
    if set(raw_by_asset) != set(ASSETS):
        missing = sorted(set(ASSETS) - set(raw_by_asset))
        extra = sorted(set(raw_by_asset) - set(ASSETS))
        raise ValueError(f"ASSET_UNIVERSE_MISMATCH:missing={missing}:extra={extra}")
    out = {}
    for asset in ASSETS:
        payload = raw_by_asset[asset]
        rows = payload.get("hourly") if isinstance(payload, dict) else payload
        if not isinstance(rows, list):
            raise ValueError(f"{asset}:HOURLY_ROWS_MISSING")
        out[asset] = HourlySeries(rows)
    return out


def feature_week(dataset, t):
    rows = []
    for asset in ASSETS:
        signal = _finite_float(dataset[asset].lowvol_signal(t))
        outcome = _finite_float(dataset[asset].entry_exit_return(t))
        rows.append((asset, signal, outcome))
    if len(rows) != REQUIRED_ASSETS:
        raise ValueError(f"ELIGIBLE_ASSETS_NE_{REQUIRED_ASSETS}:{len(rows)}")

    signals = [x[1] for x in rows]
    outcomes = [x[2] for x in rows]
    ranked = sorted(rows, key=lambda x: (-x[1], x[0]))
    low2 = ranked[:TOP_BOTTOM_COUNT]
    high2 = ranked[-TOP_BOTTOM_COUNT:]
    spread = mean(x[2] for x in low2) - mean(x[2] for x in high2)
    return {
        "t": int(t),
        "assetCount": len(rows),
        "rankIc": spearman(signals, outcomes),
        "low2MinusHigh2": spread,
        "low2": [x[0] for x in low2],
        "high2": [x[0] for x in high2],
        "low2MeanReturn": mean(x[2] for x in low2),
        "high2MeanReturn": mean(x[2] for x in high2),
    }


def _blocks(rows, parts):
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
            "meanSpread": mean(x["low2MinusHigh2"] for x in chunk) if chunk else 0.0,
        })
    return out


def summarize_feature_rows(rows, *, stage):
    xs = list(rows)
    if stage == "DISCOVERY":
        expected_weeks = DISCOVERY_EXPECTED_WEEKS
        blocks = _blocks(xs, DISCOVERY_BLOCKS)
    elif stage == "HOLDOUT":
        expected_weeks = HOLDOUT_EXPECTED_WEEKS
        blocks = []
    else:
        raise ValueError("UNKNOWN_STAGE")

    ics = [_finite_float(x["rankIc"]) for x in xs]
    spreads = [_finite_float(x["low2MinusHigh2"]) for x in xs]
    metrics = {
        "weeks": len(xs),
        "meanRankIc": mean(ics) if ics else 0.0,
        "medianRankIc": median(ics) if ics else 0.0,
        "positiveIcWeeks": sum(1 for x in ics if x > 0),
        "rankIcNeweyWestT": newey_west_tstat(ics, NW_LAG) if ics else 0.0,
        "meanLow2MinusHigh2": mean(spreads) if spreads else 0.0,
        "medianLow2MinusHigh2": median(spreads) if spreads else 0.0,
        "positiveSpreadWeeks": sum(1 for x in spreads if x > 0),
        "spreadNeweyWestT": newey_west_tstat(spreads, NW_LAG) if spreads else 0.0,
        "blocks": blocks,
    }

    reasons = []
    if len(xs) != expected_weeks:
        reasons.append(f"WEEKS_NE_{expected_weeks}")
    if any(int(x.get("assetCount", 0)) != REQUIRED_ASSETS for x in xs):
        reasons.append(f"ASSET_COUNT_NE_{REQUIRED_ASSETS}")
    if not (metrics["meanRankIc"] > 0):
        reasons.append("MEAN_RANK_IC_NOT_POSITIVE")
    if metrics["rankIcNeweyWestT"] < ONE_SIDED_T_MIN:
        reasons.append("RANK_IC_NW_T_LT_1_645")
    if not (metrics["meanLow2MinusHigh2"] > 0):
        reasons.append("MEAN_LOW2_MINUS_HIGH2_NOT_POSITIVE")
    if metrics["spreadNeweyWestT"] < ONE_SIDED_T_MIN:
        reasons.append("SPREAD_NW_T_LT_1_645")

    if stage == "DISCOVERY":
        positive_ic_blocks = sum(1 for x in blocks if x["meanRankIc"] > 0)
        positive_spread_blocks = sum(1 for x in blocks if x["meanSpread"] > 0)
        metrics["positiveIcBlocks"] = positive_ic_blocks
        metrics["positiveSpreadBlocks"] = positive_spread_blocks
        if positive_ic_blocks < MIN_POSITIVE_DISCOVERY_BLOCKS:
            reasons.append("POSITIVE_IC_BLOCKS_LT_3_OF_4")
        if positive_spread_blocks < MIN_POSITIVE_DISCOVERY_BLOCKS:
            reasons.append("POSITIVE_SPREAD_BLOCKS_LT_3_OF_4")

    gate = {
        "pass": not reasons,
        "reasons": reasons,
        "stage": stage,
        "expectedWeeks": expected_weeks,
        "requiredAssets": REQUIRED_ASSETS,
        "neweyWestLag": NW_LAG,
        "oneSidedTMin": ONE_SIDED_T_MIN,
        "researchOnly": True,
        "executionImpact": False,
        "autoPromotion": False,
        "strategyPnlCalculated": False,
    }
    return metrics, gate


def run_feature_validation(raw_by_asset, *, stage, discovery_authorized=False):
    if stage == "HOLDOUT" and not discovery_authorized:
        return {
            "ruleset": RULESET,
            "stage": "HOLDOUT",
            "researchOnly": True,
            "executionImpact": False,
            "autoPromotion": False,
            "strategyPnlCalculated": False,
            "dataIntegrityFailure": True,
            "error": "HOLDOUT_NOT_AUTHORIZED",
            "rows": [],
            "metrics": None,
            "gate": {"pass": False, "reasons": ["HOLDOUT_NOT_AUTHORIZED"]},
            "decision": HOLDOUT_FAIL,
        }

    try:
        dataset = prepare_dataset(raw_by_asset)
        if stage == "DISCOVERY":
            anchors = weekly_anchors(DISCOVERY_START, DISCOVERY_END)
            pass_decision, fail_decision = DISCOVERY_PASS, DISCOVERY_FAIL
        elif stage == "HOLDOUT":
            anchors = weekly_anchors(HOLDOUT_START, HOLDOUT_END)
            pass_decision, fail_decision = HOLDOUT_PASS, HOLDOUT_FAIL
        else:
            raise ValueError("UNKNOWN_STAGE")

        rows = [feature_week(dataset, t) for t in anchors]
        metrics, gate = summarize_feature_rows(rows, stage=stage)
        decision = pass_decision if gate["pass"] else fail_decision
        return {
            "ruleset": RULESET,
            "stage": stage,
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
        fail_decision = HOLDOUT_FAIL if stage == "HOLDOUT" else DISCOVERY_FAIL
        return {
            "ruleset": RULESET,
            "stage": stage,
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
            "decision": fail_decision,
        }
