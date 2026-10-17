# Bounded GitHub autopilot proposal — preparation only

**This GitHub-native workflow proposal is disabled; this PR does not activate a
workflow or runtime.** A separate, owner-authorized ChatGPT coordinator is
enabled as recorded below.
Owner approval #639/comment6239454116 ("Ja Freigabe erteilt",
2026-10-17T21:22:29+02:00) authorizes this preparation packet only. It does not
approve a workflow change, permission, credential, schedule, dispatcher, or
24-hour GitHub-native pilot activation. Publisher remains paused; repair #862
and the approved preparation are the stated exceptions.

## Immutable starting inputs

Read from live GitHub before editing:

| Input | Exact observed value |
| --- | --- |
| `main` | `5c996ee9c7d4e71f0d6f2ecd59f6fc53beedcce3` |
| Starting preparation branch head | `ad625f1642e011b6100086dec88d4641ceb20e97` |
| Starting checkpoint blob | `fd80e609b9dfb196f8bb317682bad923fd80aef5` |
| Repair PR #862 base/head | `5c996ee9c7d4e71f0d6f2ecd59f6fc53beedcce3` / `15ccb6bd0b2157abc2b44aeebce73229aeb0c1b4` |
| Repair required CI at preparation start | run `39061699022` attempt 1, `action_required`, zero jobs |
| Handoff PR #860 base/head | `5c996ee9c7d4e71f0d6f2ecd59f6fc53beedcce3` / `ebaed4ab9bf274d2d569fe3d6aa3c46a2890e1de` |
| Arena #861 | issue, not a PR; explicitly waits for #860 |
| Preparation #867 / PR #868 | draft PR; pilot disabled |

## Current live reconciliation

The live source main remains `5c996ee9c7d4e71f0d6f2ecd59f6fc53beedcce3`,
the merge commit for PR #859. Preparation is now draft PR #868 for issue #867;
its GitHub-native pilot remains disabled. Separately, owner approval
#639/comment6239688670 resumed the existing ChatGPT coordinator:
automation `6ac559aa5a888191a09b2fd497405a70` (“Meridian Agenten-Koordination”)
was successfully updated and enabled. Its bounded schedule is hourly for 24
runs, starting 2026-10-17 21:45 Europe/Vienna. The first new run has not yet
been observed; the service supplied no next-run time, so no execution is
claimed. Durable coordinator status is #867/comment6239688891. This is the
existing coordinator using the Lead-connected GitHub issue-assignment
capability, not the native workflow proposal in this PR.

Live issue records show that connected Lead assigned Copilot to #863, #865,
and #867. These observed assignments verify that capability; they do not
establish autonomous dispatch from a GitHub Actions runner.

Repair #862 remains unmerged at the pinned head. Run `39061699022` attempt 1
was `action_required` with zero jobs; attempt 2 now completed `failure` with
the `syntax` job failing in “Research and auth regression tests”. This is not
successful exact-head CI. Handoff #860 remains open and waiting; Arena #861
remains queued behind it. Completed read-only reports from #863/#865 are
reusable evidence, not active writer assignments. These are current observed
statuses; the starting SHAs above remain immutable preparation inputs.

The preparation branch was not used to modify #862 or #860. Their source heads
are evidence pins, not candidate branches for this work. The current checkpoint
blob on main is byte-identical to the starting local checkpoint. Its existing
history, integer receipts, mailbox cursor, seven false V2 authority flags, and
Publisher pause are preserved; this packet adds one nested preparation record.

## Existing capability findings — blocker

Inspected at the pinned `main` above: `MERIDIAN_GO.md`,
`MERIDIAN_LIVE_CHECKPOINT.json`, `scripts/watchdog-mailbox.mjs`,
`scripts/native-copilot-task-dispatch.py`,
`scripts/native-copilot-task-runtime.py`, and
`.github/workflows/copilot-coding-pilot.yml`.

* The watchdog resolves bounded mailbox records and classifies delivery. Its
  output hardcodes `reviewAuthorization: false` and `executionImpact: false`;
  it does not dispatch an implementation agent.
