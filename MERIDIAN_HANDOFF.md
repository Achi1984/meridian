# MERIDIAN HANDOFF

## Frozen legacy dashboard
- Frozen branch: `archive/v7.65-dashboard-frozen-20260905`
- Frozen source commit: `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`
- Legacy dashboard remains recoverable and must not be mutated by v8 migration work.

## v8 customer dashboard
- PR #43 merged to `main` as `9f006fbaa50837eb8a3b98a67d24a2156e3d1339`.
- PR #44 / R8 merged to `main` as `34d52c3cc98f0bc53015001d8dca71a203a0d7be`.
- Active hotfix branch: `fix/v8-bootstrap-selfheal-r9`.
- Current phase: v8.0 R9 — bootstrap/cache self-heal.
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

R8 fixed the direct UI/data-binding defects:
- Customer summaries bind only to explicit real `#view-*` containers, never generic v8 nav buttons.
- `#primaryBottomNav` is hard-hidden after v8 navigation activation.
- TRADE/CENTER prefer existing `canonicalBotStates()` live risk SSOT over the empty bootstrap `MERIDIAN_PIONEX_SNAPSHOT`.
- CENTER adds `DATA.btcRegime` fallbacks.

## R9 stale-loader root cause and fix
A second iPhone verification after R8 still showed the pre-R8 layout. GitHub `main` already contained R8 and push Release Safety + Runtime Smoke had completed successfully, so the remaining failure is a bootstrap/version-delivery problem rather than another copy of the same UI bug.

R9 changes the compatibility layer:
- `app-v6.06.js` no longer trusts its filename/query as release authority. It fetches fresh `version.json` with `cache: no-store`, derives the required build tag and loads every module with that tag.
- If the running compatibility loader is stale, it injects a fresh loader URL with the authoritative tag and a timestamp.
- Before hot rehydration it removes stale v8 customer summaries, navigation DOM and v8 CSS IDs so an older module graph cannot keep old layout rules alive.
- `app-release-authority.js` independently detects loader/build divergence and can trigger the same bootstrap refresh.
- New regression file: `test/v8-bootstrap-selfheal.test.js`.
- Exact candidate build: `8.0-20260905-R9`.

This is presentation/bootstrap only. It does not change Baseline, Paper execution, bot sizing/risk, private portfolio contracts or `server.js`.

## Release safety
- Baseline 6.2 execution, sizing, risk, exits and ledger behavior remain unchanged.
- Paper/live execution unchanged; live trading remains disabled.
- `server.js` untouched.
- v7.63/v7.64 canonical portfolio data/history contract remains authoritative.
- R9 must pass Release Safety and Portfolio Contract on its exact final head before merge.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- No research result auto-promotes into Paper/live execution.

## After R9 merge
Verify `main` points at the R9 merge commit. Then re-open MERIDIAN on iPhone and confirm: one five-item bottom nav only, no TRADE card embedded in CENTER/navigation, CENTER/TRADE consume real canonical bot risk when available, and the runtime loader tag matches authoritative `version.json`.
