# TSMOM V2 — Frozen Implementation/Data Contract

Frozen before first V2 result inspection.

- Source: Binance Spot public 1d klines.
- Primary endpoint: api.binance.com/api/v3/klines.
- Fallback: data-api.binance.vision/api/v3/klines.
- Source window: 1460 evaluation days + 420 warm-up days = 1880 requested bars, matching the existing Paper Profit discovery data path.
- Closed bars only; no private/account data.
- Split is computed from common timestamps before any candidate return evaluation.
- Discovery data is truncated at the frozen discovery boundary.
- Holdout return computation is not executed unless the discovery Stage-B gate passes.
- 8 bps baseline and 16 bps stress use identical strategy parameters.
- No result-driven source-window, split, universe or threshold changes are allowed.

Execution impact: false.
