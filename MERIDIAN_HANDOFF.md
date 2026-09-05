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
- Previous production root remains preserved on `archive/v8-r11-production-pre-cutover` for rollback.
- Post-cutover iPhone validation completed successfully across CENTER / DEPOT / TRADE / PAPER / MORE.
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
- DEPOT: total `$27.313` = Spot `$26.417` + Trading/Bots `$896`; 1D `+1.72% / +$463`; canonical PostgreSQL history rendered; top positions coherent.
- TRADE: BTC-S30 critical bot `8.99%`; HBAR-L3 `27.33%`; XRP-L5 `40.65%`; three active bots; Trading Equity `$896`.
- PAPER: `RESEARCH ONLY`; Baseline remains reference; no automatic promotion/execution impact.
- MORE: Market/Forecast/Research/Diagnostics/Settings render inside the real MORE view; token remains connected.

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

## Clean R9 — Production identity
- User-facing prototype wording removed now that the clean shell is canonical production.
- Status row is `v8.0 · PROD · SYNC · LIVE DASHBOARD`.
- Mode banner is `MERIDIAN v8 · CUSTOMER VIEW`.

## Clean R10 — DEPOT chart ranges + extrema
- Production DEPOT chart supports `4H · 1T · 1W`.
- Uses protected canonical portfolio history only; 4H is sliced client-side from 1D, 1W from canonical week history.
- HIGH and LOW are marked directly in the chart and repeated in summary metrics.
- No portfolio contract or execution change.

## Clean R11 — DEPOT chart mobile polish
- Mobile left performance card narrowed slightly to give chart more horizontal room.
- HIGH/LOW annotations reduced and moved further away from the line.
- Range logic and canonical history unchanged.
- PR #57 merged after Release Safety run #702; main merge commit `57a3a4d87ce9c51d4ef26cbbe8276fc2b88780ab`.

## Clean R12 — TRADE detail upgrade
- Branch: `fix/v8-trade-details-r12`.
- Adds read-only disclosure cards for each active bot inside the existing TRADE view.
- Critical bot remains first/open by default; others stay collapsed until tapped.
- Detail fields come only from protected dashboard data: Current Price, Break-even, Liquidation Price, PnL, Investment and Buffer.
- Adds fixed visual ladder: `DANGER <8%`, `WATCH 8–12%`, `SAFE >=12%`.
- Each bot gets an explicit SAFE path: either remaining percentage points to 12% or already SAFE.
- On any R12 read failure, the canonical compact TRADE card is left intact.
- Presentation/read-only only: no order, margin, stop, sizing or execution writes.

## Current next steps
1. Run Release Safety on exact R12 head and merge only if green.
2. Validate TRADE on iPhone: critical bot opens by default; HBAR/XRP collapsed; details readable without crowding.
3. Confirm live dashboard actually supplies Current / Break-even / PnL fields where expected; missing values must render `—`, never be invented.
4. If R12 is clean, next product step should be CENTER enrichment or PAPER compaction, not architecture changes.
5. Research remains isolated until evidence and explicit human approval justify any promotion.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- No research result auto-promotes into Paper/live execution.
