# Integrated publisher PostgreSQL test preparation

Tracking: #774. Source baseline: `c4997255858bbaf2a5a17e315e806ba9cb3c8dc5` (PR #775).
This packet extends the existing disposable PostgreSQL harness. It does not run it,
change its workflow, install a productive host or grant publication authority.

## What the next isolated run must demonstrate

The receipt checks use the actual INSERT adapter and real restricted PostgreSQL
roles. They check the database-generated timestamp against database time, visibility
from a separate autocommit connection, concurrent reservations, committed writes
whose acknowledgment is lost or altered, rejection of existing keys, restricted
timestamp privileges, server statement timeout under a real relation lock, and a
raw transaction rollback that must never be represented as an acknowledged receipt.
After the existing container SIGKILL/restart, stored bindings and timestamps must
match exactly and must not yield a fresh reservation receipt.

The host checks compose the actual admission, receipt, transport, retention,
readback, confirmation and recovery modules with real isolated database pools.
GitHub evidence, signed OIDC tokens, credentials and HTTP responses are synthetic.
Every HTTP dependency is explicitly injected; no network fallback or real POST is
used. The checks distinguish synthetic POST counts from actual publications.
Successful completion, competing hosts, lost acknowledgments and recovery require
separate operation keys and comment IDs. Persisted rows are checked after restart.

The legacy send-record restart assertion checks its complete original key range
100..107. New suites check their own ranges/keys, so adding their records does not
weaken detection of unexpected rows in the old suite's scope.

The synthetic CI bridge additionally requires at least 37 tests, every test passed,
and zero failures, cancellations, skips or TODOs. Its three explicit suite paths
remain fixed. These synthetic results do not replace actual PostgreSQL execution.

## Execution boundary

The two earlier isolated database allowances are consumed. This source packet
requires exact-head review and the applicable merge approval. A new actual run
requires a separate bounded owner approval naming the final merged source SHA.
Use the existing `publisher-postgres-test.yml` manual workflow, once, with its
`approved_source_sha` equal to that SHA. The existing fixed PostgreSQL 16 image
digest, localhost-only port, disposable container, ten-minute job limit, read-only
repository permission and no production secrets remain unchanged.

Success must be established from the actual job logs: synthetic test totals,
each database suite's checks, restart checks and final PASS. Failure is evidence to
diagnose, not permission for another run. A successful local-container restart is
not proof of production durability, TLS, clock synchronization or host integrity.

Production host selection, database provisioning and roles, real credential
issuance, authenticated approval bootstrap, uncertain-operation ownership, and an
exact one-attempt live publication remain separate deployment decisions. No
trading or research-stage authority is changed.
