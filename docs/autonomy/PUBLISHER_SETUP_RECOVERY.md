# Reconcile the failed publisher test setup

This runbook prepares recovery evidence; it does **not** authorize or implement
marker removal, another setup attempt, secret writes, password changes or LOGIN.
Use it with [PUBLISHER_AUTO_SETUP.md](PUBLISHER_AUTO_SETUP.md). Scope remains the
fixed isolated test target defined there; production and the parent branch are
excluded.

## Known failed attempt

The owner-operated 2026-10-15 attempt reported
`AUTO_SETUP_FAILED_NO_REMOTE_WRITES`; its persistent
`~/.meridian-owner-setup/publisher-test-attempt` marker remains present.
The executed source was pinned to:

| File | SHA-256 |
| --- | --- |
| `publisher_test_auto_setup.py` | `c859d4413eb2b50f7aae04e1d28eb23961989eb64beb29cb751eb65f06a8bfc0` |
| `publisher_test_password_setup.py` | `12bf995f8327e93163c803d0eb8f643fb316ce909b3c6094b2c9f44efc4c0f60` |

In that state machine, `writing` becomes true **before** the first secret command.
The reported status therefore establishes that this invocation attempted no
target secret or database mutation. The marker is created before administrator
credential retrieval and the read-only database precheck; its presence does not
establish a remote write. This evidence says nothing about other writers or later
changes.

Subsequent owner diagnostics reached the database and matched the recorded role
baseline. Identity verification rejected the backend SSL flag. PR #816 corrects
that check to require client TLS on the actual connection and was merged as
`4ddf9b2a16b35254863b5b4062ad1e9ad1d548cc`. Source merge alone neither proves
successful owner-runtime execution nor authorizes a retry.

## Stage 1 — read-only reconciliation

The lead records a fresh evidence set before proposing marker recovery:

1. Confirm exact reviewed correction, required review/CI and post-merge results.
   Pin both matching helper files from the approved revision; retain the old
   hashes and failed-attempt result in the recovery record.
2. Establish an exclusive owner window: no other administrator, automation or
   terminal may modify these six test secrets, the three roles or the marker.
   Account for any intervening setup attempts. If this cannot be established,
   stop rather than treating the old failure status as current-state proof.
3. Inspect marker metadata and expected fixed content locally, without changing
   it. Require the owner-owned directory and marker, expected permissions, regular
   file and no symlink. Do not read CLI credential files or expose secrets.
4. Run the approved `--check`: exact repository/user identity, environment
   protections, `main` branch restriction and database variable must match.
   Complete bounded secret-name listings must prove **all six target names are
   absent from both repository and environment scopes**. Existing names are a
   reconciliation conflict, never permission to overwrite or delete them.
5. Run the corrected supervised **read-only** database precheck in the owner
   runtime. Require the pinned hostname/CA and `verify-full`, affirmative client
   TLS on that actual connection, expected database/owner identity, PostgreSQL
   version, ownership, all three NOLOGIN roles and exact approved memberships.
   Require clean rollback/connection close and supervisor success. A standalone
   TLS probe or `--check` success is insufficient.

Credential retrieval for step 5 stays within the reviewed private process/pipes;
never return a URI, password, password hash, raw exception or SQL text to chat.
The read-only `publisher_test_reconcile.py` runner performs the provider preflight,
private connection retrieval, supervised database precheck and a second provider
preflight. It does not read or alter the marker, so step 3 remains a separate
evidence requirement. Independently review and pin the runner and both sibling
helpers before use. Use the same approved paths/hashes as the setup helper:

```sh
python3 -I /absolute/reviewed/scripts/publisher_test_reconcile.py \
  --check --owner-approved-cli-sessions \
  --acknowledge-provider-logging --exclusive-owner-window \
  --baseline /absolute/reviewed/baseline.json \
  --ca /absolute/verified/ca.pem --ca-sha256 VERIFIED_CA_SHA256 \
  --gh /absolute/trusted/gh --gh-sha256 VERIFIED_GH_SHA256 \
  --neon /absolute/trusted/neon --neon-sha256 VERIFIED_NEON_SHA256
```

This is a non-executable template: replace paths/hashes with independently
approved values and run from the owner's interactive terminal. The runner uses
the same isolation/environment restrictions as setup. It emits one bounded
status and returns success only when that success status was delivered:

| Reconciliation status | Meaning |
| --- | --- |
| `RECONCILE_READ_ONLY_CHECKS_PASSED` | Provider gates passed before and after the corrected read-only DB check; point-in-time evidence only. |
| `RECONCILE_INVOCATION_FAILED` | Invocation or local prerequisite failure; no recovery authorized. |
| `RECONCILE_PROVIDER_CHECK_FAILED` | Initial or final provider preflight failed. |
| `RECONCILE_CONNECTION_RETRIEVAL_FAILED` | Private administrator connection retrieval failed. |
| `RECONCILE_DATABASE_CHECK_FAILED` | Supervised read-only DB precheck failed. |

Missing output or nonzero exit is not success. Record the status alongside
nonsecret source/evidence identifiers; never use it to trigger automatic marker
recovery or setup retries.

**Stop at this stage if any evidence is missing, stale or contradictory.** Keep
the marker and remote state unchanged. The existing database verifier does not
prove whether a role has a previously assigned password; do not claim that it
does or inspect password verifiers to fill that gap.

## Stage 2 — separately reviewed recovery plan

Only after Stage 1 passes, prepare an exact plan for independent review. It must
identify the reconciled attempt and current approved source, preserve the old
marker/evidence in a unique no-overwrite record, and specify the checks needed
before deliberately retiring only that reconciled marker pathname. Review must
cover interruption, symlink/race and concurrent-writer cases. This document
contains no executable marker-recovery operation.

Do not bypass the guard by changing HOME, choosing another marker path, patching
`acquire_marker()`, or deleting the marker blindly. Obtain any missing approval
for the concrete recovery action; do not confuse source review with runtime
authorization. Existing owner approval for isolated test preparation does not
expand the target or permit credential overwrite.

## Stage 3 — one controlled attempt, only after recovery approval

The approved recovery procedure may permit exactly one fresh preparation attempt
inside the same exclusive window. The unchanged setup guard must create its
fixed exclusive marker again and all provider/database gates must run normally.
Do not reuse generated passwords from an uncertain attempt or add automatic
retry, rollback, secret deletion or credential rotation.

| Result | Required handling |
| --- | --- |
| `AUTO_SETUP_PREPARED_NOLOGIN` | Record confirmed preparation; verify expected secret names and NOLOGIN state without exposing values. |
| `AUTO_SETUP_FAILED_NO_REMOTE_WRITES` | Preserve the new marker; investigate and reconcile before another attempt. |
| `AUTO_SETUP_RECONCILIATION_REQUIRED`, missing result or interrupted run | Preserve all local/remote evidence; treat the outcome as uncertain, with no retry or cleanup. |

Preparation does not activate LOGIN, prove a future runtime secret read, dispatch
a protected workflow or authorize production/live operations. Those remain
separate steps.
