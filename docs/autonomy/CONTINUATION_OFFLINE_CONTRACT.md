# Continuation contract — inactive implementation packet

Follows Draft #660 at 574610a19d43213624e2bd7c0ba7def682c7cc23 and its
design-only Claude response 6101189208 in mailbox #571. This packet does not adopt
that policy, merge #660, install an App or start a live trial.

## What is implemented

`scripts/continuation-contract.mjs` exports three pure functions:

- `validateManifest(object)` returns a frozen, canonical, validated copy.
- `initialLedger(manifest)` returns an empty offline claim ledger.
- `advance(manifest, ledger, event, now)` returns a new ledger or throws a named
  `ContractError`. Rejection leaves the original snapshot unchanged.

There are no filesystem, network, environment, clock, scheduling or model calls.
The caller supplies Unix seconds. The functions are not imported by any workflow
or production module. Returned `authenticated`, `durable`, `dispatchAllowed` and
`mergeAllowed` are always false. All observations, including approval references,
CI, review and merge SHAs, are unauthenticated claims. No result is a command.

The JSON schema describes structural inputs; the validator additionally checks
relationships between fields. It accepts JSON-shaped plain objects, not serialized
JSON. Duplicate textual JSON keys are not detected here: a future transport must
reject them before construction. Accessors, sparse arrays and unexpected fields
are rejected. This is not a hostile-JavaScript sandbox; never call arbitrary
Proxy objects or executable input. In production the trusted parser and transport
must supply bounded data, independent of these simulation checks.

## Manifest and budget source

A manifest contains at most eight ordered packet specifications and a positive
invocation cap at most the packet count. Each packet permits only one Markdown
file under `docs/v11/` and one trusted test under `test/v11-*.test.js`, with a
64-character template digest. No arbitrary generated JavaScript is admitted by
this output class. Actual template/fact bytes are not loaded or checked by this
contract; publisher validation is separate. A valid digest string is not proof
that an approved template exists.

Dependencies must refer to earlier packet IDs; cycles and duplicates are rejected.
Claims follow manifest order; a failed or unstarted earlier packet cannot be
skipped automatically, even when paths are disjoint. Dependencies are revalidated
on every accepted snapshot, not only at claim time.
The desired gate is either reviewed Draft or separately observed merge followed
by post-merge checks. The manifest has one fixed base SHA, an approval reference,
and a maximum 24-hour interval. A different runtime base requires reconciliation
and a newly approved manifest, not a timestamp/base rewrite on a consumed ledger.
The `merged` transition is a dependency simulation; it does not authorize working
on a stale base after an actual merge advances main.

The canonical manifest digest binds the ledger to that exact normalized data.
In production the Lead must verify the manifest's protected commit and explicit
Owner authorization before any claim. Only the Lead may propose revisions;
changes to scope, cap, expiry or authority require the applicable Owner decision.
Event text, model output and labels cannot edit the approved manifest.

Budget source for this model is `maxInvocations` minus permanently consumed
packet claims. Claim consumes the slot before inference, even if no model request
was eventually sent. It is a conservative invocation cap, not a credit estimate,
provider billing counter or atomic reservation. Production must read the protected
manifest and durable claim/invocation ledger; missing or uncertain data blocks a
new call. Account zero-overage settings remain a separate external requirement.
No current billing API or automated credit meter is claimed by this implementation.

## State and adverse observations

Normal simulation: READY -> CLAIMED -> GENERATING -> CI_WAIT -> REVIEW_WAIT ->
COMPLETE_DRAFT. Exact head matching is required for CI and review observations.
MERGE_OBSERVED and POST_MERGE_PASSED only record a separately observed Lead merge;
the latter must name the same merge SHA. Neither grants a merge capability.

A changed Draft head invalidates old CI and review. A revoked review removes
readiness. A failed call permanently consumes its packet, and an unknown outcome
blocks the pipeline. There is no RESET, retry generation, implicit unclaim or
automatic recovery from UNKNOWN_OUTCOME. Recovery requires a later audited design,
not supplying a fresh initial ledger to a live dispatcher.

If another packet has already consumed a claim, an observed head change or review
revocation conservatively revokes the entire batch. The same applies to review
revocation after a merge observation. Every consumed packet becomes UNKNOWN_OUTCOME
and loses effective CI/review readiness; base/head/merge history is retained.
This records late invalidation even when another writer is already active. No
dependent step can advance, and consumed slots cannot be restored. It deliberately
prefers a full-batch stop over selective recovery, which is not implemented here.

At most one busy packet may exist in a non-revoked ledger. This models sequential work even for disjoint
paths. Revision checking catches stale snapshots only if the caller already has
the current ledger: two callers can both advance copies of the same snapshot.
It is emphatically NOT atomic CAS, durable deduplication, exactly-once behavior,
authentication or a fencing implementation. All those remain activation gates.
Permanent claim refs must survive failure, deletion attempts and agent restarts;
an empty local JSON file cannot establish that no earlier invocation occurred.

Expiry prevents every non-revocation transition. Revocation can still be recorded
after expiry and prevents continuation. There is no inference that an expired
remote process has been cancelled. Reconcile accepted requests and preserve evidence.

## Verification and next gate

Run `node --test test/continuation-contract.test.js` from repository root.
Tests exercise duplicate/replayed events, independent-writer contention, failed
and uncertain requests, wrong heads, dependency gates, missing/forged state,
manifest changes, cap/expiry/revocation and malformed/path-expanding input.
They establish pure-function behavior only; live delivery and repository rules
cannot be proved by these fixtures.

Companion documents provide the real workflow inventory and an unapplied
enforcement/fencing specification. CI inventory is a dated source analysis, not
a secret-access inspection or proof of effective permissions.

NEXT: exact-head independent code review and full CI. Keep inactive. Before any
transport implementation can be activated, apply the separately approved
repository protections, credential boundaries, all-writer coordination and live
delivery tests described in the enforcement document. Research remains SOURCE_AUDIT;
no canonical execution, PnL, Discovery, Paper or Live transition is introduced.
