# MERIDIAN Autonomy Bridge V3 — isolated design (2026-10-10)

Status: DESIGN_ONLY / NOT_AUTHORIZED_FOR_ACTIVATION. Base: main 33db4d3e0cd0ddd01f046e8a8ca3bf57ed9350e4. STREAM-SAFE-V7 applies.

## Goal and trust model
Move beyond offline Bridge R2 only after independently verifiable evidence. ChatGPT remains lead and sole merge owner; Claude is independent read-only reviewer; Codex may implement scoped changes only following owner-approved boundaries. GitHub API responses are evidence only when fetched by a trusted, bounded transport; agent-supplied JSON, labels, comments and flags are untrusted. No implicit authorization from a successful CI run or a GREEN review.

## Proposed architecture (not implemented)
1. **Read-only evidence collector:** fetch exact repository, PR head/base, immutable commit and check run IDs; bind to an operation ID and request ID. Reject mismatches, absent fields, stale checks and ambiguous identities.
2. **Policy gate:** require explicit owner authorization for each mutating class; check allowlisted paths, protected branches, source stage, cost ceiling and forbidden actions. Default deny. Offline tests must not be interpreted as live capability.
3. **Single-writer journal:** append hash-linked local intent, expected revision and branch head before an action; use compare-and-swap for mutations. On unknown outcome, reconcile remote state before any retry; never replay an identical write blindly.
4. **Agent coordination:** one request ID + exact head + scope; one Claude review request; never duplicate answered or in-flight requests. Strongest blocking verdict wins for the same head. New head invalidates earlier review.
5. **Release gate:** verify actual exact-head CI with named job status and test counts, independently read full diff, obtain Claude exact-head verdict, then request explicit owner merge decision. Check exact head and base again immediately before merge.
6. **Observability:** one edited PR progress comment; mailbox #571 reserved for CROSS_MODEL_REQUEST, CROSS_MODEL_RESPONSE, NEEDS_USER_DECISION and FINAL_MERGE_STATUS. No watchdog noise.

## Non-goals and hard stops
No live agent dispatch, runner/workflow modifications, permissions, secrets, paid starts, automatic merge, deploy, trading, discovery, validation, holdout, canonical execution or strategy PnL. SOURCE_AUDIT remains frozen. No inference of authentication from self-asserted GitHub-shaped objects.

## Acceptance and adversarial test matrix
- Forged actor or GitHub evidence rejected; same-account hostile writes and rollback explicitly out of offline trust scope.
- Replay of same request/head is inert; same request with changed head fails closed; distinct request IDs never bypass per-head review dedupe.
- Crash before and after remote mutation reconciled without duplicate effects.
- CAS conflict, stale base/head, altered file list, missing CI job, stale GREEN and contradictory verdict block advancement.
- Protected paths, workflows, release identity, research authorization and cost guards denied.
- Transport outage, rate limit and partial API payload yield STOP/WAITING, never speculative success.
- No mutable workflow or agent activation until a separate security review, scoped user approval and demonstrated end-to-end test.

## Next isolated implementation package
Produce a pure, side-effect-free evidence-envelope validator and negative tests on a separate branch; do not wire it to network transport. Require CI and Claude exact-head review before any merge. This design document grants no implementation or runtime permissions.
