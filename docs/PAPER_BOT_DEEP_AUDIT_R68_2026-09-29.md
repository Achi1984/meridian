# MERIDIAN Paper-Bot Deep Audit — current-main r68 — 2026-09-29

Status: **CURRENT-MAIN ARCHITECTURE / RESEARCH-GOVERNANCE AUDIT**  
Base: `aec6bd58fd75c0979672e4f88c020cba4208e9fd`  
Terminal identity: `10.0-r68`  
Execution impact: **false**  
Paper-bot parameters changed: **false**  
Runtime performance snapshot claimed: **false**

## Why the earlier #334 audit is superseded

#334 was prepared from an older repository state. Current `main` now declares the production PWA entry as `./v10/?build=r68&fresh=r68` and the terminal identity as `10.0-r68`.

The legacy file `app-v8.0-paper-summary.js` still exists and still contains the old hard-coded BASELINE / SHADOW / CHALLENGER V2 / REGIME comparison plus UI-owned WATCH/WATCH+ heuristics. It is also still named in the legacy `app-v6.06.js` bootstrap graph.

That is **legacy technical debt**, but it is not sufficient evidence that the active v10 terminal is presenting that comparison. The active production manifest points to v10, whose adapter imports the current research modules directly.

Therefore the old #334 severity statement must not be carried forward as an active-v10 UI defect without runtime evidence.

## Research control plane and continuity drift

`MERIDIAN_RESUME.json` is intended to be the durable research index and correctly states that only merged `main` plus current-base green CI is canonical and that unmerged research branches are evidence, not authority. However, the file itself is **not a current repository checkpoint**: its recorded `sourceOfTruth.verifiedSha` predates current main, its phase still describes the earlier source-anomaly stage, and its `nextAction` still asks for the individual-trades source-feasibility/Data V1.1 work that has since been executed and failed at the frozen canary gate.

Therefore the research results inside the file may be used only where independently reconciled to current main, while its top-level resume pointer must be refreshed after the current Data V1.1/source-consistency decision is frozen. A future chat must not treat the stale `verifiedSha` or `nextAction` as current authority.

The current Paper Bot Profit Special Agent V1 is frozen in:
- `research/PAPERBOT-PROFIT-SPECIAL-AGENT-V1.md`
- `research/paperbot-profit-special-agent-v1.js`
- v10 Lab integration in `v10/v10.js`

Its objective is net research profit **after** hard risk, cost, breadth and concentration gates. It has:
- research-only status;
- no auto-promotion;
- no live order path;
- no martingale or pyramiding;
- max research leverage 2x;
- explicit 8 bps turnover cost in the frozen V1 candidates.

## Current profit-research outcomes

Canonical state already records:
- **V1:** no candidate passes the frozen profit gate;
- **V2 UP-UP risk-managed momentum proxy:** +7.22% net return, PF 1.129, max DD 43.81%, 2/5 positive windows -> immutable `V2_DISCOVERY_FAIL`;
- **Funding Carry V1/V2:** no new entries; V2 retired on the repeatability sample gate;
- **Cross-Venue Funding Spread V1:** discovery passed, transfer holdout failed the frozen asset-level gate; no promotion;
- **Adaptive Trend Sharpe Proxy V1:** discovery fail;
- **Dynamic Grid Proxy V1:** discovery fail;
- **Regime-Gated Grid V2:** discovery fail;
- other listed successor research remains fail-closed / not promoted unless separately recorded as canonical.

These outcomes are research evidence, not a ranking of currently running Paper bots.

## R32 lifecycle remains a separate canonical mechanism

`paper-learning-policy.js` still freezes `R32-PAPER-LEARNING-V1` with:
- first checkpoint: 20 closed trades;
- retirement decision from 30 closed trades;
- final checkpoint: 50 closed trades;
- weak PF: 0.90;
- promising PF: 1.10 plus positive expectancy;
- researchOnly=true;
- livePromotion=false.

The presence of R32 must not be confused with the separate r68 historical Profit Special Agent research gate. They answer different questions and must not silently share thresholds.

## Observer / V4 / funding lineage

The current repository still contains:
- read-only `bot-observer.js`;
- paired `CHALLENGER V4 EXIT SHADOW` with independent ledger and no auto-promotion;
- Funding Carry V2 with `NEW_ENTRIES_ALLOWED=false`;
- archived Shadow/Regime lifecycle data.

These remain valid research/telemetry components, but none authorizes a live promotion.

## Critical audit findings

### A1 — Continuity checkpoint is stale and must be refreshed

The durable resume file currently points behind `main` and its next-action text has already been overtaken by #343/#345. This is a process-integrity issue: a fresh chat could repeat completed research if it trusts the resume file without first reconciling GitHub.

Required action: after the active source-consistency diagnostic is resolved, update the resume checkpoint from verified current main with the immutable Data V1.1 FAIL and the next separately versioned step. Do not update it mid-gate in a way that can race the active diagnostic.

Severity: **HIGH for orchestration continuity, zero execution impact**.

### A2 — Current-runtime comparison requires a fresh deployed snapshot, not new API code

