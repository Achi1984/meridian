# V2 review evidence envelope — source-only contract

This optional new contract places the complete supplied assessment inside the actual comment body. It does not modify the existing strict v1 claim, pinned validator or legacy serializer, and does not change legacy binder semantics. It does not invoke Claude, execute a command, fetch GitHub, publish a comment, authenticate a reviewer or grant merge authority.

## Interface

- `produce_envelope(claim_raw, assessment_raw, expected_scope_raw, required_policy_raw)` requires all four explicit serialized inputs and returns canonical JSON only after validation.
- `validate_envelope(body_raw, expected_scope_raw, required_policy_raw)` returns the unchanged v1 claim, full assessment, verdict and integrity digests, with all authentication/provenance/authorization/dispatch/merge/durability flags false.

The entire UTF-8 body is limited to 16384 bytes, matching the existing exact-comment body guard. The envelope has exactly schemaVersion=2, policySha256, claim, assessment and evidenceSha256. The unchanged v1 claim is checked by the pinned structured-review-transport.py and coordinator against independently supplied repository/request/operation/PR/head/base/CI pins.

The policy is supplied separately by the trusted controlling caller and has exactly `requiredChecks`, a nonempty list of 1–16 uniquely identified records `{id,commandSha256}`. Its canonical digest is bound inside the envelope. The response cannot replace it with a self-described policy, reduce mandatory checks or change expected command hashes. An empty policy is rejected, including for negative verdicts.

Assessment contains exactly findings and checks. Up to 16 findings contain severity (`blocking` or `advisory`) and at most 512 UTF-8 bytes of explicit text. Up to 16 checks contain exactly:

```text
id, commandSha256, executed, status, exitCode, evidenceSha256,
headSha, baseSha, requestId, ci
```

CI identity is the exact runId/runAttempt/workflowId/headSha already pinned independently. A not_executed check requires executed=false, exitCode=null and evidenceSha256=null. Passed/failed checks require executed=true and a SHA256 evidence reference; passed requires exit 0, failed requires exit 1–255. Boolean exit codes are rejected. Evidence hashes refer to caller-supplied execution evidence; the contract does not retrieve or authenticate that evidence.

Every present check must belong to the independent policy, match its exact command hash and match the expected request/head/base/CI identity. Duplicate or unexpected check IDs reject. GREEN requires every mandatory check, all executed and passed, and no blocking finding. Non-GREEN requires an explanatory finding; missing/not-executed checks remain explicit adverse evidence. No default verdict or prose-to-GREEN conversion exists.

## Integrity and actual trust boundary

`evidenceSha256` hashes canonical `{schemaVersion,policySha256,claim,assessment}`. Thus changes to findings or Executed checks change the actual comment body and evidence digest, fixing the former unbound-sidecar limitation. `bodySha256` additionally hashes the exact received bytes for the separate actor/comment-version binder. Both digests are integrity bindings, not signatures or proof of real execution. A malicious caller can invent matching check data and hashes; this source-only validator does not authenticate them.

Recomputing the integrity digest cannot bypass independently supplied policy or exact scope/CI pins. It also cannot turn a missing, failed or not-executed mandatory check into a valid GREEN without changing the underlying claimed check record. The contract still cannot tell whether a syntactically consistent claimed execution actually occurred. Trusted execution receipts and independently verified actual outputs remain required.

Policy completeness is explicitly outside this validator. The current review policy requires exact main/head/base checks, full diff, CI and scope-mandatory tests, plus continuity/frozen-research/orchestration checks when applicable. The trusted caller must construct that complete applicable policy and expected identities independently; merely supplying any nonempty list does not satisfy the standing review policy. Main-state freshness and actual execution provenance also remain external gates.

The deployed Claude workflow still emits prose with an Executed checks section, not this JSON envelope. No producer prompt, workflow, reviewer identity rule or activation has changed. The separate envelope binder must validate the original full-body actor/version before using this contract, without re-pinning a synthetic inner v1 body. Legacy prose and v1 behavior remain unchanged. This preparation is not a live review, compatible deployed producer or approval.

## Tests

```sh
python -I review-binding/test/test_review_evidence_contract.py
```

Eleven tests cover deterministic serialization, all false authority, assessment tampering, rehashed wrong scope/CI/policy, missing/failed/not-executed mandatory checks, duplicate/unexpected checks, blocking findings, contradictory execution status, adverse verdict preservation, findings inside body integrity, independent policy replacement/emptiness rejection, bounds, duplicate JSON keys and missing verdict rejection. All check records are synthetic; no tested command is asserted to have run by this contract.
