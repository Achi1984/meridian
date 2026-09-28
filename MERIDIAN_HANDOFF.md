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


## R18 iPhone validation — completed

Production screenshots supplied by the user at 20:18 show CENTER `$27,846` and DEPOT `$27,867`, versus the previously suspicious static value near `$27,313`. DEPOT reconciles as Spot `$26,972` + Trading/Bots `$896` ≈ `$27,868`, with one-dollar display rounding. The `$21` CENTER/DEPOT delta is only about `0.075%` and is plausible across independently timed refreshes.

Decision: R18 near-live spot valuation is validated on iPhone. Do not investigate backend execution or Pionex. Trading/Bots remains snapshot/manual, so the aggregate must not be described as fully exchange-live.

---

## SSOT UPDATE — 2026-09-07 · R19 / Elliott research closure

This update supersedes earlier current-status and next-step text where it conflicts.

- **Main:** `08686d71c62b1407c1be89c72387a0c137c15e53` after PR #91 (R19 Research Control Board), Release Safety #844 green on exact head.
- **R19:** 15/15 local architecture/UI tests passed. UI explicitly shows candidate states plus `EXECUTION NONE` and `AUTO-PROMOTION OFF`.
- **Hybrid v7.102:** rejected; PR #87; final head `11ac5349bc7d0d2de66233f954c72fed5d5d193f`; Evidence #2 run `34140663280`; artifact `10025793601`; Release Safety #834.
- **Elliott Wave-3 V1:** frozen near-pass, not promoted. 144 trades, PF 1.21, +0.088R expectancy, DD 8.814R; failed sample, breadth and concentration gates. PR #88; final head `a1283b68419bdb2a5d22ff2b49fff5b4109354db`; Evidence #2 run `34143541691`; artifact `10026843740`; Release Safety #837.
- **Elliott Wave-3 V2 unchanged historical replication:** 101 trades, PF 1.39, +0.158R expectancy, DD 9.514R; all five assets positive; only sample gate failed. Frozen confirmation, not a holdout and not promoted. PR #89; final head `465555c16bc0d64f69ba3afe1f29fcf3fe73c6ea`; Evidence #2 run `34145957770`; artifact `10027682729`; Release Safety #840.
- **Elliott Wave-5 V1:** rejected for insufficient opportunity count and unstable/weak side/window evidence. PR #90; final head `5f30cce5fc64778c83fcb03e33edc39dc3003f0c`; Evidence #2 run `34147347479`; artifact `10028158787`; Release Safety #843.
- **Guardrails unchanged:** Baseline 6.2 frozen, PAPER only, live off, no paper/live connection, `server.js` untouched, Pionex untouched.
- **Next:** physical-iPhone PAPER validation of R19 when deployed; keep Wave-3 and FIB V3 frozen; no immediate Elliott ABC/variant tuning series. Any new bot starts from a distinct predeclared hypothesis, gates, assets, windows and folds.


## Agent workflow handoff

Before starting new work, read `MERIDIAN_AGENT_WORKFLOW.md` together with CONTEXT / DECISIONS / HANDOFF.

Operational defaults:
- quality over speed
- user communicates only with Main Agent
- specialist -> independent reviewer -> max 3 revision loops -> Main Agent integration
- no merge without required GREEN LIGHT / available quality gates
- autonomous PR/merge remains allowed after gates pass
- iPhone review is mandatory for UI changes
- trading logic gets technical + methodology review
- live financial data uses a second source when technically possible
- if the runtime cannot instantiate the requested agent/model roles, do not fabricate them; disclose the actual verification level


## v9 r17 — Data Truth

r16 was physically validated on the user's iPhone. The next production checkpoint is r17 Data Truth.

Required invariants:
- tracked/reference bot rows remain visible for context but are non-actionable unless confidently live-matched
- Profit Lock requires live bot match + live PnL
- Risk Priority / NEXT ACTION cannot be driven by reference-only PnL
- exposure figures use known live capital only and disclose incompleteness
- market prices are cross-checked OKX + Binance when available
- null/blank remains unavailable, never zero
- negative money formatting uses absolute magnitude
- header reports MIXED when the page combines live market data with snapshots/reference data
- Research label distinguishes Profit Lock Lab engine r15 from the current app release


## v9 r18 — Source Freshness / Feed Coverage

r17 iPhone acceptance exposed the next blocker: only 2/25 tracked bots are present/matched in the private bot data while public price coverage is broad.

r18 requirements:
- private dashboard bot data is labelled snapshot/private, never assumed live
- `pionexRisk.updatedAt` or `snapshotAt` is required for trusted freshness
- action freshness window is 15 minutes
- generic `privateUpdatedAt` is not enough for trading actions
- stale snapshots produce SYNC/STALE and cannot drive Profit Lock, NEXT ACTION, Risk Priority or bot exposure
- Data Truth shows raw API rows, matched rows, unmatched rows, snapshot age, actionable rows, two-source price coverage
- if raw rows == matched rows but tracked > matched, backend coverage is the bottleneck; if raw rows > matched, matcher coverage is the bottleneck
- LIQ labels are explicitly scoped to liquidation status
- future authenticated Pionex risk patches are server-stamped when no section timestamp is provided


