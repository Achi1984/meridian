# Paper Arena — retained market diagnostic, 16 October 2026

This is a retrospective **diagnostic**, not independent Holdout, prospective
Paper performance or proof of future profitability. The current fixed universe
has unresolved survivorship bias. Costs are model assumptions and close-marked
positions exclude future exit costs; drawdown samples daily closes only.
No model is promoted or connected to runtime orders by these results.

## Source and reproduction

The eight Kraken USD instruments were chosen for source availability **before
outcomes**, without changing the strategies or replacing an asset. Eight spot
histories contain 400 aligned closed UTC daily candles, with the sole current
unclosed candle explicitly excluded and retained in raw responses. Full raw
metadata, raw OHLC bodies and normalized series are stored in the eight JSON
chunks under `research/results/strategy-arena-20261016/`. The manifest retains
the original source receipt and hashes; UI reassembles the input, verifies every
chunk and the complete input hash, and recomputes all metrics on an explicit
button click. Stored summary tables are never trusted as executable results.

Warmup/data: 2025-09-11–2026-10-15.
Scored period: **2026-03-30–2026-10-15**,
**200 daily observations** after 200 warmup candles.

Initial capital is **10,000 nominal USD per independent simulation**, 1× spot.
There is no USD/USDT or EUR conversion, no pooled sum of test accounts and no
inference of an actual account balance. Baseline/stress charge 8/16 bps on every
buy and sell. All default terminal positions remain marked, not liquidated.

| Model | Net return | Cost-stress return | Daily-close max DD | Realized sale slices |
|---|---:|---:|---:|---:|
| H1-B | +12.61% | +12.50% | 12.65% | 1 |
| H1-E | +12.61% | +12.50% | 12.65% | 1 |
| H7-B | +19.84% | +19.55% | 10.70% | 11 |
| H7-R | +11.88% | +11.75% | 8.53% | 12 |
| Equal-sleeve buy & hold | +20.06% | +19.97% | 33.86% | 0 |
| Cash | 0.00% | 0.00% | 0.00% | 0 |

H9 remains **BLOCKED_DATA**, with no return or trade claim. Positive marked
returns do not establish skill: H7-B slightly trails buy & hold in this window;
H1-E adds no observed change to H1-B; H7-R trades return for lower sampled
drawdown here. These are descriptive observations, not statistically established
causal advantages or a new optimization target. Sale slices are dependent partial
realizations, not an independent sample of bets. PF is undefined when no losses
are realized; H1 PF of zero refers to its single realized losing slice while
positive marked gains remain open. Do not select a winner using this table.

No verified risk-matched benchmark, execution depth, venue fee tier, independent
unseen sample, confidence interval or prospective observation is established.
CRV compatibility remains unresolved. The earlier failed USDT collection remains
part of the record; no access restriction was bypassed and no failed strategy was
renamed or rescued.

## Integrity and independent checks

- `inputSha256`: `decf35415605bda739d08e9ac489951c21f5428d6b5f6362bd6e77abf265c473`
- `engineSha256`: `c80fdae96eda45ae8fc3f4ce253db1223639548ccda6b484c1dd093c140aee64`
- `protocolSha256`: `901f0b7e48f6ecebed344d899ea5c7f5c8404bb465ce5360c54e081dc4e628bf`

The receipt was written before evaluation. The parent reproduced the exact full
result on Node 20.20.2 after collection on Node 24; a separate agent independently
verified metadata, all eight raw-response hashes, exact normalization and the
same full replay result without more network access. These are reproduction and
integrity checks, not independent financial validation. The protocol source was
frozen before acquisition and was not rewritten after observing results.
