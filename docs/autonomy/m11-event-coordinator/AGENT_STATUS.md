# M11 agent status — read-only source UI

Status: `PREPARATION_ONLY`

The approved status contract and browser renderer are mounted in the V11 source preview. This is not a live agent feed, coordinator activation, or autonomous execution.

## Scope

- `scripts/autonomy/m11-agent-status.mjs` contains the strict input contract and validation logic.
- `public/js/m11-agent-status.js` exports a browser render and mount API for isolated use.
- `public/css/m11-agent-status.css` holds the namespaced component styling.
- `test/m11-agent-status.test.js` validates the contract and the DOM-safe rendering.
- `v11/index.html` mounts `#agent-status-root` below the operating paragraph inside `#autonomy-status .details-body`, with the existing component CSS.
- `v11/agent-status-client.js` accepts only JSON strings bounded to 512 KiB UTF-8 and at most 50 rows. Its synchronous `onChange` consumer uses the approved renderer as the authoritative contract validator; a rejected projection discards the cached DTO.
- `v11/agent-status-bootstrap.js` exports `mountAgentStatus(document, window, {access, now, schedule, cancelSchedule, createClient})` and imports the shared `appAccess` with `?v=B15-M11`. The browser never imports the Node normalizer.
- `test/v11-agent-status-integration.test.js` and `test/v11-agent-status-chrome.test.js` cover cache clearing, exact expiry, lifecycle and the real page at 320/390 px.

There is no provider service, endpoint, polling, dispatch, storage, credential access, or production fixture/injection hook. The production default is **Keine verifizierten Statusdaten.** The disclosure summary stays **Autonome Entwicklung · Unbekannt**, independently of any task progress.

## Client and lifecycle

`createAgentStatusClient({now, onChange})` exposes `accept(serializedDto)`, `clear(reason)`, `revalidate()` and `dispose()`. A future producer must supply a normalized serialized DTO; no producer is connected now. `accept` returns false on rejection or after disposal. The synchronous consumer must throw on renderer rejection. Invalid JSON, oversized input, contract rejection, clock failure, or rendering failure discards the prior DTO and explicitly clears all cards and links, displaying the fixed **Statusdaten nicht verfügbar.** message rather than retaining stale DOM.

The bootstrap registers clear/revalidate callbacks with `access.registerReader`. Access lock or expiry, pagehide and disposal discard data, not merely hide it. Pagehide blocks late deliveries until pageshow; returning never restores the discarded DTO. Disposal unregisters readers/listeners and permanently rejects subsequent client input.

There is at most one cancellable, generation-bound expiry timeout. It uses the earliest future row or evidence expiry and reprojects only the cached serialized data through the renderer. At exact expiry, `CURRENT` becomes `STALE`; replacement, clear and disposal invalidate late callbacks. Long delays are capped to the browser timeout limit. No timeout makes network or work requests.

## Contract rules

- Task state is distinct from coordinator mode.
  - Task states: `QUEUED`, `RUNNING`, `REVIEWING`, `BLOCKED`, `DONE`, `UNKNOWN`
  - Coordinator modes: `PREPARATION`, `PILOT`, `ACTIVE`, `STOPPED`, `UNKNOWN`
- Freshness is derived from the injected clock and explicit expiry window.
  - `CURRENT` when observed and not expired for the provided clock
  - `STALE` when the evidence expires at or before the clock
  - `UNKNOWN` when there is no evidence, a malformed timestamp, or a future observation
- A task may be `RUNNING` while the coordinator is `STOPPED`; the two states are independent.
- Provider and model verification are validated separately and require explicit evidence.
- `ownerDecisionRequired` is only allowed with an explicit reason.
- Unsafe URLs, malformed timestamps, proxy objects, extra fields, and hostile text are rejected.
- Public output is rendered via `textContent` and DOM creation; no `innerHTML` is used with value data.

## Synthetic fixtures and no runtime activation

The component is designed to be inert. It does not wake ChatGPT, dispatch tasks, read live provider APIs, or claim an autonomous runtime. The fixtures in the local tests are synthetic-only examples.

Synthetic DTOs are supplied only by test harnesses. The real-page browser check uses the existing static server/CDP helpers, mocks central access verification, and verifies that the panel makes zero status-network requests. Bot/Depot remain separate, manual read surfaces. Release identities, workflows, the approved renderer and Node normalizer are unchanged.
