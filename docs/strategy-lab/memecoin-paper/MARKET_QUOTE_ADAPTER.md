# Bounded Market Quote Adapter

Status: **SOURCE-ONLY / READ-ONLY / DISABLED BY DEFAULT**

This adapter defines the causal Paper quote-and-cost contract. It never starts a runner, places an order, reads credentials, or authorizes entry.

## Causal chain

`input amount → entry quote → entry fees/slippage/impact/network → entry cost → exit quote → exit fees/slippage/impact/network → exit proceeds → net P&L`

The adapter requires explicit provenance for every cost component. A zero amount without provenance is **not** accepted as a free cost. Missing, stale, future, malformed, mixed-identity, oversized, or transport-failed input returns `UNKNOWN`. No caller-supplied authorization flag is trusted; outputs hardcode `executionAuthorized:false`.

## Identity and chronology

Entry and exit must share asset, quote currency, pool identity, and route identity. Exit source time must not precede entry source time. Source and receipt timestamps are preserved. The adapter rejects future or stale quotes using the configured clock and stale window.

## Bounds

- fixed HTTP(S) origin; cross-origin paths return `UNKNOWN`
- GET only, credentials omitted, redirects rejected
- injected transport only; no default network side effect
- hard request deadline with AbortController
- bounded serialized response size
- no retries

## Contract

Use `evaluateCausalQuoteChain({entry, exit, fx, now, staleAfterMs})` for offline evaluation. Each leg contains gross input/output and four components (`fees`, `slippage`, `impact`, `network`), each with `amount` and a provenance object. FX requires a positive rate, pair, and provenance. The result is either `READY` (still non-executable) or `UNKNOWN`.

Use `createMarketQuoteAdapter({transport, origin, maxDurationMs, maxBytes})` only with an injected read-only transport. It does not integrate with any runner or UI.
