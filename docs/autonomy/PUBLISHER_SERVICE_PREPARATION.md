# Publisher admission service — inactive composition

Continues approved preparation #571/6160988345. No service route, production
import, configuration, credentials, SQL provisioning or live publication is added.
The fixture tests invoke only synthetic key/evidence readers and a fake database.

`publication-service.mjs` now composes the real negative-message validator and
OIDC verifier. Its fixed sibling Python bridge accepts bounded stdin, loads the
actual existing protocol and validates original body/scope/policy/pins. No token
is sent to Python. It uses Python isolated mode, a fixed script path, a minimal
environment, no shell, a ten-second timeout and 32KiB output cap. The existing
validator's nested Node check retains its five-second bound. This synchronous
bridge is preparation code, not a production request-concurrency design; a future
host must isolate it from the network event loop and test child cleanup/resource
limits before installation.

After token verification, the service reads fresh evidence through a deployment-
injected reader with a five-second deadline. The reader must be a fixed trusted
implementation that performs authenticated GitHub reads. Request input must never
choose the reader, keys, clock, pool or trusted configuration. The module compares
the numeric owner and approval-comment IDs, repository/mailbox, exact approval
body digest and pinned updated timestamp, current open PR head/base, successful
exact-head CI run/workflow/attempt, and exact
in-progress publisher run/workflow/control source/attempt. It rechecks approval
and token expiry after the awaited evidence read. Configuration is copied before
async work; arbitrary request-supplied plan objects cannot bypass the real bridge.

`prepareAdmission` only returns an untrusted candidate and derived ledger binding.
`reserveAdmission` obtains that candidate internally, then calls the actual
parameterized ledger adapter once. It never accepts a candidate from the caller,
never retries a conflict/uncertain result, and returns no body or send capability.
All broad authentication, authorization, provenance, durability, dispatch, merge
and send flags remain false. A token result's `validUntil` is only a cryptographic
freshness bound, not the duration of an owner approval or a lease.

## Unimplemented trust boundaries

The reader's returned JSON and deployment config do not authenticate themselves.
The fixed-origin reader is now prepared separately in
`PUBLISHER_GITHUB_READER_PREPARATION.md`; trusted deployment wiring,
approval/run bootstrap and its persistence are still required before installing
this composition. The owner must approve the
actual body/policy/request/control/run binding; matching a comment digest only
checks correspondence with that independently selected approval, not the semantic
meaning or authority of arbitrary text. A replacement authenticated approval or
updated timestamp stops admission; wider revocation still needs authoritative
bootstrap/admission handling. These are explicit integration requirements, not
boolean fields an HTTP client can fill in.

The database pool must be dedicated, autocommit, TLS-verified and have bounded
connection/statement timeouts. A future host must retain consumed reservations on
any uncertainty and gate actual send separately. Current source has no POST sender,
finalization/readback service or authenticated receipt endpoint. Only the existing
ledger's reserve statement is connected; no claim of a complete live publisher.

## Evidence and tests

Run `node --test docs/autonomy/event-adapter/review-binding/test/publication-service.test.mjs`.
Nine composition tests use the actual Python envelope producer/validator, real RSA
sign/verify, synthetic API records and a mock pool. They cover success to one reserve,
wrappers/body changes, forged tokens, changed approval/PR/CI/run state, approval expiry,
token expiry during evidence retrieval, DB conflict/uncertainty, stalled evidence
and forbidden config fields. They prove local ordering/validation, not authenticity
of the mocked API records or database commit behavior.

No PostgreSQL binaries were found via PATH or under /usr/lib, /usr/local or /opt.
Actual schema/role/concurrent-claim/crash tests therefore remain unrun. No production
DATABASE_URL, application credentials or Asset Watch token was inspected or used.
Next integration needs an isolated PostgreSQL environment and authenticated evidence
adapters, followed by reviewed exact source and bounded owner execution approval.
