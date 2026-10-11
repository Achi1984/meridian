# Offline structured response producer

`produce_response(scope_raw, verdict, findings, ci_state_raw)` is a deterministic serializer, not a reviewer or deployed Claude workflow. No request, model invocation, GitHub mutation or native approval is performed. All returned authentication/authority flags are false.

The independently reconciled scope contains the existing exact repository/request/operation/PR/head/base/CI identity pins. CI state is separately supplied. The caller must provide an explicit supported verdict and an explicit findings list. No default verdict exists; prose is never parsed to infer approval. GREEN with any blocking finding is rejected. A non-GREEN result must include at least one explanatory finding. Findings are bounded to 32 records of explicit severity and at most 2048 UTF-8 bytes of text each. These restrictions do not establish the correctness or completeness of the supplied review.

The existing structured claim schema and serializer are reused unchanged through the pinned strict transport/coordinator. GREEN also requires completed-success CI according to that validator. The output body is canonical JSON with sorted keys, plus its SHA256. Duplicate pin keys, invalid scope/CI, unsupported verdicts and unknown state fields fail closed.

## Findings are explicit separate evidence

The existing strict claim schema has no findings property. This preparation does not silently widen it. Findings remain in the returned `assessment` sidecar, with the complete scope and bodySha256 included before computing `assessmentSha256`; the body contains the explicit verdict and exact identity/CI claims only. The hash of findings is not cryptographically embedded in the body and the existing binder does not validate that sidecar. This only catches accidental cross-request/body association when the sidecar is checked; it does not authenticate evidence. Publishing a separate sidecar alone is insufficient. A future approved design must bind the complete assessment and required executed-check evidence to the reviewed scope in an authenticated evidence contract, or adopt a reviewed schema change. This remains an explicit deployment and standing-review compliance blocker. Dropping the sidecar must not be represented as a complete review. Advisory findings may accompany an explicitly supplied GREEN; blocking findings may not.

## Actual deployed incompatibility remains

The inspected current claude-mailbox-review workflow requests a prose CROSS_MODEL_RESPONSE using GREEN LIGHT / REVISION REQUIRED and a literal Executed checks section. It does not emit this full JSON claim. This serializer does not alter that workflow, request wording, review requirements, model output or policy. It cannot claim that Claude inspected a diff or executed tests merely because JSON was produced. Existing prose is still blocked by the binder. The serializer neither covers nor authenticates the required Executed checks; it is not a full compliant review. Required executed-check evidence must remain preserved and independently verified in any future approved producer integration.

The serializer does not set reviewer actor identity, comment ID or version. Those remain separately pinned and observed by the unchanged binder/handoff. Caller data cannot manufacture authenticated Claude identity or replace actual CI.

## Validation

```sh
python -I review-binding/test/test_structured_response_producer.py
```

From the package parent, standard discovery includes these tests:

```sh
python -I -m unittest discover -s review-binding/test -p 'test_*.py'
```

Nine tests pass, including real code composition serializer -> unchanged binder -> actual sibling event adapter, four adverse verdicts, deterministic output, no default/prose verdict, contradictory findings rejection, changed/deleted version rejection, pin/CI drift, duplicate keys and bounds. All metadata is synthetic. Passing roundtrips demonstrate interface compatibility only, not deployed producer compatibility, authenticated review or permission to merge.
