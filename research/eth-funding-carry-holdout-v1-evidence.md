# MERIDIAN — ETH Funding Carry Holdout V1 evidence

Generated from GitHub Actions run 36327397536 on 2026-09-27.

## Frozen design

- Symbol: ETHUSDT
- Holdout: 2024-01-01 00:00 UTC → 2026-06-01 00:00 UTC
- Structure: equal-base long spot + short USD-M perpetual
- Notional: $10,000 per leg; $20,000 conservative bound capital
- Costs: spot fee 10 bps, perpetual fee 5 bps, slippage 3 bps per fill
- Funding source: Binance Vision monthly fundingRate archives
- Funding valuation: official Binance Vision USD-M Mark Price 1h archives
- Spot/perpetual basis endpoints: Binance Vision 1h klines
- Research only; no live execution and no automatic promotion

Data coverage: 2,645 funding settlements, 21,168 Mark Price rows, 21,912 perpetual kline rows and 2,976 spot boundary rows.

## Result

**Decision: WATCH — not a Paper candidate.**

| Window | Funding | Basis P&L | Costs | Net | Capital return | Annualized | Positive funding periods |
|---|---:|---:|---:|---:|---:|---:|---:|
| Full 2024-01-01 → 2026-06-01 | $2,586.12 | $11.74 | $39.47 | **$2,558.39** | 12.792% | 5.294% | 84.42% |
| 2024 | $1,851.02 | $13.98 | $51.72 | **$1,813.28** | 9.066% | 9.042% | 95.81% |
| 2025 | $478.45 | $0.09 | $39.69 | **$438.85** | 2.194% | 2.194% | 83.84% |
| 2026-H1 | $27.07 | -$1.82 | $35.18 | **-$9.93** | -0.050% | -0.120% | 58.28% |

The predeclared gate required the full holdout and every frozen calendar block to be positive after modeled costs. 2026-H1 fails that condition.

## Robustness interpretation

The 2026-H1 gross result before modeled execution costs is only $25.25. Spot and perpetual fees alone are approximately $25.12, leaving about $0.13 before slippage. The frozen 3 bps-per-fill slippage assumption moves the block to -$9.93. This is an economically fragile edge rather than a robust Paper candidate.

The full-period profit is concentrated in the high-carry 2024 regime. The positive funding share falls from 95.81% in 2024 to 58.28% in 2026-H1. A positive aggregate result therefore does not justify promotion.

## Decision rule

No parameter, asset, cost assumption or calendar block is changed after seeing the result. ETH Funding Carry V1 remains WATCH/research-only. A future successor would require a new preregistered hypothesis and separate evidence; this failed gate must not be tuned away.
