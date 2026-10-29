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
- Caller abort/deadline remain active through full body streaming and parse (including cancel-as-EOF edge cases).
- Rate-limit and ambiguity conditions fail closed.
- Errors use stable codes and must not include credential values.
- Page responses return validated GitHub `total_count` as `totalCount`; missing/malformed counts fail closed.

## `authenticated` contract (non-forged)

`authenticated` is **not inferred from token presence** and is never elevated from response headers.

It is true only when caller-provided trusted attestation is currently valid (`getTrustedAuthEvidence()` or `trustedAuthEvidence`), with mandatory:

- `host: api.github.com`, `scheme: https`, `tls: true`
- `principal` and stable `evidenceId`
- `verifiedAtMs` and **required** `expiresAtMs`
- bounded evidence lifetime (short-lived window)

If evidence expires or a request receives `401/403`, the adapter invalidates prior attestation and reports unauthenticated until fresh evidence is supplied. `403` responses classified as rate-limited still invalidate authentication state while returning `RATE_LIMITED`.

`authenticated` is only a gate signal; it is **not** independent identity proof. For provenance, callers should read `authenticationEvidence` (immutable snapshot with `evidenceId`, `principal`, `verifiedAtMs`, `expiresAtMs`, host/scheme/tls) and persist it alongside collected artifacts.

Residual trust: this proves caller-attested authenticated transport evidence for `api.github.com` within the validity window; it does **not** prove end-to-end principal continuity outside that window.

## Exact-pair and diff completeness behavior

- Workflow run head SHA is mapped from GitHub run payload (`head_sha`) as-is (can be merge SHA).
- Historical base SHA is taken only from run-associated pull request objects; empty/ambiguous associations remain explicit (`baseSha: null`) and must block at collector policy level.
- PR metadata is never used to substitute missing historical run evidence.
- `listWorkflowRuns` is bounded to workflow + `event=pull_request` + immutable `head_sha`; returned run rows expose `headSha` and historical `baseSha` derived only from run payload associations.
- `getPullRequestDiff` binds immutable pair evidence by requesting both compare JSON and compare diff from `/compare/{base}...{head}`.
- PR metadata is read before and after compare fetches; movement races are rejected as ambiguous.
- Completeness remains `false` when proof is missing (pagination ambiguity, missing file patches, changed-file mismatch, commit-list truncation, merge-base mismatch, empty diff text).
- `listWorkflowJobs` validates run-attempt identity via bounded authenticated GET `/actions/runs/{runId}/attempts/{runAttempt}` and cross-checks every job `run_id`/`run_attempt`.
- If bounded relevant-run discovery cannot be proven complete within page/item limits, collector policy must fail closed (`UNSUPPORTED_RELEVANT_RUN_DISCOVERY`) rather than treating partial inventory as complete.

## Interface gaps for core integration owner

This packet does not modify existing #973 core files. Integration owner still needs to:

1. Wire this adapter into coordinator injection points.
2. Decide and implement authoritative source/lifecycle for short-lived trusted auth evidence.
3. Map adapter error codes to coordinator-level blocked/waiting reasons.
