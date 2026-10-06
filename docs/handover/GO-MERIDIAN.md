# GO MERIDIAN — durable resume checkpoint

Updated: 2026-10-06
Resume keyword: **Go Meridian**

## Operating mode
- ChatGPT is Lead Architect / Lead Developer / Product Owner / Merge Owner.
- Claude is independent cross-model reviewer, challenger and second developer in read-only mode unless explicitly authorized otherwise.
- User wants MERIDIAN developed autonomously 24/7 and only wants to be involved for major product/risk decisions, protected-gate authorizations, secrets/permission changes, waivers, or blockers that genuinely need manual input.
- User approval in chat: **MERIDIAN 24/7 AUTONOMY V1**.
- iPhone / ChatGPT app does **not** need to remain open for GitHub Actions or configured ChatGPT automations.

## Mandatory resume protocol
Before every MERIDIAN work step:
1. Read latest comments in GitHub Issue #571.
2. Read `MERIDIAN_LIVE_CHECKPOINT.json`.
3. Check live `main` SHA and terminalBuild.
4. Check relevant CI/gates.
5. Check only relevant open PRs/branches.
6. Treat GitHub live state as authoritative; never repeat an uncertain write after a stream interruption.

Follow **STREAM-SAFE-V7**:
- one bounded remote tool-call group per assistant turn;
- at most one repository mutation per assistant turn;
- after a mutation, stop and reconcile next turn;
- Claude request is a mutation: post, then stop;
- at most one poll per turn; WAITING is terminal for that turn;
- use CAS / expected SHA where applicable;
- never duplicate a Claude request for the same request-id + head;
- stop on surprises;
- unfinished work ends with NEXT.

## Current live state at this checkpoint
- Repository: `Achi1984/meridian`
- main: `c46b925ecc9306020909407c16433259ae4622f4`
- checkpoint protocol: STREAM-SAFE-V7
- Watchdog PR #588: merged to main earlier at `c46b925ecc9306020909407c16433259ae4622f4`.
- Claude watchdog workflow: `.github/workflows/claude-watchdog-15m.yml`
- Configured cron: `*/15 * * * *`
- Workflow was independently confirmed by Claude as registered and **active** in GitHub Actions.
- At this checkpoint, watchdog scheduled runs visible: 0.
- Claude diagnosis: YAML valid; most likely GitHub scheduler delay for a newly added schedule. Do not shorten cron merely as a probe. Preferred smoke is existing `workflow_dispatch`, but current ChatGPT GitHub connector has no dispatch action. Treat persistent no-run after roughly 1–2 hours as a scheduler/platform activation problem.
- Do **not** claim autonomous operation verified until:
  1. a real watchdog run has completed, and
  2. a subsequent unchanged tick proves dedupe/skip with no extra Claude invocation/token spend.
- Only then say exactly: **AUTONOMER BETRIEB VERIFIZIERT – du kannst schlafen gehen.**

## Current product/development lane
- Stage 2 PR #585: **Stage 2 Draft: Asset Detail decision surface**
- head: `665201f63811c6ed0b9454c1ab74682fafac91f7`
- base: `e304f1b480c92f9432d9eca0271fdd879acc3d65`
- draft: true
- mergeable reported: true
- Stage 2 was losslessly rebased before watchdog work; after PR #588 merge it may be behind main and must be reconciled before further writes.
- Stage 2 remains Draft until exact-head checks/review are current.

## 24/7 control-plane roadmap
After watchdog verification, prioritize:
1. machine-readable work queue (READY / IN_PROGRESS / WAITING_CI / WAITING_USER / FROZEN / DONE);
2. heartbeat / dead-man state;
3. stuck-state counter;
4. failure classification (TRANSIENT / PLATFORM_STALL / CODE_RED / CONFIG_BLOCK) with bounded retry;
5. Claude run/comment budget + per-fingerprint retry cap;
6. mechanically checkable single-writer lease;
7. low-noise status output;
8. prompt-injection / security hardening.
Then continue Stage 2 and the product roadmap.

