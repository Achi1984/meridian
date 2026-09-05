# MERIDIAN HANDOFF

## Frozen legacy dashboard
- Frozen branch: `archive/v7.65-dashboard-frozen-20260905`
- Frozen source commit: `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`
- Legacy dashboard remains recoverable and must not be mutated by v8 migration work.

## v8 customer dashboard
- Active branch: `v8/customer-dashboard`
- Draft PR: #43
- Current phase: v8.0 R4 — DEPOT customer summary
- Goal: answer-first UX with details/research on demand.
- Target top-level navigation: CENTER / DEPOT / TRADE / PAPER / MORE.

## v8 R1 PAPER
- New module: `app-v8.0-paper-summary.js`
- PAPER overview is reduced to one customer answer card plus four compact bot rows.
- Rows show only: Trades, P&L, PF, DD and a compact status.
- A relative current leader is shown, but relative leadership does not equal promotion.
- Full legacy PAPER remains available under `RESEARCH DETAILS` during migration.

## v8 R2 TRADE
- New module: `app-v8.0-trade-summary.js`.
- Default TRADE answers first whether liquidation risk requires action.
- Shows overall risk state, critical bot, liquidation buffer, one `NEXT ACTION`, and compact bot rows.
- Reuses the v7.65 recovery ladder: below 8% = DANGER, 8–12% = WATCH, >=12% = SAFE.
- Legacy Trade detail remains available via `DETAILS ANZEIGEN`.

## v8 R3 CENTER
- New module: `app-v8.0-center-summary.js`.
- CENTER is the customer start page and shows only canonical portfolio value, market regime, portfolio/bot risk, one next action, and the best available scanner opportunity.
- Opportunity output is conservative: if no ready/trade-quality scanner candidate is available, the UI shows `NO READY SIGNAL` rather than inventing a recommendation.
- Legacy dashboard detail remains available via `DETAILS ANZEIGEN` during migration.

## v8 R4 DEPOT
- New module: `app-v8.0-depot-summary.js`.
- Default DEPOT shows canonical total wealth, 1D performance, canonical-history sparkline, Spot vs Trading/Bots split, and four largest spot positions.
- It reads the existing v7.63/v7.64 canonical portfolio contract; it does not introduce a second portfolio total.
- If persisted history is not mature enough for a chart, it explicitly shows `KANONISCHE HISTORIE WIRD AUFGEBAUT`.
- Full legacy Depot remains available via `DETAILS ANZEIGEN`.

## Release safety note
- v8 preview metadata is synchronized through `scripts/release-sync.mjs` outputs: loader cache tag, manifest, package.json and package-lock.json.

## Safety
- Baseline 6.2 execution, sizing, risk and exits are unchanged.
- Paper/live execution unchanged; live trading remains disabled.
- `server.js` untouched.

## Next v8 implementation order
1. MORE consolidation
2. navigation reduction and final mobile polish

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- No research result auto-promotes into Paper/live execution.
