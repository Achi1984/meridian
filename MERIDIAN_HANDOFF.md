# MERIDIAN HANDOFF

## Frozen legacy dashboard
- Frozen branch: `archive/v7.65-dashboard-frozen-20260905`
- Frozen source commit: `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`
- Legacy dashboard remains recoverable and must not be mutated by v8 migration work.

## v8 customer dashboard
- Active branch: `v8/customer-dashboard`
- PR: #43 — ready for review; user explicitly approved merge after final clean review
- Current phase: v8.0 R7 — pre-merge hardening
- Goal: answer-first UX with details/research on demand.
- Final top-level navigation: CENTER / DEPOT / TRADE / PAPER / MORE.

## Implemented customer screens
- PAPER: one answer card plus compact Baseline / Shadow / Challenger / Regime rows; research details remain on demand; relative leader is not promotion.
- TRADE: risk state, critical bot, liquidation buffer, exactly one next action and compact active-bot rows; legacy detail remains on demand.
- CENTER: canonical portfolio value, market regime, risk state, one next action and only actionable READY/TRADE/ENTRY-quality scanner opportunity; otherwise `NO READY SIGNAL`.
- DEPOT: canonical total, 1D performance, canonical-history sparkline when mature, Spot vs Trading/Bots and top positions; no fabricated history.
- MORE: Market, Forecast, Scanner, Research and Diagnostics grouped behind one secondary hub.

## Navigation / mobile
- `app-v8.0-navigation.js` provides exactly CENTER / DEPOT / TRADE / PAPER / MORE.
- First four items delegate to existing view handlers; MORE opens the hub.
- Legacy bottom navigation is preserved but hidden only after v8 navigation is ready.
- Market and Forecast remain reachable through preserved legacy handlers even while their old nav buttons are hidden; these secondary views map to MORE in the active five-item nav.
- iPhone safe-area, card widths, banner spacing and small-screen nav density are normalized.

## R7 pre-merge review fixes
- Fixed CENTER fallback that could previously surface a non-ready scanner item as `BEST OPPORTUNITY`.
- Fixed MORE Market/Forecast routing after R6 hid legacy bottom navigation.
- Extended `test/v8-navigation.test.js` with regression assertions for both behaviors.
- Restored canonical project/security/research invariants in `MERIDIAN_CONTEXT.md` so continuity is not weakened by the v8 rewrite.

## Release safety
- Exact R7 release build: `8.0-20260905-R7`.
- Compatibility loader tag and PWA manifest are synchronized to R7.
- Baseline 6.2 execution, sizing, risk, exits and ledger behavior are unchanged.
- Paper/live execution unchanged; live trading remains disabled.
- `server.js` untouched.
- v7.63/v7.64 canonical portfolio data/history contract remains authoritative.

## Merge rule for PR #43
Do not merge on an older successful run. Require both `MERIDIAN Release Safety` and `MERIDIAN Portfolio Contract v7.63` to succeed on the exact current R7 head. If both are green and PR remains mergeable, merge to `main` using the user's explicit approval from this conversation.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- No research result auto-promotes into Paper/live execution.

## After merge
Verify `main` points at the v8 merge commit and then verify Northflank deployment separately; do not infer successful deployment solely from the GitHub merge.
