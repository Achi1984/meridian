# MERIDIAN FIB Level Bot V3 — Daily-Anchor Evidence

Status: RESEARCH ONLY — HISTORICAL GATE FAIL — NO PROMOTION.

Evidence run: GitHub Actions `FIB Level Bot V3 Daily Anchor` run #1 on implementation head `1a8ed707c3c554ba1d62ca7eaf860dd6546c0494`.
Artifact: `9992106464`.
Digest: `sha256:f219a4e2a51c9161b459366762209e2c330e6e707ae4d784424a71a5bfefb999`.
Source: Coinbase Exchange public 1h candles, deterministically resampled to UTC 4h and Daily.
No prospective candle, Paper/live execution or Pionex path is used.

## Primary unused historical year

Period: 2023-09-06T14:15:00Z to 2024-09-06T14:15:00Z.

- Closed baskets: `190`.
- PF: `1.34`.
- Expectancy: `+0.150R`.
- Net: `+28.416R`.
- Max drawdown: `6.609R`.
- Win rate: `53.7%`.
- Median time in market: `15` 4h bars (`60h`).
- 246 setups, 191 filled, 55 unfilled; fill rate `77.6%`.

## Chronological folds

- Fold 1: n `64`; PF `1.31`; EXP `+0.129R`; DD `4.632R`.
- Fold 2: n `64`; PF `1.01`; EXP `+0.003R`; DD `3.790R`.
- Fold 3: n `62`; PF `1.74`; EXP `+0.322R`; DD `6.609R`.

All folds pass the locked positive-edge condition, although Fold 2 is economically marginal.

## Side and universe breadth

- SHORT: n `107`; PF `1.41`; EXP `+0.183R`.
- LONG: n `83`; PF `1.25`; EXP `+0.107R`.
- CORE: n `90`; PF `1.50`; EXP `+0.205R`.
- EXPANSION: n `100`; PF `1.22`; EXP `+0.100R`.

Both sides and both universe groups are positive.

## Asset breadth and concentration

- BTC: n `31`; PF `0.44`; EXP `-0.370R`.
- ETH: n `29`; PF `1.40`; EXP `+0.128R`.
- SOL: n `30`; PF `4.67`; EXP `+0.872R`.
- XRP: n `18`; PF `2.06`; EXP `+0.402R`.
- ADA: n `24`; PF `2.03`; EXP `+0.270R`.
- AVAX: n `22`; PF `1.06`; EXP `+0.026R`.
- LINK: n `36`; PF `0.81`; EXP `-0.119R`.

Five of seven assets pass the predeclared positive breadth rule. Positive-net-R concentration is ETH `8.4%`, SOL `59.2%`, XRP `16.4%`, ADA `14.7%`, AVAX `1.3%`. SOL exceeds the locked 40% maximum; the concentration gate fails.

## Regime telemetry

- BEAR: n `55`; PF `0.91`; EXP `-0.041R`.
- TRANSITION: n `47`; PF `1.91`; EXP `+0.390R`.
- RANGE: n `20`; PF `2.32`; EXP `+0.533R`.
- BULL: n `68`; PF `1.06`; EXP `+0.025R`.

Regime remains descriptive. No regime gate may be derived.

## Secondary stability

- 2024-09-06 to 2025-09-06: n `198`; PF `1.38`; EXP `+0.155R`; DD `13.970R`.
- 2025-09-06 to 2026-09-06: n `206`; PF `1.43`; EXP `+0.162R`; DD `10.984R`.
- Two-year aggregate: n `404`; PF `1.41`; EXP `+0.159R`; DD `14.009R`.

Both secondary years are positive, but they are already observed research history and cannot replace a prospective holdout.

## Gate decision

Passed eight of nine gates: primary sample, primary edge, all folds, both sides, asset breadth, universe breadth, both secondary years and secondary aggregate.

Failed: positive-PnL concentration.

Therefore `historicallyRobust = false` and `promotionPermitted = false`.

This is a materially stronger research result than V1/V2, but the predeclared gate must govern the decision. Do not remove BTC/LINK, overweight or isolate SOL, tune the daily pivot width, or derive side/regime filters. The prospective holdout after 2026-09-06T14:15:00Z remains locked and unused.
