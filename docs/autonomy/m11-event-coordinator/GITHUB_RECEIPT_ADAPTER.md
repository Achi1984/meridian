# Coordinator GitHub receipt adapter (source only)

`scripts/autonomy/m11-coordinator-github-receipt-api.mjs` composes the receipt
hooks in `m11-review-lifecycle.mjs` from accepted main `6abe32fd` (#1020).
The implementation was developed against checkout
`6bfe9269e50ed6ba2b73fbaa81659dec23b8de6e`, whose parent is that accepted main.
It does not change the GET-only adapter, backend (#1022), or UI (#1024).
It is **disabled by default**, has no caller wiring, and performs no credential
acquisition, provisioning, workflow activation, or actual hosted publication.
All tests use injected synthetic transport.

## API and immutable intent

The factory export is `createM11CoordinatorGithubReceiptApi(options)`. Its frozen
interface is:

```js
await adapter.postOnce({actionKey, executionKey, receipt, signal}); // signal optional
// {status: 'CREATED', receiptId: '123'} | {status: 'NOT_ATTEMPTED' | 'UNKNOWN'}
await adapter.lookupByActionKey({actionKey, signal});
// {status: 'FOUND' | 'NOT_FOUND' | 'UNKNOWN', complete, receiptIds}
```

Both outer keys must equal `receipt.executionKey`. `receipt.actionKey` remains
the logical action key. The closed receipt schema is exactly the lifecycle
payload: `actionKey`, `executionKey`, `reviewRequestId`, `sessionId`,
`repository`, `pullRequest`, `headSha`, `baseSha`, `diffDigest`,
`completionState`, `verdict`. Only the boundary's terminal publication pairs
`COMPLETE/GREEN_LIGHT` and `REVISION_REQUIRED/REVISION_REQUIRED` are accepted;
incomplete review is not publishable.

Before entering `RECEIPT_POSTING`, the trusted host must durably persist an
immutable publication intent for this execution. The pure serializer
`canonicalizeM11ReceiptIntent(draft)` returns `{intent, body, intentHash}`:

```js
const draft = {
  version: 1,
  receipt, // exact lifecycle payload
  publisher: {
    actorId: '42', login: 'example-publisher[bot]', type: 'Bot', appId: '7'
  },
  posting: {
    kind: 'RECEIPT_POSTING', transitionId: 'durable-transition-id',
    fence: 'durable-fencing-identity', committedAtMs: 1700000000000
  },
  validUntilMs: 1700000060000
};
```

The returned intent adds `canonicalBodyHash` (SHA-256 of exact UTF-8 body bytes).
The host must allocate/bind the posting identity and commit the intent and
transition consistently; calling this serializer does **not** make either
durable or authorized. The host supplies
`intentStore.getPublicationIntent({executionKey, signal})`, returning that exact
immutable intent, including its body hash. Each lookup independently loads it,
including on a reconstructed adapter without any preceding POST. Missing,
modified, or inconsistent intent fails closed. JSON round trips are supported;
in-process object branding is not durable evidence.

All records are closed plain-data schemas, not accessor/proxy objects.
Identifiers are at most 200 UTF-8 bytes; head/base are lowercase 40-hex SHAs and
diff digest is lowercase 64-hex SHA-256. Publisher actor/app IDs are canonical
positive decimal strings (`appId: null` means no app and requires a null API
app field). Request IDs, session IDs, and logical keys are base64url-encoded in
the fixed body, not interpolated into arbitrary Markdown. There is no caller
body, mention, command, or endpoint option.

The versioned marker binds SHA-256 of the entire normalized intent core
(receipt, publisher, posting fence, and publication window), plus a payload
hash. The body hash is outside that core to avoid a hash cycle. This is a
deterministic binding, **not a signature or provenance proof**.

## Explicit trusted host dependencies

Enabling requires `enabled: true`, an injected `fetchImpl`, clock `now`
(defaults to `Date.now`), and the following trusted dependencies. There is no
global fetch fallback, environment secret discovery, token issuance, or
capability-boolean authorization.

* `credentials.getAuthorizationHeader()` synchronously returns the header from
  an externally managed credential. It is never returned in adapter results.
* `getTrustedAuthEvidence()` synchronously returns exactly:
  `{evidenceId, principal, host, scheme, tls, actorId, appId, verifiedAtMs,
  expiresAtMs}`. Host is `api.github.com`, scheme is `https`, TLS is `true`;
  actor/app must match the intent. Evidence is verified no later than now,
  expires strictly after now, and has a maximum 15-minute TTL. The trusted host
  must establish principal/credential identity, TLS/origin, and evidence
  provenance independently. A caller's token or self-reported evidence object
  is not proof; this source module does not implement that verifier.
* `authorizationAuthority.consumePostingAuthorization(request)` atomically
  consumes an **already issued**, fresh, authoritative, durable one-use
  authorization. Issuance must occur at the committed posting transition, not
  on demand from an observed `RECEIPT_POSTING` state or readback. The consumer
  must fail closed on duplicate/expired/revoked/unknown grants across all
  instances and processes, even if its own acknowledgement is lost. No issuer
  is exposed by this adapter.
* `publicationEvidenceStore.getPublicationEvidence({executionKey, signal})` is
  an injected trusted **read-only** source of durable actual-send evidence.
  It must return exactly `{status: 'RECORDED', commentId, executionKey,
  intentHash, canonicalBodyHash, transitionId, fence, authorizationId}`.
  IDs are canonical decimal strings; `authorizationId` identifies the consumed
  authorization that actually produced this comment ID under that execution's
  posting transition/fence. The store/verifier must independently establish this
  relationship from authenticated retained sender evidence and durable consumed
  authorization records, not infer it from a comment's body, marker, shared
  actor/app identity, or a requester's assertion. Missing, ambiguous, or
  unverified records must not produce `RECORDED`. The adapter does not implement
  this trusted store/verifier, create send records, or mint provenance.

The consumption request contains exactly `intentHash`, `canonicalBodyHash`,
`executionKey`, `transitionId`, `fence`, `evidenceId`, `principal`, and an abort
`signal`. A successful consumer response contains exactly those binding fields
(without signal), plus `status: 'CONSUMED'`, `authorizationId`, `issuedAtMs`,
and `expiresAtMs`. Issuance must be at/after the posting commit and no later
than now. Expiry must be in the future, within 60 seconds of issuance, and no
later than intent/auth-evidence expiry. A boolean or arbitrary token is
rejected. The injected consumer is an authority boundary, not a way for
untrusted application input to attest to itself.

The auth evidence and credential are snapshotted before the first durable
read. Freshness and exact snapshot equality are checked before/after requests,
before/after every stream read, and before returning success. Evidence ID,
principal, credential, or any other evidence rotation blocks the operation.
An observed rotation away and back between checks cannot be detected here;
the trusted host must use monotonic evidence epochs and never reuse IDs.
Callbacks must not synchronously block the event loop; async hangs are bounded.

## Transport and outcomes

Private constants pin origin `https://api.github.com`, repository
`Achi1984/meridian`, and mailbox issue **942**. POST uses only
`/repos/Achi1984/meridian/issues/942/comments`; lookup uses only that
collection's GET pagination. Redirects, alternate response URLs, unexpected
statuses/media types, and malformed streams are rejected. There is no retry,
PATCH, DELETE, arbitrary direct comment GET, or fallback endpoint.

Each adapter locally consumes its posting slot synchronously before its first
await. It invokes HTTP POST **at most once over its entire lifetime**. The
external authority must additionally enforce durable one-use consumption over
reconstruction and concurrency. The synthetic authority in tests demonstrates
the contract only; this change implements neither a hosted global-at-most-once
guarantee nor a trusted credential/authorization issuer.

`CREATED` requires status 201 and exact body, mailbox/URLs, canonical decimal
comment ID, numeric publisher ID, login/type, app ID, unedited state, and
creation/update timestamps within the intent window and not in the future.
GitHub timestamps have second precision; the posting window's lower bound is
rounded down to that precision. Unsafe numeric IDs are rejected; larger IDs
must arrive as canonical decimal strings. Timestamp equality cannot detect an
edit-and-restore within the same GitHub timestamp resolution.

Before fetch invocation, rejection/deadline/abort is `NOT_ATTEMPTED` (even if
authorization was burned). From the instant POST may start, all exceptions,
timeouts, aborts, auth drift, non-201 or invalid responses are `UNKNOWN`.
Unknown delivery is not permission to retry. An ignored abort can still mean
the server accepted a request. Late async intent/authorization completions
cannot proceed to POST after the operation is aborted.

## Readback inventory and limits

Lookup never consumes or issues authorization and never clears a durable fence.
It scans the full permitted mailbox inventory twice and requires identical
ordered snapshots, strictly increasing unique IDs, valid response destinations,
and consistent bounded pagination. Matching execution tags or intent markers
with wrong body, author/app, timestamps, or edited state are ambiguous, not
ignored. A copied marker or even an exact full-body copy from another workflow
sharing the same actor/app cannot prove workflow provenance; credential
compromise is not required for this ambiguity.

For a unique candidate, lookup reads the trusted publication evidence before
the second inventory scan and again afterward. Both records must be identical
and bind the observed comment ID to this execution, intent hash, canonical body
hash, posting transition/fence, and actual consumed authorization ID. A wrong
authorized comment ID, missing/ambiguous record, or changed authorization ID
returns UNKNOWN. These reads share the total deadline and auth-continuity checks.
Neither the candidate nor a successful POST response synthesizes a send record
inside this adapter. In particular, lost ACK after server acceptance remains
UNKNOWN/manual reconciliation when no positive authoritative send record exists.

`FOUND, complete: true` means exactly one authoritative exact match in both
complete permitted inventories **plus matching independently trusted actual-send
evidence**. Multiple matches, conflicting snapshots,
changed inventories, malformed/off-origin/looping/skipped/truncated pagination,
page/byte/deadline exhaustion, and auth drift return `UNKNOWN, complete: false`.
Direct GET of one ID would not prove inventory uniqueness and is not used.

`NOT_FOUND, complete: true` means zero matches in those observed permitted
inventories only. **Mutable GitHub pagination is not a snapshot and cannot prove
a linearizable negative**, even with two equal scans. Concurrent insert/delete
or transient unobserved mutation remains possible. `complete` is not a global
absence/linearizability assertion. NOT_FOUND can never authorize POST; the
existing posting fence and authoritative consumed authorization remain intact.
Likewise FOUND is evidence for lifecycle admission, not authority to write.

| Bound | Default | Maximum configurable |
| --- | ---: | ---: |
| Canonical POST body | 8192 UTF-8 bytes | fixed |
| Total operation deadline, including intent/send-evidence stores/authority/streaming | 4500 ms | 10000 ms |
| One response's decoded bytes | 131072 | 1048576 |
| All responses combined (both inventory scans) | 1048576 | 4194304 |
| Pages per inventory scan | 10 | 20 |
| Rows per page | 100 | fixed |
| Intent publication window | at most 15 minutes | fixed |

Content-Length is only an early rejection hint; decoded stream bytes are
counted independently. Deadline races also bound fetch/reader implementations
that ignore abort; cancellation is best effort. Exhausting limits is UNKNOWN,
not evidence of absence.

## Focused validation and handoff

Run only the existing focused Node test:

```sh
node --test test/m11-coordinator-github-receipt-api.test.js
```

It exercises synthetic create/readback, JSON reconstruction, shared
whole-sequence POST/GET counts, serialized available/consumed authority records
reloaded by independent instances, durable consumed-state restart, consumption
persisted with ACK lost, concurrent atomic consumption, lost POST ACK,
timeouts/abort/stalled streams, decoded and total byte bounds, publisher/hash/
copy/edit checks, zero/one/many matches, conflicting/mutating pagination, and
auth expiry/rotation, same-actor/app full-body copies, missing/wrong/ambiguous
actual-send evidence, and valid evidence with revalidation. Synthetic authority
persistence is a serialized in-memory fixture, not a hosted atomic store or
production crash-durability proof. No live GitHub POST or authentication is exercised.
Lead full CI and Claude review remain integration gates; focused success does
not claim those gates, production readiness, provisioning, or hosted safety.
