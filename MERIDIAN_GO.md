# MERIDIAN GO

Canonical quick-start for the user command: **Go Meridian**

## Meaning
When the user says **Go Meridian**, continue MERIDIAN autonomously from the real live repository state. Do not rely on stale chat handoffs or remembered SHAs.

## Bootstrap order
1. Read `MERIDIAN_LIVE_CHECKPOINT.json`.
2. Resolve the active Claude mailbox from `mailboxIssue`; read only the bounded latest relevant request/response/status items.
3. Fetch live `main` SHA, `version.json -> terminalBuild`, the one relevant PR and its relevant runs.
4. Reconcile any interrupted operation before writing. Repository state is authoritative.
5. Continue exactly one safe next action unless a real user decision or authorization gate is required.

## Roles
- ChatGPT: Lead architect, implementer, product owner and merge owner.
- Claude: independent read-only reviewer/challenger. Exact-head review before critical merge.
- Claude may use the read-only surfaces granted by the mailbox workflow, but may not edit/write repository content or mutate GitHub except the requested mailbox response comment.

## STREAM-SAFE-V7
Turn length is the primary transport budget.

- Maximum one bounded remote tool-call group per assistant turn.
- Maximum one repository mutation per assistant turn.
- After any mutation: preserve a short auditable checkpoint (commit/op-id/PR-local status as appropriate) and end the turn. Under the approved decision-only policy, do not send unsolicited routine progress messages; reconcile on the next authorized chat or scheduled invocation.
- A Claude request is a mutation: post it, then stop. Never wait for Claude in the same turn.
- Poll a still-running CI/reviewer/platform state at most once per user turn. `WAITING` is a valid terminal turn state and is not, by itself, a reason to notify the user.
- Prefer one bounded state pack: mailbox tail (max 5), checkpoint, live main, one relevant PR, relevant run IDs/statuses. No full mailbox dump.
- Do not fetch log bodies unless a named job failed. Inspect at most one bounded failing log slice per turn.
- Never use sleep/retry loops inside a turn.
- Stop on the first unexpected state (head moved, unknown/red check, scope drift) and diagnose on the next turn.
- Never repeat a write after interruption without reconciliation. Use op-id plus expected head/blob/base guards.
- Same Claude request ID + same exact head must never be reposted while running or already answered.
- At most two short user-visible checkpoints per turn.
- Keep tool-result echoes compact; IDs, SHA, state and blocker only.
- Bare `Go` always means RECONCILE -> CLASSIFY -> one safe next action. It never means repeat the previous write.
- Preserve a deterministic next action in the durable operation checkpoint when work remains. Include a user-visible `NEXT:` line only when the user explicitly requests status or must make a decision.
- Large or irreversible work must be split into durable atomic steps.
- Transport rules never relax exact-head review, CI, Research-stage, PnL, execution, release or Single-Writer gates.

### Source transport budgets (approved Transport & Feedback V1)
`maxPayloadBytes=4096` bounds rendered progress/log excerpts only. Source uploads use
`maxSourceFileBytes=262144` UTF-8 bytes per file and
`maxSerializedUploadBytes=393216` bytes per complete encoded request.
Run `node scripts/stream-safe-preflight.mjs --upload-budget contents` (or `blob` / `tree`)
with the actual complete tool arguments on stdin before upload. Verify source blob
SHA before/after publication and preserve the expected-head/CAS checks. A budget
pass is not authorization, CI, review or permission to bypass one mutation per turn.
Full details and approval provenance: `MERIDIAN_AGENT_WORKFLOW.md`, Transport V1.
Watchdog suppression is a separate implementation; these budget changes do not enable it.

### Recovery classification
After reconciliation classify the prior operation:
- `OP_APPLIED`: intended effect exists -> do not repeat; advance.
- `OP_ABSENT`: effect absent and expected base/head unchanged -> eligible for one guarded retry.
- `OP_CONFLICT`: head/base moved or different operation owns the state -> stop and supersede with a new op-id next turn.
- `WAITING`: external work still running -> report exact IDs/status and end the turn.
- `BLOCKED_STREAM`: second interruption of the same step -> stop automatic retries.

