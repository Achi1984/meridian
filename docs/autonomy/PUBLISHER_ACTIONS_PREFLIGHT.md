# Actions publisher preflight and selected architecture

Historical architecture choice: 2026-10-14 12:00:02 Europe/Vienna, “Wie du es für richtig empfindest- go”, recorded in mailbox #571 comment 6165402603, initially selected GitHub Actions with a dedicated persistent Northflank PostgreSQL ledger separate from the financial DATABASE_URL.

Superseding status — 2026-10-14: the owner-approved dedicated Neon Free pilot has been provisioned as project `wandering-queen-12324132`. The isolated schema/role test branch passed 20 checks; direct application TLS remains unverified. Approval/status are recorded in mailbox #571 comment 6165402603 and issue #778 comments 6168196333 and 6168230680. The Northflank financial depot remains unchanged. Provisioning and schema checks do not establish protected-environment readiness, credential readiness or live-publication authorization.

## Implemented preparation

`publication-run-preflight.mjs` composes the actual plan/identity/admission code with the fixed GitHub evidence reader. It checks the fixed repository/owner, manual main run, attempt 1, run ID and control SHA before reads. It snapshots input and host bootstrap configuration, rejects extra request/context fields, and has no pool, reservation, credential acquisition or send dependency. Success means only PREFLIGHT_VALIDATED_NO_SEND, with authority flags false. No flag enables a send path.

`publication-plan-process.mjs` runs the existing Python validator asynchronously in its own isolated process with a fixed script, restricted environment, bounded input/output and ten-second deadline. Errors and child output are not exposed. The existing service now awaits this process instead of blocking the Node event loop. It still performs its original token and evidence checks afterward. This enables parent host deadline timers to run; it is not a claim of cancellation of effects already in flight.

Importing these modules performs no work. Calling preflight may issue fixed HTTPS GETs; it is not an offline check. Tests inject synthetic HTTPS responses and signed synthetic tokens. Host context/configuration/fetch remain trusted deployment inputs: copying GitHub environment values or passing JSON does not itself authenticate a host. A successful preflight must never be reused as a reservation receipt or publication authorization.

## Explicit environment identity preparation

The verifier now accepts two host-selected configurations. Existing callers with no `environment` property retain the main-ref subject profile and reject every token carrying an environment claim. Supplying an explicit trusted `environment` property selects the environment profile; the signed `environment` claim and explicitly pinned environment subject must both match. There is no claim-driven switching or fallback. Both legacy and immutable repository subject forms remain explicitly pinned, never automatically substituted.

Environment names in this preparation are restricted to 1–64 lowercase ASCII letters, digits and hyphens, starting with a letter. This avoids escaping and case-normalization ambiguity; unsupported deployment names fail closed. Existing repository/owner IDs, main ref, exact workflow and control SHA, manual event, run ID, first attempt, issuer, audience, signature and freshness checks remain mandatory. Reusable-workflow claims remain rejected. Other ordinary GitHub claims retain the existing behavior; this does not impose a blanket claim allowlist.

The service forwards only the trusted configuration pin. Unknown configuration keys still reject. Synthetic tests cover signed environment success and rejection before JWKS, evidence reads or database calls on missing/wrong environment, subject downgrade and forbidden workflow claims. The test environment name is not an installed or approved GitHub environment.

An environment JWT claim proves the claimed job environment only after signature verification; it does not prove that required reviewers or branch protection have been configured. Actual protection settings, owner-approved credential identity and activation still require independent deployment evidence. This source packet installs no workflow, acquires no token, opens no database connection and publishes nothing.

## Remaining coherent deployment boundary

The next source packet must bind actual Actions OIDC acquisition and owner approval bootstrap to the fixed configuration, instantiate separate narrowly scoped PostgreSQL roles with verified TLS and bounded statement/connect timeouts, and wire the existing host/recovery modules. Retain consumed operations across job exit and uncertainty. Never share the portfolio financial database or retry an uncertain publication.

Before deployment, complete the selected Neon pilot evidence: network reachability from Actions, verified direct application TLS, role ownership, bounded connect/statement timeouts, backup/restart behavior and DB/host clock behavior. The isolated schema/role checks do not substitute for these deployment checks. This source packet requires no new paid resource and approves no additional spend. No connection string or secret is included in this packet.

Before installation/activation, review the exact workflow, permissions, protected environment and credential identity, including the expired key diagnostic. A future workflow requires separate review and owner approval; none is installed here. The exact body/target, direct owner approval, publisher run, one-attempt allowance and owner handling of uncertainty remain gates. No real publication, trading, strategy evaluation or new isolated DB run is authorized by this packet.

## Verification

Environment identity packet: OIDC and service suites 53/53 pass; complete local publisher Node suites 154/154 pass, zero fail/skip/cancel/todo. Five added tests exercise signed environment success and rejection matrices. Existing ref-profile host, preflight and recovery fixtures pass unchanged. No live APIs or database were used. Exact-head CI and independent Claude review remain pending for this source packet.