## v9 r19 — OKX Futures DCA migration

Newest authoritative OKX state is the user screenshot from 25.09.2026 06:22:
- previous INJ/XRP manual futures positions were closed
- active OKX items are two LONG 3x Futures DCA bots: INJ and XRP
- both use 65.32 USDC investment
- INJ: last 7.977, avg 7.908, TP 8.28, total PnL +0.1729 (+0.26%), safety 0/7
- XRP: last 1.5291, avg 1.5296, TP 1.5924, total PnL -0.014 (-0.03%), safety 0/9
- no estimated liquidation price is shown for either DCA bot; never infer one
- display these as OKX DCA snapshot rows, not old manual positions
- cross-check only market price through public feeds; account-specific bot fields remain screenshot-source
- known OKX bot equity is ~130.80 USDC, not guaranteed total account equity


## v9 r20 — Pionex Bot API read-only refresh

Root cause from r19 acceptance: private Pionex risk data was 23 days stale because no runtime producer refreshed it.

New module: `pionex-bot-auto-sync.js`
- starts from `scripts/start-gateway.mjs`
- read-only `GET /api/v1/bot/orders`
- default 5-minute cadence
- paginated running-order fetch
- supports futures_grid and future_hedge_grid rows
- normalizes range, leverage, liquidation, TP, USD investment only when trustworthy, and optional PnL fields
- never calls create/adjust/reduce/cancel
- successful sync stamps `pionexRisk.updatedAt/snapshotAt`
- failed sync preserves prior bot timestamp and rows while writing diagnostic status only
- missing credentials produce one startup diagnostic, no repeated private-state churn

Expected deployment secrets:
- `PIONEX_BOT_READ_API_KEY`
- `PIONEX_BOT_READ_API_SECRET`
Recommended Pionex permission: Bot reading only.

Frontend r20 Data Truth now shows PIONEX API, BOT ROWS, BOT MATCH, SNAPSHOT PNL, BOT SNAPSHOT AGE, ACTIONABLE, 2-SOURCE PRICE, UNMATCHED, BOT API, BOT SOURCE and PORTFOLIO source.

Important: until read-only Pionex credentials are configured in the runtime, r20 should show BOT API = OFF and continue refusing trading actions from stale bot data.


## v10 r22 — Deep-audit integrity follow-up

- Continues the v10 deep audit after r21 without changing trading rules, paper-bot parameters, execution, Pionex orders, or research promotion logic.
- Header live-status classes now have explicit semantic colors for SAFE / WATCH / DANGER / MUTED.
- MARKET two-source coverage counts only the currently rendered market universe, preventing transient numerator/denominator drift after tracked-asset changes.
- Forced BOTS refresh preserves the user's Asset Watch details open/closed state.
- Forced SCANNER refresh preserves expanded fresh/stale detail groups.
- CONFLICT/neutral scanner explanations use both long-adverse and short-adverse reason sets instead of presenting only one side.
- Requires Release Safety plus targeted r22 regression coverage before merge.


## v10 r23 — Portfolio source integrity

- COMMAND Pionex equity now follows the canonical private portfolio contract: `portfolio.pionexEquityUsd`, then the Pionex row in `portfolio.manualVenueBalances`.
- The old 80% magnitude heuristic is removed. Bot/COIN-M partial equity can no longer be promoted to an account total because it happens to be numerically close to the snapshot.
- Pionex source is explicitly a private portfolio snapshot, with provenance and timestamp carried through the model.
- If canonical private Pionex equity is missing, MERIDIAN fails closed to the existing screenshot fallback rather than guessing from `pionexRisk` or generic `pionex` fields.
- No trading logic, bot matching, execution, orders or research rules changed.


## v10 r24 — Portfolio null integrity

- Canonical holding valuation no longer lets `null` or blank quantity coerce to numeric zero.
- Missing quantity now falls through to explicit stored USD value (`value`, `valueUsd`, `usdValue`) rather than silently erasing it.
- An explicit quantity of zero remains zero and correctly overrides stale stored value.
- This enforces the existing Data Truth invariant: missing numeric data is unavailable, never zero.
- No trading logic, execution, bot state or research logic changed.


## v10 r25 — COMMAND portfolio SSOT reconciliation

- Continues the deep audit after r24.
- COMMAND headline now uses the same current canonical basis as DEPOT: Spot holdings + Pionex equity.
- Public Spot valuation reuses the privacy-safe all-ticker Binance overlay; no holding-specific symbol/quantity query is sent.
- If public Spot pricing fails, stale live prices are cleared and COMMAND falls back to a labelled private canonical snapshot instead of claiming fresh valuation.
- PostgreSQL portfolio history is diagnostic/historical only; current-vs-history delta is surfaced but history does not overwrite current valuation.
- OKX Futures DCA screenshot equity remains visible as reference and is explicitly outside the canonical total.
- Removed the COMMAND total dependency on the hard-coded Ledger snapshot and OKX DCA subtotal.
- No trading rules, Paper-bot parameters, execution logic, Pionex mutations or research promotion changed.


