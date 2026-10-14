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
operation; trusted bootstrap and fixed authenticated comment-reader installation
remain outstanding. A comment can change after observation, so consumers need
fresh readback and an authenticated receipt service. No receipt endpoint or durable
publication proof is claimed. All authority/provenance/durability flags stay false.

The reader has a five-second bound. Final admission repeats the bounded crypto and
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
