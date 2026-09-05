# MERIDIAN HANDOFF

## Frozen / protected references
- Frozen legacy dashboard: `archive/v7.65-dashboard-frozen-20260905` at `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`.
- Baseline `6.2.0 / 6.2-SIGNAL-V1` remains frozen.
- Paper/live execution, sizing, risk, exits and ledgers remain unchanged; live trading remains disabled.
- `server.js` must remain untouched by v8 frontend work.
- v7.63/v7.64 canonical portfolio contracts remain authoritative.

## Current production main
- Compatibility v8 R11 remains the production UI entry.
- Clean rebuild R1-R5 was merged to `main` in PR #49 at merge commit `5540ff463546c96997814487329b4886ec2e3f78`, but only under `v8-clean/`; production `index.html` was not switched.
- PR #48 / R12 was closed unmerged and superseded after iPhone evidence showed legacy renderer/view collisions.

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
- MORE is the fifth real top-level root, not an overlay.
- Explicit child modules: MARKET / FORECAST / SCANNER / RESEARCH / DIAGNOSTICS / SETTINGS.
- MARKET, FORECAST and SCANNER derive only from the private dashboard contract.
- RESEARCH uses protected research analytics.
- DIAGNOSTICS uses `/gateway-health` plus private revision/schema metadata.
- SETTINGS owns the session-only read token.
- `more-runtime.js` hydrates only `#view-more` and never delegates to legacy navigation.

## Clean R6 — GitHub Pages API binding
- iPhone validation on `https://achi1984.github.io/meridian/v8-clean/` proved the clean five-view routing is stable, but all protected views returned HTTP 404 because the standalone shell used same-origin GitHub Pages as its API base.
- Fix branch: `fix/v8-clean-api-base-r6`.
- The test shell now sets `window.MERIDIAN_V8_CONFIG.apiBase` to the real Northflank gateway host `https://p01--achi-meridian--ttvk44grdlp7.code.run` before any clean modules load.
- The gateway already allows origin `https://achi1984.github.io`; no CORS widening is required.
- No read/write token is committed. The read token remains session-only and must be entered through MORE / SETTINGS.
- Cache tags bumped to `8.0-clean-r6` and a regression test locks the remote API-base contract.

## Current next steps
1. Run Release Safety on the exact R6 head and merge only if green.
2. Re-open the same GitHub Pages clean URL on iPhone; without a token the protected views should show LOCKED/401 semantics rather than HTTP 404, while `/gateway-health` should resolve through Northflank.
3. Enter the read token in MORE / SETTINGS and verify CENTER / DEPOT / TRADE / PAPER / MORE with real data.
4. Validate data consistency and mobile layout across all five views.
5. Only after explicit approval: deliberately migrate the production entry to `v8-clean/`.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- No research result auto-promotes into Paper/live execution.
