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
- R7 token persistence + canonical spot repair was merged in PR #52 at `d1f10b4b359e1b7743aa228986de45a53ef031ff`.
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
- Read token is now stored on-device in `localStorage` under the existing `meridian.v8.readToken` key, with one-time migration from an existing session token. No token value is committed.
- Connecting/replacing the token in MORE triggers an immediate page reload so all protected views hydrate from one authenticated state.
- DEPOT/CENTER prefer holdings valued with live/stored prices. If holdings cannot currently be valued, only the private spot snapshot is used as fallback.
- `snapshotTotalIncludingPionexUsd` is intentionally not used, preventing Pionex double counting.
- Trading/Bots remains separate. Total remains exactly `spot + trading`.
- iPhone validation after R7 showed CENTER and DEPOT both at `$27.313`, with Spot `$26.417`, Trading/Bots `$896`, and consistent top positions/history.

## Clean R8 — Visual & UX polish
- Branch: `fix/v8-clean-visual-polish-r8`.
- Presentation-only change; no data, auth, navigation ownership, research or execution behavior changes.
- Adds `v8-clean/r8-polish.css` as a small override layer instead of modifying the stable clean base stylesheet.
- Mobile spacing is tightened: topbar, status row, mode banner, cards, action cards and bottom navigation use less vertical space.
- CENTER is prioritized so portfolio, market/risk, next action and best opportunity are more likely to fit within the first iPhone viewport.
- Very short mobile viewports hide only the explanatory subline in the mode banner; all five real views and all data cards remain available.
- Clean cache tags are bumped to `8.0-clean-r8`.
- Regression coverage verifies R8 remains presentation-only and preserves five-view ownership.

## Current next steps
1. Release Safety must pass on the exact R8 head before merge.
2. Re-open the GitHub Pages clean URL and visually validate CENTER / DEPOT on iPhone with the compact layout.
3. Confirm no clipping behind the fixed bottom navigation and that BEST OPPORTUNITY is reachable without awkward extra scroll.
4. If clean, treat v8-clean R8 as the visual candidate for production cutover.
5. Production entry migration remains a separate deliberate change and requires explicit approval.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- No research result auto-promotes into Paper/live execution.
