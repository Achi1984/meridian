# Existing deployment fit — source inspection only

Inspected repository base `b0da3a11967955036dacab465848a1b9688a50fc`.
No deployment, database connection, credentials, schema or service was changed.

## What the existing sources establish

- `package.json` already depends on `pg`; its start command runs `scripts/start-gateway.mjs`.
- `server.js` conditionally creates a PostgreSQL pool from `DATABASE_URL` and initializes Meridian state/event/evidence/job tables. Its database status distinguishes PostgreSQL from an in-memory fallback.
- `server-gateway.js` also has an optional PostgreSQL pool configured by `DATABASE_URL`.
- `Dockerfile` uses `node:20-alpine`, installs npm production dependencies and starts the gateway. It does not explicitly provision the Python runtime used by this inactive event-runtime package.
- The sibling event-adapter README specifies Node 22+, and the source suites were run on Node 24.19.0. Compatibility with the current Node 20 image has not been established; runtime versions must be reconciled before integration.

These are source capabilities, not proof that the deployed service currently has a database, sufficient permissions, connectivity or the runtime required for this package. No live configuration was inspected. PostgreSQL server/client binaries were unavailable in the current development workspace, so no PostgreSQL concurrency or recovery test was performed.

## Narrow candidate for the shared-store step

An isolated autonomy store using the existing PostgreSQL integration is a candidate to evaluate before introducing another hosted service. This is an architectural inference from the sources, not an implemented or approved deployment design. The current SQLite inbox cannot be shared merely by placing a database filename in separate Actions jobs; copying or restoring its file is not a coordination protocol.

A PostgreSQL implementation must preserve the already tested inbox contract: permanent event/revision deduplication, conflict rejection, one consumed attempt, a single active scope with monotone fencing, unknown-outcome blocking, bounded records and atomic decision/continuation completion. It needs real independent-client transaction and crash tests against PostgreSQL; mocks or the SQLite suite would not establish those properties. Runtime provisioning and the storage adapter must be reviewed together.

Do not reuse existing research/trading tables or public routes as an implicit autonomy channel. No worker registration, credentials, model invocation or repository-write permissions follow from a configured database. A hosted event receiver still needs verified delivery provenance and independent current repository/review scope before processing; a coding worker additionally needs the bounded authorization and external-write guards that this local decision worker does not supply.

## Still separate from local recovery

Local recovery metadata has no authentication or execution authority. Shared-host deployment, authenticated full review evidence, trusted request/manifest construction, postmerge routing and actual event-delivery/recovery acceptance remain separate integration work. The hourly Autopilot remains disabled; none of these source preparations installs a scheduler.