## v10 r26 — Portfolio provenance / coverage integrity

- Deep-audit continuation after r25.
- Portfolio math is unchanged: canonical total remains Spot + Pionex.
- Adds explicit Spot live-price coverage metadata (holding count, requested, resolved, feed freshness, complete/partial).
- COMMAND no longer calls the whole portfolio “CANONICAL CURRENT”.
- Complete Spot overlay + canonical private Pionex snapshot is labelled CANONICAL MIXED.
- Partial Spot coverage or screenshot Pionex fallback is labelled CANONICAL PARTIAL.
- No fresh Spot overlay is labelled PRIVATE CANONICAL SNAPSHOT.
- Spot resolved/requested coverage is shown in COMMAND; Pionex remains explicitly snapshot provenance.
- OKX DCA remains reference-only outside the canonical total.
- No trading-rule, Paper-bot, signal, leverage, execution or research-promotion change.


## v10 r27 — Pionex portfolio equity age provenance

- Continues the deep audit after runtime-verified r26.
- Adds a missing-aware, future-aware timestamp helper for snapshot provenance.
- COMMAND now shows the age of the selected Pionex portfolio-equity snapshot when an explicit equity timestamp exists.
- Missing source timestamp is shown as NO TIMESTAMP; a timestamp >30 seconds in the future is shown as FUTURE TIMESTAMP.
- KNOWN_SEED provenance is shown as STATIC SEED.
- Generic private dashboard update time is never substituted for Pionex equity update time.
- No arbitrary Pionex-equity stale cutoff is introduced; this release improves transparency only.
- Portfolio math remains Spot + Pionex and r26 coverage classification remains unchanged.
- No trading-rule, Paper-bot, signal, leverage, execution, Pionex mutation or research-promotion change.


## v10 r28 — Bot feed coverage SSOT

- Continues the deep audit after runtime-verified r27.
- Adds one shared botFeedCoverage helper in the v9 data engine.
- Coverage denominator is now the current supported private API rows, not the full historical Asset Watch/reference catalog.
- A fresh 3/3 supported-row match can be FRESH even if the reference catalog contains additional older entries.
- Any unmatched or ambiguous supported API row keeps coverage incomplete.
- v9 DATA TRUTH, v9 header/source state and v10 DATA GUARD now consume the same coverage contract.
- DATA TRUTH BOT MATCH now shows matched / supported live rows.
- No bot-matching thresholds, trading rules, Paper-bot parameters, risk calculations, leverage, execution or Pionex mutation paths changed.


## v10 r29 — Decision readiness SSOT

- Continues the deep audit after runtime-verified r28.
- Adds shared safetyReadyBot and decisionReadyBot helpers to the v9 data engine.
- DECISION READY requires: fresh trusted bot snapshot, safe match, usable Liq/safety data, PnL and fresh per-asset market intel.
- DATA TRUTH ACTIONABLE now uses the same decision-ready helper instead of the older weaker Match + PnL + Bot-Freshness check.
- v10 syncHealth consumes the same safety/decision helpers instead of re-deriving them independently.
- SAFETY READY remains intentionally available without PnL or fresh market intel when liquidation data is usable.
- No signal formula, risk threshold, Profit Lock rule, NEXT ACTION priority, Paper-bot parameter, leverage, execution or Pionex mutation path changed.


## v10 r30 — Bot timestamp provenance integrity

- Continues the deep audit after runtime-verified r29.
- Centralizes bot snapshot time state in botFeedTimeState.
- Bot freshness keeps the exact existing rules: trusted timestamp, no more than 15 minutes old, and no more than 5 minutes in the future.
- Untrusted fallback timestamps are displayed as NO TRUSTED TIMESTAMP instead of a misleading young age.
- Trusted timestamps beyond the existing +5 minute tolerance are displayed as FUTURE TIMESTAMP instead of <1 MIN.
- DATA TRUTH, stale Profit-Lock/action explanations and v10 DATA GUARD now use the same timestamp label.
- No trading-rule, matching, PnL, risk, Paper-bot, leverage, execution or Pionex mutation change.


## v10 r31 — Decision completeness SSOT

- Continues the deep audit after runtime-verified r30.
- Adds decisionComplete = matched > 0 + complete match coverage + decisionReady === matched.
- DATA GUARD shows DECISION READY only when every matched supported live row is decision-ready; otherwise nonzero readiness is PARTIAL READY.
- Header BOT READY and DATA GUARD now consume the same decisionComplete state.
- PROFIT WATCH / LOCK counts now use shared decisionReadyBot rows, preventing safety-incomplete rows from entering action summaries.
- No Profit Lock formula, signal/risk threshold, NEXT ACTION priority, Paper-bot parameter, leverage, execution or Pionex mutation change.


