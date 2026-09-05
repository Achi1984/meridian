# MERIDIAN HANDOFF

## Frozen / protected references
- Frozen legacy dashboard: `archive/v7.65-dashboard-frozen-20260905` at `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`.
- Pre-cutover production rollback branch: `archive/v8-r11-production-pre-cutover` at `bdfc64f8cf588d5b4c3d6a3f4daebf019b8e7749`.
- Baseline `6.2.0 / 6.2-SIGNAL-V1` remains frozen.
- Paper/live execution, sizing, risk, exits and ledgers remain unchanged; live trading remains disabled.
- `server.js` remains untouched by v8 frontend work.
- v7.63/v7.64 canonical portfolio contracts remain authoritative.

## Production status — v8 LIVE
- Production cutover PR #54 merged to `main` at `b075cff295311932fb777a61b329638d6ef5f2f1` after exact-head Release Safety run #688 succeeded.
- Production root redirects deterministically to `./v8-clean/`, preserving query string and hash.
- The previous R11 production root remains preserved on `archive/v8-r11-production-pre-cutover` for rollback.
- Post-cutover iPhone validation on the production root completed successfully across CENTER / DEPOT / TRADE / PAPER / MORE.
- No legacy renderer/view collision was observed after production cutover.
- Persistent read-token state remained valid on production.

## Clean architecture invariants
- Exactly five real root views: CENTER / DEPOT / TRADE / PAPER / MORE.
- One deterministic navigation; no hidden legacy buttons.
- No legacy renderer/view ownership inside `v8-clean/`.
- Explicit read-only adapters use backend/API contracts; never scrape legacy DOM for values.
- No research auto-promotion.

## Production validation snapshot — 2026-09-05
- CENTER: total `$27.313`; Market `RISK-ON / SHORT-SQUEEZE`; Risk `WATCH`; BTC-S30 buffer `8.99%`; next action targets SAFE `>=12%`; Best Opportunity `NO READY SIGNAL`.
- DEPOT: total `$27.313` = Spot `$26.417` + Trading/Bots `$896`; 1D `+1.72% / +$463`; canonical PostgreSQL history rendered; top positions remained coherent.
- TRADE: BTC-S30 critical bot `8.99%`; HBAR-L3 `27.33%`; XRP-L5 `40.65%`; three active bots; Trading Equity `$896`.
- PAPER: `RESEARCH ONLY`; Baseline remains reference; no automatic promotion/execution impact; research board and opportunity-cost/audit sections render correctly.
- MORE: Market/Forecast/Research/Diagnostics/Settings render inside the real MORE view; token remains connected; no legacy overlay.

## Clean R1 — CENTER
- Native mobile-first shell and one five-item bottom navigation.
- CENTER reads `/api/private/dashboard` for canonical total, market, risk, one next action and only READY/TRADE/ENTRY-quality opportunity.
- No committed read secret.

## Clean R2 — DEPOT
- Native clean DEPOT; total only `spotUsd + tradingUsd`.
- Spot excludes Pionex holdings; Trading/Bots uses canonical Pionex equity.
- 1D chart only from `/api/private/portfolio-history?range=1d` and performance withheld until >=16.8h canonical coverage.
- No fabricated history; Top 4 exposures use the same valuation basis when available.

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
- SETTINGS owns read-token connection UI.
- `more-runtime.js` hydrates only `#view-more` and never delegates to legacy navigation.

## Clean R6 — GitHub Pages API binding
- `window.MERIDIAN_V8_CONFIG.apiBase` points to `https://p01--achi-meridian--ttvk44grdlp7.code.run` before clean modules load.
- Gateway CORS already allows origin `https://achi1984.github.io`; no `server.js` or CORS widening was needed.

## Clean R7 — Token persistence + canonical spot repair
- Read token is stored on-device in `localStorage` under `meridian.v8.readToken`, with one-time migration from session storage. No token value is committed.
- Connecting/replacing the token in MORE triggers immediate reload so all protected views hydrate from one authenticated state.
- DEPOT/CENTER prefer holdings valued with live/stored prices and use only private canonical spot snapshot as fallback.
- `snapshotTotalIncludingPionexUsd` is intentionally not used, preventing Pionex double counting.
- Trading/Bots remains separate; total remains exactly `spot + trading`.

## Clean R8 — Visual & UX polish
- Presentation-only compact mobile override in `v8-clean/r8-polish.css`.
- CENTER prioritizes portfolio, market/risk, next action and best opportunity in the first viewport.
- DEPOT / TRADE / PAPER / MORE remain fully scrollable and preserve fixed bottom navigation.
- iPhone production validation after cutover showed no visual blocker.

## Clean R9 — Production identity
- Branch: `fix/v8-production-identity-r9`.
- User-facing prototype wording is removed now that the clean shell is canonical production.
- Page title becomes `ACHI MERIDIAN v8`.
- Status row becomes `v8.0 · PROD · SYNC · LIVE DASHBOARD`.
- Mode banner becomes `MERIDIAN v8 · CUSTOMER VIEW` with concise product copy.
- Cache tags move to `8.0-r9`; no data, auth, routing, research or execution behavior changes.
- Regression coverage locks the production identity while preserving the same five-view/read-only architecture.

## Current next steps
1. Run Release Safety on the exact R9 head and merge only if green.
2. Verify production root shows the R9 identity without changing any live data behavior.
3. Keep the R11 rollback branch untouched unless a production regression requires rollback.
4. Next product work should be incremental on v8 only; do not reintroduce legacy renderer ownership.
5. Research remains isolated until evidence and explicit human approval justify any promotion.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- No research result auto-promotes into Paper/live execution.
