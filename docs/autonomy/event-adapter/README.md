# Event continuation adapter — source-only integration evidence

This package composes the existing event intake, planner, review coordinator and continuation reducer. It is not a receiver, scheduler, authenticated collector, runtime dispatcher or activation. It makes no network/model/filesystem calls at runtime and grants no authority.

Run with Node 22+ from this directory:

```sh
node --test test/*.test.mjs
```

Local result after the mailbox CI-binding fix: 20 tests passed, zero failures/skips/cancellations, Node v24.19.0. Fresh independent review is required for the corrected bytes. Fixtures are unchanged pinned sources; the first regression verifies their Git blobs against provenance.json. No external dependency or download is needed.

## Existing code reused

- PR648 intake `normalizeEvent`: repository/workflow/mailbox scoping and opaque comment digest.
- PR642 `planWork`: exact head/base job/review consistency, contradictory evidence precedence and ownership waits.
- Main V3 review coordinator, imported by that planner.
- PR661 `validateManifest` and `advance`: original ledger schema, claims, CI/review transitions, invalidation, expiry and authority-false contracts.

No second ledger state machine or collector is implemented. A search also found existing `scripts/codex-bridge-v3-evidence.mjs`; its authenticated-transport API explicitly throws AUTHENTICATED_TRANSPORT_UNAVAILABLE. Its local seen Set is not a live collector and is not reused as authentication.

## API

`reconcileContinuation({trigger,config,expected,snapshot,manifest,ledger,requiredJobs})` returns an immutable offline decision and reducer ledger. All authentication/provenance/authorization/dispatch/merge/durability flags remain false. The input fixture in test/event-continuation-adapter.test.mjs is a complete schema example.

`expected` carries separately reconciled repository, packet/request/operation identities, head/base/main pins, independently expected CI run/attempt/workflow/head pins, nullable independently fetched `reviewVersion` (commentId/createdAt/updatedAt/bodySha256), caller clock and age limit (at most 300 seconds). `snapshot` supplies repository, observation time, current main, PR head/base/state/merge, the planner's work row, exact event identity/revision, separate CI run/attempt/workflow/head binding, and nullable `reviewBinding` carrying the validated original comment version plus its CI identity. These are **unverified caller claims**, including timestamps and CI/review data. Independent-looking JSON objects cannot establish independence or provenance.

The future trusted caller must fetch and authenticate current repository/PR state, actual CI jobs from the exact run attempt, required checks, review identity and complete review evidence. It must map reviewer claims to the observed comment version/body digest; matching comment IDs alone is not proof of current review. eventBinding and ciBinding are consistency assertions, not authenticated receipts. The snapshot clock must come from trusted time. Latest attempt selection and job-to-attempt provenance remain the caller's responsibility. Serialized JSON must be strictly decoded upstream, including duplicate-key rejection; this API accepts bounded plain data objects, not raw snapshot JSON.

## Decision behavior

- Matching CI observation with missing review advances the existing reducer from CI_WAIT to REVIEW_WAIT and reports WAITING_REVIEW.
- Matching separately supplied review advances to COMPLETE_DRAFT and reports READY_FOR_OWNER_DECISION. This is never approval, execution or a merge command.
- Repeated completed snapshots add no revision; duplicate delivery is not thereby durable deduplication.
- Unknown or failed outcomes stop. Head/base/request/path mismatches and malformed/future/stale snapshots throw; **every exception must stop the affected pipeline**, not fall back to an older green result.
- Deleted review triggers, non-success workflow events, absent required jobs, active writers and contradictory reviews cannot complete the packet.
- A blocking/reconciliation observation on COMPLETE_DRAFT invalidates the existing ledger through its REVOKE transition, preventing stale draft-readiness reuse. Missing review uses existing REVIEW_REVOKED semantics.
- Main/base movement, an observed merged PR or merge-stage ledger returns RECONCILE_NEW_MANIFEST. A new manifest is never constructed or approved. The caller must reconcile the current main and separately obtain a valid fresh scope before further work. Historical COMPLETE_MERGED ledger evidence is preserved; it is not next-packet permission.
- The adapter handles post-draft evidence only. It does not select or dispatch an initial coding task, create a draft, run a model, merge, or claim the next packet.

## Ledger validation reuse

The existing reducer has no exported ledger validator. The adapter validates the full supplied ledger with a **pure, discarded REVOKE dry run** before decision-making. The reducer is immutable; that computed ledger is not returned or persisted. This deliberately reuses its complete validation rather than duplicating its state model. A later upstream refactor could expose a pure validation API, but no upstream fixture was changed here.

## Source provenance and publication

provenance.json records full commit/blob pins for #642, #648, #661 and main. The originals remain unchanged. Publication preserves this exact local structure under docs/autonomy/event-adapter/, including explicit pinned fixture copies, so reviewed source/test hashes remain unchanged. Do not copy this source-only package into production imports implicitly.

Remaining real boundary: authenticated event receiver and current evidence collection, durable shared consumption/lease/fencing, bounded model execution, output publication, independent review transport and guarded merge under concrete owner authorization. No existing hourly automation was enabled or modified.

Mailbox CI-binding correction: every path consuming work.ci now compares snapshot.ciBinding against independently supplied expected.ci, the observed work run/head and the configured workflow allowlist, with positive run/attempt/workflow identifiers. CI_WAIT, REVIEW_WAIT and COMPLETE_DRAFT cannot advance or retain readiness with null or mismatched binding. Existing adverse-review/deletion invalidation retains precedence.

Review-binding correction: READY requires exactly one scoped GREEN response whose comment ID matches `snapshot.reviewBinding`, whose original comment version matches independent `expected.reviewVersion`, and whose CI identity matches independent `expected.ci`. Mailbox wakes additionally require the normalized event comment timestamps/body digest to match. Workflow wakes require the independent current comment-version pins even though their own event has no comment. Missing/stale/version/run mismatch stops and revokes prior COMPLETE_DRAFT readiness; a sidecar cannot bless a different or additional scoped response. The binders and handoff preserve original full-body version/claim CI. These remain untrusted claims until a trusted caller actually retrieves and validates the current inputs.