* The connected Lead's issue-assignment capability is verified by the observed
  Copilot assignments to #863, #865, and #867. This is distinct from dispatch
  initiated by a GitHub Actions runner.
* The existing ChatGPT coordinator automation is owner-authorized and enabled
  (`6ac559aa5a888191a09b2fd497405a70`); update succeeded, while its first new
  run remains unobserved. It uses the connected Lead issue-assignment capability
  and is distinct from this disabled GitHub-native workflow proposal. This PR
  neither creates nor changes that coordinator or its schedule.
* The native Copilot task adapter is inactive by default. That specific runner
  path requires a pinned approved task and externally verified user-to-server
  token capability; its source explicitly excludes an Actions `GITHUB_TOKEN`.
  The CLI does not provision credentials or storage. Autonomous runner
  dispatch/token/permission capability is **not established** here; this
  adapter's limitation does not prove that every GitHub-supported dispatch
  path is unavailable.
* The existing coding workflow is bound to a different fixed workflow run/head,
  packet claim, and publisher flow. Its `copilot-requests: write` permission and
  publisher write capability cannot be generalized to this queue by editing a
  document. It does not provide the proposed per-PR operation ledger.
* The current connector has no workflow-approval operation. Run
  `39061699022` attempt 1 was `action_required` with zero jobs; its attempt 2
  failed its research/auth regression-test step. There is no successful
  exact-head CI evidence and no independent review; neither may be bypassed.

Therefore this is a concrete **BLOCKED** activation design, not an implementation
dispatcher. Lead-connected issue assignment is already demonstrated, but
autonomous runner dispatch is not established and activation is not approved.
Do not request Claude review until required exact-head CI succeeds. Do not use
another branch, copied commits, or a new trigger to bypass that gate.

## Bounded queue and state machine

`proposal.json` is a non-workflow, disabled configuration source. Its only
target scope is repository `Achi1984/meridian` and queue #862 → #860 → #861.
At most three packets may be active, counting repair #862, waiting handoff #860,
and this disabled preparation PR #868; #861 remains queued. Completed reports
from #863 and #865 are reused, not active writer packets. There is one mutation
lane, at most one reconciliation pass per hour, and validated events are
preferred to polling. Each job is capped at 10 minutes, each packet at three
agent turns, and the entire queue at nine turns. Retry budget is zero. Start/end
are unset until a separately approved activation; any future window is at most
24 hours and does not extend automatically. The pilot ends when the authorized
queue finishes or the 24-hour window expires, whichever comes first.

For any future approved operation, its per-PR status record must include:

```json
{
  "op_id": "unique operation identity",
  "pr": 862,
  "phase": "OBSERVED",
  "owner_agent": "copilot",
  "input_base_sha": "40 lowercase hex",
  "input_head_sha": "40 lowercase hex",
  "observed_event": {"delivery_id": "bounded ID", "kind": "check completion"},
  "last_processed_event_or_comment": "bounded ID",
  "evidence": {"ci_run_ids": [], "job_receipts": [], "review_receipt": null},
  "next_gate": "exact-head CI",
  "owner_approval": {"scope": "preparation only", "activation": false},
  "intent": null,
  "result": null,
  "reconciliation": "NOT_STARTED",
  "blocker": null
}
```

There is one continuously edited status record per active PR. The intended
phases are `OBSERVED → VALIDATED → INTENT_RECORDED →
DISPATCH_REQUESTED → RECONCILING → APPLIED | ABSENT | UNKNOWN`. Persist intent
before a mutation and reconcile its outcome afterward. Unknown, partial, or
conflicting outcomes stop all dependent writes; never retry them. Only a
verified `ABSENT` with unchanged expected base/head could be considered for a
new separately authorized operation. Deduplicate on repository/target/head/
phase; ignore exact duplicates and stale/out-of-order observations. Compare
the live base/head before every gate. A status comment is a checkpoint, not an
atomic lock or compare-and-swap.

