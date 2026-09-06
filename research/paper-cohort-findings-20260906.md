# MERIDIAN Paper Cohort Findings — 2026-09-06

Status: RESEARCH ONLY. No promotion. No execution impact. Pionex untouched.

## Challenger V2 cohort snapshot from PAPER R18

### SIDE
- SHORT: n=19, expectancy +$6, PF 1.11, delta expectancy vs Baseline +$31. Sample adequate.
- LONG: n=4, expectancy -$36, PF 0.29, delta expectancy -$1. Sample inadequate.

### REGIME
- RANGE: n=7, expectancy +$87, PF 5.75, delta expectancy +$87. Sample inadequate; promising but not decision-grade.
- TRANSITION: n=14, expectancy -$44, PF 0.39, delta expectancy +$59. Sample adequate but still negative absolute edge.
- BEAR: n=2, expectancy -$13, PF 0.80, delta expectancy -$13. Sample inadequate.

### ASSET
- ETHUSDT: n=9, expectancy +$20, PF 1.38, delta expectancy +$86. Sample adequate and currently strongest asset cohort.
- SOLUSDT: n=8, expectancy -$1, PF 0.98, delta expectancy +$69. Sample adequate; near break-even and materially better than Baseline.
- BTCUSDT: n=6, expectancy -$33, PF 0.52, delta expectancy +$39. Sample inadequate and still negative.

## Interpretation

1. Challenger improvement is not uniform. SHORT is currently the only side with adequate sample and positive absolute expectancy/PF >1.
2. LONG cannot be rejected from n=4; it is evidence-poor, not proven bad. Do not hard-disable LONG.
3. RANGE is the strongest regime signal by magnitude, but n=7 is below the research adequacy threshold. Treat it as a hypothesis for prospective accumulation, not a gate.
4. TRANSITION is important: Challenger improves substantially vs Baseline (+$59 expectancy delta), yet remains strongly negative in absolute terms. A soft risk reduction/routing treatment is more appropriate than calling it successful.
5. ETH is the best current adequate asset cohort. SOL is close to break-even. BTC remains weak but sample is too small for a hard exclusion.
6. These observations support a reliability-weighted / regime-aware allocator and oppose more binary hard filters.

## Implications for Hybrid Alpha V1

- Preserve independent LONG and SHORT scoring; do not encode a global SHORT-only rule.
- Give RANGE-specific mean reversion meaningful weight, but require prospective evidence before increasing risk.
- In TRANSITION, use stronger uncertainty/risk attenuation while still allowing high-quality soft-score trades.
- Treat asset historical reliability (e.g. current ETH strength) as a future soft meta feature only after leakage-safe rolling estimation; never use full-sample hindsight as an input.
- Keep missing features renormalized instead of blocked.
- Compare Hybrid Alpha against Baseline and Challenger using identical outcome windows, exits and cost assumptions.

## v7.90 harness

`hybrid-alpha-backtest-v790.js` now accepts decision-time feature snapshots plus realized forward-R labels and reports total/by-side/by-regime/by-symbol PF, expectancy, win rate and max drawdown in R. It also supports chronological descriptive walk-forward folds and transaction-cost sensitivity via `costR`.

The harness does not fetch future information, does not execute orders and does not modify any Paper/live state. The data builder must guarantee every feature timestamp predates the corresponding forward outcome label.

## Next

1. Build leakage-safe feature snapshots from 15m/1h/4h historical candles.
2. Add relative-strength universe snapshots calculated only from contemporaneous/past data.
3. Add funding/carry history where timestamp-safe.
4. Order-flow remains optional until reliable historical data coverage is available.
5. Run 30/60/90-day and expanding walk-forward comparisons with costs/slippage.
6. Reject any result dependent on a single asset, side, regime or narrow parameter island.
