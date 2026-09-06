# MERIDIAN HANDOFF

## Frozen / protected references
- Frozen legacy dashboard: `archive/v7.65-dashboard-frozen-20260905` at `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`.
- Pre-cutover production rollback branch: `archive/v8-r11-production-pre-cutover` at `bdfc64f8cf588d5b4c3d6a3f4daebf019b8e7749`.
- Baseline `6.2.0 / 6.2-SIGNAL-V1` remains frozen.
- Paper/live execution, sizing, risk, exits and ledgers remain unchanged; live trading remains disabled.
- `server.js` remains untouched by v8 frontend work.
- v7.63/v7.64 canonical portfolio contracts remain authoritative.

## Production status — v8 LIVE
- Production root redirects deterministically to `./v8-clean/`, preserving query string and hash.
- Previous production root remains preserved on `archive/v8-r11-production-pre-cutover` for rollback.
- iPhone validation completed across CENTER / DEPOT / TRADE / PAPER / MORE with no legacy renderer/view collision.
- Persistent read-token state remains valid on production.

## Clean architecture invariants
- Exactly five real root views: CENTER / DEPOT / TRADE / PAPER / MORE.
- One deterministic navigation; no hidden legacy buttons.
- No legacy renderer/view ownership inside `v8-clean/`.
- Explicit read-only adapters use backend/API contracts; never scrape legacy DOM for values.
- No research auto-promotion.

## Production validation snapshot — 2026-09-05
- CENTER: total `$27.313`; Market `RISK-ON / SHORT-SQUEEZE`; Risk `WATCH`; BTC-S30 buffer `8.99%`; next action targets SAFE `>=12%`; Best Opportunity `NO READY SIGNAL`.
- DEPOT: total `$27.313` = Spot `$26.417` + Trading/Bots `$896`; canonical history rendered; top positions coherent.
- TRADE: BTC-S30 critical bot `8.99%`; HBAR-L3 `27.33%`; XRP-L5 `40.65%`; three active bots; Trading Equity `$896`.
- PAPER: `RESEARCH ONLY`; Baseline remains reference; no automatic promotion/execution impact.
- MORE: Market/Forecast/Research/Diagnostics/Settings render inside the real MORE view; token remains connected.

## Clean R1–R11 summary
- R1 CENTER: native five-view shell, private dashboard adapter.
- R2 DEPOT: canonical `spot + trading`, private history only.
- R3 TRADE: lowest-buffer bot drives DANGER/WATCH/SAFE and one next action.
- R4 PAPER: protected research board, no auto-promotion.
- R5 MORE: real fifth view, no legacy overlay.
- R6 Pages API binding to Northflank gateway.
- R7 persistent local read-token + canonical spot fallback repair.
- R8 mobile visual polish.
- R9 production identity (`v8.0 · PROD`).
- R10 DEPOT ranges `4H · 1T · 1W` plus HIGH/LOW.
- R11 chart mobile polish.

## Clean R12 — TRADE detail upgrade
- PR #58 merged after Release Safety run #704; main merge commit `41c13f864fd0bc9804d614c72941caad94f9e226`.
- Read-only disclosure cards for each active bot.
- Critical bot opens by default; other bots remain collapsed.
- Detail fields: Current Price, Break-even, Liquidation Price, PnL, Investment and Buffer.
- Fixed ladder: `DANGER <8%`, `WATCH 8–12%`, `SAFE >=12%`.
- Explicit SAFE path shows remaining percentage points to 12% or already SAFE.
- On read failure the canonical compact TRADE card remains intact.

## Clean R13 — TRADE data hygiene
- PR #59 merged; main merge commit `a405cd9b024b29f9a42fbcb26107a50400a7c10d`.
- Non-positive Break-even, Investment, Liquidation and Current prices render unavailable instead of fake `$0` values.
- PnL zero is accepted only when an actual PnL field is explicitly present on the protected bot object.
- No backend contract change, no invented values, no execution writes.

