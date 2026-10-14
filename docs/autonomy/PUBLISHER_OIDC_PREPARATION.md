# Publisher OIDC verifier — inactive standalone source

The [service composition](PUBLISHER_SERVICE_PREPARATION.md) now connects this
verifier with the real negative-envelope validator and ledger reservation adapter
using synthetic readers/pool in tests. Authenticated production adapters remain
unimplemented. The minimal token result now also includes `validUntil` so the
caller can reject token expiry after later awaited work without another key fetch.

Prepared under owner direction #571/6160988345. This is a separate module under
the source-preparation directory. No server import, API route, workflow, id-token
permission, token acquisition or database access is introduced. Asset Watch's
existing verifier and audience are unchanged.

`publication-oidc.mjs` verifies RS256 JWT signatures using Node's crypto library
and keys read only from GitHub's fixed issuer JWKS URL. It restricts the audience
to `meridian-negative-publisher`, exact repository/owner IDs, explicitly pinned
subject, main ref, control SHA, workflow path/SHA, run ID and first attempt. Only
manual workflow_dispatch on github-hosted runners is accepted. Reusable workflows
and environment-bearing tokens are excluded from this first mode. Unknown JOSE
header fields, including key URLs and critical extensions, are rejected.

Pins must come from the trusted service's independently authenticated approval/run
binding, never the request token or payload. Both legacy and immutable GitHub
subject formats are supported only when the exact format is explicitly pinned;
there is no automatic subject migration. Numeric IDs are canonical decimal strings.
The source's time policy limits token age to 300 seconds, lifetime to 600 seconds,
future issuance to 30 seconds and nbf backdating relative to iat to 300 seconds;
expired tokens receive no grace. These limits still need compatibility validation
against a separately approved actual GitHub job token before deployment.

JWKS reads use the fixed HTTPS origin, reject redirects, abort after five seconds,
stream with a 64KiB body cap and accept at most 32 keys. An explicit deadline race
bounds even stalled fetch/read promises; stream cancellation is best-effort and
never awaited without a bound. JWT input is capped at
16KiB. Exactly one matching RSA signing key is required, with at least 2048 bits.
There is no key cache, discovery URL from the token, retry or fallback key. JSON
is parsed once with the same objects used for signature-bound claim checks; no
decoded claims are returned for a downstream parser to reinterpret. Signature
verification always covers the original encoded bytes. The optional fetch/clock
injections exist for tests and must not be exposed to untrusted request input.

The result `tokenVerified:true` means only that token verification succeeded under
the supplied trusted pins and key transport. It does not prove owner approval,
the supplied comment/body, check execution, ledger state or replay safety. General
authenticated/provenance/authorized/durable/dispatch/merge flags remain false.
Only a minimal run/source result is returned; raw tokens, JWT payloads, key data
and sensitive error messages are never included. A jti is required but no JWT
replay store is supplied: durable operation admission remains the ledger's job.

Fourteen locally signed synthetic-token tests cover successful signature validation,
changed claims/signatures, audience/source/run confusion, expiry/time types,
algorithm/key-URL confusion, key duplication/use, malformed pins, redirects,
network failure, oversized key responses, stalled fetch/read/cleanup, expiry during
key retrieval and explicit subject variants. These are
cryptographic/unit tests, not an actual GitHub/OIDC service integration test.
Run `node --test docs/autonomy/event-adapter/review-binding/test/publication-oidc.test.mjs`.

Remaining integration work: enforce an independently authenticated approval and
run binding at a private service boundary; compose the verifier with the negative
payload contract and ledger; provide independent comment readback and authenticated
receipt retrieval. Validate actual PostgreSQL transactions/crashes and a real OIDC
token under separate bounded execution approval. No live-publication readiness
follows from this source or the synthetic tests.

Primary claim reference consulted 2026-10-14:
https://docs.github.com/en/actions/reference/security/oidc
