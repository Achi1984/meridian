# M11 GitHub Read Adapter (isolated packet for #973)

`scripts/autonomy/m11-coordinator-github-read-api.mjs` is a bounded, read-only adapter for the `collectExactPair` API surface:

- `getWorkflowRun`
- `getPullRequest`
- `getPullRequestDiff`
- `listWorkflowRuns`
- `listWorkflowJobs`

It is intentionally **not integrated** into existing coordinator files yet.

## Safety boundaries

- **GET only** (no write/mutation methods exported).
- Fixed origin and repository only: `https://api.github.com/repos/Achi1984/meridian/...`.
- Redirects disabled (`redirect: 'error'`).
- Off-origin responses and off-origin pagination links are rejected.
- Bounded request deadline, bounded response bytes, bounded caller page window.
- Caller abort is propagated to in-flight fetch.
- Rate-limit and ambiguity conditions fail closed.
- Errors use stable codes and must not include credential values.

## `authenticated` contract (non-forged)

`authenticated` is **not inferred from token presence**. It is true only when at least one of these is true:

1. Constructor receives valid `transportEvidence` (host/api scheme/TLS/verified time, optional unexpired window).
2. A successful API response contains authenticated transport headers (`x-oauth-scopes` or `x-accepted-github-permissions`).

Residual trust: this proves authenticated transport metadata was observed on `api.github.com`; it does **not** prove principal identity or that every required scope/permission is still present after the observation time.

## Exact-pair and diff completeness behavior

- Workflow run head SHA is mapped from GitHub run payload (`head_sha`) as-is (can be merge SHA).
- Historical base SHA is taken only from run-associated pull request objects; empty/ambiguous associations remain explicit (`baseSha: null`) and must block at collector policy level.
- PR metadata is never used to substitute missing historical run evidence.
- `getPullRequestDiff` binds to immutable `baseSha/headSha` and marks `complete: false` when completeness cannot be proven (pagination ambiguity, missing file patches, changed-file mismatch, empty diff text).

## Interface gaps for core integration owner

This packet does not modify existing #973 core files. Integration owner still needs to:

1. Wire this adapter into coordinator injection points.
2. Decide the authoritative source and lifecycle for `transportEvidence`.
3. Map adapter error codes to coordinator-level blocked/waiting reasons.
