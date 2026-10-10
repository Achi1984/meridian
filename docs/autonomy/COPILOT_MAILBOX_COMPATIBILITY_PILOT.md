# Offline mailbox compatibility pilot

op_id: `MERIDIAN-COPILOT-PILOT-MAILBOX-20261010-001`

## Scope and revision evidence

- Verified live main / PR base: `d29481521337506d107c1fa4cc846f0a247c8936`.
- Initial isolated branch head: `aee8a1708bdc63acd20d9e2c0e4b88122c953c69`
  (empty initial-plan commit directly on that base).
- Branch: `copilot/meridian-copilot-pilot-mailbox-compatibility-tests`;
  existing Draft PR: #638. Final committed head is reported in the pilot handoff,
  outside this file to avoid a self-referential commit hash.
- Read `MERIDIAN_GO.md`, `MERIDIAN_LIVE_CHECKPOINT.json`,
  `scripts/watchdog-mailbox.mjs`, and the existing mailbox test suite.
- Only this document and `test/copilot-mailbox-compatibility.test.js` are added.
  Runtime, existing tests, workflows, permissions, dependencies, and policies
  remain unchanged. No PR #636 or other branch mutation, merge, deployment,
  research run, new integration, or additional spending is authorized.

All new fixtures are synthetic and call the exported `resolveMailbox`; there
is no parser copy, network client, subprocess, credential, or external action
in the new tests. A bounded read of the checkpoint-selected mailbox #571
(page 60, five-comment limit; three returned) confirmed a human-facing
`REVISION_REQUIRED` with same-line prose and an annotated `reviewed_base`
(comment 6097260947). No actual review payload is used as a fixture. The issue
also reports `GREEN LIGHT`; its live response was not independently retrieved.

## Current delivery classification

Each case uses a trusted owner request, a later trusted reviewer response,
and a live synthetic PR with matching head/base unless explicitly varied.

| Format / variation | Current state |
| --- | --- |
| All six canonical tokens: `GREEN_LIGHT`, `CHANGES_REQUIRED`, `STALE_HEAD`, `NEEDS_MORE_EVIDENCE`, `ROOT_CAUSE_CONFIRMED`, `ALTERNATIVE_CAUSE` with exact head/base | `ANSWERED` |
| `GREEN_LIGHT (static review only)` / `CHANGES_REQUIRED (integration pending)` | `ANSWERED` |
| Canonical metadata followed by separate-line review prose | `ANSWERED` |
| CRLF direct record or known action envelope with parenthesized verdict | `ANSWERED` |
| `GREEN LIGHT` | `UNRESOLVED` |
| `REVISION_REQUIRED`, with or without prose or parentheses | `UNRESOLVED` |
| `GREEN_LIGHT for this exact head.` or prose after closing parentheses | `UNRESOLVED` |
| Matching head/base SHA followed by a parenthesized annotation | `UNRESOLVED` |
| Bare CR rather than CRLF | `UNRESOLVED` |
| Wrong reviewer login, numeric ID, or type; different head or base, even with CRLF/envelope/parentheses | `UNRESOLVED` |
| Wrong owner login on the request | No request item |

`ANSWERED` only retires delivery tracking. Even a negative or exact-head
`STALE_HEAD` verdict can be `ANSWERED`; this is not a favorable review.
Every new case checks `reviewAuthorization:false` and `executionImpact:false`.
Head-less `STALE_HEAD` retirement is already covered by the original suite
and is not conflated with the exact-head case here.

## Minimal reproductions and lead contract decisions

Start with this synthetic response to an exact, live request with the same ID:

```text
CROSS_MODEL_RESPONSE SYNTHETIC-COMPATIBILITY
verdict: GREEN_LIGHT
reviewed_head: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
reviewed_base: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
```

The baseline is `ANSWERED`. Independently replace:

1. The verdict with `GREEN LIGHT`: `UNRESOLVED` (spelling gap).
2. The verdict with `REVISION_REQUIRED`: `UNRESOLVED` (vocabulary gap).
3. The verdict with `GREEN_LIGHT for this exact head.`: `UNRESOLVED`
   (same-line prose gap); parentheses or separate-line prose are accepted.
4. The base with `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb (recorded base)`:
   `UNRESOLVED` even with canonical verdict (independent SHA-field gap).
   The analogous head annotation is also rejected.

These independently isolated failures explain why fixing only a verdict
alias would not make the observed multi-gap response delivery-compatible.
The parser's verdict regex and allowlist are at lines 119–125; base SHA
validation is at line 120 and head validation at line 125.

These are characterization tests, not endorsements of dropped reviews.
The lead must choose and enforce a producer/consumer contract:
either require canonical machine metadata (plain exact SHAs, canonical tokens,
explanations in parentheses on verdict or in separate prose), or explicitly
approve narrowly specified aliases/normalization with separate runtime tests.
Under a producer-only decision, noncanonical responses must be corrected by
the producer; under an alias decision, supported equivalents should count as
delivery after all identity, ID, time, and exact-SHA gates pass. Do not accept
arbitrary suffixes or weaken identity/SHA checks implicitly. In either
decision, delivery acceptance must never grant merge authority, replace
independent exact-head/base review and CI, or replace owner approval.

## Added coverage versus existing controls

Novel coverage: spaced/unsupported human-facing verdicts; isolated suffix
versus parentheses versus separate-line prose; annotated but otherwise exact
head/base; the four previously untested canonical verdict tokens; direct
response CRLF; and CRLF action-envelope/parenthesis combinations.

Existing controls retained as compatibility interactions: `GREEN_LIGHT`,
`CHANGES_REQUIRED`, reviewer numeric ID/type, and head/base mismatch. The new
tests exercise these with CRLF/envelope/parentheses and verify response IDs,
unresolved keys, and both non-authority flags. Login-only impersonation for
reviewer and owner adds coverage beyond the original numeric-ID/type checks.
The original suite already covers pagination, stale-without-head, retries,
age/time boundaries, duplicate metadata, supersession, target retirement,
workflow shells, fingerprint suppression, and status-trailer CRLF; those are
not claimed as newly discovered gaps.

## Validation and limitations

Command (repository working directory):
`node --test test/claude-watchdog-mailbox.test.js test/copilot-mailbox-compatibility.test.js`.
Node: `v22.23.3`. Output was captured under `/tmp`; only the summary was
displayed. First run at 12:05:01–12:05:03 UTC: exit 1, 128/129 passed
(2183.461227 ms). The new bare-CR fixture incorrectly invalidated both
request and response, yielding no request item. It was corrected to keep
the request LF-valid and vary only the response; no runtime or existing
test changed. One corrected rerun at 12:05:20–12:05:22 UTC: exit 0,
**129/129 passed** (103 existing, 26 new; 2119.289322 ms), no skips.
`git diff --check` also passed. No repeated retries were performed.

No full-suite, live workflow, end-to-end reviewer delivery, or integration
readiness claim is made. The original suite uses local mocked shell commands;
the new suite uses only in-memory data and built-in assertions. No runtime
repair is attempted. Timing above is measured test execution, not total
agent-session time. Final handoff records the exact tested committed head
and automated review/security results. AI-credit consumption and billing are
not observable; no credit metrics are invented.
