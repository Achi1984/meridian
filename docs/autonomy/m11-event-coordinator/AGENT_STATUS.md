# M11 agent status — isolated read-only contract

Status: `PREPARATION_ONLY`

This packet is intentionally isolated. It adds a strict, read-only M11 agent status contract and browser renderer without altering any existing entrypoint, coordinator runtime, workflow, dispatch path, or ownership model.

## Scope

- `scripts/autonomy/m11-agent-status.mjs` contains the strict input contract and validation logic.
- `public/js/m11-agent-status.js` exports a browser render and mount API for isolated use.
- `public/css/m11-agent-status.css` holds the namespaced component styling.
- `test/m11-agent-status.test.js` validates the contract and the DOM-safe rendering.

No live fetch, storage, credential access, scheduler, or network adapter is present. The input is assumed to be supplied by a caller or synthetic fixture only.

## Contract rules

- Task state is distinct from coordinator mode.
  - Task states: `QUEUED`, `RUNNING`, `REVIEWING`, `BLOCKED`, `DONE`, `UNKNOWN`
  - Coordinator modes: `PREPARATION`, `PILOT`, `ACTIVE`, `STOPPED`, `UNKNOWN`
- Freshness is derived from the injected clock and explicit expiry window.
  - `CURRENT` when observed and not expired for the provided clock
  - `STALE` when the evidence expires before the clock
  - `UNKNOWN` when there is no evidence, a malformed timestamp, or a future observation
- A task may be `RUNNING` while the coordinator is `STOPPED`; the two states are independent.
- Provider and model verification are validated separately and require explicit evidence.
- `ownerDecisionRequired` is only allowed with an explicit reason.
- Unsafe URLs, malformed timestamps, proxy objects, extra fields, and hostile text are rejected.
- Public output is rendered via `textContent` and DOM creation; no `innerHTML` is used with value data.

## Synthetic fixtures and no runtime activation

The component is designed to be inert. It does not wake ChatGPT, dispatch tasks, read live provider APIs, or claim an autonomous runtime. The fixtures in the local tests are synthetic-only examples.

This packet is ready for later M11 integration, but it does not create a runtime integration or claim that a live coordinator exists.
