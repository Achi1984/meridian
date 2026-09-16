#!/usr/bin/env python3
"""MERIDIAN Bull Compound research backtest.

Research only. This is a transparent MERIDIAN interpretation of a bull-market
compounding / partial-profit-and-reload concept; it is NOT claimed to reproduce
Bastian Keller's exact proprietary rules.

Data: daily BTC/USD closes from the public viratsoft/btc-price-json repository
(CoinGecko source). Signals are generated only from information available by
that date. Pivot points require right-side confirmation and become usable only
when confirmed, avoiding look-ahead.
"""
from __future__ import annotations

import itertools
import json
import math
import statistics
import urllib.request
from dataclasses import dataclass, asdict
from datetime import date
from pathlib import Path

DATA_BASE = "https://raw.githubusercontent.com/viratsoft/btc-price-json/main/json"
FEE = 0.001       # 10 bps per transaction
SLIPPAGE = 0.0005 # 5 bps conservative execution allowance
RESERVE_CAP = 0.20
RELOAD_WEIGHTS = (0.30, 0.35, 0.35)


def fetch_year(year: int) -> dict[str, float]:
    url = f"{DATA_BASE}/{year}.json"
    req = urllib.request.Request(url, headers={"User-Agent": "MERIDIAN-BULL-COMPOUND/0.1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = json.loads(r.read().decode("utf-8"))
    return {str(k): float(v) for k, v in raw.items() if float(v) > 0}


def load_prices() -> tuple[list[str], list[float]]:
    merged: dict[str, float] = {}
    for y in range(2019, 2026):
        merged.update(fetch_year(y))
    rows = sorted((d, p) for d, p in merged.items() if "2019-01-01" <= d <= "2025-12-31")
    return [d for d, _ in rows], [p for _, p in rows]


def ema(values: list[float], period: int) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    if not values:
        return out
    k = 2.0 / (period + 1.0)
    x = values[0]
    for i, v in enumerate(values):
        x = v if i == 0 else v * k + x * (1.0 - k)
        if i >= period - 1:
            out[i] = x
    return out


def rsi(values: list[float], period: int = 14) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    if len(values) <= period:
        return out
    gains, losses = [], []
    for i in range(1, len(values)):
        d = values[i] - values[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_g = sum(gains[:period]) / period
    avg_l = sum(losses[:period]) / period
    def val(g: float, l: float) -> float:
        if l == 0:
            return 100.0
        rs = g / l
        return 100.0 - 100.0 / (1.0 + rs)
    out[period] = val(avg_g, avg_l)
    for i in range(period + 1, len(values)):
        g, l = gains[i - 1], losses[i - 1]
        avg_g = (avg_g * (period - 1) + g) / period
        avg_l = (avg_l * (period - 1) + l) / period
        out[i] = val(avg_g, avg_l)
    return out


def date_index(dates: list[str], target: str, side: str = "left") -> int:
    if side == "left":
        for i, d in enumerate(dates):
            if d >= target:
                return i
        return len(dates)
    for i in range(len(dates) - 1, -1, -1):
        if dates[i] <= target:
            return i
    return -1


@dataclass(frozen=True)
class Params:
    pivot_window: int
    fibs: tuple[float, float, float]
    rsi_min: int
    ema200_ratio_min: float
    sell_fraction: float
    reload_drawdowns: tuple[float, float, float]


@dataclass
class Order:
    target: float
    budget: float
    filled: bool = False


@dataclass
class Result:
    start: str
    end: str
    start_price: float
    end_price: float
    btc: float
    cash: float
    equity: float
    btc_equivalent: float
    relative_to_hodl: float
    max_drawdown_pct: float
    hodl_max_drawdown_pct: float
    sells: int
    reloads: int
    sale_usd: float
    reload_usd: float
    fees_slippage_est_usd: float
    end_cash_pct: float
    min_btc: float
    sale_events: list[dict]
    reload_events: list[dict]


def collapse_pivot(pivots: list[tuple[int, str, float]], item: tuple[int, str, float]) -> None:
    if not pivots or pivots[-1][1] != item[1]:
        pivots.append(item)
        return
    # For consecutive same-type confirmed pivots keep the more extreme one.
    _, typ, px = item
    old = pivots[-1]
    if (typ == "L" and px < old[2]) or (typ == "H" and px > old[2]):
        pivots[-1] = item


def simulate(
    dates: list[str], prices: list[float], ema200: list[float | None], rsi14: list[float | None],
    params: Params, start_date: str, end_date: str,
) -> Result:
    s = date_index(dates, start_date, "left")
    e = date_index(dates, end_date, "right")
    if s < 0 or e < s:
        raise ValueError("bad date range")

    btc = 1.0
    cash = 0.0
    min_btc = btc
    orders: list[Order] = []
    pivots: list[tuple[int, str, float]] = []
    active_setup: tuple[int, int, int] | None = None
    sold_levels: set[float] = set()
    pending_level: float | None = None
    sells = reloads = 0
    sale_usd = reload_usd = 0.0
    cost_drag = 0.0
    sale_events: list[dict] = []
    reload_events: list[dict] = []
    peak = prices[s]
    max_dd = 0.0
    hodl_peak = prices[s]
    hodl_dd = 0.0

    # Replay from enough history to allow pivots to be confirmed before start.
    replay_start = max(0, s - 220)
    w = params.pivot_window

    for i in range(replay_start, e + 1):
        p = prices[i]

        # Confirm the pivot at j only now, after w right-side observations exist.
        j = i - w
        if j >= w:
            win = prices[j - w:j + w + 1]
            pj = prices[j]
            is_low = pj == min(win) and win.count(pj) == 1
            is_high = pj == max(win) and win.count(pj) == 1
            if is_low:
                collapse_pivot(pivots, (j, "L", pj))
            elif is_high:
                collapse_pivot(pivots, (j, "H", pj))
            if len(pivots) >= 3:
                a, b, c = pivots[-3:]
                if a[1] == "L" and b[1] == "H" and c[1] == "L" and c[2] > a[2] and b[2] > c[2]:
                    setup = (a[0], b[0], c[0])
                    if setup != active_setup:
                        active_setup = setup
                        sold_levels = set()
                        pending_level = None

        if i < s:
            continue

        # Execute a prior day's sell signal at today's close.
        if pending_level is not None:
            equity_before = btc * p + cash
            reserve_pct = cash / equity_before if equity_before > 0 else 0.0
            room_usd = max(0.0, RESERVE_CAP * equity_before - cash)
            qty = min(btc * params.sell_fraction, room_usd / p if p > 0 else 0.0)
            if qty > 1e-10:
                exec_px = p * (1.0 - SLIPPAGE)
                gross = qty * exec_px
                fee = gross * FEE
                proceeds = gross - fee
                btc -= qty
                cash += proceeds
                sells += 1
                sale_usd += proceeds
                cost_drag += qty * p * SLIPPAGE + fee
                min_btc = min(min_btc, btc)
                # Every sale gets an independent pre-placed reload ladder.
                for dd, weight in zip(params.reload_drawdowns, RELOAD_WEIGHTS):
                    orders.append(Order(target=exec_px * (1.0 - dd), budget=proceeds * weight))
                sale_events.append({"date": dates[i], "price": round(p, 2), "fib": pending_level,
                                    "btc_sold": round(qty, 8), "proceeds": round(proceeds, 2)})
            pending_level = None

        # Pre-placed reload limits. Close <= target is deliberately conservative versus intraday OHLC.
        for o in orders:
            if o.filled or cash <= 1e-9:
                continue
            if p <= o.target:
                budget = min(o.budget, cash)
                exec_px = o.target * (1.0 + SLIPPAGE)
                fee = budget * FEE
                qty = max(0.0, budget - fee) / exec_px
                btc += qty
                cash -= budget
                reloads += 1
                reload_usd += budget
                cost_drag += budget * SLIPPAGE + fee
                o.filled = True
                reload_events.append({"date": dates[i], "close": round(p, 2), "limit": round(o.target, 2),
                                      "btc_bought": round(qty, 8), "budget": round(budget, 2)})

        # Mark equity and benchmark drawdowns.
        equity = btc * p + cash
        peak = max(peak, equity)
        max_dd = max(max_dd, (peak - equity) / peak if peak > 0 else 0.0)
        hodl_peak = max(hodl_peak, p)
        hodl_dd = max(hodl_dd, (hodl_peak - p) / hodl_peak if hodl_peak > 0 else 0.0)

        # Signal only after close. The sell happens next day, avoiding close-lookahead execution.
        if i < e and active_setup is not None and pending_level is None:
            a_i, b_i, c_i = active_setup
            impulse = prices[b_i] - prices[a_i]
            if impulse > 0:
                base = prices[c_i]
                er = ema200[i]
                rr = rsi14[i]
                if er and rr is not None and rr >= params.rsi_min and p / er >= params.ema200_ratio_min:
                    for fib in params.fibs:
                        target = base + fib * impulse
                        if fib not in sold_levels and p >= target:
                            sold_levels.add(fib)
                            pending_level = fib
                            break

    end_p = prices[e]
    equity = btc * end_p + cash
    btc_eq = equity / end_p
    end_cash_pct = cash / equity if equity > 0 else 0.0
    return Result(
        start=dates[s], end=dates[e], start_price=prices[s], end_price=end_p,
        btc=btc, cash=cash, equity=equity, btc_equivalent=btc_eq,
        relative_to_hodl=btc_eq - 1.0,
        max_drawdown_pct=max_dd * 100.0, hodl_max_drawdown_pct=hodl_dd * 100.0,
        sells=sells, reloads=reloads, sale_usd=sale_usd, reload_usd=reload_usd,
        fees_slippage_est_usd=cost_drag, end_cash_pct=end_cash_pct * 100.0,
        min_btc=min_btc, sale_events=sale_events, reload_events=reload_events,
    )


def result_at_checkpoint(dates, prices, ema200, rsi14, params, start, checkpoint):
    return simulate(dates, prices, ema200, rsi14, params, start, checkpoint)


def pjson(p: Params) -> dict:
    d = asdict(p)
    d["fibs"] = list(p.fibs)
    d["reload_drawdowns"] = list(p.reload_drawdowns)
    return d


def main() -> None:
    dates, prices = load_prices()
    e200 = ema(prices, 200)
    r14 = rsi(prices, 14)

    train_start, train_end = "2020-05-12", "2022-12-31"
    bull_checkpoint = "2021-11-10"
    valid_start, valid_end = "2023-01-01", "2025-12-31"

    grid = []
    for vals in itertools.product(
        (5, 7, 10),
        ((1.272, 1.618, 2.0), (1.618, 2.0, 2.618), (1.272, 1.618, 2.618)),
        (68, 72, 76),
        (1.10, 1.20, 1.30),
        (0.025, 0.05, 0.075, 0.10),
        ((0.05, 0.10, 0.15), (0.08, 0.13, 0.21), (0.10, 0.15, 0.20)),
    ):
        grid.append(Params(*vals))

    candidates = []
    for p in grid:
        tr = simulate(dates, prices, e200, r14, p, train_start, train_end)
        top = simulate(dates, prices, e200, r14, p, train_start, bull_checkpoint)
        # Guard against a model that "wins" only by abandoning the bull trend.
        # It must retain >=95% of HODL value near the 2021 bull peak and actually trade.
        if top.btc_equivalent >= 0.95 and tr.sells >= 2:
            candidates.append((tr.btc_equivalent, -tr.end_cash_pct, p, tr, top))
    if not candidates:
        raise RuntimeError("No candidate survived training constraints")
    candidates.sort(key=lambda x: (x[0], x[1]), reverse=True)
    best = candidates[0]
    _, _, best_p, train, train_top = best

    valid = simulate(dates, prices, e200, r14, best_p, valid_start, valid_end)
    continuous = simulate(dates, prices, e200, r14, best_p, train_start, valid_end)

    # Robustness: without selecting on validation, see how the top 20 TRAIN models generalize.
    top20 = candidates[:20]
    validations = []
    for rank, (_, _, p, tr, top) in enumerate(top20, 1):
        vr = simulate(dates, prices, e200, r14, p, valid_start, valid_end)
        validations.append({"rank": rank, "params": pjson(p), "train_btc_eq": tr.btc_equivalent,
                            "validation_btc_eq": vr.btc_equivalent, "validation_sells": vr.sells,
                            "validation_reload": vr.reloads})
    beat_count = sum(1 for x in validations if x["validation_btc_eq"] > 1.0)
    med_val = statistics.median(x["validation_btc_eq"] for x in validations)

    output = {
        "method": {
            "name": "MERIDIAN Bull Compound v0.1",
            "claim": "MERIDIAN interpretation; not Bastian Keller exact rules",
            "data": "CoinGecko BTC/USD daily close via viratsoft/btc-price-json",
            "fee_bps_each_side": FEE * 10000,
            "slippage_bps_each_side": SLIPPAGE * 10000,
            "reserve_cap_pct": RESERVE_CAP * 100,
            "reload_weights_pct": [x * 100 for x in RELOAD_WEIGHTS],
            "signal_execution": "sell signal at close, execute next daily close; pre-placed reload limit triggered only when daily close <= limit",
            "train": [train_start, train_end],
            "validation": [valid_start, valid_end],
            "selection_guard": ">=95% of HODL BTC-equivalent at 2021-11-10 and >=2 sales",
            "variants_tested": len(grid),
            "variants_survived": len(candidates),
        },
        "best_params_locked_from_train": pjson(best_p),
        "train_result": asdict(train),
        "train_bull_checkpoint": asdict(train_top),
        "validation_result": asdict(valid),
        "continuous_result": asdict(continuous),
        "top20_train_robustness": {
            "validation_beat_hodl_count": beat_count,
            "count": len(validations),
            "median_validation_btc_equivalent": med_val,
            "rows": validations,
        },
    }

    Path("bull-compound-result.json").write_text(json.dumps(output, indent=2), encoding="utf-8")

    def pct(x): return f"{x*100:+.2f}%"
    bp = best_p
    lines = [
        "# MERIDIAN Bull Compound v0.1 — walk-forward backtest",
        "",
        "> Research-only MERIDIAN interpretation. It is **not** presented as Bastian Keller's exact rule set.",
        "",
        "## Locked rule selected on 2020–2022 only",
        f"- Pivot confirmation: ±{bp.pivot_window} days",
        f"- Fib extensions: {', '.join(str(x) for x in bp.fibs)}",
        f"- Overextension gate: RSI14 ≥ {bp.rsi_min}, Close / EMA200 ≥ {bp.ema200_ratio_min:.2f}",
        f"- BTC sold per triggered Fib level: {bp.sell_fraction*100:.1f}% of current BTC, reserve capped at {RESERVE_CAP*100:.0f}% of equity",
        f"- Reload ladder: {', '.join(f'-{x*100:.0f}%' for x in bp.reload_drawdowns)} with 30/35/35% of that sale reserve",
        f"- Costs: {FEE*10000:.0f} bps fee + {SLIPPAGE*10000:.0f} bps slippage per side",
        "",
        "## Results",
        "| Period | BTC-eq end | vs HODL | BTC held | Cash | Sells / reloads | Max DD strategy | Max DD HODL |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for label, r in [("TRAIN 2020-05-12→2022-12-31", train), ("OOS 2023→2025", valid), ("Continuous 2020→2025", continuous)]:
        lines.append(f"| {label} | {r.btc_equivalent:.5f} BTC | {pct(r.relative_to_hodl)} | {r.btc:.5f} | ${r.cash:,.0f} | {r.sells} / {r.reloads} | {r.max_drawdown_pct:.2f}% | {r.hodl_max_drawdown_pct:.2f}% |")
    lines += [
        "",
        f"Training bull-top guard (2021-11-10): {train_top.btc_equivalent:.5f} BTC-equivalent ({pct(train_top.relative_to_hodl)} vs HODL).",
        f"Top-20 training models that also beat HODL in untouched 2023–2025: **{beat_count}/{len(validations)}**; median OOS BTC-equivalent: **{med_val:.5f} BTC**.",
        "",
        "## Interpretation",
        "A positive BTC-equivalent delta means the strategy ended with more total value than 1 BTC HODL at that period's final BTC price. Cash is converted to BTC-equivalent only for comparison; it is not assumed to have been magically reinvested.",
        "Close-only data makes reload triggering conservative: an intraday dip below a pre-placed limit that recovered before the daily close is not counted.",
    ]
    Path("bull-compound-result.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
