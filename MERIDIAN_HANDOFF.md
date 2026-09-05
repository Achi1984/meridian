# MERIDIAN HANDOFF

## Frozen / protected references
- Frozen legacy dashboard: `archive/v7.65-dashboard-frozen-20260905` at `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`.
- Pre-cutover production rollback branch: `archive/v8-r11-production-pre-cutover` at `bdfc64f8cf588d5b4c3d6a3f4daebf019b8e7749`.
- Baseline `6.2.0 / 6.2-SIGNAL-V1` remains frozen.
- Paper/live execution, sizing, risk, exits and ledgers remain unchanged; live trading remains disabled.
- `server.js` must remain untouched by v8 frontend work.
- v7.63/v7.64 canonical portfolio contracts remain authoritative.

## Production cutover candidate
- Branch: `release/v8-clean-production-cutover`.
- Production root `index.html` now redirects deterministically to `./v8-clean/`, preserving query string and hash.
- The previous R11 production root is preserved on `archive/v8-r11-production-pre-cutover` for immediate rollback.
- No clean data/auth/research/execution code is changed by the cutover itself.
- Root entry is intentionally thin to prevent any legacy renderer from initializing before the clean shell.

## Clean architecture invariants
- Exactly five real root views: CENTER / DEPOT / TRADE / PAPER / MORE.
- One deterministic navigation; no hidden legacy buttons.
- No legacy renderer/view ownership inside `v8-clean/`.
- Explicit read-only adapters use backend/API contracts; never scrape legacy DOM for values.
- No research auto-promotion.

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
- iPhone validation showed CENTER and DEPOT at `$27.313`, with Spot `$26.417`, Trading/Bots `$896` and consistent history/top positions.

## Clean R8 — Visual & UX polish
- Presentation-only compact mobile override in `v8-clean/r8-polish.css`.
- CENTER prioritizes portfolio, market/risk, next action and best opportunity in the first viewport.
- DEPOT / TRADE / PAPER / MORE remain fully scrollable and preserve fixed bottom navigation.
- iPhone validation after merge commit `bdfc64f8cf588d5b4c3d6a3f4daebf019b8e7749` showed no visual blocker.

## Current next steps
1. Release Safety must pass on the exact cutover head.
2. Merge cutover only after the exact-head check is green.
3. After deployment, verify the production root opens v8-clean directly and token persists.
4. Validate CENTER / DEPOT / TRADE / PAPER / MORE once on production root.
5. If any production-only issue appears, rollback by restoring `archive/v8-r11-production-pre-cutover` / commit `bdfc64f8cf588d5b4c3d6a3f4daebf019b8e7749`.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- No research result auto-promotes into Paper/live execution.
