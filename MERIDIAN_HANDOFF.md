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
- Branch: `fix/v8-trade-hygiene-depot-label-r17`.
- Root cause of visible `$0,0000` / `$0` placeholders: JavaScript formatters converted `null` to numeric zero via `Number(null)` even though normalization had correctly rejected the backend placeholder.
- R17 formatters now reject `null`, `undefined` and empty-string values before numeric formatting, so unavailable Break-even / Investment / PnL fields render `—`.
- Explicit real zero PnL remains valid only when an actual PnL field exists on the protected bot object.
- DEPOT's technical `POSTGRES_*` history source identifier is presentation-only shortened to `Canonical History`; no history values or basis logic change.
- Cache tags move TRADE detail and label cleanup to `8.0-r17`.
- No backend contract, server.js, Baseline 6.2, Paper/live execution, sizing, risk, margin or order changes.

## Paper / Hybrid Alpha research — 2026-09-06
- Paper Cohort Board R18 is on production main and shows Challenger V2 deep-dive cohorts.
- Challenger V2 remains strongest legacy Paper control but is not promotable: overall PF ~0.98 / EXP ~-$1; SHORT is positive (n=19, PF 1.11, EXP +$6), LONG sample is low/negative; RANGE is promising but n=7 only; ETHUSDT is strongest adequate asset cohort (n=9, PF 1.38, EXP +$20).
- Hybrid Alpha V1 v7.89 combines trend, momentum, relative strength, mean reversion, optional carry/order-flow, regime context, volatility and liquidity as soft evidence. Missing evidence is renormalized, not hard-blocked.
- v7.90 adds deterministic public-candle evidence/backtest harness with 15m/1h/4h decision-time trend, 30/60/90d windows, 4h/12h/24h horizons, scaled costs and chronological folds.
- 4h Hybrid Alpha is rejected as currently negative. 12h is mixed. 24h is the leading horizon.
- v7.91 prior-only reliability router was tested and rejected; it did not improve robustness sufficiently.
- v7.92 Macro Trend Overlay improves 24h PF/DD across 30/60/90d but leaves one negative 90d chronological fold.
- v7.93 failure-window drill-down found the strongest recurring asymmetry: `LONG×TRANSITION` positive in all three 24h folds, `SHORT×TRANSITION` negative in all three.
- v7.93 predeclared one soft change only: multiply `TRANSITION×SHORT` research risk by `0.60`; no trade gate, no LONG boost, no asset rule.
- v7.93 deterministic evidence (run #35, artifact `9986661279`, digest `sha256:61429aac07a1fb44c9810893be67a1c1717b736334d1e970319a57d0a7ec023e`) improves 24h 30/60/90d PF, expectancy and drawdown versus v7.92 with unchanged trade counts.
- 24h v7.93: 30d PF 2.11 / EXP +2.350R / DD 46.753R; 60d PF 1.56 / EXP +1.130R / DD 63.729R; 90d PF 1.59 / EXP +1.006R / DD 50.362R.
- 24h/90d folds v7.93: PF 1.70 / 0.98 / 2.09 and EXP +0.776R / -0.044R / +2.286R. The middle fold is almost neutral but still negative.
- Decision: **NO PROMOTION**. Do not tune the 0.60 factor to force the middle fold above PF 1.00; freeze v7.93 parameters and validate prospectively / on broader assets first.

## Current next steps
1. Keep Pionex bots unchanged unless the user explicitly reopens that topic.
2. Freeze v7.93 parameters; no direct threshold tuning from the current 90d sample.
3. Run broader-asset robustness for v7.93 and then a prospective/later-data holdout with the exact frozen parameters.
4. Add funding/carry and true order-flow only when leakage-safe historical decision-time data is available; do not fabricate missing features.
5. Research remains isolated until evidence and explicit human approval justify promotion.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- Hybrid Alpha v7.89–v7.93 remains on draft PR #67 / research branch; no execution hooks.
- No research result auto-promotes into Paper/live execution.
