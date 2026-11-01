# M11 Coordinator Cancellation Boundary

This is a source-only reliability change. It does not activate the coordinator,
change publication readiness, or claim hosted atomicity; publication remains
`NOT_READY`.

## Signal flow

The optional `AbortSignal` flows from lifecycle budget wrappers through the
state store and atomic-record backend into the GitHub state transport. Calls
without a signal retain their existing argument shape and behavior. The
lifecycle reconciler accepts an execution key as a scalar, so its caller uses a
small wrapper to attach the budget signal without changing that API.

Pre-aborted store operations perform no backend reads or writes. The backend
checks cancellation before starting each read or replacement and again after
awaited transport work. Once cancellation is observed, it does not start a
readback or another mutation. The GitHub transport passes its operation signal
to `fetch`, removes its abort listener and clears its operation timer on exit.
Its independent hard deadline remains in force and is not extended by caller
cancellation.

An active mutation opportunity remains one-use. A pre-aborted transport call
does not consume its read binding because no replacement attempt is started;
once an active replacement is attempted, the binding stays consumed even when
the request outcome is uncertain.

## Ambiguous outcomes

Cancellation does not undo a remote write. If cancellation or a lost
acknowledgement occurs after a mutation request may have reached the service,
the caller receives an unknown/reconcile outcome. The request may already have
committed; callers must preserve that possibility, reconcile durable state,
and must not retry the mutation or repost a receipt. A confirmed commit still
requires the existing authoritative readback. The canonical posting fence,
restart behavior, and one-use version binding remain in effect.

Tests use deterministic barriers and fake transport/HTTP responses to cover
pre-abort, cancellation during reads and readback, cancellation before CAS,
lost acknowledgements, possible commits, duplicate/restart behavior, and
transport listener/timer cleanup. They do not model remote rollback or prove
hosted atomicity.
