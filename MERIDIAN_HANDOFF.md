# MERIDIAN HANDOFF

## Frozen legacy dashboard
- Frozen branch: `archive/v7.65-dashboard-frozen-20260905`
- Frozen source commit: `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`
- Legacy dashboard remains recoverable and must not be mutated by v8 migration work.

## v8 customer dashboard
- Active branch: `v8/customer-dashboard`
- Draft PR: #43
- Current phase: v8.0 R2 — TRADE customer priority
- Goal: answer-first UX with details/research on demand.
- Target top-level navigation: CENTER / DEPOT / TRADE / PAPER / MORE.

## v8 R1 PAPER
- New module: `app-v8.0-paper-summary.js`
- PAPER overview is reduced to one customer answer card plus four compact bot rows.
- Rows show only: Trades, P&L, PF, DD and a compact status.
- A relative current leader is shown, but relative leadership does not equal promotion.
- Headline remains `NO MODEL QUALIFIES` unless the lightweight forward-quality check is met; even a `WATCH+` result is not a promotion.
- Promotion still requires OOS/walk-forward, adequate sample and explicit human approval.
- Full legacy PAPER remains available under `RESEARCH DETAILS` during migration.

## v8 R2 TRADE
- New module: `app-v8.0-trade-summary.js`.
- Default TRADE view answers one question first: do I need to act or reduce liquidation risk?
- Shows one overall risk state, the critical active bot, its liquidation buffer, one `NEXT ACTION`, and compact active-bot rows.
- Risk presentation reuses the existing v7.65 recovery ladder: below 8% = DANGER/recovery, 8–12% = WATCH/target SAFE, >=12% = SAFE.
- Full legacy Trade dashboard is hidden by default but remains available via `DETAILS ANZEIGEN` during migration.
- This module is presentation-only; it does not write positions, sizing, risk settings or orders.

## Safety
- Baseline 6.2 execution, sizing, risk and exits are unchanged.
- Paper/live execution unchanged; live trading remains disabled.
- `server.js` untouched.

## Next v8 implementation order
1. CENTER command view
2. DEPOT simplification
3. MORE consolidation
4. navigation reduction and final mobile polish

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- No research result auto-promotes into Paper/live execution.
