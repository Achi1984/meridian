# Paper provider acquisition qualification

This package is bounded, default-disabled, read-only acquisition plumbing. It
does not create credentials, make live requests by itself, approve a provider,
or make the Paper runtime live-ready. All positive fixtures in
`test/memecoin-paper-provider-sources.test.js` are synthetic.

## Current qualification

| Provider / method | Provider identity and documented scope | Observed completeness | Exact timestamp fidelity | Policy approval |
|---|---|---|---|---|
| Helius `getTransactionsForAddress` | Helius RPC identity is retained. The request captures the address, finalized commitment, page limit, and cursor; each row retains its original slot and `blockTime`, and each raw response has a SHA-256 receipt. Requested local bounds are retained as scope, not asserted as provider-enforced filters. | **UNKNOWN.** Finalized status, time/slot bounds, a short page, or exhausted pagination do not prove complete address attribution or archival history. Repeated cursors, contradictory rows, null metadata, unsupported transaction versions, and quota failures remain unavailable. | Not a timestamp-observation adapter; provider `blockTime` is preserved, including null values. | **NOT APPROVED.** |
| Helius `getProgramAccountsV2` | Helius identity, each response context slot, cursor, raw response hash, and decoded token-account owner aggregation are retained. `minContextSlot` is a lower bound, not a frozen multi-page snapshot. | **UNKNOWN.** Only `paginationKey: null` terminates pagination; short pages do not. Cursor cycles, contradictory accounts, context-slot drift, and quota failures remain unavailable. Matching aggregate supply is not a completeness proof. | Not applicable. | **NOT APPROVED.** |
| Birdeye `historical_price_unix` | Birdeye endpoint identity, mint, USD denomination, purpose, raw receipt hash, and returned `data.updateUnixTime` are retained. The adapter exposes an observation only when the returned second timestamp exactly equals the requested millisecond timestamp. | **UNKNOWN.** A response is one observation, not proof of series coverage or token support. Missing, near, future, malformed, and non-second-aligned times are unavailable. No parity fallback or client token scaling is applied. | Exact request/response timestamp equality is enforced for accepted observations. The requested timestamp is never substituted for the provider timestamp. | **NOT APPROVED.** |

`CAPTURED` means only that the bounded Helius acquisition reached its endpoint
termination condition. It is not a completeness state. Birdeye's exact
timestamp-match receipt is not a source-trust or policy-approval decision.
Each adapter's `qualification` fields keep provider identity, documented method
scope, observed completeness, timestamp fidelity, and policy approval distinct.

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

The sandbox could not resolve/fetch these documentation hosts during this task.
The behavior above follows the issue's stated pagination and timestamp
requirements; it is not a claim that the current provider docs, account
entitlement, response contract, or service availability were independently
verified. Birdeye's referenced documentation is described by the issue as
returning a resolved time **near** the request, so this adapter deliberately
rejects a near-but-not-exact observation.

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
