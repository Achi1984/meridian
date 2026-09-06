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

## Current next steps
1. Run Release Safety on the exact R17 head and merge only if green.
2. Validate on iPhone that missing BTC-S30 Break-even / Investment render `—` rather than fake zeroes, while Current / Liq / Buffer remain unchanged.
3. Validate DEPOT 1D card shows concise `Canonical History` rather than a technical POSTGRES identifier.
4. If clean, freeze visual-density work and move to CENTER enrichment / functional product work.
5. Research remains isolated until evidence and explicit human approval justify promotion.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- No research result auto-promotes into Paper/live execution.