On restart, reconcile live `main`, target PR/issue, exact head/base, CI, review,
and the last acknowledged operation from GitHub; chat context alone is not
recovery evidence. Preserve source receipts, rejected hypotheses, and
unresolved findings. Provenance/source audits and operational validation are
distinct evidence classes.

No event/comment body is executed or treated as a command. Review requires
completed successful CI on the exact head/base, then one `REQUEST`; no
`FOLLOWUP`. A GREEN receipt with any gap or self-reported gap is invalid.
Assignment, execution, check receipts, independent review, and merge status
remain separate evidence. Copilot is the only writer on an assigned branch;
an independent existing agent may only perform genuinely independent,
read-only evidence work. Lead remains sole merge owner. No auto-merge/deploy.

`simulator.py` is a pure offline gate exercise only: it has no HTTP client,
token, GitHub API, filesystem ledger, scheduler, or mutation call. It models
fail-closed/no-op cases and can never return a dispatch-ready state. Synthetic
fixtures only; run:

```sh
python3 -B -m unittest discover -s docs/autonomy/autopilot-pilot -p 'test_*.py'
```

## Exact future activation diff — BLOCKED

No executable workflow diff is safe or supportable from the evidence available.
In particular, do **not** change `enabled`, fill in a time window, add a file
under `.github/workflows`, or grant permissions in this preparation. The
existing native assignment path needs a user-to-server token capability that
is neither present nor approved; the existing coding workflow is not a generic
dispatcher. The action-required CI gate is also unresolved.

Minimum permission inventory for a separately reviewed future design (none
granted here):

| Capability | Minimum permission/capability to assess | Current state |
| --- | --- | --- |
| Read exact refs, PRs, checks/jobs | `contents: read`, `pull-requests: read`, `actions: read` | Not activated for this proposal |
| Assign Copilot to a fixed issue from an Actions runner | `issues: write` plus a supported authentication capability | Runner capability not established; existing adapter excludes Actions token |
| Edit a same-PR checkpoint/comment, if explicitly approved | Narrow `contents: write` and/or `pull-requests: write` | Not approved |
| Copilot CLI generation, if separately justified | `copilot-requests: write` | Existing pinned workflow only; not transferable by this proposal |
| Merge/deploy | None | Explicitly excluded |

The exact diff is therefore deferred until capability and owner-approval gates
are satisfied; inventing a workflow body or silently adding a secret/permission
would contradict the current blocker. A future activation proposal must specify
the exact workflow file, triggers, token provenance, pins, permissions, and
rollback patch and receive a separate concrete owner approval before any source
workflow change.

### Disable/rollback plan for any later separately approved activation

1. Disable its trigger/workflow and cancel pending runs; do not dispatch an
   alternate workflow or use a copied branch.
2. Stop writes on any unknown result; reconcile the live PR/head/check/review
   state and last acknowledged operation before continuing.
3. Preserve ledger, run receipts, source evidence, and rejected hypotheses;
   never delete history or reset a claim to make a retry possible.
4. Revoke only credentials created under that separate approval. No credential
   is created by this preparation.
5. Record the disabled state and reason in the same PR status/checkpoint. Do not
   attempt to undo already applied branch changes automatically.

## Frozen boundaries and current stop

The current required CI is `action_required`, not `SUCCESS`; no review request
has been made. Publisher remains paused except the existing bounded cleanup
exception for #862. V2 remains `SOURCE_AUDIT`; canonical execution, strategy
PnL, Discovery, Validation, Holdout, Paper, and Live flags remain false. No
runtime/provider access, credentials, new permissions/services, workflow
changes, replay, stage promotion, trading, merge, or deployment is authorized.

Current stop: **BLOCKED — #862 CI approval required; dispatcher capability and
activation authority unavailable.** Resume only after those exact gates are
independently resolved and a new concrete owner decision authorizes activation.

## Evaluation record, if separately activated

Record completed packets, gate failures, duplicate deliveries, measured job
duration, and usage only when the platform reports it. Do not infer token/euro
savings. Every record must distinguish assignment, execution, CI/job receipts,
independent review, and merge; logs must exclude credentials and secrets.