## v10 r32 — Header tone semantics

- Continues the deep audit after runtime-verified r31.
- Normalizes active v10 system-header tones to safe / watch / danger / muted.
- MARKET STALE now emits watch directly instead of legacy mixed.
- BOT REF now emits muted directly instead of legacy reference.
- COMMAND source strip and sticky header consume the readiness tone without local translation.
- Initial v10 shell statuses start as muted, matching the semantic CSS contract before runtime data arrives.
- Readiness labels and conditions are unchanged.
- No trading rules, signals, risk thresholds, Profit Lock, Paper-bot parameters, leverage, execution or Pionex mutation paths changed.


## v10 r33 — Exposure completeness SSOT

- Continues the deep audit after runtime-verified r32.
- Adds shared exposureIntegrity in the v9 data engine for global and per-asset exposure completeness.
- Current unmatched supported live rows now count as unknown exposure instead of disappearing from completeness checks.
- A same-asset unmatched live row makes that asset's hedge percentage unavailable.
- The existing hedgeLow threshold remains <15%; r33 only blocks that test when its denominator is incomplete.
- Global SHORT/LONG coverage becomes unavailable when any current live exposure row is unmatched or any matched row lacks USD investment.
- Active v10 pair cards and COMMAND live overview reuse the shared completeness helper and show PARTIAL rather than COMPLETE on incomplete exposure.
- Known matched exposure values remain identifiable as known values; no missing quantity is invented.
- No trading thresholds, Profit Lock percentages, Paper-bot parameters, leverage, execution or Pionex mutation paths changed.


## v10 r34 — Portfolio regime basis provenance

- Continues the deep audit after runtime-verified r33.
- Keeps the existing portfolioRegime/riskV2 scoring formulas exactly unchanged.
- Adds exposureComplete and COMPLETE/PARTIAL_EXPOSURE provenance to portfolioRegime.
- When exposure is incomplete, the retained COMMAND portfolio-regime pill is visibly labelled PARTIAL BASIS.
- The legacy regime strip also discloses PARTIAL BASIS and an incomplete exposure-basis note.
- Concentration thresholds remain 10/15/25%; avg-risk penalties remain 4/6; regime cutoffs remain +/-2.
- Active v10 NEXT ACTION remains independent of portfolioRegime.
- No trading rules, Profit Lock percentages, hedge threshold, Paper-bot parameters, leverage, execution or Pionex mutation paths changed.


## v10 r35 — Pair PnL completeness

- Continues the deep audit after runtime-verified r34.
- Adds shared pnlIntegrity(symbol) for asset-level PnL aggregation provenance.
- PAIR PNL USD is shown only when the bot snapshot is fresh, all current rows for that asset are matched, and every matched row has live PnL.
- Same-asset unmatched rows now make the aggregate unavailable instead of disappearing from the sum.
- Unmatched rows from other assets do not invalidate a complete asset pair.
- Incomplete cards explicitly show PnL-Summe unvollständig.
- Individual bot PnL logic, Decision Ready and all Profit Lock thresholds remain unchanged.
- No hedge threshold, market signal, Paper-bot parameter, leverage, execution or Pionex mutation path changed.


## v10 r36 — Pair PnL USD value integrity

- Continues the deep audit after runtime-verified r35.
- Tightens shared pnlIntegrity so Pair PnL requires a non-null USD value from botPnlUsd on every matched row.
- A percent-only PnL row without raw USD PnL or usable USD investment no longer counts as complete for PAIR PNL USD.
- Existing percent + investUsd derivation and validated raw USD PnL remain accepted.
- Active pair cards also verify every aggregate value is non-null before reducing the sum, preventing JavaScript null-to-zero coercion.
- Same-asset unmatched-row scoping from r35 is unchanged.
- Decision Ready and Profit Lock still use the existing generic live-PnL/percentage contract; their thresholds and behavior are unchanged.
- No hedge threshold, market signal, Paper-bot parameter, leverage, execution or Pionex mutation path changed.


## v10 r37 — Global NEXT ACTION coverage guard

- Continues the deep audit after runtime-verified r36.
- Global NEXT ACTION now requires complete supported bot coverage before emitting non-safety momentum/profit/HOLD guidance.
- Any unmatched or ambiguous supported current row changes non-safety NEXT ACTION to KEINE AKTION · DATEN PRÜFEN and shows matched/supported coverage.
- LIQ_RISK and PROTECTION_RISK remain ahead of the coverage guard so known liquidation/SL safety is never hidden.
- Existing DATA_STALE / MARKET_STALE / UNVERIFIED blocking remains unchanged.
- Pair-status formulas, risk/signal ranks, Profit Lock formulas and thresholds, hedge threshold, Paper-bot parameters, leverage and execution are unchanged.


## v10 r38 — Per-asset match completeness guard

