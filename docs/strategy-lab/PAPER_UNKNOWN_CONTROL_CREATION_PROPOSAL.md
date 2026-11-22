# Initial UNKNOWN control creation — owner-reviewable proposal

Status: **NOT_ADOPTED; no implementation in this packet**.
Baseline: PR1082, `87d69bb982c1261aa45f1b55a702cc413cd1ee7e`.

## Exact blocker

Reconciliation draft 0.1.0-draft.2 §4 accepts resolution proposals only from an
existing UNKNOWN_BLOCKED control record, but explicitly leaves its initial
creation/storage schema to a separate persistence design gate. Canonical v1
has no such record. Thus publishing the reconciliation draft did not make an
existing v1 UNKNOWN resolvable. The temporary-journal fixture needs neither this
record nor the proposed reconciliation outcomes and can be reviewed separately.

## Smallest proposed amendment (draft.3 prerequisite)

Add a closed creation envelope, separate from the unchanged v1 wire format:
`schemaVersion`, `creationIdentity`, `creationDigest`, `runRef`, `accountRef`,
`originalOperationRef`, `originalFenceRef`, `lastAcknowledgedStateRef`,
`lastAcknowledgedSequence`, `uncertaintyEvidenceRef`, `expectedAccountRef`,
`expectedJournalHeadRef`, `expectedCommittedSequence`, `expectedFenceDisposition`,
`authorityGrantRef`, and `controlIdentity`. All reference types must reuse the
accepted draft's exact immutable reference definitions. A precise closed schema
and canonical digest vector must be accepted before implementation; this list
is a review proposal, not a newly valid wire envelope.

Creation must explicitly record both last acknowledged state and independently
verified CURRENT account/head/sequence. They may differ after a lost ACK. Never
turn the last acknowledged state into a current-state CAS or infer absence from
it. Original operation/fence references must be exact and bound to run/account.

Add a distinct creation grant scope, validated independently of observation and
read permission. No bootstrap self-grant, default reconciliation authority, or
inference from user UI access. Evidence must establish the original uncertainty
and the current control/account/head/fence boundary. If that boundary is missing,
corrupt, contradictory, or unverifiable, return RESOLUTION_UNKNOWN with zero
writes. The original v1 block remains; do not fabricate a control record.

Creation transaction must atomically:

1. Recheck grant validity and the exact account/head/sequence/fence CAS.
2. Assert absence of a control record for the original run/account/operation/fence.
3. Append one immutable creation receipt and install control revision 0 in
   UNKNOWN_BLOCKED, with retryAuthorized=false and resumeAuthorized=false.
4. Leave original account, receipt sequence, receipts, and fence unchanged.

Allow ACTIVE_UNRESOLVED and RESOLVED_COMMITTED fences only when independently
verified. Creation itself cannot seal a fence or assert OP_APPLIED/OP_ABSENT.
An existing exact creationIdentity/digest returns the identical historical
receipt under separate read authorization, without a write. Same identity with
a different digest rejects; competing creation identities for the same operation
must not overwrite or produce duplicate controls. A losing creator reads the
winner only when independently read-authorized. Creation must serialize with
original commit and any later resolution, not merely with other creators.

Required future cases: lost ACK with committed current state; truly unresolved
original attempt; original commit racing creation; duplicate same digest;
conflicting digest; two distinct creators; revoked/expired grant; foreign
run/account/fence; unavailable/corrupt boundary with zero writes; exit before
creation commit; exit after creation commit before ACK; exact authorized lookup
after grant revocation; lookup leaves block intact. Every successful creation
must prove byte-identical original account/receipts and original sequence.

## Exact adoption change set

- Reconciliation draft: new version draft.3, initial-control closed schema,
  digest membership/vectors, dedicated grant scope, uniqueness/CAS rules,
  creation receipt, and transitions/races above; preserve draft.2 provenance.
- FORWARD_PAPER_V1_JOURNAL_SPEC.md: replace the UNSPECIFIED-amendment blocker only
  after acceptance with the exact accepted separate amendment version/commit;
  define atomic control creation and OP_ABSENT sealing separately from v1
  execution. Never rewrite the historical v1 event pin.
- FORWARD_PAPER_V1_RECOVERY_ACCEPTANCE.md: add creation/duplicate/crash/race cases,
  revised fence invariants, explicit same-result read-only lookup compatibility,
  and evidence that no terminal outcome permits automatic resume/retry.
- FORWARD_PAPER_V1_CONTRACT_SPEC.md and SYNTHETIC_PAPER_INFRASTRUCTURE_V1.md:
  reconcile reconciliation-authority and schema blockers with the same accepted
  amendment pin while leaving operational choices REQUIRED_UNSET and production
  WARMUP_ONLY unchanged. Original event fields/enums/bytes remain unchanged.
- Independent contract/accounting/security review and explicit adoption receipt
  must name the exact new schema, canonical-vector revision and coordinated
  journal/recovery commit. Only then propose a separate test-only reconciliation
  implementation packet with verified resource and verifier mechanism.

None of these adoption edits has been applied here. The next useful executable
step is review of the already implemented six-case temporary-journal packet;
actual strategy execution still needs candidate/source qualification and all
operating choices, not merely storage tests.
