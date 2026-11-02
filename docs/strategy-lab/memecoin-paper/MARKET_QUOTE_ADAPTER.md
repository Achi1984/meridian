# Read-only market quote adapter

`scripts/memecoin-paper/market-quote-adapter.mjs` adapts one documented
read-only quote contract: Jupiter Swap API V2 `GET
https://api.jup.ag/swap/v2/order`, with no `taker` parameter. The adapter is
disabled by default, does not fetch at import or construction, and only accepts
an injected transport when explicitly enabled. It never signs, builds, submits,
or retries a transaction. The request origin and endpoint are fixed; redirects
are rejected, credentials omitted, request/response sizes and execution time
bounded, and the response stream is cancelled on rejection, timeout, or caller
cancellation. Each adapter instance allows at most 100 request attempts (a
smaller `maxRequests` may be selected).

The public V2 docs say an order without `taker` returns a quote and
`transaction: null`; their OpenAPI contract documents the exact-in base-unit
amount, route plan, optional RFQ expiry, platform/total fee fields, price impact,
slippage tolerance, and reported lamport fees. See the [Jupiter Swap API
overview](https://github.com/jup-ag/docs/blob/main/swap/index.mdx) and the
[Swap API V2 OpenAPI
specification](https://github.com/jup-ag/docs/blob/main/openapi-spec/swap/v2/swap.yaml)
for the source contract. The source docs advertise 0.5 keyless requests per
second; the underlying route adapter enforces that spacing.

## Result and chronology contract

Call `createMarketQuoteAdapter({enabled: true, transport, clock, timeoutMs})`
and then `getPaperQuote(request, {signal})`. Request data is snapshotted and
rejects unknown fields, including caller-supplied source/clock-authentication
claims.

The request binds Solana mint, selected pool, quote mint and both token decimal
counts. `side: "ENTRY"` takes an exact raw quote-token input amount and requests
quote-token to base-token. `side: "EXIT"` takes an exact raw base-token amount
and requests base-token to quote-token; it must carry `positionOpenedAt` instead
of `authorizedAt`. Both sides require the candidate sample time. Returned route
input/output mints and amounts must match exactly, and pool binding is supported
only for a single route leg that matches the selected pool.

The receipt time is sampled from the injected local clock after the response
body is read and parsed, then checked against the sample and authorization or
position-open time. Candidate and causal reference times older than five minutes
are explicitly stale. The documented response does not provide a quote-generation
timestamp; provider quote staleness therefore cannot be independently checked,
and `sourceTime` is `NOT_PROVIDED_BY_DOCUMENTED_RESPONSE`.
Receipt time and `expireAt` do not authenticate the provider or clock. An
optional JupiterZ `expireAt` is bounded by the local 15-second freshness policy;
when absent, expiry is local-policy-only.

`priceQuotePerBase` preserves the exact base-unit ratio as reduced integer
numerator/denominator strings; it is denominated in quote tokens per base token,
not USD. Caller-provided decimal counts are disclosed as such. Provider USD
estimates are not used as exact currency conversions.

## Cost and Paper-consumer boundary

`quoteCandidate` is always marked `HYPOTHETICAL` and `executable: false`.
`priceMicros` is `null`, `authorizationEligible` is always false, and every
USD-cent cost component remains `UNKNOWN`:

| Component | Available report | Why it remains unknown |
| --- | --- | --- |
| Fee | `feeBps`, `feeMint`, and optional exact `platformFee` token amount | Total fee rate includes platform fee and other charges; token-to-USD conversion and complete fee settlement semantics are not verified |
| Spread | None | The API does not provide an independently measured, non-overlapping spread cost |
| Slippage | `slippageBps` and `otherAmountThreshold` | Tolerance/minimum output is not realized cost |
| Price impact | `priceImpact` percentage points | No verified independent benchmark converts it to a non-overlapping USD amount |
| Network | Signature, prioritization (including tips), and estimated rent amounts in lamports | Payer/gasless handling varies; no source-verified SOL/USD conversion or payer settlement is supplied |

Do not treat absent fees as zero or add fee rate, platform fee, price impact,
minimum output, slippage tolerance, or lamports as separate USD charges. The
exact route ratio is not an executable price or a USD mark. The candidate is
deliberately not a ledger quote and the existing Paper execution step rejects
it; this adapter is not connected to the runner.

### Remaining evidence before an eligible quote can exist

The chosen API provides route and amount information but cannot establish all
the following inputs. No caller assertion or boolean can substitute for them:

1. A verified USD conversion for the quote token, fee mint, and SOL, bound to
   the same route and observation time with exact decimal/rational semantics.
2. Source-supported, non-overlapping USD costs for fee, spread, realized
   slippage, price impact, and network charges, including who pays each charge.
3. A documented source quote timestamp and independently authenticated source
   and clock provenance, plus source semantics supporting the selected pool,
   quote lifetime, amount, and hypothetical execution claim.
4. Independent coverage for the route's actual liquidity and executable
   capacity at the requested amount; a routed quote alone is not a fill.

Until that evidence is supplied by a separately reviewed contract, missing
coverage remains `UNKNOWN`, not eligibility. This packet does not enable real
market scans or change synthetic-only restrictions.

## Offline validation

`node --test test/memecoin-paper-market-quote-adapter.test.js` runs only
generated synthetic fixtures and injected transports. It verifies inert
construction, exact entry/exit chronology and amounts, source/route identity,
missing costs, quote expiry, decimal precision, invalid input, bounded response
handling and cancellation, and rejection by the existing Paper consumer. It
makes no network request and does not claim that synthetic responses are real
market evidence.
