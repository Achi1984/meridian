# Isolated PostgreSQL test candidate

Owner approved preparation at 2026-10-14 07:43:33 Europe/Vienna.
The workflow is an inactive fixture outside `.github/workflows`. It is not
installed, dispatched or connected to production. Existing Release Safety does
not discover the preparation tests under docs; this candidate invokes them explicitly.

The harness starts its own disposable PostgreSQL 16 Docker container, hardcodes
loopback port 15432 and synthetic credentials, and ignores database environment
URLs. It mounts no host files. No GitHub/OIDC token, sender or production endpoint
is used. The restricted non-owner role exercises the actual SQL and Node adapter.
The container has 256 MiB memory/one CPU; the manual job has a ten-minute limit.
Normal completion/failure removes the container and anonymous volumes; cancellation
or hard timeout relies on destruction of the ephemeral GitHub-hosted runner.
Unencrypted loopback is specific to this disposable test, not a deployment pattern.

Checks cover two concurrent same-key reservations (exactly one wins), lost reply
after actual commit, replay refusal, terminal transitions, role permissions,
identity/delete/truncate guards, rollback, and SIGKILL/restart recovery with the
same disposable container storage. The lost-reply injection is a simulated client
failure after a real DB commit; it does not reproduce every network failure.
This is not failover, storage hardware loss or production durability proof.

## Before installation or execution

Review the exact candidate commit, all harness/SQL/adapter source, and existing
package lock. Resolve and independently verify an official PostgreSQL 16 image
digest; record it with the source SHA and one-run approval. No digest is invented
or mutable image tag silently used. The workflow requires both values and checks
that the approved source equals its actual GitHub SHA. Digest syntax does not
authenticate image provenance or owner approval: those are external review gates.
The workflow alone does not enforce a single-use execution approval.

Action commit pins were resolved through the public GitHub API on 2026-10-14.
Installation under `.github/workflows`, merge and one dispatch remain separate
from the current preparation approval. There is no schedule or automatic PR/push
trigger. Only contents:read is requested; no OIDC/write scope or production secrets.

Local validation can check JavaScript syntax, YAML structure and the existing
preparation tests. Actual PostgreSQL execution remains unrun: this environment
has no Docker/PostgreSQL, and normal package setup fails at setgroups/seteuid.
Do not report the database checks as passed until the isolated job actually runs.
