# MERIDIAN — Basis Convergence V1

Status: PREDECLARED / RESEARCH ONLY / NO PAPER OR LIVE EXECUTION  
Declared: 2026-09-26 before the first historical result is inspected.

## Objective

Test a market-neutral economic hypothesis that is distinct from Funding Carry.

Long spot / short perpetual is opened only when the executable perpetual premium is large enough that a mechanical basis compression can cover realistic round-trip costs. Funding is **not** an entry filter and is not forecast. Actual funding settlements during the holding period are recorded as realized cashflow and may help or hurt the trade.

## Frozen universe

Exactly:
- BTCUSDT
- ETHUSDT
- SOLUSDT

No asset may be added or removed after evidence.

## Frozen basket and costs

One portfolio basket maximum across the entire universe.

At entry:
- buy $10,000 spot notional;
- short the same base quantity in USD-M perpetual;
- conservative reference capital: $20,000.

Execution model on the selected confirmed 4h open:
- spot fee 10 bps/fill;
- perpetual fee 5 bps/fill;
- slippage 3 bps per leg/fill.

The same fee/slippage assumptions apply on exit.

Approximate modeled round-trip friction is therefore 42 bps of one $10,000 leg before any funding.

## Frozen executable basis

At every matched confirmed 4h open:

`basisPct = (perpBid - spotAsk) / spotAsk × 100`

with slippage-adjusted executable references:
- `spotAsk = spotOpen × 1.0003`
- `perpBid = perpOpen × 0.9997`

Exit basis uses:
- `spotBid = spotOpen × 0.9997`
- `perpAsk = perpOpen × 1.0003`
- `exitBasisPct = (perpAsk - spotBid) / spotBid × 100`

## Frozen entry

A flat portfolio may open a basket only when:

1. executable entry basis >= **0.75%**;
2. the asset has matched complete spot/perpetual 4h data at that timestamp;
3. the portfolio is outside its 24h cooldown.

If multiple assets qualify on the same 4h timestamp:
- select the asset with the highest executable entry basis;
- exact tie break: BTCUSDT, then ETHUSDT, then SOLUSDT.

No funding-rate, RSI, MACD, EMA, ADX, volume, OI or market-regime filter is allowed.

## Frozen exits

Evaluate on every subsequent matched 4h open. First applicable exit wins in this order:

1. **MARKED_LOSS:** basket marked net P&L <= -$200.
2. **BASIS_WIDENING:** executable exit basis >= entry basis + 1.00 percentage point.
3. **BASIS_CONVERGED:** executable exit basis <= 0.10%.
4. **MAX_HOLD:** holding time >= 14 calendar days.

No trailing stop or discretionary exit.

After exit, wait 24 hours before another basket can open.

## Funding accounting

Official historical USD-M funding settlements are applied only when:
- the basket was already open before the settlement timestamp; and
- the settlement timestamp is at or before the current decision time.

For a short perpetual:
- positive funding rate is income;
- negative funding rate is expense.

Funding is calculated on the equal-base perpetual mark notional using the contemporaneous perpetual 4h open for the containing bucket.

Funding is never used to determine entry.

## Frozen evidence

Evaluation:
- start: `2021-01-01T00:00:00Z`
- primary/secondary split: `2023-07-01T00:00:00Z`
- end: `2026-06-01T00:00:00Z`

Official Binance Vision:
- spot 4h
- USD-M perpetual 4h
- USD-M fundingRate

Only information available at or before each simulated timestamp may be used.

## Frozen data repair

For a missing official 4h market bucket:
1. exactly four contiguous official Binance Vision 1h bars;
2. otherwise exactly 240 official 1m bars;
3. otherwise data adequacy fails.

A missing monthly official fundingRate file may be replaced only by official Binance Vision daily fundingRate files for the exact missing dates. Funding is never interpolated.

## Predeclared pass gate

All conditions must pass:

1. >=20 completed baskets overall.
2. Aggregate net P&L > $0.
3. Dollar PF >= 1.25.
4. >=60% of baskets profitable.
5. Maximum marked portfolio drawdown <= $250.
6. Primary >=7 baskets, net P&L > $0, PF >=1.10.
7. Secondary >=7 baskets, net P&L > $0, PF >=1.10.
8. At least two assets each have >=4 completed baskets and positive net P&L.
9. No one asset contributes >70% of total positive basket P&L.
10. At least four calendar years contain completed baskets and every such year is net non-negative.
11. Aggregate P&L remains > $0 and PF >=1.10 after an additional $8 friction charge per completed basket.
12. Complete/reproducible spot/perpetual 4h data for all assets and complete funding history across the evaluation interval.

## Decision

PASS permits an isolated prospective **Basis Convergence V1 Paper shadow** with the exact frozen rules above.

FAIL means:
- no Paper shadow;
- no threshold/date/asset/hold/exit/cost tuning from the result.

Passing never permits live or Pionex execution.

## Isolation

Funding Carry V1/V2 remain manage-only. All previous Carry/Directional/FIB/Elliott results remain unchanged. No existing Paper or live execution path is modified.
