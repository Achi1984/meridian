# MERIDIAN v7.100 — OKX Taker-Flow Opposition Design

Status: PREDECLARED / RESEARCH ONLY / NO PROMOTION  
Declared: 2026-09-06, before the first v7.100 result

## One hypothesis

Starting from frozen v7.97, unusually strong 24-hour taker flow against the proposed trade direction indicates weak execution support and should attenuate research risk:

- calculate each asset's 24h taker imbalance as `(buy volume - sell volume) / (buy volume + sell volume)`;
- standardize the seven simultaneous asset imbalances cross-sectionally;
- LONG: attenuate when the asset imbalance z-score <= -1.50;
- SHORT: attenuate when the asset imbalance z-score >= +1.50;
- attenuation: incoming v7.97 risk x 0.60;
- otherwise v7.97 remains unchanged.

This is one direction-aware hypothesis using only taker flow. Funding and open interest are excluded.

## Leakage-safe definition

- Source: official unauthenticated OKX `/api/v5/rubik/stat/taker-volume`
- Query: base currency with `instType=CONTRACTS`; this is explicitly OKX currency-level derivatives flow, not instrument-specific Binance evidence.
- Locked currencies: BTC, ETH, SOL, XRP, ADA, AVAX and LINK.
- Period: 1H; preserve returned sell and buy volumes separately.
- Conservative availability: each hourly row is usable only at `ts + 1 hour`.
- At each decision, sum the latest 24 usable hourly buy and sell volumes.
- Require 24 finite non-negative observations, positive total volume, current age <=2 hours and no interval gap >2 hours.
- Require all seven valid 24h imbalances for the cross-sectional state. Otherwise evidence is missing and factor = 1.00.
- Fetch 92 calendar days to cover the 90-day evaluation plus warm-up.
- No interpolation, invented values, cross-venue substitution or post-decision observations.
- Record requested/returned ranges, transport attempts, missing counts and raw/normalized SHA-256 per currency.

The +/-1.50 cross-sectional z boundary is frozen as a conventional strong relative outlier. The already-used 0.60 attenuation factor is reused. Neither may be tuned after results.

## Invariants

- No trade blocking; side and opportunity count stay identical to v7.97.
- Risk may only decrease and never exceed incoming v7.97 risk.
- No asset, regime, alpha-band or window-specific rule.
- No Baseline, Paper, live execution, Pionex, `server.js`, entry or exit change.
- Data quality is not alpha evidence.

## Frozen evaluation

Direct comparison of v7.93, v7.96, v7.97 and v7.100 on identical rows and costs:

- primary horizon 24h; sensitivity 4h and 12h
- 30d, 60d and 90d
- three chronological 90d folds
- PF, expectancy, maximum drawdown and opportunity count
- 90d LONG/SHORT x regime and asset concentration
- attenuation count, evidence-missing count and sample adequacy

## Decision rule

v7.100 survives only if, with unchanged opportunities:

1. 24h PF and expectancy do not degrade versus v7.97 on any 30/60/90d window;
2. 24h drawdown does not materially worsen on any window;
3. no chronological fold materially degrades and the negative middle fold improves toward PF 1 / expectancy 0;
4. improvement is not concentrated in one asset or a tiny sample.

Failure means no z-threshold, aggregation horizon, factor, side, asset or regime search. If funding, OI and taker-flow isolated tests all fail, stop microstructure threshold experiments and move to a structurally different leakage-free meta-allocation design or prospective holdout. Promotion remains forbidden regardless of outcome.