- Continues the deep audit after runtime-verified r37.
- An asset pair can no longer show PROFIT LOCK / momentum RISK REVIEW / WATCH PROFIT / HOLD when another current live row for the same asset is unmatched or ambiguous.
- Same-asset incompleteness is labelled UNVERIFIED with an asset-scoped row count and ambiguous count when applicable.
- Unmatched rows for other assets do not invalidate the current pair.
- LIQ_RISK and explicit SL/protection risk stay ahead of this guard so known safety issues remain visible.
- r37 global NEXT ACTION coverage guard remains unchanged.
- No matcher threshold, signal/risk rank, Profit Lock formula, hedge threshold, Paper-bot parameter, leverage, execution or Pionex mutation path changed.


## Agent/release coordinator hardening

- Release ownership is now serialized through the Main Agent; subagents may not independently bump terminalBuild, open competing release PRs or merge to main.
- Every resumed/interrupted workflow begins with a live repo/PR/workflow preflight before any write.
- Terminal release branches must be exactly main+1 and use matching v10-rNN branch/build identity.
- The oldest open PR for a target revision owns that revision lease; later contenders fail Release Safety.
- Any branch commit invalidates earlier gate results; merges require green gates on the exact current head SHA.
- Immediately before merge, main/base/head/behind status/competing PRs/gates are re-read. If main advanced, the stale release is not merged and its scoped work moves to the next free revision.
- A post-main workflow closes stale open release PRs automatically.
- Superseded PR #204 was closed rather than reusing the already-consumed r37 release number.
- No trading/Paper/risk/leverage/execution logic is part of this process hardening.


## v10 r39 — OKX DCA reference equity provenance

- Continues the deep audit after runtime-verified r38 and the single-writer release coordinator hardening.
- Adds a complete/partial snapshot contract for OKX Futures DCA reference equity.
- Exact OKX DCA REF equity requires explicit investUsd and totalPnlUsd on every DCA row.
- Missing fields no longer enter the reference sum as implicit zero; explicit zero PnL remains valid.
- The stale manual OKX fallback is no longer used when the DCA snapshot is incomplete.
- COMMAND labels OKX DCA REF as REFERENCE COMPLETE or REFERENCE PARTIAL and reports missing investment/PnL counts when partial.
- OKX remains outside the canonical Spot + Pionex portfolio total.
- r37 global NEXT ACTION and r38 per-asset match-completeness guards are preserved unchanged.
- No trading rules, Profit Lock thresholds, hedge threshold, market signals, Paper-bot parameters, leverage, execution or Pionex mutation paths changed.


## v10 r40 — Unmatched live-row diagnostics

- Continues the deep audit after runtime-verified r39.
- Adds one shared privacy-safe unmatched-row details renderer to active v10 COMMAND and BOTS surfaces.
- Each unresolved live row identifies asset, side, leverage, NO CONFIDENT MATCH vs AMBIGUOUS MATCH, and only PnL/USD-capital availability flags.
- Bot IDs and private numeric values are intentionally not rendered in this diagnostic.
- BOTS preserves the unmatched-details disclosure state across forced refreshes.
- r37 global NEXT ACTION coverage guard and r38 per-asset match-completeness guard remain unchanged.
- No matcher thresholds, Profit Lock rules, hedge threshold, market signals, Paper-bot parameters, leverage, execution or Pionex mutation paths changed.
## v10 r41 — Read-only Pionex bot detail hydration

- Continues after merged r40 unmatched-row diagnostics.
- Keeps the existing Pionex Bot API list read, but no longer assumes list rows contain complete futures-grid risk data.
- Hydrates every supported active futures_grid / future_hedge_grid row through GET /api/v1/bot/orders/futuresGrid/order.
- Fails closed on missing/duplicate IDs, ID mismatch, incomplete details, truncated pagination or any detail-read error.
- Publishes listRows, supportedRows, detailRows and detailsComplete in the fresh Pionex risk snapshot.
- DATA TRUTH adds BOT DETAIL x/y separately from BOT MATCH.
- All Pionex calls remain GET-only; no create/adjust/reduce/cancel/transfer path is added.
- Existing r37 global coverage guard, r38 per-asset guard and r40 privacy-safe unmatched diagnostics remain unchanged.
- No matching threshold, Profit Lock rule, hedge threshold, market signal, portfolio math, Paper-bot parameter, leverage or execution behavior changes.

## Current Pionex API configuration status — 28.09.2026

- The r41 read-only Pionex Bot API integration is implemented, but the user has confirmed that no Pionex API credentials have been created/configured yet.
- Until PIONEX_BOT_READ_API_KEY and PIONEX_BOT_READ_API_SECRET exist in the runtime secret store, MERIDIAN must treat Pionex Bot API as OFF / not configured.
- Do not claim live Pionex bot synchronization from GitHub connectivity alone. GitHub repository access and Pionex exchange credentials are separate concerns.
- Pionex credentials must never be committed to the repository. When created, use Bot-reading/read-only permissions and inject them only through the deployment/runtime secret store.
## v10 r42 — Pionex read-only account/futures integration