## Hard research/trading boundaries
These remain false unless the user explicitly approves the protected gate:
- canonicalExecutionAuthorized=false
- strategyPnlAuthorized=false
- discoveryAuthorized=false
- validationAuthorized=false
- holdoutAuthorized=false
- paperAuthorized=false
- liveAuthorized=false
Current V2 stage remains **SOURCE_AUDIT**.
No live trading action.

## Automation context
- ChatGPT task **Meridian Autopilot** exists on an hourly exact schedule and should continue from live GitHub state using STREAM-SAFE-V7.
- GitHub **MERIDIAN Claude Development Watchdog** is intended to run every 15 minutes.
- The watchdog uses cheap state fingerprinting before Claude; unchanged state should skip Claude/model-token spend.
- User's phone/app may be closed; server-side automation is independent.

## Immediate NEXT
1. Reconcile #571 + checkpoint + main + Actions.
2. Detect the first real `MERIDIAN Claude Development Watchdog` run.
3. If in progress: WAITING.
4. If failed: inspect only one named failure/log slice, fix safely.
5. If successful: verify its real watchdog status/comment and fingerprint.
6. Verify a later unchanged tick skips Claude.
7. Once verified, continue control-plane work autonomously, then Stage 2.
8. Escalate to the user only for a truly major/protected decision.

## Cross-model scheduler diagnosis reference
Claude response comment id: 6025452234. Verdict: GREEN_LIGHT (diagnosis only).

## Relevant open PRs at checkpoint
- #585 Stage 2 Draft: Asset Detail decision surface — DRAFT — head `665201f63811c6ed0b9454c1ab74682fafac91f7`
- #119 R44: BTC NEXT RANGE / COMPOUND V1 research — DRAFT — head `251a9726534d94dacd74050124d2b4fbd1811693`
- #103 R29: research replay coverage and gap-fill audit — DRAFT — head `9e94ac22683ca2bf98026cac32529d13e238ea7e`
- #93 research: audit Paper stop fills and re-entry behavior — DRAFT — head `f608d3911a1ec52c693f30f6e5a8c198b619f0d0`
- #77 Research: lock FIB V3 prospective holdout — DRAFT — head `8f0bbb641a5325697959b724c62a2a9ab29d8a4e`
- #76 Research: FIB Bot V3 daily anchors / 4h execution — DRAFT — head `7b15a8b37431af317bc5d8b50ef960024b353982`
- #75 Research: FIB Bot V2 4h replication — DRAFT — head `b8fc8edf66394f4a2ab63b48f511e3a37a80b00d`
- #74 Research: FIB Level Bot V1 — DRAFT — head `c3cc6dd38ab5bdb54abbee4863e4e9d444cdb12f`

## Relevant recent CI snapshot
- MERIDIAN Release Safety: completed/success — 37530608839 — c46b925ecc9306020909407c16433259ae4622f4
- MERIDIAN Runtime Smoke: completed/success — 37530608729 — c46b925ecc9306020909407c16433259ae4622f4
- MERIDIAN Release Coordinator Sweep: completed/success — 37530608607 — c46b925ecc9306020909407c16433259ae4622f4
- pages build and deployment: completed/success — 37530607887 — c46b925ecc9306020909407c16433259ae4622f4
- MERIDIAN Release Safety: completed/success — 37529340189 — d7e042f33fd22e9e77fb28ba065c3a40b7cbbd29
- MERIDIAN Release Safety: completed/success — 37528399536 — 311ce5b64b753e873dc3512c74e2a2f3c3710e53
- MERIDIAN Visual QA: completed/success — 37526035658 — 665201f63811c6ed0b9454c1ab74682fafac91f7
- MERIDIAN Release Safety: completed/success — 37526035568 — 665201f63811c6ed0b9454c1ab74682fafac91f7
- MERIDIAN Agent Orchestration Safety: completed/success — 37524693214 — e304f1b480c92f9432d9eca0271fdd879acc3d65

---
When the user says **“Go Meridian”** in a new/long-chat recovery context, start from this file plus the mandatory live reconciliation above. Never rely on this snapshot over newer GitHub state.
