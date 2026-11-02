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

The existing consumer requires all five nonnegative integer-cent fields
(`feeCents`, `spreadCents`, `slippageCents`, `priceImpactCents`,
`networkCents`) and adds them separately to route-derived notional/proceeds.
Its shared `normalizeExactCosts` contract takes identity/source/time-bound
nonnegative integer `microUsd` values for all five fields, rounds each upward
independently to cents, and returns `NORMALIZED_UNVERIFIED` with
`authorizationEligible: false`. That helper is the supported conversion to the
consumer's exact cost shape; this adapter does not duplicate or loosen it.

The test fixture exercises that helper successfully with five explicitly
supplied, nonzero synthetic scenario inputs. The result is useful to demonstrate
rounding and consumer-field mapping, but its label is
`SYNTHETIC_DECLARED_COST_SCENARIO_ONLY`, its provenance remains
`CALLER_ASSERTED_NOT_SOURCE_VERIFIED`, and it is not evidence that these values
describe Jupiter fees or a real market. No values are selected as operating
assumptions by this adapter.

## Minimum additional inputs and decision

For a *declared simulation scenario* to populate the existing normalizer, its
caller must provide, without defaults:

1. The source quote plus quote identity and quote-observation timestamp.
2. Explicit fixed-point integer micro-USD values for each of the five consumer
   components, bound to the same identity and observation time. For a cost
   asserted as actual rather than an assumption, each value also needs a
   source contract establishing its non-overlapping gross/net basis.
3. If deriving a fee estimate rather than declaring it as a scenario, Jupiter's
   `platformFee.amount`, `feeMint`, and `platformFee.feeBps` plus an exact,
   time-bound USD conversion for that mint. This establishes only the quoted
   platform-fee component: top-level `feeBps` may include gasless cost recoup,
   and does not provide an exact total fee amount. `/execute` documents actual
   route-versus-wallet input/output amounts and would be needed to confirm
   settled fee deltas; calling it, signing, or submitting is outside this
   read-only packet.
4. An explicit same-time USD conversion for the quote mint and SOL-denominated
   network costs, using exact rational/fixed-point values and provenance. The
   Jupiter `/order` USD estimates are numeric display fields, not this exact
   conversion contract.

**Decision for this packet: keep real-data Paper cost eligibility blocked; do
not add adapter-side fee/cost normalization or populate missing cost fields.**
Jupiter's quote-only contract says the platform fee is included/deducted in the
quote, while `/execute` distinguishes route amounts from final wallet amounts.
Adding the reported fee again to a price derived from the quote can therefore
double count, but treating it as zero also hides a required consumer field.
Spread has no independent reference in `/order`; slippage tolerance is not
realized slippage; price impact has no independent pre-impact USD benchmark; and
network amounts do not establish payer settlement in a quote-only request.
Those source gaps cannot be solved by normalization.

If Paper is later to accept conservative declared assumptions, the owner must
choose and approve the scenario inputs and the gross/net treatment first. The
five values must remain explicitly labeled assumptions, not actual costs, and
must not be silently substituted for measured evidence. Otherwise, source
contracts for independent spread/price-impact benchmarks, realized execution
costs, exact USD conversions, and transaction payer settlement are required.
Until one of those decisions/contracts exists, missing coverage remains
`UNKNOWN` and the existing consumer rejects the adapter candidate. No live
market scan, credentials, signing, submission, or runner connection is added.

## Versioned review-only scenario projection

The adapter exposes a separate `scenarioProjection` only when
`getPaperQuote(request, {reviewScenario})` receives a complete explicit
configuration. Omission returns `scenarioProjection: null`; malformed,
unapproved, mismatched, stale, or unbound evidence returns `BLOCKED`. Nothing
in the adapter or consumer defaults into a scenario. The two fixed experimental
cases are:

| Case | Adverse scenario adjustment | Fixed network reserve per side |
| --- | ---: | ---: |
| `BASELINE` | 100 bp | 10 US cents |
| `STRESS` | 300 bp | 50 US cents |

