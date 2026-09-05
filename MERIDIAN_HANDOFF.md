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
- Goal: rebuild the v8 frontend from a clean shell instead of layering more wrappers over legacy v7 renderers.
- Entry: `v8-clean/index.html`.
- Architecture: `v8-clean/ARCHITECTURE.md`.
- The clean app does not load `app-v6.06.js`, old v7 UI wrappers, hidden legacy nav buttons or legacy renderer functions.

## Clean architecture
Five real root views only:
1. CENTER
2. DEPOT
3. TRADE
4. PAPER
5. MORE

One deterministic navigation owns those five roots. Data arrives only through explicit adapters. Details are child modules of the owning view, never fake top-level overlays. No legacy DOM is used as a data source.

## Clean R1 implemented
- Standalone mobile-first shell and status/header.
- Exactly one five-item bottom navigation.
- One explicit app-state route; no hidden-button delegation.
- Dedicated `v8-clean/data.js` adapter.
- CENTER R1 reads the protected `/api/private/dashboard` contract and derives portfolio/risk/next-action/opportunity without touching legacy renderers.
- Private read token prototype uses session storage key `meridian.v8.readToken`; no token or secret is committed.
- DEPOT / TRADE / PAPER / MORE are explicit placeholders for the next implementation stages.
- Regression test: `test/v8-clean-architecture.test.js`.

## Build order
1. Lock clean shell + CENTER contract.
2. DEPOT from canonical portfolio + canonical history.
3. TRADE from one bot-risk adapter.
4. PAPER from protected ledgers/research endpoints, still research-only.
5. MORE as explicit modules for Market / Forecast / Scanner / Research / Diagnostics / Settings.
6. Full iPhone verification of all five views.
7. Only after clean verification, deliberately switch the production entry to `v8-clean`.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- No research result auto-promotes into Paper/live execution.
