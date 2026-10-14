# PostgreSQL publication ledger — source preparation, not deployed

The separate [publisher OIDC verifier](PUBLISHER_OIDC_PREPARATION.md) is now
prepared with synthetic signed-token tests. Service composition, authenticated
approval/run binding and real PostgreSQL tests remain outstanding.

Continuation of owner-approved architecture preparation #571/6160988345.
Main source already contains PostgreSQL support in `server.js` and a separate
Asset Watch verifier in `github-actions-oidc.js`. Their existence does not prove
that a deployed database is available or authorize using its credentials.
Neither production file is changed by this packet.

## Concrete choice and scope

Propose an isolated `meridian_publisher` PostgreSQL schema, accessed only by a
trusted backend through its own restricted non-owner role. No database password
is provided to a workflow. The adapter accepts a dedicated trusted autocommit
`pg.Pool`; it must never receive a transaction-bound Client, arbitrary caller
query function or existing application connection with broad table permissions.
This injection contract is not an authentication mechanism.
The future pool must verify the database server's TLS certificate/hostname and
use bounded connection/statement timeouts. Do not copy the existing application's
`rejectUnauthorized:false` setting into this new trust boundary.

`publication-ledger.sql` is a reviewable provisioning candidate, not an automatic
migration. `publication-ledger.mjs` has no driver import, connection creation or
entrypoint. It sends at most one fixed parameterized statement to a supplied pool.
No source here imports it into the gateway, creates a route or enables a sender.

The unique operation key is derived by the existing publication protocol from
repository ID, mailbox, request and operation. The authenticated service must
derive it itself, not accept a key from request JSON. Intent/body/run bindings
are likewise derived from the exact approved plan. The initial insert uses
`ON CONFLICT (operation_key) DO NOTHING RETURNING`; an existing row never becomes
a new grant. Identity remains immutable; only RESERVED -> CONFIRMED or AMBIGUOUS
is permitted. Terminal states cannot change. No expiry, deletion, truncation,
reset, lease or update-to-retry exists. Trigger and role restrictions are defense
in depth; database owners/superusers remain trusted administrators who can remove
them. No claim of protection against a malicious DB administrator is made.

`ACKNOWLEDGED` describes a matching query response only. It is **not** a send
capability or proof of durable commit; all authority/durability flags remain false.
The future service must own and verify autocommit pool semantics and database
configuration (including durable WAL/commit and failover guarantees) before using
the insert acknowledgment. Zero rows means NOT_ACQUIRED; any error, lost response
or malformed reply means UNCERTAIN. There is no retry and no reread that upgrades
an uncertain reservation to permission to send. A reservation can consume an
operation without delivering its comment. Failed terminal persistence leaves the
already-consumed operation blocked.

## Distinct authenticated service contract to implement next

The proposed publisher workflow requests a GitHub OIDC token for the dedicated
audience `meridian-negative-publisher`. A new service verifier must validate RS256
signature against GitHub's fixed issuer/JWKS, exact audience, timestamps/age,
repository numeric identity, main ref, approved workflow path **and SHA**, run ID,
attempt 1, event workflow_dispatch, and github-hosted runner. Reusable workflows
are excluded from the first mode unless both caller and job workflow identities
are explicitly designed and pinned. Never use user-supplied decoded claims,
arbitrary JWKS URLs, the shared Actions bot identity or a boolean 'verified' field
as authentication. Do not reuse or widen the Asset Watch verifier/audience.

OIDC proves job origin, not owner authorization of its body. Independently loaded
owner approval, current PR head/base, policy/body digest, control-source pin,
expiry/revocation and trusted launcher/run binding are separate checks. Raw
tokens, database URLs and full private payloads must not be logged or stored in
the ledger. OIDC itself does not bind the request body digest: the service must
compare the approved plan before every reservation/finalization operation.

The service's receipt endpoint must read the immutable reservation/terminal row,
return exact operation/intent/body/run/comment bindings and authenticate its
response to the receiver over a fixed authenticated channel. The service must
independently read the original GitHub comment before accepting CONFIRMED; a
workflow-supplied comment ID is not proof. Current code checks SQL behavior only;
no OIDC service, receipt route or trusted receiver adapter is supplied yet.
No per-workflow exclusivity is inferred from a GitHub-signed commit.

## Rejected shortcut

A Git ledger branch with `createCommitOnBranch.expectedHeadOid` could serialize
cooperating writers, but the shared Actions actor does not identify a workflow.
A permitted writer can also delete an operation record via an ordinary forward
commit. Preventing force pushes alone therefore does not preserve reservations.
The PostgreSQL proposal avoids adding repository contents:write for this ledger;
its actual service/database access still requires separate deployment approval.

## Verification and rollout boundary

Run `node --test docs/autonomy/event-adapter/review-binding/test/publication-ledger.test.mjs`.
Nine fake-client tests cover fixed SQL/parameters, conflict/no-retry, lost response,
malformed readback, invalid input, exact terminal bindings, failed settlement,
invalid transitions and caller mutation during an outstanding query.
They do **not** execute the SQL schema or prove PostgreSQL concurrency, process
crash recovery, role isolation, authenticated origin or deployed persistence.
No PostgreSQL server/client was available in the preparation environment.

Before live use, run the actual schema in an isolated supported PostgreSQL:
two concurrent same-key claimants (exactly one wins), crash after committed insert
but before acknowledgment (no replay), restart recovery, forbidden identity edits,
DELETE/TRUNCATE/terminal mutation, restricted-role access and rollback/failover
behavior. Then implement and adversarially test the separate OIDC service and
receipt receiver. Runtime permissions, provisioning, route installation and any
bounded publication test require reviewed exact source and explicit approval.
Reversal before activation is removal of unused preparation files. After activation,
disable admission/sending but retain consumed reservations; never 'roll back' by
deleting the ledger and enabling retries.

Primary references, consulted 2026-10-14:
- https://www.postgresql.org/docs/16/sql-insert.html
- https://docs.github.com/en/actions/reference/security/oidc
- https://docs.github.com/en/graphql/reference/commits
