# D1 technical data verification — not admission

Operation: `MERIDIAN-D1-WORK-20261019-01`; owner-approved scope: issue #895.
Observed main: `6f720373af5439af70c54e6cb2f1c17abaf8b877`.
Pinned data commit: `1c7b6dccd886f57e866c7d359c091b1e72a193ea`.

The technical verification passed for exactly the seven allowlisted Kraken files,
in request order. All complete raw-file SHA-256 values match EXECUTION_REQUEST.
All CSV records passed seven-column schema, finite decimal, positive OHLC/range,
nonnegative volume/integer trade-count and strictly consecutive daily calendar
checks. Selected series each have exactly 955 synchronized dates from
2024-02-19 through 2026-09-30 (6,685 selected rows). The unchanged existing B1
`validateSeries` returned `ok: true, errors: []`.

`verification.json` contains exact file paths, byte counts, complete and selected
hashes, toolchain, source/validator/verifier identities and the manifest draft.
Selected hashes use SHA-256 of UTF-8 canonical JSON: recursively sorted object
keys, original array order, JavaScript finite-number serialization, no whitespace.
No row sorting, filling, repair, replacement or partial acceptance occurred.

## Reproduction and independent evidence

`executed-verifier.mjs.txt` preserves the exact executed source, including its
original workspace paths. SHA-256:
`30e2b8bf80d93f2bb76b70a0afc28092180b729b1b0bd4ccf203359d28b6c156`.
It was invoked with `node d1-check.mjs` under Node v24.19.0. For reproduction,
copy the archived text to an `.mjs` outside the checkout and change only the
checkout/import/output locations. The pinned data commit must be available;
the verifier uses `git show <pinned-commit>:<exact-allowlisted-path>` to obtain
untransformed bytes. No market download tool is used. This is a manually
authorized D1 procedure, not a CI hook or a production loader.

Independent reviewer `/root/d1_independent_review` first inspected the verifier,
request, captured-loader canonicalization and existing validator. The reviewer
then independently recomputed all seven whole-file and selected-series digests
using a separate inline Node v24.19.0 program: explicit request pins, alphabetic
row-key insertion plus `JSON.stringify`, and existing `validateSeries`.
All seven raw and selected digests matched; all quality/calendar checks passed.
No engine import or strategy execution was used. This is an independent Work
agent review, **not a Claude verdict**. Candidate CI and final exact-head review
remain separately required; the technical result alone is not merge acceptance.

## Boundaries

Manifest state is **NOT_FROZEN**, admission is false, source authenticity is
**NOT_ESTABLISHED**. Hash agreement proves byte identity, not exchange origin.
No features, indicators, returns, PnL, strategy batch, Paper, Live, scheduler,
permissions or credentials were changed or activated. Production manifest and
admission constants remain null. D2 remains a separate explicit owner decision.
EXECUTION_REQUEST is retained as the original proposal with historical pending
wording; #895 and this dated receipt record the later D1-only authorization.

PR892 source acceptance is recorded in mailbox #639 comment6255139258: Claude
full-source coverage plus a separately authorized independent residual review.
It must not be described as a new final Claude verdict.