Evidence > assumptions.

## Mailbox hygiene
Use the mailbox issue resolved from `MERIDIAN_LIVE_CHECKPOINT.json`.
Mailbox is reserved for:
- `CROSS_MODEL_REQUEST`
- `CROSS_MODEL_RESPONSE`
- `CROSS_MODEL_STATUS NEEDS_USER_DECISION`
- `FINAL_MERGE_STATUS`

INTENT/progress belongs in one continuously updated PR-local lead-status comment. Rollover the mailbox when the configured comment threshold is exceeded, and update routing coherently before archiving the predecessor.

## Product-owner governance
- Standard UI/presentation terminal cadence: maximum one UI release merge per calendar day. Genuine bugfix/trust/safety fixes are excepted.
- Any additional same-day UI release requires a release-specific `CROSS_MODEL_STATUS NEEDS_USER_DECISION` that names the blocked release and the cadence conflict, followed by an explicit user answer authorizing that exact release. The authorization is single-use and does not carry forward to later releases.
- A prior user override may never be generalized into a standing exception. In particular, "Go – Regel ändern und R125 heute mergen" authorized R125 only.
- Before every `@claude` request, inspect the authoritative mailbox for the same Request-ID + exact head. If an unanswered matching request already exists, do not repost. If a matching response already exists, do not repost.
- Changes to autonomy rules, release cadence, watchdog/workflow behavior, scheduler behavior, or 24/7 operating rules always require `CROSS_MODEL_STATUS NEEDS_USER_DECISION @Achi1984` and an explicit user answer before merge. Post-hoc authorization is invalid.
- Current 24/7 MERIDIAN operation is explicitly user-authorized. ChatGPT Autopilot and Claude Watchdog may run 24/7; quota protection must come from state-change detection, deduplication and staggered scheduling rather than quiet hours.
- Scheduling target: ChatGPT Autopilot at minute :27 and Claude Watchdog at minute :57, avoiding intentional parallel starts.
- GitHub scheduled workflows are best-effort. Do not open further Ops PRs solely to make cron delivery "reliable"; only act if a completed source/expected workflow demonstrates a real configuration defect.
- These governance rules never relax exact-head CI/review, expected-head merge protection, Single-Writer, research-stage, PnL, execution, privacy or safety gates.

## Hard research / trading boundaries
The live checkpoint is authoritative. Unless it explicitly says otherwise, do not perform or authorize:
- canonical execution
- strategy PnL
- Discovery
- Validation
- Holdout
- Paper transition
- Live transition
- trading actions

Vision is not authorization.

## Product principle
**Complex inside – simple outside.**

Priority:
QUALITY > SPEED
EVIDENCE > ASSUMPTIONS
CLARITY > FEATURE COUNT
ROBUST EDGE > WIN RATE
PAPER FIRST > LIVE
RISK > PROFIT MAXIMIZATION

## Completion behavior — decision-only communication (approved 2026-10-07)

Product Owner approval: GitHub mailbox #571 comment `6045216366` (`MERIDIAN-USER-COMMUNICATION-V2`).

- Do not ask the user to repeat recoverable repository context.
- Do not interrupt or send individual updates about ordinary defects, failing CI/QA, review corrections, stream recovery, retries, waiting states, or normal implementation/PR progress. Lead + Claude handle them internally and capture evidence in CI, commit op-ids, or PR-local status.
- Request a user decision **only** when necessary to change product/development direction, architecture, scope or priorities, risk/trust/safety stance, meaningful cost or external service, agent/governance policy, release-cadence exception, strategy/research stage, or Paper/Live/trading authorization. Present a concise recommendation with options.
- A failed gate never becomes permission to merge; fail closed and escalate only when a material Product Owner choice is actually required.
- When the user explicitly requests a status or final deliverable, answer briefly and truthfully. Do not imply chat is running in the background; scheduled automations/workflows, where configured, remain independently governed.
- This policy changes **communication only**. STREAM-SAFE-V7 mutation/turn limits, expected-head checks, release lease and cadence, exact-head CI, Claude review, Single-Writer, privacy and all research/trading authorization gates remain unchanged.