These are methodology-review inputs, **not measured fees, approved operating
assumptions, or guaranteed upper bounds**. The caller must pass the complete
configuration, including the case-specific ID/version, full chain/mint/pool/
quote/decimal identity, fixed-point `USDC/USD = 1` assumption, cost basis,
all five cost inputs and dispositions, and review-evidence record. USDC must be
the native Solana mint documented by [Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses)
(`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) at exactly six decimals; the
peg remains an explicit experimental assumption, not a price observation.
`reviewScenarioConfigSha256(config)` supplies the deterministic hash to bind
the review evidence to every scenario assumption and identity field.

For example, the caller explicitly builds (not inherits/defaults) a baseline
configuration before attaching the offline review artifact:

```js
const config = {
  optIn: true,
  scenarioId: "MEMECOIN_PAPER_QUOTE_ADVERSE_V1_BASELINE",
  scenarioVersion: "1",
  scenario: "BASELINE",
  identity,
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  usdcDecimals: 6,
  usdcUsdMicrosPerToken: "1000000",
  quoteBasis: "QUOTED_ROUTE_AMOUNTS_AS_MODELED_NET_SWAP_BASIS",
  adverseAdjustmentBps: 100,
  networkReserveCents: "10",
  feeCents: "0",
  spreadCents: "0",
  priceImpactCents: "0",
  zeroChargeDisposition: "NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS"
};
const reviewScenario = {
  ...config,
  reviewEvidence: {
    evidenceId, evidenceSha256, reviewerRef,
    scenarioConfigSha256: reviewScenarioConfigSha256(config),
    identity,
    purpose: "OFFLINE_SCENARIO_REVIEW_ONLY",
    decision: "APPROVE_SCENARIO_REVIEW_ONLY",
    recordedAt
  }
};
const {scenarioProjection} = await adapter.getPaperQuote(request, {reviewScenario});
```

`evidenceId`, `evidenceSha256`, `reviewerRef`, and `recordedAt` above must come
from an actual offline review artifact; the example supplies no synthetic
approval. The adapter checks only schema and binding, never the truth or
authority of those fields.

The review evidence must name an evidence artifact and reviewer reference,
carry a SHA-256-shaped artifact digest, bind the exact configuration hash and
identity, state `purpose: "OFFLINE_SCENARIO_REVIEW_ONLY"` and
`decision: "APPROVE_SCENARIO_REVIEW_ONLY"`, and predate the local response
receipt. The adapter only checks this caller-supplied structure and binding:
output provenance is `CALLER_ASSERTED_NOT_AUTHENTICATED`. It does not verify
the artifact, reviewer, approval, or clock, and it does not assert that the
owner approved operating or execution use. Independent evidence verification
is mandatory at any future integration boundary.

The declared basis is
`QUOTED_ROUTE_AMOUNTS_AS_MODELED_NET_SWAP_BASIS`: route fee, spread, and
size-impact already reflected in the quoted ratio are not charged a second
time. The preview sets their additional cost fields to zero only with
`NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS`; these are not claims of actual
zero costs. Raw provider fee, lamport, price-impact, and slippage-tolerance
fields remain separately visible and do not become actual-cost evidence.
Scenario slippage is the selected adverse adjustment, converted to cents with
integer arithmetic and rounded up; network is the explicit fixed USD reserve
for each side. The provider slippage tolerance/minimum output is never charged
again.

USDC conversion and token-price arithmetic use `BigInt` rational operations.
The model's USD-per-token `priceMicros` rounds up for entry and down for exit.
Debit values round up and credit values round down to cents. Entry sizing is
linearly projected only up to the source-quoted input amount and is further
capped so the modeled gross value plus scenario costs does not exceed the
existing fixed `$80` entry limit (`8,000` cents). The current consumer's
authorization, available-cash, 8%-of-equity, hard-evidence, and other risk
limits are not recalculated here; they remain unchanged. The projection is not
an executable exact-size route, and any integration must enforce the explicit
input-size cap rather than extrapolate from `priceMicros`.

`quoteValue.grossBeforeExtraScenarioCostsCents` and
`quoteValue.afterExtraScenarioCostsCents` are **single-side modeled quote
values, not PnL**. The adapter does not compute PnL before/after costs: that
requires a paired identity-bound entry, exit, and marks. Scenario cost
coverage `COMPLETE` means only that this declared scenario has all arithmetic
inputs. Alongside it, actual cost coverage remains `UNKNOWN`, quote candidate
price/costs remain unavailable, and `authorizationEligible`,
`executionRealistic`, and `integrationEligible` remain false. The scenario
projection is not passed to the runner or Paper consumer, and existing hard
filters and cost gates are not weakened.

## Offline validation

`node --test test/memecoin-paper-market-quote-adapter.test.js` runs only
generated synthetic fixtures and injected transports. It verifies inert
construction, exact entry/exit chronology and amounts, source/route identity,
successful exact route-ratio normalization alongside unresolved costs, quote
expiry, decimal precision, invalid input, bounded response handling and
cancellation, rejection by the existing Paper consumer, and opt-in baseline/
stress projections including cost non-overlap, rounding, configuration/evidence
binding, size caps, and identity stability across recreated adapters. It makes
no network request and does not claim that synthetic responses are real market
evidence.
