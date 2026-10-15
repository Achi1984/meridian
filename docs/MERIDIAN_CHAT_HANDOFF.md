# MERIDIAN Chat Handoff

## Current handoff — 2026-10-15

This section is the current operational summary. Historical snapshots below are
retained for provenance, not as instructions or evidence of present state.

- Verified source main: `2736f9d1d98988858373c05c05a7d5a67cbca27b`; PR **#814**
  merged. FINAL_MERGE_STATUS: **6201503547**. Reviewed head
  `c9c3f9b489b3f16fb2e9d90738483f4948a317a0`, base
  `48275e8ac149806859d698e7b29cb375dee73ff3`; full-scope Claude review
  **6201457990 GREEN_LIGHT**. Exact-head Release Safety
  **38793459593/job 116648593675** succeeded: 2,525 passed, 0 failed,
  cancelled, skipped, or todo (Node **20.20.2**).
- PR **#814 source packet is complete**; this handoff refresh is still pending
  publication. All four required post-merge checks succeeded on
  `2736f9d1d98988858373c05c05a7d5a67cbca27b`: Release Safety **38801351055**,
  Runtime Smoke **38801351069**, Release Coordinator **38801351260**, and Pages
  **38801348792**. The future publication commit for this refresh is not yet known.
- Prior housekeeping evidence remains historical: #818 merged at
  `7dc94b9108e25d742bef7652fb7511c5cb5108ea` (FINAL_MERGE_STATUS **6199370528**;
  all five post-merge checks succeeded). #819 merged at
  `48275e8ac149806859d698e7b29cb375dee73ff3` (FINAL_MERGE_STATUS **6199797884**;
  Release Safety **38788973884**, Agent Orchestration **38788973900**, Release
  Coordinator **38788973917**, Runtime Smoke **38788973928**, and Pages
  **38788972716** all succeeded).
- Terminal build: **10.0-r128**; checkpoint protocol: **STREAM-SAFE-V8**.
- Active work: complete and publish this factual handoff refresh after exact-head
  CI and full-scope review. No infrastructure action is authorized by this refresh.
- Authoritative mailbox is now **#639**, predecessor **#571**; watchdog status
  comment is **6198924473**. Superseded rollover PR **#640** is closed.
  Successor read/delivery/response smoke **PASS**, response **6199499751** to request **6199490288**. Predecessor #571 is closed as completed historical archive (6199526147). Resolve routing from `MERIDIAN_LIVE_CHECKPOINT.json`.
