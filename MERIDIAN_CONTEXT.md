# MERIDIAN CONTEXT

## Product direction
MERIDIAN v8 is a customer-centered presentation redesign. The existing v7.65 dashboard is frozen and recoverable on `archive/v7.65-dashboard-frozen-20260905` from source commit `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`.

The v8 migration reduces cognitive load. Every top-level screen answers one customer question first; technical detail is secondary and research/diagnostics are tertiary.

Target top-level structure:
- CENTER — What do I need to know now?
- DEPOT — How is my portfolio developing?
- TRADE — Do I need to act or reduce risk?
- PAPER — Which bot is actually working?
- MORE — Deep detail, market, forecast, diagnostics and research.

## v8 checkpoints
Branch: `v8/customer-dashboard`
Draft PR: #43
Current build: `8.0-20260905-R3`

### R1 PAPER
`app-v8.0-paper-summary.js` provides one answer header plus four compact bot rows. Relative leadership is not promotion; promotion still requires adequate sample, positive OOS/walk-forward evidence, acceptable drawdown/stability and explicit human approval.

### R2 TRADE
`app-v8.0-trade-summary.js` reduces the default Trade view to liquidation-risk state, critical bot, buffer, one next action and compact active-bot rows. It reuses the v7.65 risk-presentation ladder and does not change execution.

### R3 CENTER
`app-v8.0-center-summary.js` turns the start dashboard into a command view. Default visible information is restricted to canonical portfolio total, current market regime, current liquidation-risk state, one next action and the best available scanner opportunity. Missing/uncertain scanner data is shown as `NO READY SIGNAL` rather than promoted into an action.

Legacy detail remains accessible on demand during the migration; no v7 dashboard capability is deleted yet.

## Safety invariants
- Baseline execution remains frozen at `6.2.0 / 6.2-SIGNAL-V1` unless explicitly approved.
- Paper only; live trading remains disabled.
- Research never silently changes execution.
- `server.js` must remain untouched by v8 presentation migration.
- Existing privacy/token protections stay intact.
- PostgreSQL remains canonical for private financial state and portfolio history.

## Portfolio history
v7.64 canonical portfolio history remains the data contract. Current value formula remains `totalUsd = spotUsd + tradingUsd`. Historical ranges only switch to canonical persisted history when their maturity/coverage rules are met; no fabricated Pionex backfill.

## Release authority
v8 release metadata must stay synchronized through `scripts/release-sync.mjs`: compatibility loader cache tag, manifest, package.json and package-lock.json must match `version.json` before Release Safety can pass.

## Research isolation
- v7.79 prospective holdout remains locked and prospective.
- v7.86 Retest/Hold Breakout V2 remains research-only.
- Meta Allocator work remains research-only until explicit promotion criteria are satisfied.

## Next v8 sequence
DEPOT simplification -> MORE consolidation -> final five-item navigation and mobile polish.