## Clean R14–R16 — production layout refinement
- R14 removes the redundant `MERIDIAN v8 · CUSTOMER VIEW` banner to reclaim vertical space.
- R15 establishes the approved CENTER mobile spacing rhythm; CENTER is now the visual reference and remains unchanged in R16.
- R16 (PR #62) is a presentation-only consistency pass across DEPOT, TRADE, PAPER and MORE.
- DEPOT gives the portfolio chart more width and clamps the long canonical-history source label so it no longer dominates the left 1D card.
- TRADE keeps every read-only bot detail while reducing vertical travel inside expanded cards.
- PAPER compresses model rows, opportunity-cost tiles and audit flags for faster scanning while preserving all research telemetry.
- MORE adopts the same tighter mobile card cadence.
- Release Safety passed before R16 merge; main merge commit `4c3d194e4322e4a45073054228b7785781bdb50a`.

## Clean R17 — TRADE placeholder correctness + DEPOT label cleanup
- PR #63 merged after Release Safety run #725; main merge commit `f1418d950eba90644b0db80ed00fdba5580073c3`.
- Root cause of visible `$0,0000` / `$0` placeholders: JavaScript formatters converted `null` to numeric zero via `Number(null)` even though normalization had correctly rejected the backend placeholder.
- R17 formatters reject `null`, `undefined` and empty-string values before numeric formatting, so unavailable Break-even / Investment / PnL fields render `—`.
- Explicit real zero PnL remains valid only when an actual PnL field exists on the protected bot object.
- DEPOT's technical `POSTGRES_*` history source identifier is presentation-only shortened to `Canonical History`; no history values or basis logic change.
- No backend contract, server.js, Baseline 6.2, Paper/live execution, sizing, risk, margin or order changes.

## Research v7.87 — Paperbot Deep Dive telemetry
- PR #64 merged; main merge commit `cfe357ef4c076c053603539c1b2218a5c116df44`.
- Adds research-only Baseline vs Challenger V2 cohort telemetry by SIDE / REGIME / SYMBOL plus descriptive temporal slices and linked opportunity cost.
- Sample adequacy is explicit (`n >= 8`).
- Known Challenger Baseline-READY dependency remains flagged; no promotion.

## Clean R18 — PAPER Cohort Board
- PR #65 merged to main at `d3fc44c7174f432c5e53680a52409d6e2882dfaa`.
- Read-only module `v8-clean/paper-cohort-r18.js` reads protected `/api/research-analytics` and surfaces Challenger V2 cohort evidence directly inside PAPER.
- Compact sections: SIDE / REGIME / ASSET, with Challenger expectancy, PF, delta expectancy and sample adequacy.
- No private values are committed; the board renders only runtime protected telemetry.
- No server.js, Baseline, execution, Pionex or research-promotion changes.

## Clean R18 — near-live Spot portfolio valuation
- PR #70 fixes a separate stale-price issue discovered from CENTER remaining at `$27.313` despite the existing 30-second visible-view refresh.
- Root cause: `/api/private/dashboard` returns persisted PostgreSQL private state and its `livePrices` field can itself be stale; repeated UI fetches therefore re-read the same prices.
- The browser now overlays fresh public Binance spot prices on protected dashboard GET responses before the existing canonical `spot + trading` valuation runs.
- Privacy rule: the adapter downloads the full public ticker table; held symbols, quantities and venues are never sent to Binance as holding-specific query parameters.
- Wrapped exposure aliases are preserved for pricing (`BETH -> ETH`, `OKSOL -> SOL`); USD/USDT/USDC/FDUSD/DAI are valued at 1 USD. Unsupported assets keep the existing holding/snapshot fallback rather than receiving invented prices.
- If the public market feed is unavailable, persisted `livePrices` are cleared for that read so stale prices are not mislabeled as live.
- Spot valuation is near-live at the existing 30-second visible-view cadence. Pionex/Trading equity remains the protected snapshot/manual value; the aggregate total is therefore not claimed to be fully exchange-live.
- R18 is read-only frontend valuation: no private write, no holdings mutation, no `server.js`, no Pionex-bot, no Baseline or execution change.

## Current next steps
1. Validate R18 near-live Spot valuation on iPhone after production deployment; compare CENTER/DEPOT across at least two 30-second refreshes.
2. Continue Hybrid Alpha v7.96 as isolated RESEARCH ONLY; evaluate 30/60/90d and chronological folds before any further hypothesis.
3. Do not tune factors, drop assets, or hard-gate regimes after seeing the v7.94/v7.95 evidence.
4. Pionex bots remain unchanged unless explicitly re-opened by the user.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- v7.89–v7.96 Hybrid Alpha programme remains isolated research; no execution connection.
- No research result auto-promotes into Paper/live execution.


## SSOT UPDATE — Research closure 2026-09-06

This section supersedes earlier research next-step text where it conflicts.

- Hybrid Alpha v7.97 is complete on Draft PR #73 / head `6905f7d2bc2386f0b5390acaff121718a52ce065`. Low-liquidity `<0.50` risk attenuation by fixed `0.60` improves 30/60/90d aggregate PF, expectancy and DD without changing trade count, but 90d Fold 2 remains negative (PF `0.63`, EXP `-0.782R`). NO PROMOTION; stop threshold search.
- FIB V1 Draft PR #74: 1h primary and 15m fail; 4h discovery positive but not confirmatory. Head `c3cc6dd38ab5bdb54abbee4863e4e9d444cdb12f`.
- FIB V2 Draft PR #75: unchanged 4h unseen-year replication fails (n `791`, PF `0.89`, EXP `-0.059R`, DD `77.372R`). Head `b8fc8edf66394f4a2ab63b48f511e3a37a80b00d`.
- FIB V3 Draft PR #76: Daily anchors with 4h execution are materially stronger across three historical years. Primary n `190`, PF `1.34`, EXP `+0.150R`, DD `6.609R`; both sides and all folds positive; secondary yearly PF `1.38 / 1.43`. Gate still fails because SOL supplies `59.2%` of positive primary net R. Head `7b15a8b37431af317bc5d8b50ef960024b353982`. NO PROMOTION and no SOL-specific reaction.
- FIB V3 prospective holdout is locked on Draft PR #77 / head `3a5650a2c5b14276969bf5ef9c0dc818204f8d09`. Start `2026-09-06T14:15Z`; formal evaluation only after >=180 days and >=100 closed baskets; earliest `2027-03-05T14:15Z`. Initial status `NOT_ELIGIBLE`; zero prospective trades; six pre-cutoff carry-over baskets excluded.
- All FIB and Hybrid work remains isolated from production, Paper/live execution and Pionex.
- R18 physical iPhone validation across two ~30-second cycles remains pending and must not be marked complete without user observation.
- Next research must be structurally new and leakage-free; no additional threshold, pivot, asset, side, regime or FIB-level tuning.
