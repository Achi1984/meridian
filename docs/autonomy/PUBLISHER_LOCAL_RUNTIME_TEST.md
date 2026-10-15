# Disposable publisher runtime integration

Op-ID: `M11-LOCAL-RUNTIME-TLS-20261015`.
Prepared against main `1387b47e564c06c3475db501ac3ee77ffa098715`.

This source-only packet connects the existing catalog-readiness checker and
protected-environment Actions runner to a disposable local PostgreSQL 16 database.
GitHub responses, approval evidence, OIDC signing keys and publisher credentials
are synthetic. No GitHub comment is actually published.

The production host pin is unchanged. A test-only Pool adapter first checks the
complete expected production connection configuration, then substitutes a
loopback address, ephemeral port and ephemeral test CA. Consequently a passing
test is **not** evidence of Neon routing, Neon credentials, GitHub environment
protection or production readiness.

## Scope

- TLS certificate and hostname rejection, plus rejection of non-TLS connections.
- Real catalog checks with the three narrowly granted application roles.
- Deliberate excess timestamp INSERT privilege rejected by readiness.
- Protected-environment runner confirmation and duplicate-attempt exclusion.
- Concurrent attempts permit at most one synthetic publication.
- Lost reservation acknowledgement prevents sending; lost POST acknowledgement
  prevents resending, including a fresh runner instance.
- Wrong environment rejected before opening application pools.

All database changes are confined to the new disposable container. No real
connection string, administrator password or existing database is accepted.
The fixture uses the local Unix Docker socket, an already available pinned
PostgreSQL image, fresh synthetic passwords and temporary certificates. It must
not pull an image implicitly or install dependencies. Cleanup targets only its
uniquely named, ownership-labelled container and its own temporary directory.

## Evidence boundary

From the repository root, on a separately approved local Docker runtime with
the pinned image already present, OpenSSL, Python 3, Node and the repository's
`pg` dependency available:

```sh
node docs/autonomy/event-adapter/review-binding/scripts/publication-runtime-postgres-integration.mjs --local-pg16-tls
```

The explicit flag is mandatory. The command accepts no host, connection string
or password argument. It must exit successfully and report
`LOCAL_RUNTIME_INTEGRATION_PASSED` before the real-database gate can be recorded
as passed. A successful offline test invocation does not satisfy that gate.

Offline unit tests can validate adapter restrictions, import safety and fixture
contracts without Docker. They do not execute PostgreSQL or establish TLS
interoperability with the `pg` driver.

At preparation time this workspace has Node and OpenSSL but no Docker,
PostgreSQL server or installed `pg` package. The real database integration is
therefore **NOT_EXECUTED**. Missing prerequisites are a failed invocation, never
a successful or silently skipped database test.

## Approved isolated Actions execution

On 2026-10-15 at 10:49 Europe/Vienna the owner approved adapting the existing
`publisher-postgres-test.yml` workflow and **one** dispatch after exact-source
review (decision `M11-LOCAL-TLS-RUNNER-AUTH-20261015`, mailbox comment
6188228371). The job remains manual, read-only, pinned to its reviewed source
SHA and limited to ten minutes. It explicitly caches the already pinned image,
retains the legacy database regression and then runs this TLS integration.
Use only the existing Actions quota; no additional purchased budget is granted.
No retry is authorized if the one run fails or its outcome is unknown.

Synthetic passwords are visible to the disposable container's local Docker
daemon and process inspection; they are never real service credentials.
Docker control is privileged and therefore requires the approved isolated
runner. An interrupted local invocation may leave its uniquely named container;
inspect the exact `meridian.local-tls` label and name before removing only that
identified container. Do not use broad Docker cleanup commands.

No secret installation, production role, strategy permission or live/trading
flag is changed. Exact-head CI and independent review remain required; source
review must not substitute for the outstanding real database execution evidence.
