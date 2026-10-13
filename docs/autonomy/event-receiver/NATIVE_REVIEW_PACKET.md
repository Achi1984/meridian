# Consolidated native review observation — inactive, not ready for a live run

This package provides one complete bounded observation operation instead of a
caller assembling independent receipts. It reconciles the selected native review,
current PR/main/CI, full bounded review and thread inventories, and Release Safety
reported test counters. No workflow is installed or changed. No live request,
new credential, schedule, dispatch, trading or repository mutation is included.

## Operation and output

`observe_packet(expected_raw, token)` validates the existing exact-pin scope
before using the caller's existing token or constructing a transport. It accepts
the same <=16384-byte schema as `native_review_observation.validate_expected`:
PR number, head/base SHA, CI run/attempt/workflow/head, selected review ID,
submission timestamp and body digest. Tokens are never part of pins or output.

The operation executes these stages with one shared in-memory budget:

1. Reconcile the selected Copilot native approval, PR, main and CI twice using
   the existing observer, followed by its final main read.
2. Collect two passes of all bounded review pages and two passes of thread pages.
   Any `CHANGES_REQUESTED` or `PENDING` review, including historical heads,
   blocks. Unresolved threads block. No supersession policy is inferred.
3. Revalidate the precise CI snapshot and PR association, collect attempt-specific
   jobs, and fetch the eligible syntax job log. Parse existing reported counters.
4. Repeat both complete inventory operations and require identical validated
   projections/digests. This catches adverse reviews or changed threads appearing
   while the CI/log stage ran. Any component failure discards all partial success.
5. Repeat the full selected-review/PR/main/CI observer and final budget check.

Success means `OBSERVED_PACKET_INCOMPLETE`, never an approval. The <=4096-byte
receipt includes scope, selected review pins, counts/digests and reported CI
counters/log digest. It contains no bodies, log text, credentials, signed URLs or
exception strings. All authentication, provenance, authority, merge, dispatch,
durability, full-review-evidence and transport-pagination flags remain false.
`plannerResponse` remains null. Failures produce a generic bounded blocked
receipt without a partial observation.

These reads are not an atomic GitHub snapshot. An inventory can change after its
final read, including during another inventory's final collection. Repeated reads
detect observed drift; they cannot guarantee that no change occurred between or
after reads. A future mutation still requires fresh guarded reconciliation.

## Bounds for the complete operation

| Resource | Maximum |
|---|---:|
| Explicit HTTP opens, including log storage redirect | 49 |
| Aggregate response-body bytes | 22 MiB |
| Checked elapsed time | 120 seconds |
| Individual socket timeout | min(15 seconds, remaining overall budget) |
| Emitted receipt | 4096 UTF-8 bytes |

The call cap comprises 18 observer reads, 12 review-page reads, 12 thread-page
reads, and up to seven CI reads (run, three jobs pages, log plus optional storage
redirect, run reread). There are no retries. Existing per-response, page, frame
and per-helper bounds still apply. Before each read the shared budget clamps the
requested size to remaining bytes plus one overflow-detection byte. Redirect
opens consume another call; storage requests carry no GitHub authorization.

The 120-second elapsed budget and socket timeouts are checked before and after
operations. They are **not a hard wall-clock cancellation guarantee**, including
slow in-flight reads. Counters cover response bodies, not HTTP headers or wire
overhead. Private budget hooks accept only the process-local `_PacketBudget`
class; a caller-supplied dictionary or receipt cannot substitute for it.

## Explicit launcher and non-runnable pilot proposal

Direct startup requires isolated Python (`-I`); it disables bytecode writes and
loads only reviewed sibling modules. The explicit option is
`--allow-read-only-network`; it requires a local exact-pin JSON file. Only after
validating all pins does the CLI read the already-existing `GH_TOKEN` variable.
It does not accept credentials in arguments/configuration or discover/provision
them. It prints one redacted JSON receipt: incomplete success exits **2**, blocked
execution exits **1**. Exit zero is never an approval signal.

**Pilot status: NOT_READY_TO_RUN.** There is currently no verified suitable
current-base PR with a selected native approval and exact successful CI pins for
this proposal. Historical PR736/PR738 observations are consumed and must not be
reused. No runnable pins or activation command are included here.

Before proposing one live invocation, the lead must publish and review this
complete source packet, obtain its successful exact-head CI, then select a real
open same-repository PR with current main base, an actual independently selected
Copilot approval and exact Release Safety run/attempt. Record the target
head/base/review body digest and timestamps, immutable control-source SHA, verified
source dependencies, and the single invocation's budget/output destination.
Present those concrete pins and limits for separate owner approval. No token
creation, workflow installation, repinning or repeat invocation is implied.

## Architectural boundary after this outcome

The collected CI evidence remains `JOB_LOG_REPORTED_COUNTERS`, with
`testOutputForgeryExcluded=false`. Retrieving a genuine Actions log does not prove
that executed code could not forge test output, nor that the required independent
review checks ran. `event-runtime/durable_check.py` and its fixed-catalog trusted
checkout executor produce a different local execution receipt; substituting
reported TAP counters into that schema would be invalid.

Native `APPROVED` reviews are not Claude's structured full-evidence envelope.
The existing `review_handoff.py` binds a specific numeric Claude actor and exact
versioned mailbox comment. This packet neither relabels the native reviewer nor
manufactures a planner response from an approval state.

Owner approval is also not authenticated here: `ownerApprovalRef` in the offline
continuation manifest validates URL shape, not approval semantics, numeric actor,
head/scope/version, expiry or revocation. Durable event deduplication, a shared
writer lease, fencing, authorized worker activation and outcome reconciliation
remain separate. The complete observation is useful input for a human decision;
it does not establish full autonomous readiness.

## Synthetic acceptance

`test_native_review_packet.py` mocks the HTTP opener and clocks, then composes
the real observer, both transports, projectors and CI log parser. It exercises
all-success/incomplete output, credential-free storage redirect, immediate CI
scope validation, adverse and ordinary inventory drift during log retrieval,
thread/PR/main/review changes, bad jobs/logs, cross-component call/byte/time
exhaustion, path/log capability limits, invalid pins, import inertness and isolated
CLI exit semantics. No real API query is executed. Existing observer, inventory,
thread, transport and summary suites remain regression requirements.
