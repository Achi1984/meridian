# MERIDIAN HANDOFF

## Frozen / protected references
- Frozen legacy dashboard: `archive/v7.65-dashboard-frozen-20260905` at `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`.
- Baseline `6.2.0 / 6.2-SIGNAL-V1` remains frozen.
- Paper/live execution, sizing, risk, exits and ledgers remain unchanged; live trading remains disabled.
- `server.js` must remain untouched by v8 frontend work.
- v7.63/v7.64 canonical portfolio contracts remain authoritative.

## Current production main
- Compatibility v8 R11 remains the production UI on `main` at `3c2c88280a8fd75e6b8bb4d38648b792a45e0965`.
- PR #48 / R12 was closed unmerged and superseded after iPhone evidence showed legacy renderer/view collisions.

## Active v8 direction — CLEAN REBUILD
- Active branch: `v8-clean/rebuild`.
- Draft PR #49: `MERIDIAN v8 Clean Rebuild`.
- Entry: `v8-clean/index.html`.
- Architecture: `v8-clean/ARCHITECTURE.md`.
- Promotion rule: no production-entry switch until all five clean views pass regression checks and are visually verified on iPhone.

## Clean architecture invariants
- Exactly five real root views: CENTER / DEPOT / TRADE / PAPER / MORE.
- One deterministic navigation; no hidden legacy buttons.
- No legacy renderer/view ownership inside `v8-clean/`.
- Explicit read-only adapters use backend/API contracts; never scrape legacy DOM for values.
- No research auto-promotion.

## Clean R1 — CENTER
- Native mobile-first shell and one five-item bottom navigation.
- CENTER reads `/api/private/dashboard` for canonical total, market, risk, one next action and only READY/TRADE/ENTRY-quality opportunity.
- Session-only read token; no committed secret.

## Clean R2 — DEPOT
- Native clean DEPOT; total only `spotUsd + tradingUsd`.
- Spot excludes Pionex holdings; Trading/Bots uses canonical Pionex equity.
- 1D chart only from `/api/private/portfolio-history?range=1d` and performance withheld until >=16.8h canonical coverage.
- No fabricated history; Top 4 exposures use the same valuation basis.

## Clean R3 — TRADE
- Native clean TRADE from private `pionexRisk.bots` only.
- Critical bot = lowest finite liquidation buffer.
- Customer ladder preserved: `<8% DANGER`, `8–<12% WATCH`, `>=12% SAFE`.
- Exactly one next action; active bots sorted by buffer.
- Read-only presentation; no order, margin, stop, sizing or execution changes.

## Clean R4 — PAPER
- Native clean PAPER from protected `/api/research-analytics` and `/api/activity-summary`.
- Baseline / Shadow V1 / Challenger V2 / Regime V1 shown on one research board.
- Full-ledger metrics and common-window activity are distinct.
- Challenger opportunity cost and audit caveats remain visible.
- Baseline is reference; no winner label or auto-promotion.

## Clean R5 — MORE
Implemented and saved:
- MORE is the fifth real top-level root, not an overlay;
- explicit child modules: MARKET / FORECAST / SCANNER / RESEARCH / DIAGNOSTICS / SETTINGS;
- MARKET, FORECAST and SCANNER derive only from the private dashboard contract;
- RESEARCH uses protected research analytics;
- DIAGNOSTICS uses `/gateway-health` plus private revision/schema metadata;
- SETTINGS owns the session-only read token;
- `more-runtime.js` hydrates only `#view-more` and never delegates to legacy navigation;
- malformed prototype `data-route` attributes were corrected before iPhone validation.

## Current next steps
1. Wait for Release Safety on the exact R5 head and fix any regression failure before visual testing.
2. Expose the clean entry for controlled iPhone validation without replacing production R11 yet.
3. Verify all five tabs: route/content ownership, no legacy bleed-through, data consistency, safe-area/mobile layout, token reconnect and refresh behavior.
4. Only after explicit approval: deliberately migrate the production entry to `v8-clean/`.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- No research result auto-promotes into Paper/live execution.
