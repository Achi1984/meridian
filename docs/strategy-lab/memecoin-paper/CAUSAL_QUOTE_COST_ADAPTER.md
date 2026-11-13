# Causal Paper Quote/Cost Adapter

Status: source-only, read-only, disabled by default.

The additive exports in `scripts/memecoin-paper/market-quote-adapter.mjs` define a causal chain:

`input → entry quote → entry fees/slippage/impact/network → entry cost → exit quote → exit fees/slippage/impact/network → exit proceeds → net P&L`.

Every leg is bound to asset, quote currency, pool, route, source time and receipt time. Entry and exit must share identity and exit cannot precede entry. Stale, future, malformed, mixed or incomplete values return `UNKNOWN`.

Fee, slippage, impact and network components require explicit non-negative values and provenance. A zero without provenance is not accepted as a free cost. FX requires a positive rate, pair and provenance.

The transport is injected only, GET-only, fixed-origin, credentials-omitted, redirect-rejected, byte- and time-bounded, cancellable and non-retrying. No default network request is made. Every result hardcodes `executionAuthorized:false`; `READY` means structurally complete evidence only, never permission to trade.

Runner, ledger, UI and provider integration are intentionally out of scope for this packet.
