# PostgreSQL TLS diagnostic workflow fixture

This is an **inactive source fixture**, not an installed GitHub Actions workflow.
It is credential-free and has no database login, SQL, retries, schedule, or
user-configurable host/ref. The probe script
`scripts/publication-postgres-tls-probe.mjs` is a pending dependency: it must be
merged and independently reviewed before anyone considers installing this
fixture. The fixture does not include or replace that script.

## Scope of evidence

A successful probe exit is intended to show that, from that GitHub-hosted runner
at that time, the fixed endpoint
`ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech:5432` accepted PostgreSQL's
SSLRequest and completed a TLS handshake with certificate-chain and hostname
verification. The workflow suppresses raw probe output and prints only a fixed
success or failure message.

This does **not** establish PostgreSQL authentication, a database role's
permissions, database contents or durability, or application runtime readiness.
It is not a SQL/connector result and must not be substituted for TLS evidence.
It also does not establish availability from other networks or at other times.

## Source and approval boundary

The workflow is manual-only and accepts no dispatch inputs. Its guard restricts
execution to the repository owner on `main`, first workflow run, and first
attempt. Checkout is pinned to the triggering `github.sha`, using a
commit-pinned checkout action with persisted credentials disabled; there is no
caller-selected ref. Permissions are limited to `contents: read`; no token
write, OIDC permission, secret, or database credential is configured.

An owner must separately approve installation of the reviewed workflow into
`.github/workflows` and a single run against the final merged `main` source SHA.
The probe script must already be merged and independently reviewed, and the
owner must explicitly approve the installation and that one-run diagnostic.
Installation alone is not run approval. Do not install or execute this fixture
as part of source preparation.