- Adds a shared GET-only HMAC client for Pionex private reads.
- Adds read-only Spot trading-account balance ingestion.
- Adds read-only Futures balance ingestion.
- Adds read-only current Futures position ingestion including side, size, mark/entry, unrealized PnL, margin, leverage and liquidation when Pionex returns them.
- Adds ACCOUNT API and FUT POS diagnostics to Data Truth, separate from BOT API/BOT DETAIL.
- Adds gateway readiness for normal Pionex reading vs Bot reading.
- Missing credentials stay OFF; read failures preserve the previous snapshot as stale.
- Adds PIONEX_READONLY_SETUP.md with least-privilege setup.
- No Pionex write endpoint, trading permission, transfer permission, leverage mutation or margin mutation is introduced.
- No trading rule, Profit Lock threshold, hedge rule, Paper-bot parameter, leverage or execution behavior changes.
## v10 r43 — Pionex Bot API live-read hotfix

- Explicitly filters running Bot API list reads to `futures_grid` and `future_hedge_grid`.
- Keeps the existing read-only GET detail hydration.
- Preserves `EMPTY_GUARD` when a previous live bot snapshot exists and the new supported result is zero.
- Adds privacy-safe aggregate list diagnostics for guard troubleshooting.
- During `EMPTY_GUARD`, UI row counts now show the current filtered API list result instead of the stale preserved snapshot count.
- No Pionex trading, bot trading, transfer, mutation, PaperBot, leverage, signal or execution behavior changes.
## v10 r44 — Pionex signed-query compatibility hotfix

- Replaces one repeated-array Bot API request with two scalar signed GET requests.
- Reads `futures_grid` and `future_hedge_grid` separately, then combines results before existing detail hydration.
- Keeps all existing privacy-safe diagnostics and `EMPTY_GUARD` behavior.
- No API credential changes required.
- No trading, Bot trading, transfer, PaperBot, leverage, signal or execution changes.
## v10 r45 — Pionex unfiltered bot discovery

- Reads all running bot orders with `GET /api/v1/bot/orders?status=running`.
- Omits `buOrderTypes` from the signed request.
- Applies the Futures allowlist locally: `futures_grid` and `future_hedge_grid`.
- Persists aggregate type/status counts so unsupported or legacy Pionex bot types are visible without exposing private row details.
- Keeps detail hydration and `EMPTY_GUARD` fail-closed behavior.
- No Pionex trading, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock or execution changes.
## v10 r46 — Pionex read-only account position layer

- Keeps Bot API discovery and EMPTY_GUARD unchanged.
- Adds a separate POSITION API layer sourced from GET /uapi/v1/account/positions.
- Shows account-position asset, side, leverage, average price, mark price, liquidation price, size and unrealized PnL when fresh.
- Explicitly labels positions as not bot-matched; no Grid/TP/Profit-Lock action is derived from them.
- Adds account-position assets to the market-data universe.
- Gateway health exposes aggregate pionexAccountStatus, pionexFuturesPositionCount, pionexBotStatus and pionexBotListRows only.
- No API writes, trading permissions, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock or execution changes.
## v10 r47 — Pionex Wallet Bot Account discovery

- Adds GET /api/v1/wallet/balancesFull to the existing read-only account sync.
- Wallet read is fail-soft; a Wallet permission/API failure does not break the working Futures POSITION API layer.
- Normalizes Bot Account and Trader Account category structure.
- BOTS UI shows BOT ACCOUNT API / WALLET DISCOVERY with category count, reported entry count, loaded list count and returned field names.
- Public gateway health exposes only aggregate/category structure metadata, not balances, position values or bot IDs.
- No automatic Wallet-to-bot mapping yet.
- No API writes, trading permissions, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock or execution changes.
## v10 r48 — Wallet Bot detail hydration discovery

- Keeps r47 Wallet/Bot Account discovery and r46 Futures POSITION API intact.
- Privately normalizes TRADING_BOT and FUTURES_LITE wallet entries.
- Probes each unique buOrderId with GET /api/v1/bot/orders/futuresGrid/order at safe pacing.
- Stores successful detail payloads privately for later validation; individual failures are fail-soft.
- Public diagnostics expose only aggregate buOrderType/cateType counts and detail success/failure counts.
- Recognizes FUTURE_GRID_COIN_MARGINED as the documented Coin-M Futures Grid cateType.
- Does not promote probe results into bot decision readiness.
- No trading, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock or execution changes.
## v10 r49 — validated Wallet live-bot fallback

- Builds `pionexAccount.walletBotRisk` from Wallet `futures_grid` entries whose direct Futures Grid detail reads succeeded.
- Requires all supported Wallet futures_grid candidates to detail-hydrate, normalize and have unique IDs before marking the Wallet risk snapshot complete.
- Selects fresh classic Bot API first; otherwise selects fresh complete Wallet detail risk.
- Enforces the existing 15-minute bot-feed freshness policy.
- Keeps the 3 observed `futures_lite` entries outside the supported live-bot layer.
- UI distinguishes active BOT SOURCE from the separately reported classic Bot API status.
- Public gateway health exposes aggregate readiness/counts only; private bot IDs/details stay private.
- No trading, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock, hedge-threshold or execution changes.
## v10 r50 — Wallet risk normalization diagnostics

