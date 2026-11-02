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
for the source contract. Fee inclusion and route-versus-wallet amount semantics
are described in [Order & Execute](https://github.com/jup-ag/docs/blob/main/swap/order-and-execute.mdx);
payer and gasless fee cases are described in [Gasless
Swaps](https://github.com/jup-ag/docs/blob/main/swap/advanced/gasless.mdx).
The source docs advertise 0.5 keyless requests per second; the underlying route
adapter enforces that spacing.

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

## Cost closure against the existing Paper consumer

`quoteCandidate` is always marked `HYPOTHETICAL` and `executable: false`.
`priceMicros` is `null`, `authorizationEligible` is always false, and every
USD-cent cost component remains `UNKNOWN`. The closure below compares Jupiter's
documented `/order` and `/execute` fields with the actual current consumer
contract:

| Item | Exact Jupiter source contract | Already in / overlaps quote amounts? | Required by current Paper consumer? | Closure |
| --- | --- | --- | --- | --- |
| USD price conversion | V2 OpenAPI documents `inUsdValue`, `outUsdValue`, and `swapUsdValue` as numbers; raw `inAmount`/`outAmount` are token base units. | A token/token route ratio does not itself convert either mint to USD. The USD-valued response fields are estimates, not an exact fixed-point conversion with independent source-time/provenance evidence. | Yes. `createPaperExecutionStep` requires positive integer `priceMicros`; its ledger performs USD-cent accounting from that value. | UNKNOWN. The documented estimate fields do not meet the exact, time-bound, source-verified USD conversion contract required for a Paper ledger price. |
| Swap/platform fee | V2 `/order`: `feeBps`, `feeMint`, optional `platformFee.amount`, `.feeBps`, and `.feeMint`. Jupiter's Fees documentation says the platform fee is included in the quote and deducted automatically; total `feeBps` may also include gasless cost recoup. `/execute` distinguishes route amounts from final wallet amounts when a fee is collected in the input or output mint. | The provider explicitly says the platform fee is included/deducted in the quote. The quote-only fields do not supply `/execute`'s actual `totalInputAmount`/`totalOutputAmount`; nor do they establish a non-overlapping USD charge for every total fee component. Adding `feeBps` or `platformFee.amount` to a route-price-derived cost can double count. | Yes, the current consumer syntactically requires integer `costs.feeCents` and separately adds it to entry/exit totals. No override says fees already included in the quote price. | UNKNOWN. Need a reviewed gross-versus-net amount contract and an exact fee breakdown plus fee-mint-to-USD conversion. Do not book the fee twice or use zero to hide missing coverage. |
| Spread | V2 `/order` provides a route and amount; it has no independent spread field or reference/baseline price. | Any market spread reflected by the route's returned amount is inseparable from that amount here; the source does not quantify a separate spread cost. | Yes, `costs.spreadCents` is a mandatory integer field and is separately summed by the ledger. | UNKNOWN. A source must provide a same-time, independently defined reference and an attributable spread measure. Route price impact is not a substitute. |
| Slippage | V2 `/order` reports `slippageBps` and `otherAmountThreshold`; the docs define `outAmount` as expected output before slippage and the threshold as minimum output after applying slippage. | The tolerance/threshold is not realized slippage. The quoted `outAmount` is not a later fill, so no actual adverse movement is observable. | Yes, `costs.slippageCents` is mandatory and separately summed. | UNKNOWN. Requires a later, identity-bound executable observation/fill or a separately approved scenario (which would not be actual cost evidence). Do not convert tolerance into a charge. |
| Price impact | V2 `/order` reports `priceImpact` in percentage points. | The size-specific route amount already represents the quote at that size; adding an impact estimate as a separate deduction without an unimpacted benchmark risks charging for the same price movement twice. The API does not define an independent USD cost amount. | Yes, `costs.priceImpactCents` is mandatory and separately summed. | UNKNOWN. Requires an independently defined pre-impact benchmark and exact conversion; percentage points alone are not cents. |
| Network / rent | V2 `/order` may report `signatureFeeLamports`, `prioritizationFeeLamports`, `rentFeeLamports` and payer fields. The Gasless documentation describes distinct taker, Jupiter sponsor, market-maker, and integrator-payer cases. | Some gasless cost recoup may already contribute to total `feeBps`; the remaining network amounts are denominated in lamports and payer-dependent. Quote-only uses no taker and returns no transaction to establish a payer or settlement. | Yes, `costs.networkCents` is mandatory and separately summed. | UNKNOWN. Requires a transaction/payer-specific cost basis and source-verified SOL-to-USD conversion; this read-only quote does not establish either. |

These are not merely missing values in a JSON mapping. The existing consumer
requires all five nonnegative integer-cent fields (`feeCents`, `spreadCents`,
`slippageCents`, `priceImpactCents`, `networkCents`) and adds them separately to
the route-derived notional/proceeds. Its shared `normalizeExactCosts` helper
accepts all five source-bound integer micro-USD values but labels them
`NORMALIZED_UNVERIFIED` and leaves eligibility false. Its quote normalizer also
keeps source and quote semantics unverified. Supplying five zeros, mapping
`feeBps` to cents, or treating slippage tolerance / price impact / lamports as
USD costs would manufacture evidence or risk double counting.

The fixture-backed successful normalization this contract can support is the
exact route ratio: raw `inAmount`/`outAmount` plus explicit token decimals
normalize to a reduced integer `priceQuotePerBase` ratio without floating-point
rounding. It is a quote-token-per-base-token ratio only, **not** a USD
`priceMicros`, complete cost normalization, or eligible Paper quote. A
successful eligible quote cannot be demonstrated from this reviewed source
contract. It would require the missing source evidence listed below; until then
the correct end-to-end existing-consumer result is rejection, as the focused
contract test verifies.

The candidate is deliberately not a ledger quote, and this adapter is not
connected to the runner.

### Remaining evidence before an eligible quote can exist

The chosen API provides route and amount information but cannot establish all
the following inputs. No caller assertion or boolean can substitute for them:

1. A source-backed exact USD conversion for the quote mint, fee mint, and SOL,
   with observation time and rational/fixed-point semantics. The API's numeric
   USD estimates do not establish this conversion contract.
2. A reviewed gross/net quote convention and five-component non-overlapping
   USD cost mapping that does not re-add amounts already reflected in the
   quote. The `/order` docs state the platform fee is deducted from the quote,
   while `/execute` separately exposes route and final wallet amounts; a
   quote-only response does not resolve that accounting basis for the ledger.
3. An independent spread reference and measured spread, plus realized slippage
   evidence; neither is reported as a separately valued cost by `/order`.
4. A documented source quote timestamp and independently authenticated source
   and clock provenance, plus source semantics supporting the selected pool,
   quote lifetime, amount, and hypothetical execution claim.
5. Independent coverage for the route's actual liquidity and executable
   capacity at the requested amount; a routed quote alone is not a fill.

Until that evidence is supplied by a separately reviewed contract, missing
coverage remains `UNKNOWN`, not eligibility. This packet does not enable real
market scans or change synthetic-only restrictions.

## Offline validation

`node --test test/memecoin-paper-market-quote-adapter.test.js` runs only
generated synthetic fixtures and injected transports. It verifies inert
construction, exact entry/exit chronology and amounts, source/route identity,
successful exact route-ratio normalization alongside unresolved costs, quote
expiry, decimal precision, invalid input, bounded response handling and
cancellation, and rejection by the existing Paper consumer. It makes no network
request and does not claim that synthetic responses are real market evidence.
