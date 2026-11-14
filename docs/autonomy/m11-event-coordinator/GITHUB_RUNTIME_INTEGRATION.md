# GitHub state transport through runtime composition

Issue #1045 acceptance is **SOURCE_COMPOSITION_ONLY / PUBLICATION_NOT_READY**.
Only the new integration test, external fake HTTP fixture, and this document
belong to this packet. No production module, workflow, journal or state target
is changed or provisioned.

## Dependency and scope

The isolated branch starts at exact composition dependency
`7199f8d71df4638f77c3e55993e7c99ad9553d84` (PR #1044), then merges pinned main
`9f3b9a29513116a631d0eab4c708002b11dfffda`, which contains the actual transport
from PR #1042. The local checkout was shallow; ancestry was deepened before the
ordinary merge. The #1044 branch is untouched. Until #1044 is integrated and
this packet is refreshed to integrated main, this is dependency-based evidence,
not final current-main acceptance. It does not depend on #999, #997 or #1028.

`test/m11-coordinator-github-runtime-integration.test.js` imports the actual
GitHub transport and runtime composition. Backend, store, lifecycle, boundary
and projector run transitively without replacement. Collector input comes from
explicit synthetic external repository reads through the real branded collector.
Reviewer callbacks, lookup and trusted runtime evidence are explicitly synthetic
test authority, not authenticated hosted reviewer evidence.

The fixture serializes ref, commit, tree and blob objects, request history,
mutation/GET counters and reviewer counters. Reconstruction parses those bytes
into a new fixture, new transport and new runtime; no original object identity
or transport read-binding map is reused. It serves only injected HTTP, checks the
exact fixed target, and atomically compares `expectedHeadOid` before updating its
fake ref. It neither implements nor copies coordinator reducers. Git SHA and
logical coordinator OID remain separate.

## Focused acceptance

Run only:

```sh
node --test test/m11-coordinator-github-runtime-integration.test.js
```

Four top-level scenarios cover:

1. Connected start persists `REVIEW_PENDING` before dispatch; serialized restart
   observes without redispatch. Admitted synthetic completion reaches
   `PUBLICATION_NOT_READY`, retaining `RECEIPT_POSTING`, without receipt POST or
   receipt `COMMITTED`. Another reconstruction performs read-only lookup:
   even FOUND remains UNKNOWN. Status projection performs four real transport
   GETs, no mutations or reviewer calls, and leaves provider/model/runtime
   evidence UNKNOWN/null. A focused nested assertion retains actual capture's
   UNVERIFIED rejection by the real boundary.
2. Two real transport/runtime instances reach the same expected-head CAS.
   One dispatches; the other is conservatively UNKNOWN after the HTTP/GraphQL
   conflict. Quota and claim remain singular; another start does not mutate or
   redispatch.
3. Fake Git state commits `RECEIPT_POSTING`, then loses its HTTP acknowledgement.
   The actual transport/backend/lifecycle return UNKNOWN. Neither same-instance
   observation nor reconstructed FOUND lookup retries a mutation or dispatch.
4. Runtime's 500 ms deadline expires while a posting mutation is held inside
   injected HTTP. Backend does not forward the lifecycle AbortSignal, so the
   transport's independently bounded 3000 ms operation remains active. Before
   release, canonical state is `RECEIPT_PREPARING`; after release, the late
   `RECEIPT_POSTING` write and both authoritative readbacks finish. Serialized
   recovery retains the fence, stays UNKNOWN, and only looks up, with no extra
   dispatch, mutation, receipt POST or completion.

The late-write test deliberately proves a late commit is possible, **not zero
late commits or a shared end-to-end I/O deadline**. Its 1500 ms bounded drain
waits for eight readback GETs after release. Five-request/10 MiB transport limits
apply per transport operation, not per runtime invocation. Consumed-version
bindings are instance-local; restart safety here comes from the canonical
posting fence, not a durable transport fence or an ABA defense.

## Evidence and limits

Focused command above ran once on 2026-10-30: **5 tests passed, 0 failed,
0 cancelled, 0 skipped, 0 todo** (four top-level scenarios and one nested capture
check; 838.300125 ms total). No assertion corrections or test reruns were needed.
Independent read-only source review returned GREEN LIGHT with no significant
issues. That review is not the final integrated exact-head/cross-model approval.
No new production safety blocker was exposed: late posting remains fenced and
lookup-only, but the absence of shared cancellation is a real production limit.

At delivery, PR #1044 remains open and its head has independently advanced to
`377c0d93df846e7d5b2cfa85603ba7b00a8e3a0c`; this packet does not adopt that
newer head or claim acceptance against it. Against pinned main the draft also
shows the three inherited #1044 composition files; this packet's acceptance
commit itself adds exactly the three owned test/fixture/document files.

No full local suite or CI rerun/dispatch was performed; final integrated
exact-head CI and independent review remain integration-slot gates. This packet
must remain draft until the dependency is integrated and those gates pass.

No hosted atomicity, production readiness, publication authority or trusted
provider provenance is proven. Existing exhaustive transport validation and
projector/capture unit coverage are not duplicated. Source publication remains
NOT_READY; the tests must not be weakened to manufacture completion. Any actual
production safety blocker discovered by these seams is reported here rather
than repaired outside the three owned files.

All runtime HTTP is injected synthetic HTTP. No real API probe, credential,
provider/account call, provisioning, receipt publication, runtime/feed/trading
activation, local real journal or financial action is performed.
