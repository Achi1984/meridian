# MERIDIAN HANDOFF

## Frozen / protected references
- Frozen legacy dashboard: `archive/v7.65-dashboard-frozen-20260905` at `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`.
- Baseline `6.2.0 / 6.2-SIGNAL-V1` remains frozen.
- Paper/live execution, sizing, risk, exits and ledgers remain unchanged; live trading remains disabled.
- `server.js` must remain untouched by v8 frontend work.
- v7.63/v7.64 canonical portfolio contracts remain authoritative.

## Current production main
- The compatibility-based v8 line reached R11 and is still the current production UI on `main`.
- R11 merge commit: `3c2c88280a8fd75e6b8bb4d38648b792a45e0965`.
- Live iPhone verification proved the compatibility stack still allows legacy renderer/view ownership collisions.
- PR #48 / R12 was deliberately closed unmerged and marked superseded.

## Active v8 direction — CLEAN REBUILD
- Active branch: `v8-clean/rebuild`.
- Draft PR #49: `MERIDIAN v8 Clean Rebuild`.
- Entry: `v8-clean/index.html`.
- Architecture: `v8-clean/ARCHITECTURE.md`.
- Promotion rule: do not switch production entry until all five clean views are complete, regression-tested and visually verified on iPhone.

## Clean architecture invariants
- Exactly five real root views: CENTER / DEPOT / TRADE / PAPER / MORE.
- One deterministic navigation; no hidden legacy buttons.
- No legacy renderer/view ownership inside `v8-clean/`.
- One explicit data adapter layer using backend/API contracts; never scrape legacy DOM for values.
- No research auto-promotion.

## Clean R1 — Shell + CENTER
Implemented and saved:
- standalone mobile-first shell and status/header;
- one five-item bottom navigation and one explicit route state;
- dedicated `v8-clean/data.js` protected-data adapter;
- CENTER reads `/api/private/dashboard` and derives canonical total, market, risk, one next action and only READY/TRADE/ENTRY-quality opportunity;
- private read token uses session storage only; no token or secret committed.

## Clean R2 — DEPOT
Implemented and saved:
- native clean DEPOT view; no old Depot DOM or renderer involved;
- total is only `spotUsd + tradingUsd`;
- Spot is valued from private holdings and excludes Pionex holdings, matching canonical v7.63 behavior;
- Trading/Bots uses canonical Pionex equity with compatible private fallback fields;
- 1D chart reads only `/api/private/portfolio-history?range=1d`;
- 1D performance is withheld until at least 16.8h canonical history coverage; no fabricated history;
- cashflow-adjusted performance is used only when both endpoints can be represented on that basis, otherwise raw canonical total;
- Spot vs Trading/Bots split and Top 4 exposures use the same valuation basis;
- BETH is displayed as ETH exposure and OKSOL as SOL exposure for aggregation/display only.

## Next implementation order
1. TRADE — direct private risk/bot adapter, critical bot, buffer and one action.
2. PAPER — direct protected paper/research analytics, no execution effect.
3. MORE — explicit Market / Forecast / Scanner / Research / Diagnostics / Settings modules.
4. Full iPhone verification of all five clean views.
5. Only after explicit approval: production entry migration from compatibility v8 to `v8-clean/`.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- No research result auto-promotes into Paper/live execution.
