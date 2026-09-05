# MERIDIAN HANDOFF

## Frozen legacy dashboard
- Frozen branch: `archive/v7.65-dashboard-frozen-20260905`
- Frozen source commit: `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`
- Legacy dashboard remains recoverable and must not be mutated by v8 migration work.

## v8 customer dashboard
- Active branch: `v8/customer-dashboard`
- Draft PR: #43
- Current phase: v8.0 R6 — final five-item navigation + mobile polish
- Goal: answer-first UX with details/research on demand.
- Final top-level navigation: CENTER / DEPOT / TRADE / PAPER / MORE.

## v8 R1 PAPER
- New module: `app-v8.0-paper-summary.js`
- PAPER overview is reduced to one customer answer card plus four compact bot rows.
- Rows show only: Trades, P&L, PF, DD and a compact status.
- Relative leadership does not equal promotion.
- Full legacy PAPER remains under `RESEARCH DETAILS`.

## v8 R2 TRADE
- New module: `app-v8.0-trade-summary.js`.
- Default TRADE answers first whether liquidation risk requires action.
- Shows overall risk state, critical bot, liquidation buffer, one `NEXT ACTION`, and compact bot rows.
- Reuses the v7.65 recovery ladder.
- Legacy Trade detail remains under `DETAILS ANZEIGEN`.

## v8 R3 CENTER
- New module: `app-v8.0-center-summary.js`.
- CENTER is the customer start page and shows canonical portfolio value, market regime, portfolio/bot risk, one next action, and best available scanner opportunity.
- Missing/uncertain scanner evidence is shown as `NO READY SIGNAL`.

## v8 R4 DEPOT
- New module: `app-v8.0-depot-summary.js`.
- Default DEPOT shows canonical total wealth, 1D performance, canonical-history sparkline, Spot vs Trading/Bots split, and four largest spot positions.
- It reuses the v7.63/v7.64 canonical portfolio contract and does not introduce a second total.
- Inadequate history is labeled as still building rather than fabricated.

## v8 R5 MORE
- New module: `app-v8.0-more-hub.js`.
- One secondary MORE entry point groups Market, Forecast, Scanner, Research and Diagnostics.
- MORE routes into existing detailed/legacy views instead of duplicating decision logic or financial data.
- Runtime status can be surfaced as context, but MORE does not produce a new trading verdict.

## v8 R6 NAVIGATION / MOBILE
- New module: `app-v8.0-navigation.js`.
- Final bottom navigation contains exactly five items: CENTER / DEPOT / TRADE / PAPER / MORE.
- CENTER, DEPOT, TRADE and PAPER delegate to the existing view handlers so navigation does not fork application state.
- MORE opens the R5 hub.
- Legacy bottom navigation remains in the frozen implementation but is hidden at presentation level after the v8 nav is ready.
- iPhone bottom safe area, customer banner spacing, card width and small-screen nav density are normalized.
- Added `test/v8-navigation.test.js` to assert the five-item contract and presentation-only boundary.

## Release safety note
- v8 preview metadata must stay synchronized through `scripts/release-sync.mjs` outputs: loader cache tag, manifest, package.json and package-lock.json.

## Safety
- Baseline 6.2 execution, sizing, risk and exits are unchanged.
- Paper/live execution unchanged; live trading remains disabled.
- `server.js` untouched.

## Next v8 implementation order
1. Review R6 on real iPhone screenshots across CENTER / DEPOT / TRADE / PAPER / MORE.
2. Correct any display/navigation regression without changing execution.
3. Human review before any merge to `main`.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- No research result auto-promotes into Paper/live execution.
