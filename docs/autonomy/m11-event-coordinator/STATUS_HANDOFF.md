# Offline coordinator status handoff

Source-only integration based on main `e8e805b700b51653dc3dc03b33bdb3a0ecb65846`.
This does not deploy, activate, monitor, dispatch, retry, or authorize anything.

## Explicit caller contract

The existing `mountAgentStatus(document, window, options)` controller now exposes
`acceptSnapshot(serializedDTO)`, `clearSnapshot(reason)`, and `dispose()`.
There is no default source, global controller, custom event feed, network feed,
storage, polling, or automatic producer. The existing page mount remains empty
unless an explicit caller retaining its controller supplies a snapshot.

Generate a canonical envelope through the coordinator backend, then run the
existing `projectCoordinatorStatus(envelopeJson, contextJson, nowMs)` offline in
Node. Do not import that projector or the Node normalizer into the browser.
The caller maps its result explicitly:

| Projection result | Controller call |
| --- | --- |
| `READY` | `controller.acceptSnapshot(result.serializedDTO)` |
| `EMPTY` | `controller.clearSnapshot('empty')` |
| `UNAVAILABLE` | `controller.clearSnapshot('unavailable')` |

Pass only the serialized DTO string, not an envelope, projection result object,
or diagnostic. `clearSnapshot()` defaults to empty; only the exact reason
`'unavailable'` selects the unavailable message. Clearing never renders a DTO.

Acceptance returns the actual client's boolean result. It rejects deliveries
while locked, page-hidden, or disposed. Invalid/oversized DTOs, renderer errors,
and blocked deliveries discard previous DTO/cache, cards, links, and timers.
After disposal, acceptance returns false and clearing is a no-op.
Lock and pagehide clear the cache; unlock and pageshow cannot resurrect it.
A new explicit handoff is required after access and page visibility permit it.
This synchronous API does not acquire or queue snapshots on behalf of callers.

The existing client bounds input to 512 KiB and 50 nonempty rows; the existing
renderer validates and renders it. One expiry timer and generation checks remain
in the mount. Replacement/clearing invalidate old callbacks; expiry revalidates
through the same client/renderer, without generating new evidence.

## Evidence and integration boundaries

READY renders **stored coordinator operations**, including the supplied validated
GitHub operations link. It does not represent running agents. Provider, model,
coordinator mode, and freshness remain UNKNOWN with null evidence in projected
DTOs. At expiry the renderer keeps these evidence-free rows UNKNOWN; expiry
cannot promote evidence or runtime status. The operating-status summary remains
**Unbekannt**.

Ownership is limited to `v11/agent-status-bootstrap.js`,
`test/v11-coordinator-status-handoff.test.js`, and this document. No changes to
projector, backend, normalizer, renderer, Bot, Depot, entrypoint, or release state.
Existing cache-qualified imports are retained verbatim: preserve the shared
module identity and PR999 B17 cache-graph repair during later Lead integration;
this handoff must not independently rewrite cache versions.

Focused validation:

```sh
node --test test/v11-coordinator-status-handoff.test.js test/v11-agent-status-integration.test.js test/v11-agent-status-chrome.test.js test/v11-module-cache-identity.test.js test/m11-coordinator-status-projection.test.js
```

Tests generate a real canonical backend envelope, invoke the actual offline
projector, hand its DTO to the controller API, and exercise the real client and
renderer with an in-memory DOM/clock. No full suite, deployment, or activation is
part of this handoff.
