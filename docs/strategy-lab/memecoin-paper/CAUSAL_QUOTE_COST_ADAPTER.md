# Causal Paper Quote/Cost Adapter

Status: source-only, read-only, disabled by default.

The additive exports in `scripts/memecoin-paper/market-quote-adapter.mjs` define a causal chain:

`input → entry quote → entry fees/slippage/impact/network → entry cost → exit quote → exit fees/slippage/impact/network → exit proceeds → net P&L`.

Every leg is bound to asset, quote currency, pool, route, source time and receipt time. Entry and exit must share identity and exit cannot precede entry. Stale, future, malformed, mixed or incomplete values return `UNKNOWN`.

Fee, slippage, impact and network components require explicit non-negative decimal-string values and identity-bound provenance. Arithmetic is deterministic fixed-point (no binary-float artifacts); a zero without provenance is not accepted as a free cost. FX requires a positive decimal-string rate, identity-bound provenance, and a pair exactly matching the quote currency. Source, receipt and FX-provenance timestamps are all checked for stale and future-dated evidence.

The transport is injected only, GET-only, fixed-origin, credentials-omitted, redirect-rejected, byte- and time-bounded, cancellable and non-retrying. No default network request is made. Every result hardcodes `executionAuthorized:false`; `READY` means structurally complete evidence only, never permission to trade.

Runner, ledger, UI and provider integration are intentionally out of scope for this packet. Solana-history transport is not activated by this source-only adapter; any Solana-specific byte-limit work is a separate follow-up.

CI is expected to run on the reviewable pull request head; this packet remains source-only and inert.
