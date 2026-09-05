# MERIDIAN CONTEXT

## Product direction
MERIDIAN v8 is a customer-centered presentation redesign. The existing v7.65 dashboard is frozen and recoverable on `archive/v7.65-dashboard-frozen-20260905` from source commit `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`.

The v8 migration must reduce cognitive load. Every top-level screen answers one customer question first; technical detail is secondary and research/diagnostics are tertiary.

Target top-level structure:
- CENTER — What do I need to know now?
- DEPOT — How is my portfolio developing?
- TRADE — Do I need to act or reduce risk?
- PAPER — Which bot is actually working?
- MORE — Deep detail, market, forecast, diagnostics and research.

## v8 R1 PAPER checkpoint
Branch: `v8/customer-dashboard`
Draft PR: #43
Build: `8.0-20260905-R1`

PAPER now has a customer-first summary module (`app-v8.0-paper-summary.js`). On the overview it presents a single answer header, a relative current leader, and four compact rows for Baseline 6.2, Shadow V1, Challenger V2 and Regime V1. Visible metrics are restricted to Trades, P&L, PF and DD plus a status label. Full legacy PAPER content is retained behind `RESEARCH DETAILS` during migration.

Relative leadership is not promotion. Promotion still requires adequate sample, positive OOS/walk-forward evidence, acceptable portfolio drawdown/stability and explicit human approval. `WATCH+` is only a presentation-layer forward-quality label.

## Safety invariants
- Baseline execution remains frozen at `6.2.0 / 6.2-SIGNAL-V1` unless explicitly approved.
- Paper only; live trading remains disabled.
- Research never silently changes execution.
- `server.js` must remain untouched by v8 presentation migration.
- Existing privacy/token protections stay intact.
- PostgreSQL remains canonical for private financial state and portfolio history.

## Portfolio history
v7.64 canonical portfolio history remains the data contract. Current value formula remains `totalUsd = spotUsd + tradingUsd`. Historical ranges only switch to canonical persisted history when their maturity/coverage rules are met; no fabricated Pionex backfill.

## Research isolation
- v7.79 prospective holdout remains locked and prospective.
- v7.86 Retest/Hold Breakout V2 remains research-only.
- Meta Allocator work remains research-only until explicit promotion criteria are satisfied.

## Next v8 sequence
TRADE customer priority -> CENTER command view -> DEPOT simplification -> MORE consolidation -> final five-item navigation and mobile polish.
