# GO MERIDIAN — durable resume checkpoint

## Current completion and authority — 2026-10-17

Operation: HANDOFF-824-825-20261017-01. Verified source main:
`bfebd17ddfa1d2d3b44a15126e28618a82cb81f2` (#828). Build **10.0-r129**.
This section supersedes all older operational summaries below. This handoff
candidate has no claimed publication SHA.

- Arena #824 merged at `ed60066fc58b4d60eddd727c24cae61c368720bb`.
  Full-scope review 6229617979; all six postchecks succeeded:
  Release39002934108, Runtime39002934109, Coordinator39002934102,
  Visual39002934147, Orchestration39002934170, Pages39002933046.
  FINAL_MERGE_STATUS6229668839. Retrospective offline diagnostic only;
  no forward/holdout/profitability proof, no runtime orders or auto-promotion.
- Publisher #825 merged at `8691381510039e2ad48b863ea5e66d6ad6cba462`. Full four-file review
  6229794718; premerge CI39003151050 succeeded (2561 pass, zero failures).
  Local19 fault tests passed CPython3.14.2 with pinned dependencies.
  FINAL_MERGE_STATUS6229853101. All four postmerge checks succeeded:
  Release39004204488, Runtime39004204504, Pages39004203840;
  Coordinator39004204485. Source packet complete.
- Read-only owner-path inspector #828 merged at the verified main above.
  Review6229960697; FINAL_MERGE_STATUS6229980850. Postchecks pending.
  No production caller, recovery or setup was added.
- The publisher primitive is inactive: no CLI or production caller.
  A future reviewed wrapper must establish canonical passwd-owner paths,
  authenticated approval/source evidence, fresh exclusivity and provider/DB
  reconciliation. Any propagated exception must be treated as uncertain.
  Real marker, credentials and DB were not touched.
- Owner instruction at 2026-10-17T06:31:42+02:00:
  “Du kannst selbst zukünftig über merges entscheiden - freigabe erteilt”.
  Recorded in mailbox639/comment6229644994. ChatGPT now decides future merges;
  older per-merge owner-confirmation requirements are superseded. Exact-head/base
  CI, full independent review, single writer, expected-head guards and successful
  postchecks remain mandatory. This delegates merge decisions only, not runtime
  recovery/setup, activation, trading, spending or schedule/credential changes.

- Owner working model at 2026-10-17T07:04:42+02:00: Christoph sets direction;
  ChatGPT is chief developer for architecture, coherent work packages, agent
  assignments, integration, quality and merge decisions. Agents implement bounded
  scopes or independently review; single-writer and runtime gates remain intact.

NEXT: verify #828 postchecks, complete #826 continuity review and prepare the separately reviewed
runtime wrapper. Concrete recovery and subsequent setup remain separately
owner-gated. CV2 remains SOURCE_AUDIT with all seven flags false; CRV unresolved.
Autonomous end-to-end live development remains unproven.

## Historical Arena candidate — superseded 2026-10-16

Build: **10.0-r129** (unmerged candidate). Canonical merged source remains
`0a32b25c5be4db4d0ae7d3473c664bd7c35e326d` (#821; all four postchecks passed,
FINAL_MERGE_STATUS 6214143240). Earlier current-summary sections below are
historical snapshots, superseded by the live checkpoint for current work.

Owner mandate at 22:35:21+02:00 authorizes isolated strategy Paper-arena integration
and evaluation with agents. Four offline virtual models (H1-B, H1-E, H7-B, H7-R)
plus H9 BLOCKED_DATA; no connected Paper/runtime orders or Live activation.
Source/rules receipts precede replay; historical output is diagnostic, not fresh
Holdout or forward proof. CRV compatibility remains unresolved, not waived.
All CV2 SOURCE_AUDIT authorization flags remain false; publisher recovery/setup
remain separately gated. See `docs/strategy-lab/PAPER_ARENA_PROTOCOL_20261016.md`.

NEXT: complete local engine/receipt/UI checks, exact-head CI and independent
full-scope review before a guarded merge. No candidate publication SHA is claimed.


## Historical handoff — 2026-10-16 (superseded)

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
- Active work: complete PR #821 on its revised candidate with exact-head CI and
  independent full-scope review, then lead-guarded publication. No infrastructure
  action is authorized by this refresh.
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
  **6198795959**; the one-shot marker remains untouched. Mailbox comment
  **6199968669** records the owner continuation at **2026-10-16 09:26:47 +02:00**
  and a point-in-time **Stage 1 read-only reconciliation PASSED** using runner
  revision `f0204ec0781598d9fb368088021b33e738505ed4`. The recorded owner-window
  confirmation at **09:21:31 +02:00** was “nein parallel arbeitest nur du daran.”
  The earlier pause and browser-unavailable statements are historical and
  superseded. Provider/DB results are point-in-time only; long-term Codespace and
  current provider/DB state remain unknown. Sign-in was restored for that Stage 1
  session; ongoing browser state is unknown. No password/secret/LOGIN writes were
  reported, but absence of previously assigned role passwords is **NOT
  ESTABLISHED**. Stage 2 is **PLAN_ONLY**: CPython **3.14.2** tests, exact-head CI
  and independent full-scope review precede any concrete recovery approval.
  Marker retirement and a subsequent setup attempt remain separately
  owner-gated. No recovery implementation, marker retirement or setup attempt
  occurred; the first hosted watchdog PATCH remains unproven and the lead
  activation edit is not bot evidence. The publisher lane's next permitted step
  is Stage 2 plan review only, not runtime recovery.
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

Immediate PR #821 closure requires exact-head CI and independent full-scope
review on the revised candidate, followed by lead-guarded publication. Do not
infer the publication commit from source main. After this handoff closure, the
publisher lane's next permitted step is Stage 2 plan review only, requiring
CPython 3.14.2 tests, exact-head CI and independent full-scope review before any
concrete recovery approval; marker retirement and a subsequent setup attempt
remain separately owner-gated. The strategy lane's next step is source-only
PR #823. None of these handoff statements authorizes runtime recovery or setup.

Validation evidence is commit-scoped. The earlier Node **v24.21.0** checks and
Node-20-unavailable notes are historical observations, superseded by the verified
official Node **v20.20.2** run on commit
`4cbdf5bf4a12a44bfbea61ca7cb26a26d98bf87d` (Python **3.12.3**). The official
Linux x64 archive passed Node.js `SHASUMS256.txt` verification
(`df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d`); binary
SHA-256 `6295488653f0d93b0a157841746fef7e72cc4328cfb60c4bbe0ca2668a836ffd`.
On that commit, `npm ci --ignore-scripts` passed; `node
scripts/continuity-audit.mjs` passed (r128); `node
scripts/frozen-research-guard.mjs` passed (140 checked, 0 mismatches);
`V11_A2_EVIDENCE_DIR=artifacts/v11-visual-qa node --test test/*.test.js`
passed (2,525/2,525); `node scripts/release-sync.mjs --check && node
scripts/release-check.mjs`, `node scripts/v10-ui-regression-check.mjs`, `node
scripts/privacy-check.mjs`, and `node scripts/secret-check.mjs` passed;
`python3 -B scripts/validate-agent-orchestration.py`, checkpoint JSON, and
`git diff --check` passed. Exact-head Release Safety **38806497445**, attempt 2,
job **116681553158**, also succeeded on that same commit. These results do not
cover later heads.

The intervening commit `9d2665d4e97fee4e5745553d93bb61ad81a23a00` added only
generated PNG/`.pyc` files; those exact generated paths were removed, and
Release Safety **38811069787** for that dirty head was `action_required`, not a
pass. On the cleaned candidate `95fd925aa3d7aed3b18411becee189a8c0934687`,
Node **v20.20.2** and Python **3.12.3** validation passed:
`python3 -m json.tool MERIDIAN_LIVE_CHECKPOINT.json`;
`node scripts/continuity-audit.mjs` (r128);
`node scripts/frozen-research-guard.mjs` (140 checked, 0 mismatches); and
`PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/validate-agent-orchestration.py`
(GREEN). Node was selected with
`PATH=/tmp/meridian-node20-final/runtime/bin:$PATH`; bytecode was disabled and
`V11_A2_EVIDENCE_DIR=/tmp/meridian-node20-final/artifacts/v11-visual-qa`
kept any screenshot output outside the repository. No full suite was rerun on
that documentation-only candidate. Exact-head Release Safety
**38855226605**, attempt 2/job **116863146674**, succeeded on **95fd925**:
2,525 passed and 0 failed, cancelled, skipped or todo. Claude review
**6212356397** returned **REVISION_REQUIRED** on **95fd925**. Neither result
covers the corrected candidate; its exact-head CI and independent full-scope
review remain pending. No workflow dispatch/retry has been made.

On the corrected working tree derived from `95fd925`, the official Node
**v20.20.2** runtime archive was checksum-verified again. `python3 -m json.tool
MERIDIAN_LIVE_CHECKPOINT.json`, `node scripts/continuity-audit.mjs` (r128),
`node scripts/frozen-research-guard.mjs` (140 checked, 0 mismatches),
`PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/validate-agent-orchestration.py`
(GREEN), and `git diff --check` all passed. The exact commands, runtime path,
archive checksum and Python **3.12.3** version are recorded in the checkpoint.
These are local working-tree checks, not exact-head CI; the revised candidate
still requires fresh CI and full-scope review. No full test suite or visual
artifact generation was run for this documentation-only correction.

---

## Historical archive — superseded operational snapshots


Updated: 2026-10-07
Resume keyword: **Go Meridian**

## Operating mode
- ChatGPT = Lead Architect / Lead Developer / Product Owner / sole Merge Owner.
- Claude = independent cross-model reviewer, challenger and second developer in read-only mode unless explicitly authorized otherwise.
- User wants MERIDIAN developed autonomously 24/7 and only wants to be involved for major product/risk decisions, protected-gate authorizations, secrets/permission changes, waivers, or blockers that genuinely need manual input.
- User approval in chat: **MERIDIAN 24/7 AUTONOMY V1**.
- iPhone / ChatGPT app does **not** need to stay open for GitHub Actions or configured ChatGPT automations.

## Mandatory resume protocol
Before every MERIDIAN work step:
1. Read latest comments in GitHub Issue #571.
2. Read `MERIDIAN_LIVE_CHECKPOINT.json`.
3. Check live `main` SHA and terminalBuild.
4. Check relevant CI/gates.
5. Check only relevant open PRs/branches.
6. Treat GitHub live state as authoritative; never repeat an uncertain write after a stream interruption.

Follow the active protocol in `MERIDIAN_LIVE_CHECKPOINT.json` and `MERIDIAN_GO.md`.
V8 uses authorized work packages with guarded atomic writes and checkpoints,
independent exact-head review and explicit Project Owner merge approval.
A policy update does not authorize dispatch, spending or workflow changes.
Historical snapshots below are not live-state evidence.

## Current live state
- Repository: `Achi1984/meridian`
- main: `5fe94a77749d8d73df431b0104d8d870fa07dbf6`
- checkpoint protocol: STREAM-SAFE-V7
- terminalBuild: **10.0-r126**
- Durable handover path: `docs/handover/GO-MERIDIAN.md`

## Claude Development Watchdog
- Workflow: `.github/workflows/claude-watchdog-15m.yml`
- First real scheduled watchdog run succeeded overnight:
  - run: `37553049529`
  - head: `5fe94a77749d8d73df431b0104d8d870fa07dbf6`
  - result: SUCCESS
  - active PR: #585
  - verdict: CHALLENGE
- First real watcher status fingerprint:
  `8e410b13bc96bec5b4217d1f3f26d0b6a5195874b2484aa1dc80cbd10abd06f3`
- No second recurring run appeared for ~1h40m after the first run.
- Claude independently diagnosed this as **PLATFORM_STALL** / GitHub best-effort schedule throttling, not workflow logic, not config block.
- Claude recommended moving the cron away from quarter-hour load peaks:
  - old: `*/15 * * * *`
  - new: `7,22,37,52 * * * *`
- Neutral branch created:
  `ops/watchdog-offset-cron`
- Cron offset commit:
  `b37a282c6c57281a88d89e9ed56f711e103e917d`
- That branch currently contains the one-line cron fix.
- The next planned step was: reconcile exact head `b37a282c6c57281a88d89e9ed56f711e103e917d`, check whether a PR already exists; if not, create a small Draft PR, let exact-head CI run, request Claude exact-head review, then merge only after GREEN.

## Watchdog verification rule
Do **not** claim fully verified autonomous operation until:
1. a real watchdog run completed successfully; **done**.
2. a subsequent unchanged tick proves dedupe/skip with no extra Claude invocation/token spend; **not yet proven**.

Only after both are proven say exactly:
**AUTONOMER BETRIEB VERIFIZIERT – du kannst schlafen gehen.**

## Stage 2
- PR #585: **Stage 2 Draft: Asset Detail decision surface**
- head: `665201f63811c6ed0b9454c1ab74682fafac91f7`
- base: `e304f1b480c92f9432d9eca0271fdd879acc3d65`
- draft: true
- mergeable reported: true
- Claude watchdog found a semantic/scope mismatch:
  - PR body says “no hero reorder”
  - implementation moves accounting guard above hero
- Claude recommendation:
  - make the intended order explicit;
  - either restore hero-before-guard and satisfy invariant another way,
  - or keep guard-before-hero, correct PR body, and add a DOM-order test:
    `topbar > data-state > guard > hero`
- Keep #585 Draft until resolved and re-reviewed.
- No terminalBuild/release change for Stage 2 until then.

## 24/7 control-plane roadmap
After watchdog recurrence is stable:
1. machine-readable work queue: READY / IN_PROGRESS / WAITING_CI / WAITING_USER / FROZEN / DONE;
2. heartbeat / dead-man state;
3. stuck-state counter;
4. failure classification: TRANSIENT / PLATFORM_STALL / CODE_RED / CONFIG_BLOCK;
5. bounded retry/backoff;
6. Claude run/comment budget + per-fingerprint retry cap;
7. mechanically checkable single-writer lease;
8. low-noise status output;
9. prompt-injection / security hardening.

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
- ChatGPT task **Meridian Autopilot** exists on an hourly exact schedule.
- GitHub Claude Development Watchdog is intended to run four times per hour.
- Unchanged state should skip Claude/model-token spend via fingerprint/dedupe.
- Phone/app may be closed; server-side automation is independent.

## Immediate NEXT
1. Reconcile #571 + checkpoint + main + Actions + branch `ops/watchdog-offset-cron`.
2. Confirm branch head still `b37a282c6c57281a88d89e9ed56f711e103e917d`.
3. Check whether a PR for `ops/watchdog-offset-cron` already exists.
4. If none exists, create exactly one small Draft PR for the cron-offset fix.
5. Let exact-head CI run.
6. Request Claude exact-head review on that exact head.
7. Merge only after GREEN and normal release safety.
8. Observe at least two recurring offset ticks, with the second unchanged tick skipping Claude.
9. Then declare full autonomous verification.
10. After watchdog stability, implement the 24/7 control-plane roadmap and then resolve Stage 2 #585.

## Latest Claude scheduler diagnosis
Mailbox comment id: 6029495669. Classification: PLATFORM_STALL. Recommendation: offset cron to 7,22,37,52 and validate exact-head via CI + Claude.

---
When the user says **“Go Meridian”** in a new chat, start from this file **plus live GitHub reconciliation**. Never trust this snapshot over newer GitHub state.
