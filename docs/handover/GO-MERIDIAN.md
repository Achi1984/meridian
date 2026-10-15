# GO MERIDIAN — durable resume checkpoint

## Current handoff — 2026-10-15

This section is the current operational summary. Historical snapshots below are
retained for provenance, not as instructions or evidence of present state.

- Verified source main: `0df76e19d4b04142896e227b2b2e05671b21b80c`, PR **#817** merged.
  Verified post-merge success for that commit: Release Safety **38781127242**,
  Runtime Smoke **38781127295**, Release Coordinator **38781127331** and
  Pages **38781126415**. This evidence applies only to these runs.
- Terminal build: **10.0-r128**; checkpoint protocol: **STREAM-SAFE-V8**.
- Active work: **one housekeeping package before the next infrastructure step**.
  Infrastructure work is paused until this package is completed.
- This staged candidate routes to **#639** (predecessor **#571**) and pins
  watchdog status comment **6198924473**. Activation requires the owner-approved
  merge; the external authoritative mailbox remains **#571** before that merge.
  Successor runtime smoke is **not yet verified**. After activation, resolve
  routing from `MERIDIAN_LIVE_CHECKPOINT.json`.
- V2 remains **SOURCE_AUDIT**. Canonical execution, strategy PnL, Discovery,
  Validation, Holdout, Paper and Live authorization remain **false**.
- Publisher setup: failed owner attempt documented in #571 comment
  **6198795959**. The one-shot marker is preserved. No recovery or second
  attempt has been performed; each needs its own separate owner approval.
- Decision records **6103358472**, **6178949360** and **6197277097** are resolved.
  Stale items **#653, #675 (issue), #686 and #690** are closed with readback.
  Clock-skew/#811 reconciliation: **6198817919**; retrospective
  FINAL_MERGE_STATUS for #782: **6198847209**.
- Watchdog single-comment behavior and WIP limit **3** remain proposals,
  not adopted behavior. Do not infer Codespace shutdown from this handoff.

### Resume and completion rules

Read the checkpoint-selected mailbox, current main and relevant CI before acting.
Complete the reviewed housekeeping package and
its rollover/decision records, then determine the next permitted infrastructure
step. Do not repeat setup or clear its marker.

After every completed merge block, refresh this file together with
`MERIDIAN_LIVE_CHECKPOINT.json`, `docs/MERIDIAN_CHAT_HANDOFF.md`,
`MERIDIAN_HANDOFF.md` and `docs/handover/GO-MERIDIAN.md`: record the verified
commit, review/CI evidence, pending decisions and exact next step. Unknown checks
must remain explicitly unknown; a source merge alone is not runtime acceptance.

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

