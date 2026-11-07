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
All modeled quantities, gross cents, and adverse costs are derived from that
same published rounded `priceMicros` basis; the exact raw quote/base ratio is
retained separately for comparison, never mixed into rounded-price accounting.
Gross debit cents round up for entry, and gross credit cents round down for
exit, matching the ledger's integer `priceMicros` calculation. Adverse
adjustment cents round up from that same rounded-price gross. Entry quantity is
bounded by the source-quoted output amount and binary-searched so this rounded
gross plus scenario costs does not exceed the existing fixed `$80` entry limit
(`8,000` cents); its modeled input is only a linear projection within the
source-quoted amount. Exit quantity is bounded by the source-quoted input and
the requested position amount. Gross, costs, and net quote value therefore
reconcile arithmetically to the public price and quantity under the documented
rounding rules, without claiming an executable exact-size route. The current consumer's
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

## Cost and USD receipt validation (structure only)

`createMarketQuoteAdapter(...).validateCostReceipt(quoteResult, receipt)` checks a
caller-supplied `memecoin-paper-quote-cost-receipt-v1` against a quote result
that this same adapter instance issued (tracked privately; copies are refused).
It reuses `normalizeExactCosts`; it adds no runner, readiness wrapper, provider
call, price, or conversion. Every quote candidate also carries
`sourceResponse.sha256`/`byteLength`, hashed from the exact bytes the adapter
read (not provider-authenticated).

Required receipt bindings: `source`, `responseSha256` and `responseByteLength`
equal to the observed body; `quoteRequestId`, `side`, and the full identity
(chain, mint, pool, quote, decimals); `quoteObservedAt` and `observedAt` both
equal to the adapter's post-response receipt time; validation time not before
that and not past quote expiry; the quote must have no chronology, staleness,
expiry, or pool-binding reason.

Exactly five nonoverlapping components, each an exact non-negative integer
string in micro-USD (`fee`, `spread`, `slippage`, `priceImpact`, `network`;
numbers, decimals, negatives, cents, missing or extra keys are rejected). The
`inclusion` map must state the single supported disjoint basis per component,
and `routeAmountBasis` must be `GROSS_BEFORE_ALL_COSTS`; a net-of-cost route
basis or any other inclusion wording is refused as double-count risk. Separate
`quote` (the identity's quote mint and decimals) and `sol` (wrapped SOL, 9
decimals) conversions must each be `MEASURED_SOURCE_RECEIPT` with a positive
integer micro-USD per whole token, an evidence digest, and an observation
time not after the receipt and within 5 minutes; assumed USD parity is refused.
`network` must be payer-settled lamports and its micro-USD must equal
`ceil(lamports * solMicroUsd / 1e9)`.

A passing receipt returns `STRUCTURALLY_VALID_UNAUTHENTICATED` with cents
rounded up per component by the existing normalizer. That is the maximum: the
quote candidate's `costs` stay `UNKNOWN`, `priceMicros` stays null, and
`authorizationEligible`/`executionRealistic` stay false, so admission is still
refused. Receipts cannot be authenticated by this module and tests use only the
`SYNTHETIC_FIXTURE_ONLY` label.

**Implementation limits:** no real source emits a realized five-component
receipt, a measured USDC/USD or SOL/USD conversion, or an attested time; the
checks bind claims to bytes and clocks the module observed, nothing more.
**Unresolved decisions:** the real cost source and its authentication, trusted
time, how a Jupiter net-amount quote may map to the required gross basis, and
whether modeled costs may ever be labeled separately from measured costs.

## Proposed `MERIDIAN_PAPER_QUOTED_NET_V1` (modeled, review pending)

Issue #1220. A third scenario case, `QUOTED_NET_V1` (`scenarioId`
`MERIDIAN_PAPER_QUOTED_NET_V1`), extends the same projection and shared
BigInt arithmetic; `BASELINE`/`STRESS` output is unchanged. Status:
`PROPOSED_FOR_INDEPENDENT_REVIEW`. The owner approved the transparent modeled
methodology (mailbox 942/6639026463); the numeric values below are proposed,
uncalibrated, and **not** guaranteed worst-case real costs. Adoption requires a
separate independent review and run-policy binding.

- Additional modeled cost per side on ledger gross `G` cents:
  `ceil(G * 300 / 10000) + 50` (300 bp adverse adjustment, 50 US cents network
  reserve). Example: `G = 7718` -> `ceil(231.54) + 50 = 282` cents, all-in 8000.
- Fee, spread, and price impact add `0` under the explicit QUOTED_NET basis;
  this is never an assertion of actual zero or verified inclusion. Provider
  `feeBps`, `platformFee`, `priceImpact`, `minOut`, slippage tolerance, and
  lamports are retained separately and never charged again.
- Fixed native Solana USDC mint, 6 decimals. `1 USDC = 1 MODELED_USD` is an
  unsupported-by-market accounting assumption, not observed FX or depeg
  protection.
- Requires a causal quote issued by the same adapter whose `inAmount` equals the
  requested amount and whose raw response digest was read. Entry sizes below the
  quoted amount are labeled `SMALLER_SIZE_MODELED_NOT_A_FRESH_EXECUTABLE_QUOTE`;
  missing or contradictory input returns `BLOCKED` with no `model`.
