# Actions publisher preflight and selected architecture

Owner decision: 2026-10-14 12:00:02 Europe/Vienna, “Wie du es für richtig empfindest- go”. Recorded in mailbox #571 comment 6165402603. Lead selects GitHub Actions with a dedicated persistent Northflank PostgreSQL ledger, separate from the financial DATABASE_URL. This selects the architecture only; no instance, cost or credential has been approved or verified.

## Implemented preparation

`publication-run-preflight.mjs` composes the actual plan/identity/admission code with the fixed GitHub evidence reader. It checks the fixed repository/owner, manual main run, attempt 1, run ID and control SHA before reads. It snapshots input and host bootstrap configuration, rejects extra request/context fields, and has no pool, reservation, credential acquisition or send dependency. Success means only PREFLIGHT_VALIDATED_NO_SEND, with authority flags false. No flag enables a send path.

`publication-plan-process.mjs` runs the existing Python validator asynchronously in its own isolated process with a fixed script, restricted environment, bounded input/output and ten-second deadline. Errors and child output are not exposed. The existing service now awaits this process instead of blocking the Node event loop. It still performs its original token and evidence checks afterward. This enables parent host deadline timers to run; it is not a claim of cancellation of effects already in flight.

Importing these modules performs no work. Calling preflight may issue fixed HTTPS GETs; it is not an offline check. Tests inject synthetic HTTPS responses and signed synthetic tokens. Host context/configuration/fetch remain trusted deployment inputs: copying GitHub environment values or passing JSON does not itself authenticate a host. A successful preflight must never be reused as a reservation receipt or publication authorization.

## Remaining coherent deployment boundary

The next source packet must bind actual Actions OIDC acquisition and owner approval bootstrap to the fixed configuration, instantiate separate narrowly scoped PostgreSQL roles with verified TLS and bounded statement/connect timeouts, and wire the existing host/recovery modules. Retain consumed operations across job exit and uncertainty. Never share the portfolio financial database or retry an uncertain publication.

Before provisioning, verify Northflank instance sizing, actual recurring price, network reachability from Actions, certificate verification, role ownership, backup/restart policy and DB/host clock behavior. Owner approves the concrete resource and cost. No connection string or secret is included in this packet.

Before installation/activation, review the exact workflow, permissions, protected environment and credential identity, including the expired key diagnostic. A future workflow requires separate review and owner approval; none is installed here. The exact body/target, direct owner approval, publisher run, one-attempt allowance and owner handling of uncertainty remain gates. No real publication, trading, strategy evaluation or new isolated DB run is authorized by this packet.

## Verification

Local Node publisher suites: 135/135 pass, zero fail/skip/cancel/todo. The normal Release Safety integration bridge includes the five new preflight/process tests alongside the existing 37 host/receipt/recovery tests. No live APIs or database were used. Exact-head CI and independent Claude review remain pending at preparation time.
