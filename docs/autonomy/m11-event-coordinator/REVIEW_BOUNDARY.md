# M11 Review Boundary Admission (isolated packet)

`scripts/autonomy/m11-review-boundary.mjs` provides a pure admission boundary that combines:

- **trusted runtime evidence** (through an explicit injected seam),
- **untrusted model output**, and
- **expected exact identity** (request/session/reviewer/repo/head/base/diff + changed paths).

It is intentionally isolated and not wired into existing coordinator runtime yet.

## Safety and authority boundaries

- No network, subprocess, credentials, or live reviewer invocation.
- No dispatch/merge/activation permissions are ever granted by this module.
- Output is structured only; model prose is treated as untrusted diagnostic text.
- `UNKNOWN` outcomes are non-retry (`retryAllowed: false`) to preserve no-blind-retry semantics.
- Witness validates observed inputs/session binding, **not** review quality.

## Trust seam requirement

The caller must supply `trustedRuntimeSeam.verifyRuntimeEvidence(...)`.
The boundary does not accept arbitrary object branding as proof of external authenticity.
The seam output must pass strict own-data schema checks (no getters/proxies/prototype tricks, no extra fields, bounded arrays/strings).

Expired, contradictory, or malformed runtime evidence blocks admission.

## Completion rules

Successful completion requires all of:

1. Runtime identity equals expected identity (request/session/reviewer/repo/head/base/diff).
2. Runtime terminal state indicates successful completion (`completed` + `end_turn`, no truncation, no turn-limit).
3. Runtime coverage witness includes all `REQUIRED_REVIEW_PARTS`.
4. Runtime changed-path witness contains all expected changed paths.

Runtime terminal/truncation/turn-limit and runtime witnesses override model claims.

## Output compatibility notes (for future core adapter)

The boundary returns a safe structured record containing:

- status and completion state (`ADMITTED`/`BLOCKED`/`UNKNOWN`),
- final verdict (`GREEN_LIGHT`/`REVISION_REQUIRED`/`NEEDS_MORE_EVIDENCE`),
- immutable trusted evidence identity (`evidenceId`, provider, observed/expires),
- runtime witness projection,
- untrusted model diagnostic projection,
- explicit non-authority flags (`dispatch/merge/activation/externalEffects = false`).

## Interface gaps for core owner

1. Provide concrete runtime verifier implementation behind `trustedRuntimeSeam`.
2. Define persistence contract for boundary record and evidence IDs.
3. Compose this module with existing coordinator review/store reducers.
