# Publication confirmation — inactive service composition

Continues publisher preparation after PR770 and successful isolated DB run
38520287239. This packet installs no route, sender, workflow or production pool.
The single authorized database run is complete; no second run is requested.

`confirmPublication` accepts original body, token and numeric comment ID. It uses
the real admission verifier before reading the comment through a trusted
deployment-injected reader. Raw comment ID, fixed repository/comment URL,
mailbox571, configured numeric publisher actor, Bot type and exact original body
must match. Calendar-valid UTC creation/update timestamps must be present and
equal, matching the existing receipt contract's no-edits rule. Required comment
primitives are snapshotted before further awaits. Token, approval, PR and publisher-run evidence are verified again
after the read to catch expiry/revocation observed during that await. Request and
configuration are snapshotted. The actual ledger adapter then executes exactly
one conditional RESERVED-to-CONFIRMED update with all operation/body/run bindings.
Missing rows, conflicts or ambiguous DB replies never trigger retries or sending.

This records matching observed content, not independent proof that this particular
workflow created the comment. Shared bot identity is insufficient for provenance.
The future sender must retain its actual response and bind it to the reserved
operation; trusted bootstrap and host installation of the prepared fixed-origin
comment reader remain outstanding. A comment can change after observation, so consumers need
fresh readback and an authenticated receipt service. No receipt endpoint or durable
publication proof is claimed. All authority/provenance/durability flags stay false.

The service reader has a five-second bound. Final admission repeats the bounded crypto and
evidence checks, so the host must budget the complete operation, not assume a
five-second end-to-end request. DB timeout/autocommit constraints remain the
trusted host's responsibility. A failed/late confirmation leaves the reservation
consumed, never available for another send.

Eight additional composition tests use real envelope/crypto verification with
synthetic GitHub records and a mock pool: matching settlement; wrong comment,
actor/mailbox/body; mid-read revocation/expiry; caller mutation; DB uncertainty;
stalled reads; malformed requests/forged tokens; missing/invalid/edited timestamps.
They do not perform publication
or prove a deployed reader, sender or receipt channel.

`createPublishedCommentReader` now supplies the concrete public GitHub GET reader.
It accepts only a positive safe integer comment ID, fixes the repository and mailbox,
returns only required fields, and shares the evidence reader's 4.5-second deadline,
128 KiB streaming cap, exact response URL and no-redirect/no-retry transport.
No credentials or alternate API origin are supplied. Six reader tests cover identity,
field bounds, transport errors, deadline and abort behavior. A composition test feeds
its actual parsed response through crypto/admission and conditional settlement,
including a changed-body rejection. HTTP and database responses remain synthetic.

Confirmation additionally requires a host-only `readSendRecord(binding, signal)`
dependency. Its exact six-field record binds operationKey, intentSha256,
bodySha256, runId, runAttempt and commentId to the retained sender response.
The admission binding is copied and frozen before lookup. Missing, mismatched,
extra-field or stalled records reject before settlement. The source is read before
the comment and again before final fresh admission, catching observed revocation
and expiry during the extra await. Both reads have five-second bounds.

This is a fail-closed consumer contract, not an implemented sender-response store.
The future host must supply an authenticated, protected store populated exclusively
from the actual sender response; request/comment/model content cannot populate it.
No atomicity between the last read and DB settlement is claimed: later revocation
still needs a transactional host design. No provenance flag is promoted.
Four further tests cover exact record binding, missing source, immutable lookup,
observed revocation, final-read expiry and a stalled source.