- r49 live evidence: Wallet discovery LIVE, 32/35 detail probes, but BOT SOURCE remains classic EMPTY_GUARD.
- Adds aggregate diagnostics around buildWalletBotRisk normalization.
- Shows RISK NORMALIZED n/m, reject reasons, status/trend counts, missing base count and returned detail field names.
- Public health receives aggregate diagnostics only; no IDs, balances, prices, investments or PnL values.
- Wallet source selection remains unchanged: it still requires fresh, complete Wallet risk.
- No trading, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock, hedge-threshold or execution changes.
## v10 r51 — Pionex enum whitespace normalization

- Live r50 evidence: DETAIL PROBE 32/35; RISK NORMALIZED 0/32; status running 32; trends long 5 / short 27; missing base 0; reject reason normalizer_rejected 32.
- Root-cause mismatch: diagnostic normalization trimmed enum strings, production allowlist checks did not.
- r51 trims surrounding whitespace for buOrderType, status and trend before the existing allowlist checks.
- Supported bot types/statuses/directions are otherwise unchanged.
- No trading, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock, hedge-threshold or execution changes.
## v10 r52 — exact Pionex normalizer stage diagnostics

- Live r51 evidence: DETAIL PROBE 32/35, RISK NORMALIZED 0/32 after a fresh sync.
- Adds shared inspectPionexBotOrder() used by the production normalizer and diagnostics.
- Shows TYPE / STATUS / SYMBOL / SIDE / ALL pass counts.
- Shows only coarse BASE/QUOTE classes: asset, stable_quote, missing, unresolved.
- No bot IDs, symbols, prices, balances, investment values or PnL exposed publicly.
- No source-selection, matching, trading, PaperBot, Profit Lock, hedge or execution changes.
## Streaming-safe execution hardening — 28.09.2026

A repeated ChatGPT UI streaming interruption was traced to orchestration pressure rather than lost repository state: long sequences of serial GitHub calls, repeated workflow polling, and unnecessarily large source/log payloads increased the chance of the response stream disconnecting while GitHub mutations had already completed.

Durable mitigation:
- `node scripts/stream-safe-preflight.mjs` returns a compact resume checkpoint with main SHA, terminal build, current branch/head, PR state/distance and gate summaries.
- Interactive work is limited to at most 3 consecutive tool calls before a user-visible checkpoint.
- Same-status workflow polling is limited to 2 consecutive polls.
- Tool output is normally capped below 8 KB and large logs/diffs/files must be reduced to relevant windows.
- Every mutation is checkpointed by a durable SHA/PR/run/deploy identifier.
- After interruption, repo state is authoritative and no write is replayed before preflight.

This is infrastructure/process-only. Terminal build, trading logic, PaperBots and execution behavior are unchanged.
## v10 r53 — inverse Coin-M symbol resolution

- Live r52 diagnostics: TYPE 32/32, STATUS 32/32, SIDE 32/32, SYMBOL 0/32; BASE stable_quote 32; QUOTE asset 32.
- Adds a strict inverse-only symbol fallback: stable base + asset quote -> symbol from quote.
- Normal/non-inverse bots still resolve symbol from base.
- Existing live-bot completeness, freshness, reference matching and action guards remain unchanged.
- No trading, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock, hedge-threshold or execution changes.
## v10 r54 — preserve Wallet cateType

- Live r53 evidence: DETAIL PROBE 32/35, TYPE 32/32, STATUS 32/32, SIDE 32/32, SYMBOL 0/32, BASE stable_quote 32, QUOTE asset 32.
- Root cause in code: Wallet rows carried cateType=inverse, but buildWalletBotRisk omitted cateType from the internal summary.
- r54 carries Wallet cateType into the summary and preserves it across detail merge.
- The inverse quote->asset symbol fallback remains restricted to explicit inverse semantics.
- No trading, Bot trading, transfer, matching threshold, PaperBot, Profit Lock, hedge-threshold, leverage or execution changes.
## v10 r55 — live/reference match-stage diagnostics

- Live r54 evidence: BOT SOURCE WALLET DETAIL; RISK NORMALIZED 32/32; NORMALIZER ALL 32/32; SUPPORTED MATCH 0/32.
- Adds aggregate diagnostics for ASSET / SIDE / LEVERAGE / STRUCTURE / STRONG / ACCEPTED matching stages.
- Adds aggregate LIVE vs REFERENCE side distributions and field availability for leverage/lower/upper/BE/LIQ/TP.
- No bot IDs or private numeric position values are exposed by the new diagnostic.
- No matcher threshold, ambiguity rule, trading, PaperBot, Profit Lock, hedge or execution change.
## v10 r56 — economic-side diagnostics

