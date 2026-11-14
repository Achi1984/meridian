# GitHub state transport through runtime composition

Acceptance is **SOURCE_COMPOSITION_ONLY / PUBLICATION_NOT_READY**. The
integration test, external fake HTTP fixture and this document change no
production module, workflow, journal or state target. The transport, runtime
composition and status projection are already on main; the earlier PR #1044
dependency is obsolete. Provenance and consolidated results are in
`INTEGRATION_ACCEPTANCE_20261101.md`.

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

Five top-level scenarios cover:

1. Connected start persists `REVIEW_PENDING` before dispatch; serialized restart
   observes without redispatch. Admitted synthetic completion reaches
   `PUBLICATION_NOT_READY`, retaining `RECEIPT_POSTING`, without receipt POST or
   receipt `COMMITTED`. Another reconstruction performs read-only lookup:
   even FOUND remains UNKNOWN. Status projection performs four real transport
   GETs, no mutations or reviewer calls, and leaves provider/model/runtime
   evidence UNKNOWN/null; the stored posting fence is labelled as such, still
   `UNKNOWN` (not `BLOCKED` or `DONE`). A focused nested assertion retains actual capture's
   UNVERIFIED rejection by the real boundary.
2. Two real transport/runtime instances reach the same expected-head CAS.
   One dispatches; the other is conservatively UNKNOWN after the HTTP/GraphQL
   conflict. Quota and claim remain singular; another start does not mutate or
   redispatch.
3. Duplicate start deliveries (same instance and after serialized
   reconstruction) return `ALREADY_CLAIMED` with no HTTP mutation, GraphQL
   request, conflict, dispatch or receipt POST; canonical bytes are unchanged.
4. Fake Git state commits `RECEIPT_POSTING`, then loses its HTTP acknowledgement.
   The actual transport/backend/lifecycle return UNKNOWN. Neither same-instance
   observation nor reconstructed FOUND lookup retries a mutation or dispatch.
5. Runtime's 500 ms deadline expires while a posting mutation is held inside
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

Results from the single focused run are recorded in
`INTEGRATION_ACCEPTANCE_20261101.md`. Independent review and full hosted CI
remain integration-slot gates. The late-write path exposes a real production
limit (no shared cancellation across runtime and backend HTTP), reported rather
than hidden.

No hosted atomicity, production readiness, publication authority or trusted
provider provenance is proven. Existing exhaustive transport validation and
projector/capture unit coverage are not duplicated. Source publication remains
NOT_READY; the tests must not be weakened to manufacture completion. Production blockers
discovered by these seams are reported, not worked around.

All runtime HTTP is injected synthetic HTTP. No real API probe, credential,
provider/account call, provisioning, receipt publication, runtime/feed/trading
activation, local real journal or financial action is performed.
