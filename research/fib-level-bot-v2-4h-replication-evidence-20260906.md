# MERIDIAN FIB Level Bot V2 — 4h Replication Evidence

Status: RESEARCH ONLY — HISTORICAL REPLICATION FAIL — NO PROMOTION.

Evidence run: GitHub Actions `FIB Level Bot V2 4h Replication` run #1 on strategy head `29ad1eff01ba8044cfde924c8b770fee6318c38c`.
Artifact: `9991357217`.
Digest: `sha256:839d31b873a0cf06d5d4aa94b301bf5776a6ac323ea7a85dfec8cecc119b32d4`.
Source: Coinbase Exchange public 1h candles resampled to UTC-aligned 4h.
Strategy: unchanged FIB Level Bot V1.
Universe: BTC, ETH, SOL, XRP, ADA, AVAX, LINK.
No execution impact.

## Primary unseen replication year

Period: 2024-09-06T14:15:00Z to 2025-09-06T14:15:00Z.

- Closed baskets: `791`.
- PF: `0.89`.
- Expectancy: `-0.059R`.
- Net: `-46.962R`.
- Max drawdown: `77.372R`.
- Win rate: `53.7%`.

Opportunity telemetry:

- 1,005 setups.
- 794 filled baskets.
- 791 closed baskets.
- 211 unfilled setups.
- 6 open baskets at the period cutoff.
- Fill rate `79.0%`.

## Chronological folds

- Fold 1: n `264`; PF `1.02`; EXP `+0.010R`; DD `20.521R`.
- Fold 2: n `264`; PF `1.14`; EXP `+0.061R`; DD `16.280R`.
- Fold 3: n `263`; PF `0.65`; EXP `-0.250R`; DD `72.847R`.

The third fold fails materially; chronological replication is absent.

## Side breadth

- LONG: n `400`; PF `1.06`; EXP `+0.025R`.
- SHORT: n `391`; PF `0.76`; EXP `-0.146R`.

The predeclared both-sides gate fails. Do not create a LONG-only bot from this result.

## Asset breadth

- BTC: n `131`; PF `0.42`; EXP `-0.522R`.
- ETH: n `115`; PF `0.79`; EXP `-0.104R`.
- SOL: n `127`; PF `1.13`; EXP `+0.062R`.
- XRP: n `86`; PF `0.89`; EXP `-0.053R`.
- ADA: n `97`; PF `1.12`; EXP `+0.050R`.
- AVAX: n `107`; PF `1.15`; EXP `+0.064R`.
- LINK: n `128`; PF `1.34`; EXP `+0.144R`.

Only four of seven assets are positive; the locked requirement was at least five. The CORE group BTC/ETH/SOL is negative (PF `0.69`, EXP `-0.195R`), while the expansion group is positive (PF `1.14`, EXP `+0.061R`). Universe breadth fails.

Positive net-R concentration:

- SOL `20.6%`
- ADA `12.8%`
- AVAX `18.1%`
- LINK `48.5%`

LINK exceeds the locked 40% concentration limit.

## Regime telemetry

- BEAR: PF `0.85`, EXP `-0.074R`, n `173`.
- TRANSITION: PF `1.03`, EXP `+0.013R`, n `230`.
- RANGE: PF `1.03`, EXP `+0.012R`, n `95`.
- BULL: PF `0.78`, EXP `-0.135R`, n `292`.

Regime is descriptive only. No regime gate may be derived.

## Secondary discovery-year breadth stress

Period: 2025-09-06T14:15:00Z through the fixed V1 cutoff 2026-09-06T14:15:00Z.

- Closed baskets: `779`.
- PF: `1.25`.
- EXP: `+0.107R`.
- DD: `17.963R`.

Six assets are positive; LINK is slightly negative. This confirms that the previously observed 4h strength extends across more assets in the same discovery year, but it is not independent confirmation and cannot override the failed unseen year.

## Predeclared gate result

Passed:

- aggregate sample;
- secondary breadth stress.

Failed:

- aggregate edge;
- all folds positive;
- both sides positive;
- five-of-seven asset breadth;
- core and expansion groups both non-negative;
- positive-R concentration.

## Decision

HISTORICAL REPLICATION FAIL. NO PROMOTION.

The V1 4h discovery is period-dependent under the unchanged V2 test. Do not remove BTC/ETH/XRP, select LONG-only, select expansion assets only, add regime gates, or tune pivots, ATR, FIB levels, weights, exits or costs.

The prospective holdout after 2026-09-06T14:15:00Z remains locked and unused. Given the failed disjoint replication, it should remain observational rather than become a promotion path. Any future FIB research requires a structurally new predeclared thesis, not optimization of V1/V2 failure cohorts.