GitHub contains the rules, historical research evidence and lifecycle code, but not a guaranteed fresh runtime ledger snapshot. The current server already exposes read-only runtime surfaces: `/api/paper/overview`, `/api/bot-observer`, `/api/public-status` and `/api/paper`. `paperOverviewStatus()` returns the Baseline ledger plus Challenger V2, Challenger V3, paired Directional V4, Funding Carry V2 and attribution state with a generated timestamp; `botObserverStatus()` also provides observer/lifecycle context.

Therefore the missing evidence is **not** an export implementation. It is a timestamped capture from the authoritative deployed instance, with freshness/provenance verified before comparison. Until that exists:
- do not invent current PF, win rate, PnL or drawdown;
- do not name a currently running bot “best” from repo state alone;
- do not treat a cached UI snapshot as current runtime evidence.

Severity: **HIGH for decision quality, zero execution impact**.

### A3 — Fresh runtime snapshot confirms no currently established profitable Paper lineage

Read-only snapshot run `36627547224` captured the public observer at `2026-09-29T20:36:55Z` with 179 ms age, engine RUNNING, marketFresh=true, zero engine errors, paperTrading=true and liveTrading=false.

Observed directional/reference telemetry:
- Baseline: 30 closed, PnL -853.52, PF 0.63, DD 11.35%, win rate 40.0%.
- Challenger V2: 23 closed, PnL -29.72, PF 0.98, DD 8.96%, win rate 47.8%; lifecycle SEALED_REFERENCE.
- Challenger V3: 33 closed, PnL -201.12, PF 0.73, DD 2.44%, win rate 48.5%; lifecycle RETIRED_NO_EDGE. Its R32-style learning phase is already RETIRE at 30 phase trades, expectancy -5.39, PF 0.76.
- Challenger V4 Exit Shadow: 13 closed, PnL -128.29, PF 0.56, DD 1.46%, win rate 53.8%; lifecycle PAIRED_SHADOW.
- Funding Carry V1: ACTIVE_PAPER with exposed net PnL -3.74, funding income +30.12, basis PnL -0.77 and estimated costs 33.09.
- Funding Carry V2: WAITING_ENTRY; current gate reason NET_CARRY_BELOW_HURDLE and cost coverage 0.43.

R42 runtime also remains fail-closed: momentum is SEALED after one losing closed trade and historical walk-forward rejection; pairs is SEALED with no robust pair; squeeze is WAITING_DATA for a complete liquidation feed; carry is WAITING_ENTRY with no cost-covered carry.

The snapshot does not justify a cross-lineage leaderboard because samples, lifecycles and mechanics differ. It does, however, rule out any current claim that an established profitable Paper bot is already demonstrated. No promotion or parameter rescue is supported by this evidence.

### A4 — Legacy v8 Paper scoring remains in the repository

The old `app-v8.0-paper-summary.js` still contains a second heuristic:
- WATCH+ near trades >= 20, positive PnL, PF >= 1.05 and DD <= 10%;
- hard-coded old bot names.

Because production currently starts at v10, this is not treated as an active-terminal defect. It is nevertheless dangerous legacy logic if the legacy bootstrap is ever restored or exposed.

Required action:
- mark the legacy scorer explicitly deprecated / non-authoritative;
- keep active v10 research decisions bound to canonical research modules and durable result evidence.

No trading threshold should be changed as part of that cleanup.

### A5 — Profit research has correctly failed closed so far

Several research lanes show attractive isolated metrics but fail a frozen risk, breadth, stability or transfer gate. The correct response is not threshold relaxation.

The current Quarter-Hour source-quality work is therefore an appropriate independent lane: it must complete data-quality gating before any directional signal, return or PnL is evaluated.

### A6 — Historical research results and runtime Paper bots must remain separate in UI language

The v10 Lab can execute historical research modules. Observer/R32 components describe live Paper research state. Those must not be visually collapsed into one “bot leaderboard” because their sample definitions, costs and lifecycle semantics differ.

## Safe next package

1. Finish the current Quarter-Hour source-consistency gate without exposing strategy PnL.
2. Refresh `MERIDIAN_RESUME.json` only after that gate is frozen, using the then-current verified `main` SHA and exact next action.
3. Keep the r68 profit-research outcomes immutable; do not rescue failed candidates by changing frozen gates.
4. Preserve snapshot run `36627547224` as the current runtime evidence baseline; recapture the existing observer later rather than adding a duplicate API.
5. Do not promote or rescue Baseline/V2/V3/V4 from the captured metrics; V3 remains retired, V2 sealed, and V4 under-sampled/negative.
6. Deprecate the legacy v8 WATCH/WATCH+ scorer without changing R32, Paper-bot parameters or execution.
7. Keep historical research panels explicitly labeled HISTORICAL / DISCOVERY / HOLDOUT and runtime Paper panels explicitly labeled RUNTIME / FORWARD.
8. Any future profit candidate must enter under a separately frozen protocol before results are viewed.

## Review conclusion

Current-main review does **not** support merging the old #334 audit as authoritative. The active repository has advanced to v10 r68 and its research governance is materially more mature than the earlier document assumed.

No execution, Paper-bot parameter, leverage, risk-threshold or live-order change is authorized by this audit.
