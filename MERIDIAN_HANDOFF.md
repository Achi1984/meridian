# MERIDIAN HANDOFF

## Frozen legacy dashboard
- Frozen branch: `archive/v7.65-dashboard-frozen-20260905`
- Frozen source commit: `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`
- Legacy dashboard remains recoverable and must not be mutated by v8 migration work.

## v8 customer dashboard
- v8 foundation PR #43 merged to `main` as `9f006fbaa50837eb8a3b98a67d24a2156e3d1339`.
- R8 PR #44 merged as `34d52c3cc98f0bc53015001d8dca71a203a0d7be`.
- R9 PR #45 merged as `81fade00ca589faa36f8300546d9c4a36952c35b`.
- R10 PR #46 merged as `588514001c7d333d58d6b3b8ba4459b10cb91de2`.
- R11 PR #47 merged as `3c2c88280a8fd75e6b8bb4d38648b792a45e0965`.
- Active branch: `fix/v8-more-real-view-r12`.
- Current phase: v8.0 R12 — real fifth MORE view / render ownership cleanup.
- Goal: answer-first UX with details/research on demand.
- Top-level navigation: CENTER / DEPOT / TRADE / PAPER / MORE.

## Implemented customer screens
- PAPER: one answer card plus compact Baseline / Shadow / Challenger / Regime rows; research details remain on demand; relative leader is not promotion.
- TRADE: risk state, critical bot, liquidation buffer, exactly one next action and compact active-bot rows; legacy detail remains on demand.
- CENTER: canonical portfolio value, market regime, risk state, one next action and only actionable READY/TRADE/ENTRY-quality scanner opportunity; otherwise `NO READY SIGNAL`.
- DEPOT: canonical total, 1D performance, canonical-history sparkline when mature, Spot vs Trading/Bots and top positions; no fabricated history.
- MORE: Market, Forecast, Scanner, Research and Diagnostics grouped in a dedicated real v8 view.

## R12 architecture decision — MORE is a real view
Live iPhone verification after R11 showed MORE highlighted while an underlying legacy CENTER renderer remained visible. The cause was structural: MORE was only an overlay, not a real view container, so legacy renderers could still own the visible page underneath.

R12 fixes ownership at the architecture level:
- MORE is now a real `#view-more` section under the same main view system as CENTER / DEPOT / TRADE / PAPER.
- Navigation maps MORE to `ids:['view-more']` and `runtime:'more'` and uses the same deterministic `forceView()` path as every other top-level tab.
- Opening MORE no longer clicks an overlay control or leaves a legacy view visible underneath.
- Old `#v8-more-overlay` / `#v8-more-open` artifacts are removed if present.
- Market / Forecast / Scanner / Research / Diagnostics remain explicit user actions from the MORE screen and may route into legacy detail areas intentionally.
- The compatibility hot-reload cleanup now removes stale `view-more` and legacy MORE overlay artifacts before rehydration.
- Exact candidate build: `8.0-20260905-R12`.

## Release safety
- Baseline 6.2 execution, sizing, risk, exits and ledger behavior remain unchanged.
- Paper/live execution unchanged; live trading remains disabled.
- `server.js` untouched.
- v7.63/v7.64 canonical portfolio data/history contract remains authoritative.
- R12 must pass Release Safety and Portfolio Contract on its exact final head before merge.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- No research result auto-promotes into Paper/live execution.

## After R12 merge
Verify on iPhone that each of the five top-level tabs owns exactly one visible root view. In particular, MORE must show only the dedicated Details & Tools screen, never an underlying legacy CENTER dashboard. Then verify explicit MORE routes individually.
