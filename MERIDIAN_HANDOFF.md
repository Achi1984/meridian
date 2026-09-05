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
- R6 GitHub Pages -> Northflank API binding was merged in PR #51 at `c71da83831e36e875190fab34fe6ba32fd6b4ce4`.
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
- iPhone validation on `https://achi1984.github.io/meridian/v8-clean/` proved clean five-view routing is stable, but protected views initially returned HTTP 404 because the standalone shell used same-origin GitHub Pages for API calls.
- `window.MERIDIAN_V8_CONFIG.apiBase` now points to `https://p01--achi-meridian--ttvk44grdlp7.code.run` before clean modules load.
- Gateway CORS already allows origin `https://achi1984.github.io`; no `server.js` or CORS widening was needed.

## Clean R7 — Token persistence + canonical spot repair
- iPhone validation showed a new browser/WebView session lost the read token because R6 used `sessionStorage` only; all protected views returned LOCKED again.
- R7 branch: `fix/v8-clean-token-portfolio-r7`.
- Read token is now stored on-device in `localStorage` under the existing `meridian.v8.readToken` key, with one-time migration from an existing session token. No token value is committed to the repository or sent anywhere except the authenticated gateway request header.
- Connecting/replacing the token in MORE triggers an immediate page reload so CENTER / DEPOT / TRADE / PAPER all rehydrate from one authenticated state without waiting for the 30s refresh interval.
- DEPOT/CENTER still prefer holdings valued with live/stored prices. If holdings exist but cannot currently be valued, R7 falls back only to the private `portfolio.snapshotSpotValueUsd` / canonical private spot snapshot. It does not use `snapshotTotalIncludingPionexUsd`, so Pionex cannot be double-counted.
- Trading/Bots remains the preferred Pionex equity source. Total remains exactly `spot + trading`.
- Top positions prefer computed holdings; if unavailable, private `portfolio.topPositions` snapshot rows may be shown. No legacy DOM fallback is reintroduced.
- Clean cache tags bumped to `8.0-clean-r7` and regression coverage locks token persistence, remote API binding and spot fallback semantics.

## Current next steps
1. Release Safety must pass on the exact R7 head before merge.
2. Re-open the GitHub Pages clean URL and verify the already connected token survives a fresh browser/WebView open.
3. Verify CENTER / DEPOT / TRADE / PAPER load immediately without revisiting SETTINGS.
4. Check DEPOT total: Spot must no longer collapse to $0 when the private spot snapshot is present; Trading/Bots must remain separate.
5. Validate top positions/history source labels and mobile layout.
6. Only after explicit approval: deliberately migrate the production entry to `v8-clean/`.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- No research result auto-promotes into Paper/live execution.
