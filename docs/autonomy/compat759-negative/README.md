# Offline PR759 negative compatibility preparation

This package is proposed supplied test data, not a review or a live pilot launch
configuration. Nothing here publishes, reads credentials or authorizes action.
Live readiness is false: companion push Safety run 38448417020 failed. The root
confirmed only PR Safety run 38448468207, attempt 1, succeeded on the pinned head.
No target repinning, retry, workflow activation or publication is implied.

`scope.json` pins target PR759 and its exact head/base and PR CI identity.
`catalog.json` proposes seven complete review obligations for this one-document
change; `policy.json` binds their exact command-array hashes. Review obligations
include semantic inspection and comparison, not just zero process exit codes.
The catalog is inert; its commands were not executed by this preparation.
The commands assume an independently verified clean exact-head checkout.

`body.json` is the exact, newline-free complete v2 envelope created by the real
existing `produce_envelope` serializer. It is explicitly REVISION_REQUIRED with
all seven checks not_executed and no check execution receipt hashes. Its envelope
digest proves internal consistency only. Do not equate the genuine successful
PR CI reference with execution of these required review checks.

`verification.json` records local synthetic acceptance using the real envelope
binder, handoff and continuation adapter: NON_GREEN_REVIEW with an adverse
planner response, then BLOCKED/STRICTEST_VERDICT, all authority flags false.
Seven actor/body/head/version negative cases also reject. Fake comment ID 789,
timestamps, API responses, adapter manifest, owner URL and job counts are test
fixtures only. They must never become live version/approval/execution evidence.
The live comment ID and version are intentionally absent from deliverables.

Validation used an offline preparation harness and unchanged existing Python/Node
validators. `source-provenance.json` records the 15 dependency blobs verified
against control main 5aee595821666853d5f427785439e64474b1a838. The harness and
dependencies are staging aids and are not duplicated in this evidence branch.
The root independently reviewed the generated payload and reran the synthetic
composition successfully. No catalog command was executed.

Before any live decision, independently review the proposed policy and exact
body digest, resolve the failing companion check, reconcile all immutable pins,
and supply the concrete owner decision and limits described by the rollout
proposal. No positive producer, independent review authentication, trusted
execution provenance or owner authority has been established here.
