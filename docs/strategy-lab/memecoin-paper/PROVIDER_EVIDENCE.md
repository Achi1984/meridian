# Bounded provider evidence boundary

This packet adds a default-disabled, fixed-endpoint acquisition boundary for the
existing Solana Paper evidence parsers and filters. Importing it performs no
network or filesystem I/O. `acquireProviderEvidence()` also returns without I/O
unless both its explicit `enabled` argument and the supplied manifest enable the
two fixed providers and release the stop switch. Even then, a caller must inject
the transport and clock, provide a run ID and exact eight-hour start/end window,
and supply explicit freshness limits; the module has no ambient `fetch` fallback.
Tests use only generated fixture responses.

The adapter does not enable or invoke the prepared eight-hour manifest. The
checked-in manifest remains disabled, with empty mint/pool allowlists and its stop
switch engaged. An enabled test uses an in-memory copy and a fake transport.

## Fixed request plan

One supplied candidate identity (`chainId`, mint, pool, quote) maps to a
four-request plan. Budget exhaustion or cancellation may stop dispatch before
all four requests are attempted:

| Provider | Fixed request | Useful response data |
| --- | --- | --- |
| DexScreener | `GET https://api.dexscreener.com/latest/dex/pairs/solana/{pool}` | One pair whose chain, base mint, pool and quote must all match the request |
| Solana JSON-RPC | `POST https://api.mainnet-beta.solana.com`, `getAccountInfo(mint, {encoding: "base64", commitment: "finalized"})` | Account bytes and context slot; bytes are not decoded by this adapter |
| Solana JSON-RPC | `POST https://api.mainnet-beta.solana.com`, `getTokenLargestAccounts(mint, {commitment: "finalized"})` | Up to 20 token accounts, raw amount strings, decimals and context slot |
| Solana JSON-RPC | `POST https://api.mainnet-beta.solana.com`, `getTokenSupply(mint, {commitment: "finalized"})` | Raw supply amount string, decimals and context slot |

No caller supplies a URL, method, path, body, request ID, or header. The adapter
rejects invalid addresses, unknown RPC methods, credential-enabled or
redirect-permitting manifests, caller-added options such as headers, response
redirects, and response URLs outside the exact endpoint. RPC response IDs and
schemas are checked. Non-200 responses, including 429, are counted as attempted
requests; error bodies are not read and no request is retried.

The request, response, run-byte, event and candidate limits are read from the
manifest and validated against bounded ceilings. Requests reserve a complete
per-response byte allowance synchronously before dispatch; at most four requests
are in flight in this implementation. Response bodies are consumed as streams,
capped before JSON parsing, and each attempted request emits one bounded event.
Per-request deadlines compose with caller abort; abort or exhausted budgets stop
dispatching further batches. Failed attempts consume request budget. These
configuration limits and generated concurrency tests are not provider
rate-limit, availability, or capacity guarantees.

The caller must supply a freshness policy and clock. The policy checks bounded
acquisition duration, pair creation time against the caller's maximum pair age,
and future skew. `observedAt` is the injected-clock time when a response was
received, not a source event timestamp. DexScreener does not supply a market
snapshot timestamp in this adapter's request; RPC supplies context slots, not a
wall-clock source timestamp. The adapter preserves these distinctions and does
not infer source-event time from response receipt.

## Normalized coverage and hard-gate limits

The adapter reuses `parseDexScreenerPair()`,
`parseSolanaLargestAccounts()` and the existing `filterCandidate()` contract.
Evidence carries source, receipt time, optional source time or RPC slot, coverage,
and requested identity binding. Decimal token amounts remain strings.