- Four disabled Autopilot prompts now use checkpoint-driven routing (current
  mailbox **#639**) and remain disabled. The enabled management automation
  already uses dynamic routing. Read-only event pilot **#673** is unchanged.
- V2 remains **SOURCE_AUDIT**. Canonical execution, strategy PnL, Discovery,
  Validation, Holdout, Paper and Live authorization remain **false**.
- Trial-history coverage and authorized reproduction budget remain **UNKNOWN**;
  the #814 inventory is bounded/incomplete. No new empirical work, backtest, or
  strategy PnL is authorized or claimed.
- Publisher setup: failed owner attempt documented in #571 comment
  **6198795959**. The one-shot marker is preserved. Owner pause **6199968669**
  remains in force. Real provider/DB/terminal/Codespace/browser state is
  **UNKNOWN**. The prior read-only preflight remains paused; this refresh
  authorizes no publisher next step. No recovery, retry, credential, provider,
  or browser action has been performed; recovery/retry remain separately gated.
- Decision records **6103358472**, **6178949360** and **6197277097** are resolved.
  Stale items **#653, #675 (issue), #686 and #690** are closed with readback.
  Clock-skew/#811 reconciliation: **6198817919**; retrospective
  FINAL_MERGE_STATUS for #782: **6198847209**.
- Owner approved **#818 housekeeping and WIP limit 3** at
  **2026-10-15 20:16:49 Europe/Vienna**: “Ja Freigabe erteilt”, recorded
  RESOLVED in comment **6199107184**. WIP is limited to three active packages;
  remaining proposals belong in backlog. Watchdog source routing is merged and active,
  but the first hosted watchdog PATCH remains unproven. The lead activation edit is not bot evidence. Do not infer
  Codespace shutdown from this handoff.

- Historical #814 run **38776991839**, head
  `43a351328159bf9526c6bba1f8ff93f91a2298cc`, attempt 1, remains
  `action_required`/not executed. Preserve it as historical blocked evidence;
  it was not retrospectively passed by the later #814 merge.
- Six further historical decisions were marked RESOLVED in place with existing quote/time evidence: 6171848445, 6187867522, 6175341101 (SUPERSEDED), 6177231926, 6177550606, 6178534667. No new authority granted.

### Resume and completion rules

Read the checkpoint-selected mailbox, current main and relevant CI before acting.
Mailbox **#639** is active; #571 is archived. All seven research/execution
authorization flags remain false; V2 remains **SOURCE_AUDIT**. Four disabled
Autopilot prompts remain disabled, management routing remains unchanged, and
read-only event pilot #673 is unchanged. WIP limit **3** and the #818 owner
approval history remain in force.

Complete exact-head CI and full-scope review for this handoff refresh before
lead-guarded publication. Do not infer the publication commit from source main.
This refresh authorizes no infrastructure action, publisher preflight, marker
recovery, retry, or second credential-setup attempt.

Handoff-only validation run locally with Node **v24.21.0** and Python
**3.12.3**: `python3 -m json.tool MERIDIAN_LIVE_CHECKPOINT.json` **PASS**;
`node scripts/continuity-audit.mjs` **PASS** (`ok: true`, build r128);
`node scripts/frozen-research-guard.mjs` **PASS** (140 checked, 0 mismatches);
`python3 scripts/validate-agent-orchestration.py` **GREEN**; `git diff --check`
**PASS**. Node **20.20.2** is not installed locally, so these local Node audits
were not run on the CI Node version. PR #814's exact-head CI was Node 20.20.2,
but applies to that source PR, not this refresh. No new tests or external/runtime
actions were run. Unknown checks remain unknown; a source merge alone is not
runtime acceptance.

Toolchain follow-up for handoff PR **#821**, head
`50f332035d8c7c087b26597c61e52c2f53b86bce` / base
`2736f9d1d98988858373c05c05a7d5a67cbca27b`: `.github/workflows/backend-safety.yml`
selects `node-version: 20`. `ls -1 /opt/hostedtoolcache/node` returned only
**22.23.3** and **24.21.0**; active `node --version` is **v24.21.0**
(`/opt/hostedtoolcache/node/24.21.0/x64/bin/node`). Node 20 is unavailable in
this runner, so the exact-CI-toolchain checks could not be run locally. Exact-head
Release Safety run **38803617504** is `action_required`, with **0 jobs** and no
job logs; it is not a pass. No workflow dispatch/retry was attempted, and no
full-scope Claude source-acceptance request has been made. Next: obtain successful
exact-head CI under the configured toolchain, then request full-scope review.

---

## Historical archive — superseded operational snapshots


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

- Build: **10.0-r128**
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



## CHAT HANDOFF — 2026-10-06

- Live main: `ab1c4254168c5fa024405fcb92447e3f4151ed9a`
- terminalBuild: `10.0-r127`
- R126 / PR #586: MERGED, Claude exact-head GREEN_LIGHT, pre/post-merge core gates GREEN.
- R126 Pages/Runtime incident: Runtime Smoke failed because public Pages still served r125 while Pages deploy stayed WAITING. Claude diagnosis run `37518085057`: LIKELY_ROOT_CAUSE = GitHub platform-side stall of legacy Pages deploy, not repo code/config. Do not blindly rerun or mutate; reconcile live Pages/runtime state first.
- Stage 2 / PR #585: safely rebased on R126, exact head `2528ed285391e532b1055e18744aa9222f8e8c3a`, 0 behind, mergeable Draft, Release Safety + Visual QA GREEN, Claude GREEN_LIGHT. Still frozen; no release/merge authorization.
- Historical STREAM-SAFE-V7 design (superseded by the active checkpoint protocol; not current instructions): Claude GREEN_LIGHT run `37518857170`. Goal: very short resumable turns. Historical rule: one bounded state-pack/read per turn; after any mutation STOP; long CI/Claude request then STOP; no repeated polling; WAITING/no-op turns are valid; concise replies only.
- Authoritative mailbox: Issue #571.
- Hard boundaries unchanged: V2 SOURCE_AUDIT; canonicalExecutionAuthorized=false; strategyPnlAuthorized=false; discoveryAuthorized=false; validationAuthorized=false; holdoutAuthorized=false; paperAuthorized=false; liveAuthorized=false; no trading action.
- Next chat bootstrap: user can write exactly `Go Meridian`. First action: reconcile #571 + live main + checkpoint + only relevant PR/runs. Do not repeat completed writes.
