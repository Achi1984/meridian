# MERIDIAN Chat Handoff

Status: **Cross-Venue Funding Edge V1 SOURCE_CLOSED; V2 synthetic Source→Builder→Runner Adapter→Strategy/Driver reviewed/frozen at SOURCE_AUDIT; canonical execution/Discovery locked; no PnL**  
Updated: **2026-10-05**

## Current durable checkpoint

- V2 source collection seal: **merged/reviewed via #545; automatic recollection after final evaluation is fail-closed**
- Exit-fill runner integrity fix: **merged/reviewed via #546**
- Causal Event Builder PR1: **merged/reviewed/frozen via #547; synthetic-only**
- Structural Runner Adapter: **merged/reviewed/frozen via #548; entryActive remains false structurally**
- Strategy Adapter + causal Driver: **merged/reviewed/frozen via #549; Claude CV2-STRATEGY-DRIVER-PR2-IMPL-R3 GREEN LIGHT**
- Claude mailbox bridge: **merged via #550; active mailbox resolves from MERIDIAN_LIVE_CHECKPOINT.mailboxIssue (R5 #571)**
- Terminal UI: **r114 #551 + r115 #552 merged; post-merge Release Safety / Visual QA / Runtime Smoke / Release Coordinator / Pages GREEN**
- V2 stage remains: **SOURCE_AUDIT**; Discovery / Validation / Holdout / Paper / Live: **LOCKED**
- Canonical Source→Events→Strategy→Runner execution: **not authorized**
- Strategy PnL: **not calculated / not authorized**
- Canonical source lineage remains run **37290831222**, receipt **822a42728e8f9c1da61059eb31d10fea9771adac34042dfede6fa9f3e63845d5**
- Next research gate: **explicit user authorization + separate exact-head Claude review before canonical V2 execution or Discovery**
- Secondary Funding-Carry Candidate A: **PASS_TO_DATA_DESIGN_SCOPED only; no data-design run authorized**

- Build: **10.0-r126**
- UI-Leitprinzip: **Complex inside – simple outside.**
- Verified main checkpoint: **c009326529e162f84bb985d0aca2de6cf5065c18**
- UI/runtime r108 acceptance: **PASS**
- Research gate: **V1.3 PASS**
- Full-run decision: **INDIVIDUAL_TRADES_DATA_V1_3_PASS_STRATEGY_PREREGISTRATION_REQUIRED**
- V1.3 full run: **36690368732**
- V1.3 aggregate artifact: **11090766829**
- Aggregate digest: `sha256:49211d4059f8cecc38133f8bea9ac5b4ce9bf23a041c242440cb25b335dbb344`
- Shards: **120/120 PASS**
- Strategy V1 preregistration: **canonical via PR #435**
- Execution impact: **false**
- Paper/live authorization: **false**

Repository state remains the source of truth. Before every Meridian step, resolve `mailboxIssue` from `MERIDIAN_LIVE_CHECKPOINT.json`, read that mailbox first, then reconcile latest merged `main`, CI, `MERIDIAN_RESUME.json`, `MERIDIAN_AGENT_STATE.json`, and related PRs before any mutation.

## Quarter-Hour data lineage

1. **Data V1 / aggTrades — immutable FAIL.**
2. **Data V1.1 / individual trades — immutable FAIL** on frozen predeclared gates (run **36621993141**). Later ports must not revive that result.
3. **Data V1.2 — immutable FAIL**. Full run **36664484586** failed strict trade-ID ordering in **ETHUSDT/2025-08, XRPUSDT/2025-08, ADAUSDT/2025-08**.
4. Diagnostics #356/#357 established that repeated IDs represent distinct official source records and that ETH also contains source-row timestamp decreases.
5. **Data V1.3 — PASS.** Full run **36690368732**, exactly **120/120 PASS**, zero missing/duplicate/unexpected shards and zero hard-gate reasons.

## Frozen Strategy V1

The original docs-only preregistration was frozen in #354 before MERIDIAN inspected its own Quarter-Hour signal, forward returns or strategy PnL. PR #435 restored that exact strategy design onto validated Data V1.3.

Independent normalization review confirmed that after removing only the Data V1.2 -> V1.3 dependency/provenance changes, the restored preregistration is byte-identical to #354.

