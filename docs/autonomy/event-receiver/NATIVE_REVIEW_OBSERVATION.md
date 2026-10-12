# Native review observation (source only)

`native_review_observation.observe_native_review(expected_raw, api)` observes one
independently pinned Copilot PR review. It reuses the existing PR/CI validators;
it does not replace the structured Claude review binder or continuation ledger.

The bytes input has exactly `scope` (prNumber, headSha, baseSha, ci) and `review`
(id, submittedAt, bodySha256). The CI object has runId, runAttempt, workflowId and
headSha. IDs are positive signed-64-bit integers; SHAs are lowercase full hashes.
The fixed actor is copilot-pull-request-reviewer[bot], ID 175728472, type Bot.
The selected review must be APPROVED with the exact PR URL, head, timestamp and
UTF-8 body digest. Main, open same-repository PR, Release Safety success and review
are reread twice, followed by a final main read. Drift or missing evidence blocks.

A match returns OBSERVED_APPROVAL_INCOMPLETE, never GREEN_LIGHT. It does not prove
latest-review completeness, resolved threads, executed checks, approval chronology,
transport authenticity, atomic freshness, durable storage or owner authorization.
Pins supplied from the same untrusted input do not establish independent evidence.
Every authority flag remains false; plannerResponse is null. Review bodies and
exception details never enter the result. Consumers must not use it as a gate.

The injected callable is assumed to perform only GET reads. There is no CLI or
production wiring. The existing collector HTTP allowlist intentionally does not
accept native review paths; this patch does not widen it. A separately scoped
transport and evidence-completion design is still required before live connection.
The consumed native coding pilot and its claim are untouched.

Run from this directory:
`python3 -m unittest test_native_review_observation -v`
