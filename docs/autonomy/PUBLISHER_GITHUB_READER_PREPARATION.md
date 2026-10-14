# GitHub evidence reader — inactive preparation

Continues approved preparation #571/6160988345. Adds no route, workflow,
credentials, database provisioning or publisher activation.

`publication-github-reader.mjs` provides the admission service's evidence shape
from five fixed public GitHub API GETs: repository, approval comment, PR, CI run
and publisher run. Trusted deployment configuration selects positive numeric IDs;
request input cannot select endpoints. Responses require the exact requested URL,
HTTP 200, no redirect, bounded UTF-8 JSON (128 KiB each), and matching repository,
owner, PR and run identities. Fork heads are rejected. The whole read has a
4.5-second deadline, parent cancellation and no retries. No credentials are read
or sent. HTTPS authenticates the public API server; deployment wiring and approval
bootstrap remain separate trust requirements.

Approval normalization requires the configured numeric owner, OWNER association,
mailbox 571 and explicit `performed_via_github_app: null`. An app-authored proposal
under the owner's account is rejected. Passing this check is necessary, not
sufficient: the bootstrap must establish that the exact text authorizes the exact
body/policy/request/control/run binding. The service performs the pinned digest,
timestamp, status, source, run-attempt and expiry checks.

## Verification

Run `node --test docs/autonomy/event-adapter/review-binding/test/publication-github-reader.test.mjs`.
Eight tests pass, including endpoint constraints, app-authored approval rejection,
identity mismatch, malformed/oversized/redirected responses, immutable config,
deadline and pre-aborted requests. Independent source review is GREEN.

On 2026-10-14 a read-only connector fetch of real repository 1342084551,
owner 319562141, PR 770, CI run 38516186727 and proposal comment 6160988345
confirmed the actual API field shapes. The normalizer rejected the proposal,
whose `performed_via_github_app.id` is 1144995. This diagnostic stops at the
approval check; it is not a successful approval, publisher run, admission or DB
call. No full API payload or credential is committed.

## Remaining integration

The adapter is not installed in a host. Trusted approval/run bootstrap, isolated
PostgreSQL schema/concurrency/crash tests, bounded host wiring, sender and receipt
reconciliation remain required. No suitable isolated PostgreSQL runtime is
currently available. A direct-owner approval record is not established by the
app-authored proposal. These tests do not authorize live execution or demonstrate
database durability.
