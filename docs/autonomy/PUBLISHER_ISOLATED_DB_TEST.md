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
package lock. Record the fixed image digest below with the source SHA and one-run
approval. The workflow checks that the approved source equals its actual GitHub
SHA. Both workflow and harness pin the same image; no caller-selected digest or
mutable tag is accepted. Owner approval remains an external review gate.
The workflow alone does not enforce a single-use execution approval.

Action commit pins were resolved through the public GitHub API on 2026-10-14.
Installation under `.github/workflows`, merge and one dispatch remain separate
from the current preparation approval. There is no schedule or automatic PR/push
trigger. Only contents:read is requested; no OIDC/write scope or production secrets.

Local validation can check JavaScript syntax, YAML structure and the existing
preparation tests. Actual PostgreSQL execution remains unrun: this environment
has no Docker/PostgreSQL, and normal package setup fails at setgroups/seteuid.
Do not report the database checks as passed until the isolated job actually runs.

## Verified official image pin (2026-10-14)

Source: `https://hub.docker.com/v2/repositories/library/postgres/tags/16`,
last updated 2026-10-07T19:07:56.71584Z. Official `library/postgres` tag 16:

- Index: `sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d`
- Linux amd64 manifest: `sha256:75adc2a65806c96bc0e59030230bfe3f1c1b0d6d8f8181a8913e2b8b53bdc166`
- Config: `sha256:275447c94b11b151decd1f29877965301d5a77032037c46de93d990f739f00a9`

The exact index and child manifest were fetched from
`https://registry-1.docker.io/v2/library/postgres/manifests/<digest>`.
SHA256 of each raw manifest matched its Docker-Content-Digest header and the
DockerHub values; the index links that child to linux/amd64. Only a transient
anonymous public-pull token was used, without logging or storing it. This verifies
registry correspondence/content addressing, not a vulnerability audit. The
harness additionally asserts PostgreSQL major 16 at runtime.
