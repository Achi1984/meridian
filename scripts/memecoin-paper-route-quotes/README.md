# Jupiter V2 route-quote source adapter

This package is an isolated, read-only source adapter. It is not imported by the
paper runner or any existing provider, ledger, stage, worker, UI, or workflow.
Importing the module performs no I/O. `createJupiterV2QuoteAdapter()` is
disabled by default; only an explicit `{enabled: true, transport, clock}` can
make one bounded request per call.

## Current API review

Checked on 2026-11-01 against Jupiter's official docs repository at commit
[`acbe70268b8bb985362548e36ac2e76a8ac89631`](https://github.com/jup-ag/docs/commit/acbe70268b8bb985362548e36ac2e76a8ac89631),
dated 2026-10-28:

- The current OpenAPI source is
  [`openapi-spec/swap/v2/swap.yaml`](https://github.com/jup-ag/docs/blob/acbe70268b8bb985362548e36ac2e76a8ac89631/openapi-spec/swap/v2/swap.yaml),
  OpenAPI 3.0.3, `Swap API V2` schema version 2.0.0. Its server is
  `https://api.jup.ag/swap/v2`; its quote-only operation is `GET /order`.
- The [current overview](https://github.com/jup-ag/docs/blob/acbe70268b8bb985362548e36ac2e76a8ac89631/swap/index.mdx)
  says quotes work without an API key, omitting `taker` returns
  `transaction: null`, and keyless requests are limited to 0.5 requests per
  second. The [rate-limit reference](https://github.com/jup-ag/docs/blob/acbe70268b8bb985362548e36ac2e76a8ac89631/portal/rate-limits.mdx)
  specifies a 60-second sliding window: keyless 0.5 RPS / 30 requests per
  minute, Free 1, Developer 10, Launch 50, and Pro 150 RPS per organization.
  HTTP 429 indicates rate limiting; no retries are made here.
- **Auth documentation conflicts:** the V2 OpenAPI operation declares
  `ApiKeyAuth` (`x-api-key`), and the [API-key docs](https://github.com/jup-ag/docs/blob/acbe70268b8bb985362548e36ac2e76a8ac89631/portal/api-keys.mdx)
  describe keys for `api.jup.ag`, while the overview explicitly documents
  keyless quote requests. This adapter does not accept or handle credentials.
  It uses the documented keyless route policy and returns unavailable on 401
  or 403; resolve this discrepancy and any production key requirement outside
  this package before integration.
- Jupiter's [migration guide](https://github.com/jup-ag/docs/blob/acbe70268b8bb985362548e36ac2e76a8ac89631/swap/migration/metis-to-meta-aggregator.mdx)
  maps V1 `/quote` to V2 `/order` or `/build`; this adapter does not assume
  historical V1 support.
- V2 `/order` takes `inputMint`, `outputMint`, and `amount` in the input token's
  smallest unit. This adapter also sends `swapMode=ExactIn` and explicit
  `slippageBps` (0–10,000), and never sends `taker`. The response contains
  identity, amount, minimum-output, slippage, price-impact, route and router
  fields in the official schema. `priceImpact` is percentage points;
  `priceImpactPct` is deprecated. `expireAt` is documented for RFQ responses,
  not as a universal quote expiry.

No Jupiter quote endpoint or API host was called as part of this review. The
official docs are mutable; the version and commit above record the exact
documentation snapshot reviewed, not a live-service build identifier.

## Adapter contract

```js
import {createJupiterV2QuoteAdapter} from "./jupiter-v2.mjs";

const adapter = createJupiterV2QuoteAdapter({
  enabled: true,
  transport: (url, init) => fetch(url, init),
  clock: () => Date.now()
});

const evidence = await adapter.getQuote({
  identity: {chainId: "solana", mint, pool, quote, decimals},
  inputMint,
  outputMint,
  inputDecimals,
  outputDecimals,
  amount: "100000000",
  slippageBps: 50,
  candidateSampledAt,
  authorizedAt
});
```

The adapter constructs only
`https://api.jup.ag/swap/v2/order?inputMint=...&outputMint=...&amount=...&swapMode=ExactIn&slippageBps=...`.
It never accepts caller URLs or headers, sends only `Accept: application/json`,
sets `credentials: "omit"` and `redirect: "error"`, and does not retry. The
injected transport must honor those fetch options. The adapter enforces a
1,500 ms default / 5,000 ms maximum timeout, a 2,048-byte URL cap, a 256 KiB
streamed response cap, at most 40 decimal digits per base-unit value, no more
than 32 route steps, and a per-instance 2-second keyless request interval.
The per-instance limiter does not coordinate multiple processes; an integrator
must enforce the official organization-wide limit across all its callers.

The response is strictly checked against the pinned V2 response shape and
bound to the requested mints, raw input amount, selected-pool identity,
caller-supplied decimals, `ExactIn` mode, and explicit slippage request; it
captures the raw output threshold, route-plan legs, and price-impact field.
The minimum-output
threshold is only checked as a positive integer no greater than `outAmount`;
its consistency with `slippageBps` is explicitly `UNVERIFIED`. The pinned V2
documentation describes a minimum output after slippage but does not specify a
raw-integer formula or rounding rule, so this adapter does not invent or claim
that relationship. A threshold of `"1"` with `outAmount: "17057460"` and
`slippageBps: 50` remains parseable but visibly unverified, and cannot authorize
anything. A single route step is reported as
`SINGLE_POOL_MATCH` only when its `ammKey`, mints, amounts, and full-route
allocation match the request. Any route plan with multiple steps is
`MULTI_LEG_UNBOUND`; it never becomes a fixed-pool match. A matching `ammKey`
is only a shape-level comparison, not independent proof of pool ownership or
route authenticity.

`observedAt` is the injected local receipt clock, not a Jupiter quote timestamp
or slot. The adapter applies a local 15-second expiry; when an RFQ `expireAt`
is supplied, it validates it and uses the earlier of the provider expiry and
that local bound. Non-RFQ responses have no provider expiry evidence in the
reviewed schema. Decimal counts are caller-supplied: the quote response does
not prove them.

Every result is `authorizationEligible: false`. Successful parsing still
returns `status: "UNAVAILABLE"` and invokes PR1118's
`normalizeHypotheticalQuote` with a non-executable, price-less observation.
`sourceProvenance: "INJECTED_TRANSPORT_NOT_AUTHENTICATED"` means the source
label is not authentication or provider verification. Do not pass this result
to the ledger or treat it as an executable price or fill.

## Cost evidence and integration gaps

The current order response reports partial fee/impact information (for example
`feeBps`, `feeMint`, fee-related lamports, `priceImpact`, and a minimum output).
Those values do not provide exact, non-overlapping USD costs. In particular,
do not sum an output-price difference with route fees or slippage: Jupiter's
route output already reflects routing/fees, and the minimum-output threshold
already reflects the stated slippage bound. `costEvidence` therefore keeps
`fee`, `spread`, `slippage`, `priceImpact`, and `network` individually
`UNKNOWN` with null amount and denomination; all-in costs are unavailable.

The adapter is not yet a production integration. The lead must resolve the
keyless-vs-OpenAPI auth discrepancy; provide owner-approved source/transport
provenance and organization-wide rate coordination; and independently verify
mint decimals, route/pool semantics, source time/expiry, minimum-output and
price-impact semantics, and exact itemized USD cost sources. A full multi-hop
route is not bound to one candidate pool. No existing hard gate is changed.
The remaining mint-authority, LP, ownership, developer, bundle, and wallet
provenance gates also remain out of scope and unavailable. There is no
transaction construction, signing, wallet/key handling, or submission path.

The synthetic schema-shaped fixture and focused test command are:

```sh
node --test test/memecoin-paper-route-quotes.test.js
```

Passing these tests verifies only local parsing and safety boundaries; it is
not a provider check, source-authentication receipt, trade authorization, or
empirical result.
