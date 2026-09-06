# MERIDIAN FIB Level Bot V1 — Evidence

Status: RESEARCH ONLY — NO PROMOTION.

Evidence run: GitHub Actions `FIB Level Bot V1 Evidence` run #2 on strategy head `d84e14af5cdf5b69ba623c0f3fd51d283d878818`.
Artifact: `9991143474`.
Digest: `sha256:6fb084e12b64172e09ce09e451f06483beb8ae11bb58ca4821556c0718854d02`.
Cutoff: `2026-09-06T14:00:00.000Z`.
Source: Coinbase Exchange public 15m candles.
Universe: BTCUSDT, ETHUSDT, SOLUSDT.
No execution impact.

The initial Binance transport returned HTTP 451 before any result was produced. The pre-evidence transport was replaced with the already-used public Coinbase Exchange feed; all strategy parameters remained unchanged.

## Aggregate results

### 15m

- 90d: 1,251 closed baskets; PF `0.32`; EXP `-0.855R`; DD `1,073.976R`.
- 180d: 2,607; PF `0.29`; EXP `-0.916R`; DD `2,391.069R`.
- 365d: 5,272; PF `0.36`; EXP `-0.725R`; DD `3,826.495R`.

15m is decisively rejected.

### 1h — predeclared primary

- 90d: 409 closed baskets; PF `0.92`; EXP `-0.041R`; DD `32.586R`.
- 180d: 791; PF `0.91`; EXP `-0.043R`; DD `77.979R`.
- 365d: 1,475; PF `0.86`; EXP `-0.073R`; DD `121.853R`.

365d chronological folds:

- Fold 1: n `492`; PF `0.81`; EXP `-0.113R`; DD `85.094R`.
- Fold 2: n `492`; PF `0.90`; EXP `-0.054R`; DD `40.855R`.
- Fold 3: n `491`; PF `0.90`; EXP `-0.052R`; DD `44.456R`.

The primary hypothesis fails. All three folds are negative.

1h / 365d concentration:

- LONG: n `737`; PF `0.98`; EXP `-0.012R`.
- SHORT: n `738`; PF `0.78`; EXP `-0.134R`.
- BTC: PF `0.71`; EXP `-0.165R`.
- ETH: PF `0.99`; EXP `-0.006R`.
- SOL: PF `0.91`; EXP `-0.044R`.
- BULL is the only positive descriptive regime (PF `1.22`, EXP `+0.100R`); RANGE, TRANSITION and BEAR are negative. This must not become a BULL-only hard gate.

Opportunity: 1,869 setups, 1,475 filled/closed baskets, 394 unfilled setups, 2 open baskets at cutoff, 78.9% fill rate. Median closed-basket duration is 4 bars.

### 4h — diagnostic discovery only

- 90d: 95 closed baskets; PF `1.02`; EXP `+0.011R`; DD `10.410R`.
- 180d: 152; PF `1.08`; EXP `+0.035R`; DD `10.410R`.
- 365d: 357; PF `1.27`; EXP `+0.117R`; DD `10.410R`.

365d chronological folds:

- Fold 1: n `119`; PF `1.28`; EXP `+0.118R`; DD `9.721R`.
- Fold 2: n `119`; PF `1.44`; EXP `+0.182R`; DD `7.843R`.
- Fold 3: n `119`; PF `1.11`; EXP `+0.051R`; DD `10.410R`.

4h breadth:

- LONG: n `179`; PF `1.14`; EXP `+0.064R`.
- SHORT: n `178`; PF `1.44`; EXP `+0.170R`.
- BTC: n `142`; PF `1.25`; EXP `+0.110R`.
- ETH: n `129`; PF `1.18`; EXP `+0.073R`.
- SOL: n `86`; PF `1.46`; EXP `+0.195R`.

Opportunity: 442 setups, 357 filled/closed baskets, 85 unfilled setups, 3 open baskets at cutoff, 80.8% fill rate.

The 4h diagnostic is materially more credible than the failed 15m/1h variants: all windows are non-negative, all three chronological folds are positive, both sides are positive and all three assets are positive. However 4h was not the predeclared primary outcome, so it is discovery evidence only and cannot be promoted from V1.

## FIB-level interpretation guard

The first touched level is always 0.382 by construction when price traverses the ladder. The deepest touched level is realized-path telemetry, not information known at setup creation. Baskets stopping at 1.000 necessarily tend to reach deeper levels, while shallow completed baskets are mechanically winners. Therefore the strong shallow/deep cohort separation must not be converted into a level gate or used as causal evidence.

## Decision

NO PROMOTION.

- Reject 15m.
- Reject the predeclared 1h primary V1.
- Do not create BULL-only, LONG-only, ETH-only or shallow-level gates.
- Preserve 4h only as a promising discovery requiring a new, separately predeclared prospective/robustness version.
- Do not tune pivot width, ATR multiple, FIB levels, weights, stop, targets or costs on this evidence.

A valid next step is FIB Level Bot V2 with 4h locked before testing, broader assets and longer/prospective OOS validation. V2 must remain separate and may not reuse the V1 period as fresh confirmation evidence.