- Result contract (for the runtime policy writer): `projection.model.binding`
  (every parameter with units, currency assumption, five dispositions,
  candidate identity, side, quantity, source-quote identity incl. response
  SHA-256, and computed cents), `projection.model.digest =
  paperQuotedNetModelDigest(binding)` (SHA-256 of sorted-key canonical JSON),
  `provenance: "MODELED"`, `actualCostCoverage: "UNKNOWN"`,
  `executionRealistic: false`, no authority. `verifyPaperQuotedNetProjection`
  recomputes the full binding and every exposed duplicate field (all five
  `costsCents`/`costDisposition` categories, `amountProjection` caps,
  `quoteValue`, price, scenario) from the binding's quote inputs, rejects
  missing, extra, or inconsistent fields, and never trusts a caller-supplied
  digest. Source-quote identity fields (response hash, request id, expiry) are
  caller-asserted inputs; pass `{expectedDigest}` to pin them. It does
  not authenticate the provider or reviewer.

  ## `EXPLICIT_GROSS_V1` (review-only; no adopted numeric preset)

  The versioned `EXPLICIT_GROSS_V1` variant reuses `getPaperQuote`'s
  `reviewScenario` parser and projection arithmetic. It requires `quoteBasis:
  "GROSS_BEFORE_ALL_COSTS"`, a complete `explicitAssumptions` record with a value,
  unit, and rationale for every numeric input, a measured quote-mint USD
  conversion, gross-basis evidence, and the same offline review-evidence binding.
  There are no numeric defaults or approved operating values. A zero fee, spread,
  slippage, impact, or network input also requires a component-specific
  `zeroCostAssumptions` rationale; zero never means empirically free execution.

  The five cost categories are separate: explicit fee cents, spread cents, adverse
  slippage basis points, impact cents, and network cents. Their inclusion map must
  name each category once as `EXCLUDED_FROM_GROSS`; any missing, overlapping, or
  net-basis declaration blocks projection. `grossBasisEvidence` binds the declared
  basis to the candidate identity, side, requested amount, canonical request
  digest (`paperExplicitGrossRequestDigest`), quote request id, route amounts, and
  the exact response-body SHA-256. These checks establish structural consistency
  only. Evidence hashes, the Jupiter response, local time, and caller declarations
  are not authenticated; this model does not turn Jupiter's route amounts into
  proven gross amounts. Without a matching gross-basis declaration and evidence
  reference, projection is blocked.

  `quoteUsdConversion` uses the existing `validConversion` contract: exact quote
  mint/decimals, positive integer micro-USD per whole token, method
  `MEASURED_SOURCE_RECEIPT`, evidence digest, and a conversion time no later than
  and within five minutes of the quote receipt. Assumed USDC/USD parity is not
  accepted. Entry sizing rounds the USD price and gross debit up, each adverse
  slippage amount up, and applies the tightest of 8,000 cents, 8% of supplied
  equity (rounded down), and supplied available cash. A smaller result is labeled
  `SMALLER_SIZE_MODELED_NOT_A_FRESH_EXECUTABLE_QUOTE`. Exit uses the full
  requested quantity, rounds gross credit down, and blocks when modeled costs
  exceed proceeds.

  The canonical model digest binds the version, every assumption and unit, the
  conversion, review and gross-basis evidence, request, response hash, quote, and
  recomputed output. `verifyPaperExplicitGrossProjection(projection,
  {expectedDigest})` revalidates the arithmetic and exposed fields; an expected
  digest pins the exact caller-supplied inputs. A valid result is still only
  `REVIEW_PROJECTION_ONLY`, `MODELED`, `actualCostCoverage: "UNKNOWN"`, and
  `executionRealistic: false`. `issueModeledQuote` accepts only the existing
  QUOTED_NET model and refuses this variant. Nothing is routed to the ledger,
  admission path, or runtime.

  ## Offline validation

  `node --test test/memecoin-paper-quote-cost-receipt.test.js` additionally covers
the digest, the valid synthetic receipt, and rejection of forged, missing,
stale, future, identity-mismatched, wrong-unit, missing-conversion, overlapping,
and missing-component receipts.

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

## Modeled quote handoff (fixture-only, work in progress)

A module-owned fixture adapter (`createFixtureMarketQuoteAdapter`) can issue a
frozen `PAPER_MODELED_QUOTE_V1` quote from its own QUOTED_NET_V1 projection via
`issueModeledQuote`. Issuance validates the original issued object (not a
clone), the run window and the policy against the constructor-owned clock; no
caller timestamp is ever authoritative. The quote is labelled `MODELED`,
`actualCostCoverage: UNKNOWN`, `executionRealistic: false`. The ledger commits
exactly the modeled base quantity (never resized; refused if it exceeds the
risk budget), binds the modeled facts into entry and exit replay digests, and
refuses any mark or exit whose modeled base does not equal the full position
before mutating high-water, stop or observation time. `eventId` is excluded
from issuer confirmation only because the ledger binds event identity and the
full payload separately. Real and external modes gain no authority.

Unresolved policy: approved network transport, reviewer authenticity,
archival coverage, and numeric model calibration.

The step retains an immutable configured policy and refuses (before any state
mutation) any issuer quote whose run, window, source policy, model, scenario
config or USD assumption differs, and any exit whose bindings differ from the
entry position. The fixture runtime rechecks deadline and cancellation after
the issuer clock advances, before audit append or return. Integration tests
cover issuer → composition → step → checkpoint → ledger entry/mark/exit,
checkpoint restart replay (PAPER_FILL/PAPER_EXIT provenance and digests) and
changed-event/changed-quote replay rejection. A direct regression drives
`acquireSyntheticRuntimeFixture` with a forwarding spy around the real fixture
adapter: issuance succeeds while the owned clock crosses the deadline, and the
quote returns null with `runtimeAudit.quotes` unchanged (verified to fail with
the post-issuance fence removed).
