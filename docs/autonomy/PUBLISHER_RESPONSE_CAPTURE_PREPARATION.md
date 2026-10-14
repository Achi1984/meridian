# Sender response capture — inactive preparation

PR771 merged at 840972da91024cb98441ccda640f0177a8b317ab. Authorized isolated run
38524161267 passed 33 actual PostgreSQL16 checks, 67 Node tests and 62 Python tests.
That single-run authorization is consumed; this packet requests no repeat run.

`capturePublicationResponse(request, trustedResponse, trustedConfig, dependencies)`
prepares the host step between a successful POST and later independent confirmation.
It accepts only body/token in the request. The separate trusted response must be the
host's captured POST result: status201, exact repository/mailbox POST URL, no redirect,
and a comment with exact actor/body/URLs and valid, unedited timestamps. Required
primitives and configuration are copied before admission awaits. The real admission
verifier then checks current token, approval, PR and run before the actual record
adapter performs one conditional retention via a dedicated senderRecordPool.
The pool and its bound query method are now pinned before admission awaits, so
replacing either during an evidence lookup cannot redirect record retention.
This preserves the original receiver but does not authenticate a hostile pool or
freeze its internal state. Host dependencies remain trusted.

Capture shares comment checks with confirmation. Capture acknowledgment means only
that the adapter acknowledged record retention; confirmation still requires fresh
GitHub readback, record checks and conditional settlement. Conflict/uncertain writes
never cause a resend, retry or settlement. All authority/provenance/durability flags
remain false. Rejection after a POST does not prove no comment was published; the
reservation stays consumed and requires reconciliation, never another send.

This function is not an HTTP endpoint and must not receive caller-controlled response
objects or database dependencies. The trusted host must capture and bound the actual
network response and authenticate its own storage access. A separate inactive POST
transport primitive is now prepared; no sender credentials, route, host bootstrap
or signed receipt is installed here. Input-object
validation alone cannot prove response origin or which workflow sent a comment.
Production durability and atomic approval/record revocation remain unsolved.
Before live host integration, the captured comment timestamp must also be bound to
the acknowledged reservation/send window and a trusted clock. Current calendar and
unedited checks do not reject an old matching response supplied by a trusted host.
Neither this packet nor a GREEN_SOURCE_ONLY review establishes live readiness.

Five new service tests cover matching retention, malformed/substituted responses,
forged/revoked admission, mutation during awaits, conflict and lost acknowledgment.
Tests use the real admission/record adapters with synthetic network and DB responses.
