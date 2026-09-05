# MERIDIAN CONTEXT

## Product direction
MERIDIAN v8 is a customer-centered presentation redesign. The existing v7.65 dashboard is frozen and recoverable on `archive/v7.65-dashboard-frozen-20260905` from source commit `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`.

The v8 migration reduces cognitive load. Every top-level screen answers one customer question first; technical detail is secondary and research/diagnostics are tertiary.

Final top-level structure:
- CENTER — What do I need to know now?
- DEPOT — How is my portfolio developing?
- TRADE — Do I need to act or reduce risk?
- PAPER — Which bot is actually working?
- MORE — Deep detail, market, forecast, diagnostics and research.

## v8 checkpoints
Branch: `v8/customer-dashboard`
PR: #43 — ready for review / pre-merge approved by user
Current build: `8.0-20260905-R7`

### R1 PAPER
`app-v8.0-paper-summary.js` provides one answer header plus four compact bot rows. Relative leadership is not promotion; promotion still requires adequate sample, positive OOS/walk-forward evidence, acceptable drawdown/stability and explicit human approval.

### R2 TRADE
`app-v8.0-trade-summary.js` reduces the default Trade view to liquidation-risk state, critical bot, buffer, one next action and compact active-bot rows. It reuses the v7.65 risk-presentation ladder and does not change execution.

### R3 CENTER
`app-v8.0-center-summary.js` turns the start dashboard into a command view. Default visible information is restricted to canonical portfolio total, current market regime, current liquidation-risk state, one next action and the best available scanner opportunity. R7 hardening requires that this opportunity must be READY/TRADE/ENTRY-quality; otherwise the UI shows `NO READY SIGNAL`.

### R4 DEPOT
`app-v8.0-depot-summary.js` reduces the default Depot view to canonical total wealth, 1D performance, a canonical-history sparkline when enough persisted history exists, Spot vs Trading/Bots split, and the four largest spot positions. If the history is not mature, it explicitly shows that history is still building instead of fabricating a chart. Full legacy Depot remains accessible via `DETAILS ANZEIGEN`.

### R5 MORE
`app-v8.0-more-hub.js` consolidates secondary depth behind one entry point. MORE contains Market, Forecast, Scanner, Research and Diagnostics routes. It does not create new trading decisions or duplicate data; it routes into existing detailed views.

### R6 NAVIGATION / MOBILE
`app-v8.0-navigation.js` installs the final five-item bottom navigation: CENTER / DEPOT / TRADE / PAPER / MORE. It delegates the first four routes to existing handlers and opens MORE for secondary tools. The legacy bottom navigation is hidden only at presentation level after the v8 navigation is ready. iPhone safe-area spacing, compact customer-banner spacing and card widths are normalized.

### R7 PRE-MERGE HARDENING
A final code review found and fixed two UI-contract regressions before merge:
- CENTER no longer falls back to a non-ready scanner candidate when no actionable signal exists.
- MORE can still invoke preserved Market/Forecast legacy handlers after R6 hides the legacy bottom navigation; Market/Forecast are represented as MORE in the five-item active state.
Regression coverage was added to `test/v8-navigation.test.js`.

Legacy detail remains accessible on demand; no v7 capability is deleted by the v8 presentation layer.

## Canonical environment
- Canonical repository: `Achi1984/meridian`; deployment source is `main`.
- Northflank deploys from canonical `main`.
- Baseline engine remains `6.2.0`; frozen ruleset `6.2-SIGNAL-V1`.
- Private portfolio/trading state remains PostgreSQL-backed.
- Read APIs remain bearer-protected through `server-gateway.js`.
- `MERIDIAN_READ_TOKEN` remains protected by startup hashing/removal of plaintext runtime exposure.
- `server.js` contains the paper-only safety invariant and must remain untouched by this v8 UI migration.

## Safety invariants
Baseline 6.2 execution is a frozen reference.
- Baseline entry, sizing, risk, exit and ledger behavior remain frozen unless explicitly approved.
- Paper only; live trading remains disabled.
- Research never silently changes execution.
- Existing privacy/token protections stay intact.
- PostgreSQL remains canonical for private financial state and portfolio history.

## Portfolio history
v7.64 canonical portfolio history remains the data contract. Current value formula remains `totalUsd = spotUsd + tradingUsd`. Pionex is not double-counted as Spot. Historical ranges only switch to canonical persisted history when maturity/coverage rules are met; no fabricated Pionex backfill.

## Research principles
- More evidence does not automatically become more hard entry gates.
- Evaluate performance together with trade frequency/opportunity cost.
- Judge LONG vs SHORT in regime context.
- Track avoided losers and missed winners.
- Full-window attribution is not OOS proof.
- No research bot auto-promotes; promotion requires adequate common-window sample, positive OOS expectancy/PF, acceptable drawdown, useful coverage/stability and explicit human approval.
- v7.79 prospective holdout remains locked and prospective.
- v7.86 Retest/Hold Breakout V2 remains research-only.
- Meta Allocator work remains research-only until explicit promotion criteria are satisfied.

## Release authority
v8 release metadata must stay synchronized through `scripts/release-sync.mjs`: compatibility loader cache tag, manifest, package.json/package-lock version contract and `version.json` must agree before Release Safety passes.

## Save-progress rule
Every meaningful implementation or research checkpoint must be committed to GitHub. Do not leave substantive MERIDIAN work only in chat.

## Next step
Require green Release Safety and Portfolio Contract on the exact R7 head, then merge PR #43 to `main` only under the user's explicit approval already given in this conversation.
