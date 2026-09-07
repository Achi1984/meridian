# MERIDIAN v7.98 — OKX Funding Crowding Risk Attenuation Design

Status: PREDECLARED / RESEARCH ONLY / NO PROMOTION  
Declared: 2026-09-06, before the first v7.98 result

## One hypothesis

Starting from frozen v7.97, attenuate research risk only when the trade is aligned with an extreme, crowded OKX perpetual-funding state:

- LONG: latest realized funding z-score >= +2.00
- SHORT: latest realized funding z-score <= -2.00
- attenuation: existing v7.97 risk multiplier x 0.60
- otherwise: v7.97 risk is unchanged

This is one causal use of one new evidence family: funding crowding. Open interest and taker flow are deliberately excluded from v7.98.

## Leakage-safe definition

- Source: official unauthenticated OKX `/api/v5/public/funding-rate-history`
- Instruments: BTC, ETH, SOL, XRP, ADA, AVAX and LINK USDT perpetual swaps
- At each Coinbase decision timestamp, use only the latest OKX funding observation with `fundingTime <= decision timestamp`.
- Calculate the z-score from the latest 30 realized funding observations available at that timestamp, including the latest observation.
- Require all 30 finite observations and non-zero standard deviation. If unavailable, funding evidence is missing and factor = 1.00.
- Fetch 120 calendar days to provide warm-up for the 90-day evaluation; evaluation windows and cutoff remain those of the frozen v7.97 Coinbase evidence.
- No interpolation, forward fill beyond carrying the latest already-realized funding observation, cross-venue substitution or invented observation.
- Record source coverage, timestamp range, missing-decision counts and SHA-256 provenance.

The z threshold 2.00 is frozen as a conventional extreme-state boundary. The already-used attenuation factor 0.60 is reused. Neither may be tuned after results.

## Invariants

- No trade blocking; side and opportunity count remain identical to v7.97.
- Risk can only decrease and can never exceed incoming v7.97 risk.
- No asset, side, regime, alpha-band or window-specific rule.
- No Baseline, Paper, live execution, Pionex, `server.js`, entry or exit change.
- OKX evidence remains explicitly venue-specific and is not labeled Binance evidence.
- Data-source success from V2 is not alpha evidence.

## Frozen evaluation

Directly compare v7.93, v7.96, v7.97 and v7.98 on identical rows and costs:

- primary horizon: 24h
- sensitivity: 4h and 12h
- windows: 30d, 60d, 90d
- three chronological 90d folds
- PF, expectancy, max drawdown and opportunity count
- 90d LONG/SHORT x regime and asset concentration
- funding attenuation count, missing evidence count and sample adequacy

## Decision rule

v7.98 is only a continuing research candidate if, at unchanged opportunity count:

1. 24h PF and expectancy do not degrade versus v7.97 on any 30/60/90d window;
2. 24h max drawdown does not materially worsen on any window;
3. no chronological fold materially degrades and the negative middle fold improves toward PF 1 / expectancy 0;
4. gains are not explained by a tiny funding-crowding sample or one asset only.

Failure means no tuning of z-score, lookback or factor. The next step would be a separately predeclared OI or taker-flow hypothesis, not a funding parameter search. Promotion remains forbidden regardless of outcome.
