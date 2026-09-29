"""Frozen Perpetual Relative-Value / Beta-Neutral Reversal V3 engine.

Research only. This module defines the preregistered strategy math but performs no
I/O and starts no validation run by itself.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import exp, isfinite, log, sqrt
from statistics import mean, stdev, variance

from perpetual_cross_sectional_reversal_v1 import (
    DAY, WEEK, FUND_MAX_GAP, BASE_COST_BPS, STRESS_COST_BPS,
    _compound, _pf, _sharpe, _max_dd, _windows,
)

RULESET = "PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-FROZEN"

BENCHMARKS = ("BTC", "ETH", "BNB", "SOL", "XRP")
QUALIFIED_ASSETS = (
    "SAND","MANA","ALGO","ZEC","IOTA","ZIL","COMP","SNX","KSM","1INCH",
    "CHZ","RUNE","SUSHI","DYDX","APE","ARB","SUI","WLD","SEI",
)
PRIMARY_ASSETS = ("RUNE","ZIL","SEI","ARB","DYDX","KSM","WLD","MANA","ZEC","SUI")
TRANSFER_ASSETS = ("SAND","ALGO","SNX","COMP","SUSHI","APE","1INCH","IOTA","CHZ")

VALIDATION_START = 1736121600000  # 2025-01-06T00:00:00Z
VALIDATION_END = 1788134400000    # 2026-08-31T00:00:00Z
EXPECTED_ANCHORS = 86

BETA_OBSERVATIONS = 360
FORMATION_RETURNS = 56
SIDE_COUNT = 2
MIN_SIDE_GROSS = 0.20
MAX_SIDE_GROSS = 0.80
MAX_ESTIMATED_BETA_EXPOSURE = 1e-10

COMMON_GATE = {
    "expected_anchors": 86,
    "min_active_weeks": 65,
    "min_pf": 1.10,
    "min_sharpe": 0.50,
    "max_dd_pct": 25.0,
    "min_positive_windows": 3,
    "max_positive_concentration_pct": 35.0,
    "max_abs_realized_market_beta": 0.20,
}
PRIMARY_MIN_POSITIVE_ASSETS = 5
TRANSFER_MIN_POSITIVE_ASSETS = 5


def stage_assets(stage: str):
    if stage == "PRIMARY_VALIDATION":
        return PRIMARY_ASSETS
    if stage == "ASSET_TRANSFER_HOLDOUT":
        return TRANSFER_ASSETS
    raise ValueError("UNKNOWN_STAGE:" + str(stage))


def weekly_anchors(start=VALIDATION_START, end=VALIDATION_END):
    out = []
    t = start
    while t < end:
        out.append(t)
        t += WEEK
    return out


def funding_coverage(times, start, end):
    if not times:
        return False
    if times[0] - start < 0 or times[0] - start > FUND_MAX_GAP:
        return False
    for i in range(1, len(times)):
        gap = times[i] - times[i - 1]
        if gap <= 0 or gap > FUND_MAX_GAP:
            return False
    tail = end - times[-1]
    return 0 <= tail <= FUND_MAX_GAP


@dataclass
class DailyPriceData:
    asset: str
    price: list

    def __post_init__(self):
        self._validate_price()
        self.open_by_time = {int(r[0]): float(r[2]) for r in self.price}
        self.close_mark = {int(r[0]) + DAY: float(r[5]) for r in self.price}

    def _validate_price(self):
        last = None
        for row in self.price:
            if len(row) < 6:
                raise ValueError(f"{self.asset}:MALFORMED_PRICE")
            ot = int(row[0])
            o, h, l, c = map(float, row[2:6])
            if not all(isfinite(x) and x > 0 for x in (o, h, l, c)):
                raise ValueError(f"{self.asset}:INVALID_OHLC")
            if h < max(o, c, l) or l > min(o, c, h):
                raise ValueError(f"{self.asset}:INCONSISTENT_OHLC")
            if last is not None and ot - last != DAY:
                raise ValueError(f"{self.asset}:PRICE_GAP")
            last = ot

    def log_returns_between_marks(self, start_mark, end_mark):
        if end_mark <= start_mark or (end_mark - start_mark) % DAY:
            return None
        count = (end_mark - start_mark) // DAY
        marks = [start_mark + i * DAY for i in range(count + 1)]
        px = [self.close_mark.get(t) for t in marks]
        if any(p is None or p <= 0 for p in px):
            return None
        return [log(px[i] / px[i - 1]) for i in range(1, len(px))]

    def open_return(self, start, end):
        p0 = self.open_by_time.get(start)
        p1 = self.open_by_time.get(end)
        if p0 is None or p1 is None or p0 <= 0:
            return None
        return p1 / p0 - 1.0

    def open_log_return(self, start, end):
        p0 = self.open_by_time.get(start)
        p1 = self.open_by_time.get(end)
        if p0 is None or p1 is None or p0 <= 0 or p1 <= 0:
            return None
        return log(p1 / p0)


@dataclass
class CandidateData(DailyPriceData):
    funding: list

    def __post_init__(self):
        super().__post_init__()
        self._validate_funding()
        self.funding_times = [int(r[0]) for r in self.funding]
        self.funding_rates = [float(r[1]) for r in self.funding]

    def _validate_funding(self):
        last = None
        for row in self.funding:
            if len(row) < 2:
                raise ValueError(f"{self.asset}:MALFORMED_FUNDING")
            t = int(row[0])
            rate = float(row[1])
            if not isfinite(rate):
                raise ValueError(f"{self.asset}:INVALID_FUNDING")
            if last is not None and t <= last:
                raise ValueError(f"{self.asset}:DUPLICATE_OR_NONMONOTONIC_FUNDING")
            last = t

    def funding_sum(self, start, end):
        rows = [(t, r) for t, r in zip(self.funding_times, self.funding_rates) if t > start and t <= end]
        times = [t for t, _ in rows]
        if not funding_coverage(times, start, end):
            raise ValueError(f"{self.asset}:HOLD_FUNDING_COVERAGE")
        return sum(r for _, r in rows)


def ols_beta_stats(candidate_returns, market_returns):
    if len(candidate_returns) != BETA_OBSERVATIONS or len(market_returns) != BETA_OBSERVATIONS:
        raise ValueError("BETA_OBSERVATION_COUNT")
    if not all(isfinite(x) for x in candidate_returns + market_returns):
        raise ValueError("NONFINITE_BETA_RETURNS")
    xm = mean(market_returns)
    ym = mean(candidate_returns)
    sxx = sum((x - xm) ** 2 for x in market_returns)
    if sxx <= 0:
        raise ValueError("MARKET_VARIANCE_NOT_POSITIVE")
    sxy = sum((x - xm) * (y - ym) for x, y in zip(market_returns, candidate_returns))
    beta = sxy / sxx
    alpha = ym - beta * xm
    residuals = [y - alpha - beta * x for x, y in zip(market_returns, candidate_returns)]
    sse = sum(e * e for e in residuals)
    sigma_e2 = sse / (BETA_OBSERVATIONS - 2)
    se_beta2 = sigma_e2 / sxx
    if not all(isfinite(x) for x in (beta, alpha, se_beta2)) or se_beta2 < 0:
        raise ValueError("INVALID_BETA_ESTIMATE")
    return {"betaOls": beta, "alpha": alpha, "seBeta2": se_beta2}


def vasicek_shrink(raw_stats):
    assets = sorted(raw_stats)
    if len(assets) < 2:
        raise ValueError("SHRINKAGE_ASSETS_LT_2")
    betas = [raw_stats[a]["betaOls"] for a in assets]
    beta_bar = mean(betas)
    tau2 = variance(betas)
    out = {}
    for a in assets:
        b = raw_stats[a]["betaOls"]
        se2 = raw_stats[a]["seBeta2"]
        if tau2 == 0:
            weight = 0.0
            shrunk = beta_bar
        else:
            weight = tau2 / (tau2 + se2)
            shrunk = weight * b + (1.0 - weight) * beta_bar
        if not all(isfinite(x) for x in (weight, shrunk)):
            raise ValueError("INVALID_SHRUNK_BETA")
        out[a] = {
            **raw_stats[a],
            "betaPriorMean": beta_bar,
            "betaPriorVariance": tau2,
            "shrinkWeight": weight,
            "beta": shrunk,
        }
    return out


def market_factor_log_returns(benchmark_data, start_mark, end_mark):
    series = []
    for b in BENCHMARKS:
        if b not in benchmark_data:
            raise ValueError("MISSING_BENCHMARK:" + b)
        rs = benchmark_data[b].log_returns_between_marks(start_mark, end_mark)
        if rs is None:
            raise ValueError("BENCHMARK_RETURN_GAP:" + b)
        series.append(rs)
    lengths = {len(x) for x in series}
    if len(lengths) != 1:
        raise ValueError("BENCHMARK_RETURN_LENGTH_MISMATCH")
    return [mean(row) for row in zip(*series)]


def weekly_market_return(benchmark_data, t):
    logs = []
    for b in BENCHMARKS:
        lr = benchmark_data[b].open_log_return(t, t + WEEK)
        if lr is None:
            raise ValueError("BENCHMARK_HOLD_GAP:" + b)
        logs.append(lr)
    return exp(mean(logs)) - 1.0


def compute_week_features(candidate_data, benchmark_data, assets, t):
    beta_start = t - (BETA_OBSERVATIONS + 7) * DAY
    beta_end = t - 7 * DAY
    market_beta = market_factor_log_returns(benchmark_data, beta_start, beta_end)
    if len(market_beta) != BETA_OBSERVATIONS:
        raise ValueError("MARKET_BETA_RETURNS_NE_360")

    raw = {}
    holding = {}
    candidate_beta_returns = {}
    for a in assets:
        if a not in candidate_data:
            raise ValueError("MISSING_CANDIDATE:" + a)
        cr = candidate_data[a].log_returns_between_marks(beta_start, beta_end)
        if cr is None or len(cr) != BETA_OBSERVATIONS:
            raise ValueError("CANDIDATE_BETA_GAP:" + a)
        candidate_beta_returns[a] = cr
        raw[a] = ols_beta_stats(cr, market_beta)
        hr = candidate_data[a].open_return(t, t + WEEK)
        if hr is None or not isfinite(hr):
            raise ValueError("CANDIDATE_HOLD_GAP:" + a)
        holding[a] = hr

    betas = vasicek_shrink(raw)

    form_start = t - 63 * DAY
    form_end = t - 7 * DAY
    market_form = market_factor_log_returns(benchmark_data, form_start, form_end)
    if len(market_form) != FORMATION_RETURNS:
        raise ValueError("MARKET_FORMATION_RETURNS_NE_56")

    scores = {}
    for a in assets:
        ar = candidate_data[a].log_returns_between_marks(form_start, form_end)
        if ar is None or len(ar) != FORMATION_RETURNS:
            raise ValueError("CANDIDATE_FORMATION_GAP:" + a)
        beta = betas[a]["beta"]
        score = sum(y - beta * x for y, x in zip(ar, market_form))
        if not isfinite(score):
            raise ValueError("NONFINITE_RESIDUAL_SCORE:" + a)
        scores[a] = score

    return {
        "betas": betas,
        "scores": scores,
        "holding": holding,
        "weeklyMarketReturn": weekly_market_return(benchmark_data, t),
    }


def beta_neutral_weights(scores, betas):
    ranked = sorted(scores.items(), key=lambda kv: (kv[1], kv[0]))
    if len(ranked) < 2 * SIDE_COUNT:
        raise ValueError("RANKED_ASSETS_LT_4")
    longs = [a for a, _ in ranked[:SIDE_COUNT]]
    shorts = [a for a, _ in ranked[-SIDE_COUNT:]]

    bl = mean(betas[a]["beta"] for a in longs)
    bs = mean(betas[a]["beta"] for a in shorts)
    active = bl > 0 and bs > 0
    reason = None
    long_gross = short_gross = 0.0
    weights = {}

    if active:
        long_gross = bs / (bl + bs)
        short_gross = bl / (bl + bs)
        if not (MIN_SIDE_GROSS <= long_gross <= MAX_SIDE_GROSS and MIN_SIDE_GROSS <= short_gross <= MAX_SIDE_GROSS):
            active = False
            reason = "SIDE_GROSS_GUARD"
    else:
        reason = "NONPOSITIVE_SELECTED_BETA"

    if active:
        for a in longs:
            weights[a] = long_gross / SIDE_COUNT
        for a in shorts:
            weights[a] = -short_gross / SIDE_COUNT
        exposure = sum(weights[a] * betas[a]["beta"] for a in weights)
        if abs(exposure) > MAX_ESTIMATED_BETA_EXPOSURE:
            raise ValueError("ESTIMATED_BETA_NEUTRALITY_FAILURE")
    else:
        exposure = 0.0
        long_gross = 0.0
        short_gross = 0.0

    return {
        "active": active,
        "inactiveReason": reason,
        "weights": weights,
        "longs": longs,
        "shorts": shorts,
        "meanLongBeta": bl,
        "meanShortBeta": bs,
        "longGross": long_gross,
        "shortGross": short_gross,
        "estimatedBetaExposure": exposure,
    }


def turnover(prev, new, assets):
    return sum(abs(new.get(a, 0.0) - prev.get(a, 0.0)) for a in assets)


def period_row(candidate_data, benchmark_data, assets, t, prev, cost_bps):
    features = compute_week_features(candidate_data, benchmark_data, assets, t)
    sizing = beta_neutral_weights(features["scores"], features["betas"])
    weights = sizing["weights"]
    holding = features["holding"]

    price = funding = long_gross_pnl = short_gross_pnl = 0.0
    attr = {a: 0.0 for a in assets}

    for a, w in weights.items():
        hr = holding[a]
        fs = candidate_data[a].funding_sum(t, t + WEEK)
        pr = w * hr
        fr = -w * fs
        gross = pr + fr
        price += pr
        funding += fr
        attr[a] += gross
        if w > 0:
            long_gross_pnl += gross
        else:
            short_gross_pnl += gross

    tr = turnover(prev, weights, assets)
    cost = tr * cost_bps / 10000.0
    for a in assets:
        attr[a] -= abs(weights.get(a, 0.0) - prev.get(a, 0.0)) * cost_bps / 10000.0

    longs = sizing["longs"]
    shorts = sizing["shorts"]
    loser_spread = mean(holding[a] for a in longs) - mean(holding[a] for a in shorts)

    return {
        "t": t,
        "active": sizing["active"],
        "inactiveReason": sizing["inactiveReason"],
        "weights": weights,
        "longs": longs,
        "shorts": shorts,
        "price": price,
        "funding": funding,
        "cost": cost,
        "turnover": tr,
        "net": price + funding - cost,
        "priceOnly": price - cost,
        "pricePreCost": price,
        "longGrossContribution": long_gross_pnl,
        "shortGrossContribution": short_gross_pnl,
        "attr": attr,
        "estimatedBetaExposure": sizing["estimatedBetaExposure"],
        "meanLongBeta": sizing["meanLongBeta"],
        "meanShortBeta": sizing["meanShortBeta"],
        "longGross": sizing["longGross"],
        "shortGross": sizing["shortGross"],
        "weeklyMarketReturn": features["weeklyMarketReturn"],
        "selectedLoserMinusWinnerNextWeek": loser_spread,
        "scores": features["scores"],
        "betas": {a: features["betas"][a]["beta"] for a in assets},
    }


def terminal_close(prev, assets, cost_bps):
    tr = sum(abs(prev.get(a, 0.0)) for a in assets)
    cost = tr * cost_bps / 10000.0
    attr = {a: -abs(prev.get(a, 0.0)) * cost_bps / 10000.0 for a in assets if prev.get(a, 0.0)}
    return tr, cost, attr


def realized_market_beta(weeks):
    rows = [w for w in weeks if w["active"]]
    if len(rows) < 2:
        return None
    x = [w["weeklyMarketReturn"] for w in rows]
    y = [w["pricePreCost"] for w in rows]
    xm = mean(x)
    ym = mean(y)
    sxx = sum((v - xm) ** 2 for v in x)
    if sxx <= 0:
        return None
    return sum((a - xm) * (b - ym) for a, b in zip(x, y)) / sxx


def prepare_candidate_data(raw_candidates, assets):
    return {
        a: CandidateData(a, raw_candidates[a].get("price", []), raw_candidates[a].get("funding", []))
        for a in assets
    }


def prepare_benchmark_data(raw_benchmarks):
    return {b: DailyPriceData(b, raw_benchmarks[b].get("price", [])) for b in BENCHMARKS}


def run_method(raw_candidates, raw_benchmarks, stage, cost_bps):
    assets = stage_assets(stage)
    candidates = prepare_candidate_data(raw_candidates, assets)
    benchmarks = prepare_benchmark_data(raw_benchmarks)

    prev = {}
    weeks = []
    attr = {a: 0.0 for a in assets}
    total_funding = total_cost = total_turnover = total_long = total_short = 0.0

    for t in weekly_anchors():
        row = period_row(candidates, benchmarks, assets, t, prev, cost_bps)
        weeks.append(row)
        for a, v in row["attr"].items():
            attr[a] += v
        total_funding += row["funding"]
        total_cost += row["cost"]
        total_turnover += row["turnover"]
        total_long += row["longGrossContribution"]
        total_short += row["shortGrossContribution"]
        prev = dict(row["weights"])

    if weeks:
        tr, cost, terminal_attr = terminal_close(prev, assets, cost_bps)
        weeks[-1]["net"] -= cost
        weeks[-1]["priceOnly"] -= cost
        weeks[-1]["cost"] += cost
        weeks[-1]["turnover"] += tr
        total_cost += cost
        total_turnover += tr
        for a, v in terminal_attr.items():
            attr[a] += v

    rs = [w["net"] for w in weeks]
    price_rs = [w["priceOnly"] for w in weeks]
    windows = _windows(rs, 5)
    positive = {a: v for a, v in attr.items() if v > 0}
    positive_total = sum(positive.values())
    concentration = max(positive.values()) / positive_total * 100.0 if positive else 0.0
    active = [w for w in weeks if w["active"]]
    rb = realized_market_beta(weeks)

    return {
        "stage": stage,
        "periods": len(weeks),
        "activeWeeks": len(active),
        "activeFraction": len(active) / len(weeks) if weeks else 0.0,
        "returnPct": _compound(rs) * 100.0,
        "priceOnlyReturnPct": _compound(price_rs) * 100.0,
        "profitFactor": _pf(rs),
        "sharpe": _sharpe(rs),
        "maxDrawdownPct": _max_dd(rs) * 100.0,
        "positiveWindows": sum(1 for x in windows if x > 0),
        "windowsPct": [x * 100.0 for x in windows],
        "fundingContribution": total_funding,
        "costContribution": -total_cost,
        "turnover": total_turnover,
        "longContribution": total_long,
        "shortContribution": total_short,
        "assetAttribution": attr,
        "positiveAssets": len(positive),
        "positiveConcentrationPct": concentration,
        "meanSelectedLoserMinusWinnerNextWeek": mean(w["selectedLoserMinusWinnerNextWeek"] for w in weeks) if weeks else None,
        "maxAbsEstimatedBetaExposure": max((abs(w["estimatedBetaExposure"]) for w in active), default=0.0),
        "meanAbsEstimatedBetaExposure": mean(abs(w["estimatedBetaExposure"]) for w in active) if active else 0.0,
        "meanLongGross": mean(w["longGross"] for w in active) if active else 0.0,
        "meanShortGross": mean(w["shortGross"] for w in active) if active else 0.0,
        "realizedMarketBeta": rb,
        "weekly": weeks,
    }


def stage_gate(result, stress):
    stage = result["stage"]
    assets = stage_assets(stage)
    min_positive = PRIMARY_MIN_POSITIVE_ASSETS if stage == "PRIMARY_VALIDATION" else TRANSFER_MIN_POSITIVE_ASSETS
    reasons = []

    if result["periods"] != COMMON_GATE["expected_anchors"]:
        reasons.append("ANCHORS_NE_86")
    if result["activeWeeks"] < COMMON_GATE["min_active_weeks"]:
        reasons.append("ACTIVE_WEEKS_LT_65")
    if result["maxAbsEstimatedBetaExposure"] > MAX_ESTIMATED_BETA_EXPOSURE:
        reasons.append("ESTIMATED_BETA_EXPOSURE_GT_1E_10")
    if result["returnPct"] <= 0:
        reasons.append("RETURN_NOT_POSITIVE")
    if result["priceOnlyReturnPct"] <= 0:
        reasons.append("PRICE_ONLY_NOT_POSITIVE")
    if result["profitFactor"] < COMMON_GATE["min_pf"]:
        reasons.append("PF_LT_1.10")
    if result["sharpe"] < COMMON_GATE["min_sharpe"]:
        reasons.append("SHARPE_LT_0.50")
    if result["maxDrawdownPct"] > COMMON_GATE["max_dd_pct"]:
        reasons.append("DD_GT_25")
    if result["positiveWindows"] < COMMON_GATE["min_positive_windows"]:
        reasons.append("POSITIVE_WINDOWS_LT_3")
    if stress["returnPct"] <= 0:
        reasons.append("STRESS_RETURN_NOT_POSITIVE")
    if result["positiveAssets"] < min_positive:
        reasons.append(f"POSITIVE_ASSETS_LT_{min_positive}")
    if result["positiveConcentrationPct"] > COMMON_GATE["max_positive_concentration_pct"]:
        reasons.append("POSITIVE_CONCENTRATION_GT_35")
    if not (result["meanSelectedLoserMinusWinnerNextWeek"] > 0):
        reasons.append("LOSER_MINUS_WINNER_SPREAD_NOT_POSITIVE")
    if result["realizedMarketBeta"] is None or abs(result["realizedMarketBeta"]) > COMMON_GATE["max_abs_realized_market_beta"]:
        reasons.append("ABS_REALIZED_MARKET_BETA_GT_0.20")

    if stage == "PRIMARY_VALIDATION":
        pass_decision = "PRIMARY_VALIDATION_PASS_TRANSFER_REQUIRED"
        fail_decision = "PRIMARY_VALIDATION_FAIL_RESEARCH_REDESIGN"
    else:
        pass_decision = "TRANSFER_PASS_PAPER_REVIEW_ELIGIBLE"
        fail_decision = "TRANSFER_FAIL_RESEARCH_REDESIGN"

    return {
        "pass": not reasons,
        "reasons": reasons,
        "decision": pass_decision if not reasons else fail_decision,
        "assetCount": len(assets),
    }


def run_stage(raw_candidates, raw_benchmarks, stage):
    try:
        base = run_method(raw_candidates, raw_benchmarks, stage, BASE_COST_BPS)
        stress = run_method(raw_candidates, raw_benchmarks, stage, STRESS_COST_BPS)
        gate = stage_gate(base, stress)
        return {
            "ruleset": RULESET,
            "stage": stage,
            "researchOnly": True,
            "executionImpact": False,
            "autoPromotion": False,
            "dataIntegrityFailure": False,
            "result": base,
            "stress": stress,
            "gate": gate,
            "decision": gate["decision"],
        }
    except Exception as exc:
        fail = "PRIMARY_VALIDATION_FAIL_RESEARCH_REDESIGN" if stage == "PRIMARY_VALIDATION" else "TRANSFER_FAIL_RESEARCH_REDESIGN"
        return {
            "ruleset": RULESET,
            "stage": stage,
            "researchOnly": True,
            "executionImpact": False,
            "autoPromotion": False,
            "dataIntegrityFailure": True,
            "error": str(exc),
            "gate": {"pass": False, "reasons": ["DATA_INTEGRITY_FAILURE"]},
            "decision": fail,
        }
