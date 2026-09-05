# MERIDIAN HANDOFF

## Frozen legacy dashboard
- Frozen branch: `archive/v7.65-dashboard-frozen-20260905`
- Frozen source commit: `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`
- Legacy dashboard remains recoverable and must not be mutated by v8 migration work.

## v8 customer dashboard
- Active branch: `v8/customer-dashboard`
- Draft PR: #43
- Current phase: v8.0 R1 — PAPER customer summary
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
- Baseline 6.2 execution, sizing, risk and exits are unchanged.
- `server.js` untouched.

## Next v8 implementation order
1. TRADE customer priority screen
2. CENTER command view
3. DEPOT simplification
4. MORE consolidation
5. navigation reduction and final mobile polish

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- No research result auto-promotes into Paper/live execution.
