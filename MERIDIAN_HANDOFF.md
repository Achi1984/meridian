# MERIDIAN HANDOFF

## Frozen legacy dashboard
- Frozen branch: `archive/v7.65-dashboard-frozen-20260905`
- Frozen source commit: `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`
- Legacy dashboard remains recoverable and must not be mutated by v8 migration work.

## v8 customer dashboard
- PR #43 merged to `main` as `9f006fbaa50837eb8a3b98a67d24a2156e3d1339`.
- Active hotfix branch: `fix/v8-mobile-live-hotfix-r8`.
- Current phase: v8.0 R8 — post-merge iPhone live hotfix.
- Goal: answer-first UX with details/research on demand.
- Final top-level navigation: CENTER / DEPOT / TRADE / PAPER / MORE.

## Implemented customer screens
- PAPER: one answer card plus compact Baseline / Shadow / Challenger / Regime rows; research details remain on demand; relative leader is not promotion.
- TRADE: risk state, critical bot, liquidation buffer, exactly one next action and compact active-bot rows; legacy detail remains on demand.
- CENTER: canonical portfolio value, market regime, risk state, one next action and only actionable READY/TRADE/ENTRY-quality scanner opportunity; otherwise `NO READY SIGNAL`.
- DEPOT: canonical total, 1D performance, canonical-history sparkline when mature, Spot vs Trading/Bots and top positions; no fabricated history.
- MORE: Market, Forecast, Scanner, Research and Diagnostics grouped behind one secondary hub.

## R8 live iPhone findings and fixes
The first production screenshots after the v8 merge showed a severe presentation collision: a TRADE summary was mounted inside the navigation area, the old six-item bottom nav remained visible, and CENTER reported missing bot data despite the legacy command center showing open risk.

Root causes and fixes:
- `app-v8.0-trade-summary.js` and `app-v8.0-depot-summary.js` used generic `[data-view=...]` fallbacks. Because v8 nav buttons also have `data-view`, a summary could mount inside a nav button if the real view was missing/late. R8 now binds only to `#view-trade` / `#view-depot`; CENTER also uses only explicit real view IDs.
- Older inline CSS in `index.html` gives `#primaryBottomNav` high-specificity `display:block!important` restoration. R8 adds an ID-specific v8 rule and periodic guard so the legacy nav is definitively hidden after v8 nav activation.
- TRADE/CENTER now prefer existing `canonicalBotStates()` live risk SSOT over the empty bootstrap `MERIDIAN_PIONEX_SNAPSHOT`; snapshot/DOM remain fallbacks only.
- CENTER adds `DATA.btcRegime` fallbacks so the customer market card can populate from the same browser runtime model when cloud regime data is absent.
- `test/v8-navigation.test.js` now protects these exact regressions.

## Release safety
- Exact hotfix build: `8.0-20260905-R8`.
- Compatibility loader tag and PWA manifest are synchronized to R8.
- Baseline 6.2 execution, sizing, risk, exits and ledger behavior are unchanged.
- Paper/live execution unchanged; live trading remains disabled.
- `server.js` untouched.
- v7.63/v7.64 canonical portfolio data/history contract remains authoritative.

## Hotfix merge rule
Do not merge R8 on an older successful run. Require both `MERIDIAN Release Safety` and `MERIDIAN Portfolio Contract v7.63` to succeed on the exact current hotfix head. The current screenshot message itself is treated as bug evidence, not a new blanket authorization to merge; keep the PR ready and request/await explicit merge approval after green checks.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- No research result auto-promotes into Paper/live execution.

## After hotfix merge
Verify `main` points at the R8 merge commit, then verify Northflank deployment separately. On iPhone confirm: exactly one five-item bottom nav, no TRADE card inside navigation, CENTER and TRADE show canonical bot risk when available, and legacy detail stays hidden until explicitly opened.