Frozen strategy properties include:
- continuation signal from first 10 seconds after each 00/15/30/45 boundary;
- normalized signed individual-trade flow;
- primary **12h / 48-cohort** horizon;
- per-asset max absolute target **1/6 equity**;
- total gross cap **1.0x**;
- first valid trade in `[t+10s,t+60s)` as the execution reference;
- primary cost **6 bp one-way**, with 3/10 bp diagnostics;
- realized funding with no post-funding lookahead;
- fixed B1-B4 chronological blocks;
- unchanged six primary research gates;
- no post-result strategy-rule rescue.

No historical Strategy V1 PnL has been authorized or inspected yet.

## Runtime / audit safeguards

- Asset Watch strict-live validation fails closed on future timestamps, stale envelopes and freshness-policy inflation.
- Engine cycle and signal scan use single-flight serialization.
- Common Paper `markPosition()` still has legacy opening-fee semantics; Challenger V3 compensates locally. Handle only in a dedicated accounting migration/regression work package.
- Release Safety must execute `scripts/continuity-audit.mjs` as an explicit named hard gate, not merely expose it through an npm script.

## SUPERSEDED prior next step — Quarter-Hour Strategy V1

**PAUSED:** This preserved QH Strategy V1 work package is not the active research lane. Do not execute it while `MERIDIAN_RESUME.json` selects Cross-Venue Funding Edge V2.

Historical next step was to create a separate **Strategy V1 deterministic implementation** work package.

Before the first historical evidence run, it must prove with tests and independent review:
1. signal direction and first-10-second boundary construction;
2. 12h cohort expiry and net target accounting;
3. 1/6 per-asset and 1.0x gross-cap invariants;
4. turnover cost accounting at 6 bp primary;
5. no-lookahead execution price in `[t+10s,t+60s)`;
6. funding sign and last-pre-funding valuation;
7. fixed B1-B4 evaluation blocks;
8. all six primary research gates;
9. no Paper/live execution path.

Only after exact-head Release Safety + implementation review may the historical V1.3 Strategy V1 signal/return/PnL run execute.

## SSOT UPDATE — 2026-10-05 · Cross-Venue Funding Edge transition

This section supersedes the earlier “Exact next durable step” where it conflicts.

- Cross-model governance is active: ChatGPT Lead / Claude independent Review Sub-Agent.
- Cross-Venue Funding Edge V1 remains execution-neutral and has never reached strategy PnL.
- PR #529 fixed strict raw-number validation and merged on main `a52c56010b9a547061c82d37840f5335465b3754`.
- Post-merge source run `37270798106` failed closed with `OKX_INVALID_FUNDING`; this is source-failure evidence, not a valid source receipt.
- Blocker #528 plus independent Claude source forensics established that the authoritative OKX history contains an off-grid settlement incompatible with the frozen V1 source assumptions.
- User selected Option A: V1 must close permanently as `CROSS_VENUE_V1_SOURCE_FAIL`; do not amend or rescue V1.
- Successor `CROSS-VENUE-FUNDING-EDGE-V2` is preregistered with generic outage/off-grid semantics and unchanged economic thresholds/gates.
- V2 implementation/source contract is merged and frozen. This transition authorizes only `SOURCE_AUDIT`; strategy PnL and all later stages remain disabled.
- PR #530 is merged. PR #532 subsequently froze the V1-closure/V2-preregistration lineage in the global Frozen Research Guard.
- **Current exact next durable step:** obtain Claude GREEN LIGHT on this SOURCE_AUDIT transition PR. After merge, allow the already-frozen main-only V2 Source Gate to collect and validate source evidence. Inspect source integrity only; no strategy PnL or Discovery.
- V2 canonical Source Audit has completed successfully at run `37290831222` / attempt 1 on main `63f93aa41b6e054b229309b6fd6fbc2447a92181`.
- Canonical source state: `VALID_WITH_INTEGRITY_EPISODES`; receipt digest `822a42728e8f9c1da61059eb31d10fea9771adac34042dfede6fa9f3e63845d5`; artifact `11336541442`.
- Source integrity episode: exactly three OKX events on 2022-12-18 (gap, missing 16:00 settlement, authoritative 18:54 off-grid settlement).
- The source-evaluation PR must durably persist the canonical run/artifact/receipt identity before any later transition.
- V2 remains `SOURCE_AUDIT`. Discovery, Validation, Holdout, strategy PnL, Paper and Live remain unauthorized.
- **Current exact next durable step after source-evaluation merge:** implement the deterministic V2 runner/episode state machine, strict boolean `entryActive`, independent ledger/equity construction and generic causality tests — still without executing strategy PnL.

