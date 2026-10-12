# Reviewable create-only experiment (not installed)

Purpose: observe GitHub's response to two concurrent creations of one permanent
test reference, followed by one fresh request to the same reference. No native
assignment endpoint, PAT, installation token, delete, update, retry, redirect,
or cleanup exists in this harness. Uses only the existing Actions GITHUB_TOKEN
if later authorized. Token is never printed. The script is inactive without
the exact explicit acknowledgement environment variable.

Pinned target commit: 078c20f14a44ae21f81ea7eae0aabd06cb038031.
Reference: refs/heads/meridian-integration-tests/ref-race-<approved probe ID>.
Owner approves an unused fixed probe ID before execution; retain the reference
permanently. Do not generate a new ID or rerun automatically after uncertainty.

Budget: three create POSTs maximum, each on a separate HTTPS connection; one
read-only script-fetch GET in the workflow specimen (four total API requests).
There are two concurrent contenders and then one fresh Python subprocess making
one request. No ownership or response state is passed to that process. This
tests a process restart, not a runner restart; the test identity and credential
remain the same through inherited environment variables.
The workflow has a two-minute total timeout; connections have ten-second
socket timeouts and response bodies are capped before parsing.

OBSERVED_PASS requires exactly one validated 201 and one 409/422 in the race,
then a 409/422 for the fresh call. 422 may mean other validation failure;
it is not reported as proof of existing-reference conflict. All other outcomes
are INCONCLUSIVE and require inspection, without automatic retry. Even a pass
does not prove platform linearizability, durable retention, runner restart
behavior, or production readiness. It observes one bounded race only.

The validation follows the candidate's dictionary shape plus exact ref/SHA
checks; it does not claim validation of an object.type field.

Before installing/running: independently review and merge these source files,
pin REVIEWED_COMMIT_SHA and APPROVED_PROBE_ID in the inert specimen (both
placeholders fail closed; dispatch input must equal the approved ID), inspect repository workflow
triggers and rules for side effects from creating this test branch, verify that
the token can create the reference and the reference will remain retained,
and obtain explicit approval for the exact experiment and contents:write job.
Do not bypass restrictive rules. No extra subscription or paid runner is needed;
existing Actions quota is consumed. Native assignment authorization is separate.

The specimen has no global token permissions. Its contents-write job is gated
to owner Achi1984 as both actor and triggering_actor, the exact repository,
manual dispatch on main, and attempt 1. Run number 0 deliberately disables the
job until the concrete activation approval pins one exact real run number.
Changing that gate or rerunning is not authorized by source publication.
