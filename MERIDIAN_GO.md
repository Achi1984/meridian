> **Current delivery status — 2026-10-31, receipt cutoff 942/6548075649**
> Observed main: `fb51293011fa923a6427705ccfd30d667310e773` (PR #1078).
> PR #1076 is COMPLETE at `976be55b729edd3d67c22b304eb9b486ecf382ee`;
> receipt [942/6546538434](https://github.com/Achi1984/meridian/issues/942#issuecomment-6546538434)
> includes verified Pionex-only desktop acceptance, not real iPhone Safari acceptance.
> PR #1077 at `073810c26441aa6bae6113f37cd1cd7162407e4c` has green postchecks;
> [942/6547532817](https://github.com/Achi1984/meridian/issues/942#issuecomment-6547532817)
> leaves live acceptance open after Cloud Browser transport timeouts. Private UI,
> stored history points and schema privileges were not independently verified.
> PR #1078 has green exact-merge postchecks at the observed main above;
> [942/6548075649](https://github.com/Achi1984/meridian/issues/942#issuecomment-6548075649)
> records candidate CI 3369/3369 and cumulative Claude GREEN 6547784536/6547541367.
> Live acceptance remains open after Cloud Browser transport timeouts; no actual
> live zero-bot or stored-history point is claimed. Next: complete the open live
> acceptance and review the separate reliability source packet, not yet deployed.
> Do not rerun passed CI to solve a browser transport problem.
> Mailbox remains #942; routing, watchdog binding and authority flags are unchanged.
> Older current-labeled blocks below are historical snapshots. Preserve their
> failures, unknown results and authorization flags; they do not override this
> bounded delivery summary. No private amounts or new activation authority.

> **Continuity reconciliation — 2026-10-31 **
> Current integration is PR1074 at `4c2631fa34ca07e95c3d0c04a388f078b99edf5f`.
> PR1073 is COMPLETE (942/6541251700); PR1074 is COMPLETE
> (942/6545551700), with candidate CI3352/3352 and cumulative Claude GREEN
> (6544996830,6545086305). Main Safety41214502721/job124578635492 passed
> 3352/3352 after one unchanged retry; the initial CDP-start timeout is preserved.
> Runtime41214502864 and Pages/Mirror/Coordinator succeeded on the exact merge.
> Active mailbox remains #942. Rollover requires coordinated workflow routing,
> checkpoint and watchdog-comment binding; this candidate changes none of them.
> Historical pending recovery chains999/1050/1052/1063/1065/1067 have a prepared,
> unposted SUPERSEDED closure referencing1069/6540136819. Historical failed or
> unknown runs remain failed or unknown, never retroactively COMPLETE.
> Ledger confirmation is owner-explicit; OKX credential setup remains unresolved.
> The older current-labeled entries below are historical. Research, trading,
> credential, schedule, spending and runtime authority are unchanged.

> **Current continuity reconciliation — 2026-10-27**
> Verified and latest observed `main`: `f59c540e006c7931e9be2ca338ddd0039a1a9546`.
> PR #910 is merged and complete; all four postchecks succeeded (PR receipt
> #910/comment6449656966; mailbox #942/comment6449657435). PR #911 is complete
> at merge prefix `5e80112`; receipts 6448656195/6448656706.
> Mailbox #942 was read through comment6449657435; do not advance `lastSeenCommentId`
> beyond the latest actually read receipt.
> D2 issue #935 snapshot/comment6448721244, assessment6449045864, and mailbox
> #942/comment6449029155 record one approved trial completed (attempt 1, 44
> payloads): `NO_EDGE`, all nine checks false; neighbors: zero positive out of four
> for each cost scenario. Relative drawdown reduction is 2.3371%
> (not percentage points).
> The private local execution profile is frozen; the checked-in profile remains
> `NOT_FROZEN`. The Codespace is stopped. Independent acceptance of the full
> private result is pending. Issue #965 is historical evidence V2. PR #966 is the
> ACTIVE source-only V2 implementation on its existing single-writer branch,
> dispatched at #966/comment6449658001. Next gates: author delivery ->
> exact-head/base CI -> complete independent Claude review -> Lead merge/postchecks.
> This already-authorized generated-fixture source work is not blocked by the
> independently pending full private-result acceptance.
> No retry, tuning, new trial, Paper, Live, or runtime action. Existing
> activation flags remain false.
> Older current-labeled entries below—including #948 setup, #950 launcher,
> #955 summaries, #952 comparison, and D1/admission snapshots—are historical
> and superseded. Preserve receipts, failures, false flags, and provenance.
> No private paths are included.
>
> **Historical routing and review rule — owner decision 2026-10-23**
> Resolve `mailboxIssue` from the live `MERIDIAN_LIVE_CHECKPOINT.json` before posting.
> This reviewed rollover candidate selects #942, predecessor #639, watchdog status
> comment6371625947, threshold200. Before merge the live checkpoint still selects #639;
> archive #639 only after the successor smoke succeeds. Earlier mailbox declarations
> and handoff snapshots below are historical; they do not override live routing.
> Final exact-head Claude GREEN_LIGHT after completed successful CI remains mandatory.
> Lead-only closure of SOURCE_GREEN/CI_PENDING does not replace that final review.
> Owner decision and literal quotes: #639/comment6371484899. #941 completed with all
> postchecks (receipt6371614438). #940 remains held until routing/smoke completion.
> SOURCE_AUDIT and all false authorization flags remain unchanged; no activation.

# MERIDIAN GO

## Owner delivery model — effective 2026-10-30

Owner confirmed: “Ok speichere diese Arbeitsweise und nutze die Github Agents ideal um voran zu kommen”.
Authoritative receipt: #1061/comment6535067336.

- Deliver one coherent release candidate instead of a serial chain of small feature merges.
  B16 combines the reviewed UI and TP sources with release metadata/cache on one isolated
  integration branch. Preserve attribution; close original PRs only after verified incorporation.
- Keep one implementation owner per branch/problem. Assign other agents disjoint useful work,
  never duplicate diagnosis, tests or review merely to occupy capacity. Prefer GitHub coding
  agents when dispatch works; use isolated direct connector implementation when it is blocked.
  Distinguish assigned, queued, running and delivered states.
- Authors run focused meaningful tests. Hosted CI runs the full final candidate suite, then
  Claude performs one independent final review of the stable successful candidate. Supply exact
  head/base, synthetic merge binding, totals/steps, scope and residual risks together.
  Changed source needs applicable new validation; unchanged source does not need redundant review.
  Required main postchecks, guarded merges and live acceptance remain mandatory.
- Read existing cached health, logs and provider contracts before adding diagnostic telemetry.
  Add telemetry only for evidence genuinely unavailable elsewhere. Never guess categories or
  relax safeguards merely to make checks green.
- Verify the actual deployed SHA before attributing a failed live check to new source.
  Recovery stays bounded: no blind reruns or polling loops. Privacy and trading limits remain.
- Lead owns integration and decisions, reports milestones or concrete blockers, and continues
  already-authorized work within an active session without another Go. Do not imply background
  continuation beyond agents that are actually running.

This records the adopted working model, not technical workflow changes. Duplicate branch/PR
CI and deployment-precheck improvements remain separate patches. No tests, approval gates,
workflow triggers, permissions, schedules, spending or activation are changed by this section.

## Owner working model — effective 2026-10-17

Owner instruction at 2026-10-17T07:04:42+02:00: “Go merke dir die Arbeitsweise
du bist der Chef Entwickler und ich gebe Richtung vor und Agents arbeiten”.
Christoph sets direction. ChatGPT acts as chief developer: architecture,
decomposition into large coherent work packages, bounded agent assignments,
integration, quality and merge decisions. Agents implement their assigned scope
or independently review it. This overrides older role descriptions below;
single-writer, independent review and all runtime authorization gates remain.

## Delivery efficiency — owner instruction 2026-10-31

Owner: “Verbessere den Prozess nachhaltig”. Use one coherent release candidate
with one branch writer and disjoint agent tasks. Reuse completed diagnosis and
read existing cached health/log evidence before adding telemetry. The author runs
focused regression tests; hosted CI validates the complete candidate before one
independent final review. Supply the exact head/base, synthetic merge binding,
full test totals and required-step results in the first review request. Do not
repeat an unchanged source review; changed head/base still requires applicable
fresh validation. Never claim assigned work is running without evidence.

Release Safety runs for PR candidates and main, not a duplicate codex branch
push. Superseded PR runs may be cancelled; main postchecks use unique run groups
and are never cancelled by this rule. Runtime smoke checks the expected deployed
SHA before business behavior, reporting DEPLOYMENT_NOT_READY while that SHA is
not serving. Existing bounded retry limits and failure exit semantics remain;
readiness is not acceptance and all live checks must still pass.

Exact-pair full CI, independent review, guarded merge, required main postchecks,
actual deployed SHA and live acceptance remain mandatory. No permission, secret,
schedule, spending, research-stage or trading authority changes. Workflow changes
remain separately reviewed; this instruction is not blanket future authority.

## Owner merge delegation — effective 2026-10-17

This newer owner instruction supersedes the older per-merge approval rules in
this document: “Du kannst selbst zukünftig über merges entscheiden - freigabe
erteilt”, 2026-10-17T06:31:42+02:00, mailbox639/comment6229644994.
ChatGPT is the sole merge decision owner, including previously reserved source
paths. Do not ask the owner again merely because a merge changes those paths.
Exact-head/base CI, full independent review, expected-head protection, single
writer, scope verification and successful postmerge checks remain required.
The offline routine classifier is unchanged and remains advisory, never an
authorization mechanism. Its conservative classifications do not override this
newer owner instruction. Existing approval fields remain for historical and
runtime gates; owner merge approval is now satisfied by this delegation.
This is merge authority only. Runtime recovery and subsequent setup each still
need separate concrete approval; activation, trading, spending, credentials and
schedules are not authorized by this instruction.

Canonical quick-start for the user command: **Go Meridian**

## Meaning
When the user says **Go Meridian**, continue MERIDIAN autonomously from the real live repository state. Do not rely on stale chat handoffs or remembered SHAs.

## Bootstrap order
1. Read `MERIDIAN_LIVE_CHECKPOINT.json`.
2. Resolve the active Claude mailbox from `mailboxIssue`; read only the bounded latest relevant request/response/status items.
3. Fetch live `main` SHA, `version.json -> terminalBuild`, the one relevant PR and its relevant runs.
4. Reconcile any interrupted operation before writing. Repository state is authoritative.
5. Continue the authorized work package unless a real user decision or authorization gate is required.

## Roles
- ChatGPT: Lead architect, implementer and merge owner; Christoph/Achi1984 is Project Owner.
- Claude: independent read-only reviewer/challenger. Exact-head review before critical merge.
- Claude may use the read-only surfaces granted by the mailbox workflow, but may not edit/write repository content or mutate GitHub except the requested mailbox response comment.

## STREAM-SAFE-V8 — recoverable work packages

1. Before work, resolve `mailboxIssue` from `MERIDIAN_LIVE_CHECKPOINT.json`, read its bounded latest relevant items and reconcile live main, branch, PR and CI.

A task is bounded by its authorized objective, allowed files, branch owner, acceptance tests, budget constraints and stopping conditions, rather than by chat turns. One Go resumes the first incomplete authorized step after reconciliation; it never repeats the previous write blindly.

- Multiple sequential reads, implementation steps, tests and guarded writes are allowed within one authorized work package. No 30-second or one-tool-group chat limit applies.
- Before each write, record intent and a unique op-id, check branch ownership and expected head/base/blob. Use atomic expected-state guards where required; unavailable guards block the write.
- After each write, reconcile the actual effect and record a durable checkpoint before dependent work. A checkpoint is not proof of durable replay protection or authenticated transport.
- One writer per branch; integration and release numbering belong to the lead. Isolated agents may implement, test and prepare a Draft PR only within their delegated scope.
- Stop dependent writes on conflicts, unknown outcomes or scope drift. Read-only diagnosis may continue immediately. Retry at most once after verified OP_ABSENT; never replay OP_APPLIED. A second interruption yields BLOCKED_STREAM.
- Read bounded successful-CI evidence as well as named failures. Preserve payload/source budgets and mailbox tail limits. Never dump entire mailboxes.
- No sleep or polling loops. Poll unchanged external work at most once per session. WAITING records request/run IDs and the resume condition. Existing authorized agents may finish their packet; future dispatch requires a real, separately authorized mechanism.
- Keep one edited progress comment per PR. Deduplicate reviewer requests by request ID and exact head. Give concise milestone updates without requiring a new Go for each internal step.
- Stop at completion, missing authorization, unresolved conflict, exhausted authorized budget, unavailable capability or external dependency. End unfinished reports with NEXT.
- Exact-head/base CI and independent review remain mandatory. Changed heads invalidate prior gates. Project Owner approval remains required; after explicit adoption, qualifying routine candidates may satisfy it through docs/autonomy/ROUTINE_MERGE_POLICY.md. Reserved or ambiguous candidates still require concrete owner approval.
- This policy does not authorize production activation, trading, extra spending, workflow/permission/secret/scheduler changes, or a continuously running chat. Existing research and release boundaries remain.

Proposal: mailbox #571 comment 6096562356. This candidate requires independent review and explicit Project Owner merge approval before adoption.

### Source transport budgets (approved Transport & Feedback V1)
`maxPayloadBytes=4096` bounds rendered progress/log excerpts only. Source uploads use
`maxSourceFileBytes=262144` UTF-8 bytes per file and
`maxSerializedUploadBytes=393216` bytes per complete encoded request.
Run `node scripts/stream-safe-preflight.mjs --upload-budget contents` (or `blob` / `tree`)
with the actual complete tool arguments on stdin before upload. Verify source blob
SHA before/after publication and preserve the expected-head/CAS checks. A budget
pass is not authorization, CI, review or permission to bypass operation guards.
Full details and approval provenance: `MERIDIAN_AGENT_WORKFLOW.md`, Transport V1.
Watchdog suppression is a separate implementation; these budget changes do not enable it.

### Recovery classification
After reconciliation classify the prior operation:
- `OP_APPLIED`: intended effect exists -> do not repeat; advance.
- `OP_ABSENT`: effect absent and expected base/head unchanged -> eligible for one guarded retry.
- `OP_CONFLICT`: head/base moved or different operation owns the state -> stop dependent writes, diagnose read-only and supersede only after ownership/scope reconciliation.
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
- UI/presentation terminal releases have no daily count cap. Additional same-day UI releases do not require a cadence-specific exception.
- The Project Owner explicitly removed the one-UI-release-per-day limit on 2026-10-11 at 20:47:32 Vienna: "Wir werden die Grenze 1UI Veröffentlichen aufheben" (mailbox #571 comment 6112437050). This removes only the daily cap and its same-day exception gate; it grants no additional merge, deployment or execution authority.
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

## Completion behavior
Do not ask the user to repeat context already recoverable from GitHub.
Keep user-facing replies short.
Do not narrate routine reads or long tool chains.
If no user decision is needed, advance the authorized work package and end with `NEXT:`.

## Bounded standing owner approval for routine merges

The rule in `docs/autonomy/ROUTINE_MERGE_POLICY.md` becomes effective only after independent exact-head review and explicit Project Owner approval of the concrete policy-adoption PR, followed by its guarded merge. Preparation consent or this document on a draft branch is not adoption.

After adoption, ChatGPT as sole merge owner may apply the standing approval to routine bugfixes, tests and already authorized product packets only when every policy gate is satisfied using authenticated live evidence. Record the approved work-packet scope, exact head/base, CI run IDs/totals, independent review, policy-adoption evidence and the eligibility result before the guarded merge. The offline classifier is advisory and cannot authenticate evidence or authorize a write.

`ownerMergeApprovalRequired` remains true: the adopted bounded standing approval is one permitted form of owner approval; it is never optional. Architecture/direction, budget, security/permissions, policy/workflows/schedulers, release-governance changes, production activation and research/trading changes remain individually owner-gated. The daily UI-release cap is removed; expected-state protection, single-writer and research gates remain unchanged. Unknown scope, conflicting findings or missing evidence stops the affected work package.

Immediately publish `FINAL_MERGE_STATUS` after each merge. Do not merge another dependent candidate until all required post-merge checks succeed; failure or unknown outcome stops that pipeline and triggers reconciliation. The owner may revoke this standing approval at any time. No new automated dispatcher, credentials, schedule, deployment authority or spending is introduced.



## Owner housekeeping contract — 2026-10-15

Owner instruction 2026-10-15T19:57:13+02:00, execution Go19:58:27:
- Record each required owner action as NEEDS_USER_DECISION in the active mailbox; resolve that same comment in place with the actual quote, timestamp and observed outcome. Never invent historical click times or quotations.
- Before requesting Claude review, run the relevant suite locally with the exact CI toolchain (publisher: ordinary CPython3.14.2 plus the hash-pinned dependency lock), then wait for successful exact-head CI. Partial scope or absent evidence requires NEEDS_MORE_EVIDENCE, never GREEN_LIGHT.
- Canonical review verdicts are GREEN_LIGHT, REVISION_REQUIRED, NEEDS_MORE_EVIDENCE. GREEN_LIGHT requires the full requested scope to be read and all mandatory exact-head checks successful. Historical labels are evidence, not current verdict producers.
- For credential/mutation code with an attempt marker, first run a reviewed read-only preflight against the real target. Record a failed owner attempt and known/unknown remote state before proposing recovery. Marker recovery and a second attempt each require separate concrete owner approval.
- Refresh MERIDIAN_LIVE_CHECKPOINT.json, docs/MERIDIAN_CHAT_HANDOFF.md, MERIDIAN_HANDOFF.md and docs/handover/GO-MERIDIAN.md after each merge block. Keep creation provenance, distinguish current evidence from historical snapshots, and never claim the current publication commit before readback.
- Watchdog recommendations update one checkpoint-pinned status comment; request-specific review responses remain separate. A denied mailbox read prevents a verdict, not permission to infer context. No schedule, spending, research or trading authority changes.
- WIP limit: at most three active work packages, remaining proposals in backlog. Owner approved 2026-10-15T20:16:49+02:00: "Ja Freigabe erteilt"; decision6199107184 resolved in place.

Mailbox639 routing is active after owner-approved PR818 merge7dc94b9108e25d742bef7652fb7511c5cb5108ea (FINAL_MERGE_STATUS6199370528). Four disabled Autopilot prompts now resolve checkpoint routing and remain disabled; management routing was already dynamic. Pending requests and external automation routing reconciled; successor smoke6199499751 passed. Predecessor571 closed as historical archive6199526147. First hosted watchdog PATCH remains unproven.