- Input evidence from r55: ASSET 32/32; SIDE 24/32; LEVERAGE 10/32; STRUCTURE 2/32; STRONG 0; ACCEPTED 0.
- Live declared side distribution: SHORT 27 / LONG 5.
- Reference distribution: SHORT 10 / LONG 24.
- Live matching fields present on all 32 rows: leverage/lower/upper/BE/LIQ/TP.
- Adds aggregate ECON side from liquidation geometry, TREND↔ECON agreement/opposition, asset-only leverage/structure pass and ECON-side-to-reference pass counts.
- Diagnostic only: no side remap, threshold change, action unlock, PaperBot change or execution change.
## v10 r57 — API-native bot identity

- Initial 28.09.2026 BTC spot-check screenshots showed LONG bots, but current inventory can contain both LONG and SHORT bots; do not carry forward any global "no shorts" assumption.
- The DOT SHORT sample from 18:58 was closed immediately afterwards and is historical only. Use the fresher SUI pair from 19:05–19:06 as the current manual side-validation sample: SUI COIN-M SHORT 4x creation 1.0043, break-even 1.0252, liquidation 1.5636; SUI COIN-M LONG 4x creation 1.2463, break-even 1.2218, liquidation 0.6859. These screenshots are validation samples only, not a canonical bot inventory.
- The 27.09 Asset-Watch snapshot is stale and is no longer suitable as an identity gate.
- Complete fresh Wallet-detail rows with unique bot IDs can now identify themselves directly.
- Inverse Coin-M side is economically validated from direct positionOpenPrice/liquidationPrice when clear; original trend remains diagnostic.
- Asset Watch remains historical/reference only.
- No trading, transfer, PaperBot, Profit Lock, hedge-threshold, leverage or execution change.
- Missing PnL, capital, risk or fresh market data still blocks Decision Ready.


## v10 r58 — Coin-M reciprocal convention fix

- r57 live identity path is healthy: Wallet Detail is selected and 32/32 supported futures-grid rows normalize.
- Remaining defect isolated from live screenshots: quote-inverse Coin-M detail prices were still rendered in reciprocal API units, producing values such as BTC BE 0.000011999 / TP 0.000010526 and an inverted-looking LONG/SHORT distribution.
- r58 converts quote-inverse entry/range/LIQ/TP/SL into asset/USD before side/risk use, flips pair-direction trend into the asset perspective, and keeps raw trend only as diagnostics.
- Current SUI LONG 4x and SHORT 4x screenshots plus the BTC reciprocal sample are regression fixtures.
- Safety remains fail-closed: missing PnL or unverified LIQ still blocks Decision Ready; no execution or trading behavior is enabled.


## v10 r59 — post-r58 live acceptance

- r58 side/price normalization is live-confirmed: current SUI renders 1 LONG + 1 SHORT and the stop-loss/liquidation relationship is coherent.
- Wallet Detail currently supplies 28/28 API-native supported bot identities from 31 wallet source rows; Decision Ready remains 0 because PnL is still unavailable, which is intentional fail-closed behavior.
- r59 removes legacy COMMAND repaint duplicates, relabels leveraged exposure as NOTIONAL, and promotes fresh `pionexAccount.wallet.totalInUsdt` ahead of screenshot equity fallback.
- Do not infer total-profit figures from wallet `profit` until its unit/semantics are independently validated.


## v10 r60 — live acceptance follow-up

- r59 confirmed correct SUI 1 LONG + 1 SHORT, API NATIVE 28/28 and notional labels.
- Remaining stale-view defects are handled in r60: COMMAND rebuilds from current state on data sync; tab clicks force the v10 renderer after legacy navigation.
- Wallet diagnostics now expose TOTAL / BOT ACCOUNT / TRADER ACCOUNT plus wallet age to determine why canonical Pionex equity may still be unavailable.
- Missing totals remain `—`; no wallet profit field is treated as PnL.
- Execution and decision gates remain unchanged and fail-closed.


## v10 r61 — live acceptance follow-up

- r60 COMMAND refresh is confirmed live.
- BOTS still showed legacy v9 rendering after tab navigation; r61 adds a semantic `meridian:view` event from the source renderer and forces v10 decoration from it.
- Pionex portfolio source now prefers a fresh Wallet API total over an untimestamped/older private snapshot; newer fresh private snapshots remain valid.
- Market technical freshness remains independently fail-closed and is not changed by this patch.
- Execution impact remains false.


## v10 r62 — mobile stale-cache hardening

- Production r61 was verified by runtime smoke before the user still observed r60, proving the issue was a stale mobile/PWA shell rather than deployment state.
- r62 updates the PWA launch target, links the manifest, adds a no-store version probe/self-reload to the v10 shell, and extends runtime smoke to guard these invariants.
- Existing clients already stuck on a pre-r62 shell require one cache-busted open. Once r62 is running, later stale builds can self-heal.
- Execution impact remains false.
