# MERIDIAN v7.99 — OKX Relative Open-Interest Expansion Design

Status: PREDECLARED / RESEARCH ONLY / NO PROMOTION  
Declared: 2026-09-06, before the first v7.99 result

## One hypothesis

Starting from frozen v7.97, unusually strong 24-hour open-interest expansion relative to the locked seven-asset universe indicates elevated leverage/liquidation risk and should attenuate research risk:

- calculate each asset's 24h percentage change in OKX USD open interest;
- at each decision timestamp, standardize the seven simultaneous asset changes cross-sectionally;
- if the traded asset's cross-sectional z-score >= +1.50, multiply incoming v7.97 risk by 0.60;
- otherwise leave v7.97 unchanged.

This is one direction-neutral risk hypothesis using only open interest. Funding and taker flow are excluded.

## Leakage-safe definition

- Source: official unauthenticated OKX `/api/v5/rubik/stat/contracts/open-interest-history`
- Instruments: BTC, ETH, SOL, XRP, ADA, AVAX and LINK USDT perpetual swaps
- Period: 1H; field: returned USD open interest
- Conservative availability: a row timestamp becomes usable only at `ts + 1 hour`.
- For each decision, current OI is the latest usable row; lag OI is the latest usable row at or before current row time minus 24 hours.
- Current-row age must be <=2 hours and lag distance must be 23–25 hours.
- All seven finite, positive 24h OI changes are required for the cross-sectional state. Otherwise evidence is missing and factor = 1.00.
- Fetch 92 days to cover the 90-day evaluation and 24h warm-up.
- No interpolation, invented value, cross-venue substitution or use of data published after the decision.
- Record requested/returned ranges, transport attempts, missing-decision counts and raw/normalized SHA-256 per asset.

The +1.50 cross-sectional z boundary is frozen before results as a conventional strong relative outlier. The existing 0.60 attenuation factor is reused. Neither may be tuned afterward.

## Invariants

- No trade blocking; side and opportunity count stay identical to v7.97.
- Risk never increases above incoming v7.97.
- No asset, side, regime, alpha-band or window-specific rule.
- No Baseline, Paper, live execution, Pionex, `server.js`, entry or exit change.
- OKX evidence remains venue-specific and is not labeled Binance evidence.

## Frozen evaluation

Directly compare v7.93, v7.96, v7.97 and v7.99 on identical rows and costs:

- primary horizon 24h; sensitivity 4h and 12h
- windows 30d, 60d and 90d
- three chronological 90d folds
- PF, expectancy, maximum drawdown and opportunity count
- 90d LONG/SHORT x regime and asset concentration
- attenuation count, evidence-missing count and sample adequacy

## Decision rule

v7.99 survives only if, at unchanged opportunity count:

1. 24h PF and expectancy do not degrade versus v7.97 on any 30/60/90d window;
2. 24h drawdown does not materially worsen on any window;
3. no chronological fold materially degrades and the negative middle fold improves toward PF 1 / expectancy 0;
4. the improvement is not concentrated in one asset or a tiny affected sample.

Failure means no threshold, horizon, factor or universe search. The next candidate may test one separately predeclared taker-flow hypothesis. Promotion is forbidden regardless of outcome.
