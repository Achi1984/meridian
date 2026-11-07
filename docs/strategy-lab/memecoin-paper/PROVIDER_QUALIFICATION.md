# Paper provider acquisition qualification

This package is bounded, default-disabled, read-only acquisition plumbing. It
does not create credentials, make live requests by itself, approve a provider,
or make the Paper runtime live-ready. All positive fixtures in
`test/memecoin-paper-provider-sources.test.js` are synthetic.

## Current qualification

| Provider / method | Provider identity and documented scope | Observed completeness | Exact timestamp fidelity | Policy approval |
|---|---|---|---|---|
| Helius `getTransactionsForAddress` | Helius RPC identity is retained. The request explicitly asks for full JSON transaction details, supports versions through 0, and sends provided slot/block-time bounds as provider filters. Each result extracts its signature from `transaction.signatures[0]`, retains its original slot and `blockTime`, and binds a raw response SHA-256 receipt. | **UNKNOWN.** Provider filters, result-page length, finalized data, or an explicit null `paginationToken` do not prove complete address attribution or archival history. Repeated cursors, contradictory rows, null metadata, unsupported versions, and quota failures remain unavailable. | Not a timestamp-observation adapter; the provider's `blockTime`, including null, is preserved without substitution. | **NOT APPROVED.** |
| Helius `getProgramAccountsV2` | The request specifies finalized `jsonParsed` data with `withContext: true`; response context slots, `value.accounts`, cursors, and raw response hashes are retained. Parsed token-account owners and raw amounts are grouped by owner. `minContextSlot` is a lower bound, not a frozen multi-page snapshot. | **UNKNOWN.** Only `value.paginationKey: null` terminates pagination; short pages do not. Cursor cycles, contradictory accounts, context-slot drift, and quota failures remain unavailable. The owner aggregation sums its decoded rows; it is not a mint-supply reconciliation. | Not applicable. | **NOT APPROVED.** |
| Birdeye `historical_price_unix` | Birdeye endpoint identity, mint, USD denomination, purpose, raw receipt hash, returned `data.updateUnixTime`, and `isScaledUiToken` are retained. A value is exposed only for `success: true`, `isScaledUiToken: false`, and exact equality between returned seconds and requested milliseconds. | **UNKNOWN.** One response is not proof of series coverage or token support. Failed responses, unsupported/missing scaling semantics, missing/near/future timestamps, and non-second-aligned requests are unavailable. No parity fallback or client token scaling is applied. | Exact request/response timestamp equality is enforced for accepted observations. The requested timestamp is never substituted for the provider timestamp. | **NOT APPROVED.** |
| Alchemy `getTokenHoldersAtSlot` | The offline diagnostic accepts bounded raw response bytes and an explicit mint/slot, hashes those bytes, validates the documented holder rows, and aggregates canonical raw amounts by owner. | **UNKNOWN.** The 10,000-row cap has no published completeness certificate or cursor; a shorter result, digest match, or optional same-slot mint-supply match does not establish completeness or authenticity. | The returned slot is checked against the requested slot; this does not establish exact wall-clock capture time. `minContextSlot` is not historical-state proof. | **NOT APPROVED.** |

`CAPTURED` means only that the bounded Helius acquisition reached its endpoint
termination condition. It is not a completeness state. Birdeye's exact
timestamp-match receipt is not a source-trust or policy-approval decision.
Each adapter's `qualification` fields keep provider identity, documented method
scope, observed completeness, timestamp fidelity, and policy approval distinct.

The Alchemy diagnostic is offline-only and does not collect or admit provider
data. Historical mint reads require paid account-archive access. Prospective T0
and T1 captures require separate immutable roots; existing
`local-census-acquisition` records are not eligible as exact-time warmup census.
A one-hour timer or supply match does not establish completeness. The HEDGE
budget remains frozen. This diagnostic prepares future sample inspection only.

The adapters accept an injected secret and transport. They use fixed provider
origins and allowlisted methods/paths, disable redirects, do not retry, and
bound request count, response/run bytes, work, per-request timeout, and total
deadline. Transport failures are mapped to fixed reason codes; secrets are not
included in receipts or returned errors. There is no live CLI mode.

## Documentation and verification limits

The implementation targets the issue's supplied official references:

- Helius [`getTransactionsForAddress`](https://www.helius.dev/docs/api-reference/rpc/http/gettransactionsforaddress)
- Helius [RPC HTTP `llms.txt`](https://www.helius.dev/docs/api-reference/rpc/http/llms.txt)
- Birdeye [`historical_price_unix`](https://data.birdeye.so/docs/data-api/price-ohlcv/get-defi-historical-price-unix)

Direct fetches of these documentation hosts were blocked by sandbox DNS. Search
results for the official provider references surfaced the request and response
fields implemented above, but this is not a claim of live contract conformance,
account entitlement, completeness, or service availability. Birdeye's
referenced documentation describes a resolved time **near** the request, so
this adapter deliberately rejects a near-but-not-exact observation.

## Decisions still open

- Provider accounts, entitlement, and an approved data/request budget.
- A small Raydium CPMM allowlist and a dated, reviewed trust policy.
- Whether exact timestamp equality is sufficient or a separately reviewed
  causal-freshness policy is required.
- LP horizon and proof semantics, developer attribution, prior-rug history,
  bundled-launch definition, and qualified-wallet evidence remain open.

The history/census provider's archival, attribution, pagination, and byte-budget
guarantees also need owner review. No source result or successful pagination
may convert unknown completeness into a negative finding. Until the decisions
above are separately approved, missing or unknown evidence remains unavailable
and must not be used to manufacture Analyst readiness.