| Category | Capability | Disposition |
| --- | --- | --- |
| Implemented / supported | Pair chain/mint/pool/quote, `pairCreatedAt`, actual `marketCap`, USD liquidity and one-hour volume/price change | Parsed when present and identity-matched. Missing values remain `UNKNOWN`. `fdv` is never substituted for `marketCap`; pair creation is not mint creation. |
| Implemented / supported | One-hour `buys` and `sells` transaction counts | Preserved as transaction counts only; they are not unique buyers or wallet provenance. |
| Implemented / supported | Token supply amount/decimals and largest-account amounts | Raw decimal strings and decimals are preserved. Largest accounts remain at most 20 token accounts, not unique owners or the full distribution; owner concentration stays `UNKNOWN`. |
| Unsupported hard gate | Mint/freeze authorities and Token-2022 extensions | `getAccountInfo` bytes are not decoded or treated as authority proof. These gates stay `UNKNOWN`. |
| Unsupported hard gate | LP burn/lock and duration, owner-aggregated concentration, developer attribution/history, bundled supply and smart-wallet provenance | Not established by these responses. The corresponding hard gates stay `UNKNOWN`; absence is not an allegation. |
| Unsupported capability | Unique buyers, complete discovery, depth/executable quotes, fills, validated costs, strategy score, PnL, simulated order or Paper entry | Unavailable or deliberately not performed. No paid provider or alternative source is added. The strict existing filter blocks entry while required evidence is unknown. |
| Remaining live validation | Provider and eight-hour run behavior | Not validated: live response/schema drift, host availability, rate limits/capacity, live freshness, trusted clock/skew, sustained latency, and production transport behavior. No live requests were made. Configuration and fake-transport tests establish no provider guarantee. |

The generated end-to-end test passes the normalized candidate to the existing
filter. Supported market fields are attributable and pass their individual
checks; missing authority, LP, ownership, developer, bundle, and extension
evidence leaves the overall result `UNKNOWN` and `accepted: false`. This is a
no-trade filter demonstration, not a strategy simulation or market observation.

## Public documentation checked

Documentation inspection date: **2026-11-01**. Only public provider
documentation was consulted; no provider endpoint was probed. The official
documentation pages were not directly fetchable from this sandbox, so the URLs
below are supplied for independent verification.

- DexScreener API reference: <https://docs.dexscreener.com/api/reference>
  — `GET /latest/dex/pairs/{chainId}/{pairId}` and the pair response fields,
  including `marketCap`, `fdv`, `pairCreatedAt`, `pairAddress`, `baseToken`,
  `quoteToken`, liquidity, volume, transactions and price change.
- Solana `getAccountInfo`:
  <https://solana.com/docs/rpc/http/getaccountinfo> — account value, requested
  encoding and response `context.slot`.
- Solana `getTokenLargestAccounts`:
  <https://solana.com/docs/rpc/http/gettokenlargestaccounts> — largest token
  account list, raw amount/decimals and response context.
- Solana `getTokenSupply`:
  <https://solana.com/docs/rpc/http/gettokensupply> — raw amount string,
  decimals and response context.

The public response semantics above do not establish any provider's current
capacity or guarantee stable, fresh, complete or economically actionable data.

## Focused validation and future integration boundary

Run the deterministic, network-free adapter tests with:

```sh
node --test test/memecoin-paper-provider-evidence.test.js
```

They use only generated fixtures and fake transports to cover fixed request
mapping, identity binding, disabled zero-I/O behavior, credentials/redirects,
budgets, concurrent reservation, response caps, timeouts, cancellation, malformed
responses, freshness, and the attributable no-trade filter result.

A future one-shot runner must be separately reviewed and approved. At minimum it
must: obtain the exact owner-approved mint/pool allowlists and run window; preserve
the stop switch until approval; inject a transport with the same fixed-host,
no-credential, no-redirect behavior and an explicitly trusted clock/freshness
policy; invoke the adapter once; pass only its normalized evidence to the current
strict filter; and report request outcomes, byte counts, receipt/slot distinctions,
unknown coverage, and the filter decision. It must stop on abort or budget
exhaustion and must not retry an ambiguous request. This document does not
implement that runner, persistence, scheduling, reporting orchestration,
provisioning, or activation.
