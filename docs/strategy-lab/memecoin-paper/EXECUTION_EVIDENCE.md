# Paper execution evidence boundary

This packet is an offline, synthetic-only normalization boundary for a possible
future quote adapter. It does not change the existing ledger, stages, provider
adapters, controller, runner, manifest, or run workflow. Importing it performs
no I/O. It cannot authorize an entry or exit: no executable quote source or
verified cost semantics are available in the current adapter boundary. The
package is not imported by the observation-run path and does not change its
gates.

The capability matrix was checked against the exact
[`provider-evidence.mjs` at provider1108 commit `b000c6a6dcfcce102e61821e8316174a15a0dd58`](https://github.com/Achi1984/meridian/blob/b000c6a6dcfcce102e61821e8316174a15a0dd58/scripts/memecoin-paper/provider-evidence.mjs),
not just the older adapter in this shallow checkout. That source plans a
DexScreener pair request and three read-only Solana RPC requests per candidate
(source lines 166–224), then normalizes them into evidence records.

## Required fields and source capability

The filter and score requirements are defined by
`scripts/memecoin-paper/stages.mjs` (`FILTER_POLICY`, `SCORE_SPEC`,
`filterCandidate`, and `analyzeCandidate`). “Available” below means that the
checked-in parser extracts the field from a supported response shape. It does
not mean that a live response was retrieved, authenticated, complete, or
accepted by a gate. The parser's source, freshness, coverage, and candidate
binding checks remain separate requirements.

| Consumer requirement | Current primary source or input | Current capability |
| --- | --- | --- |
| Solana chain, mint, selected pool, and quote-mint identity | DexScreener pair response parsed by `parseDexScreenerPair` | Pair identity fields are extracted; parser output is `PARTIAL`, not a verification receipt. |
| Candidate sample/receipt time | Injected clock in `acquireProviderEvidence` | Available as acquisition time; market response receipt time is not a source-event timestamp and does not date the underlying market snapshot (provider lines 418–430, 739–746). |
| Pair age (`pairCreatedAt`) | DexScreener pair response | Extracted when finite; freshness and the 30-minute–72-hour gate are checked separately. |
| Actual market cap ($300k–$20m) | DexScreener `marketCap` response field | Conditional: absent values remain null; `fdv` is explicitly not substituted. |
| Liquidity (at least $40k), trailing-hour volume (at least $50k), and 1h price change (below 80%) | DexScreener `liquidity.usd`, `volume.h1`, `priceChange.h1` | Snapshot fields are extracted when finite; they do not prove executable depth or complete coverage. |
| Token decimals (0–18) | Solana RPC `getTokenSupply` in pinned provider1108 | **Supported when the request succeeds and pair identity remains bound:** [`validateTokenSupply`](https://github.com/Achi1984/meridian/blob/b000c6a6dcfcce102e61821e8316174a15a0dd58/scripts/memecoin-paper/provider-evidence.mjs#L406-L415) validates integer `decimals` in 0–18 and raw amount; normalization emits `evidence.tokenDecimals` with `complete: true`, slot, receipt time, and raw supply coverage, and sets `candidate.decimals` ([lines 498–502](https://github.com/Achi1984/meridian/blob/b000c6a6dcfcce102e61821e8316174a15a0dd58/scripts/memecoin-paper/provider-evidence.mjs#L498-L502), [lines 530–531](https://github.com/Achi1984/meridian/blob/b000c6a6dcfcce102e61821e8316174a15a0dd58/scripts/memecoin-paper/provider-evidence.mjs#L530-L531)). This does not establish other token safety gates. |
| Revoked mint/freeze authorities and supported token extensions absent | Solana RPC allowlist includes `getAccountInfo`; no account-layout or extension-state parser is implemented | Unavailable. |
| LP burn or lock covering the proposed hold | No checked-in source/parser | Unavailable. |
| Top-ten owner concentration, excluding selected pool and burned supply | Solana RPC `getTokenLargestAccounts` | Unavailable: response coverage is top-20 token accounts, not unique owners or the complete supply distribution (provider lines 503–511, 540–542). |
| Developer-associated holdings and complete attributed rug history | No checked-in source/parser | Unavailable. |
| Bundled-launch supply percentage | No checked-in source/parser | Unavailable. |
| 15-minute momentum | No supported 15-minute price-history evidence | Unavailable; 1h pair change is not a substitute. |
| Unique buyers in 1h | DexScreener `txns.h1` counts | Unavailable: transaction counts do not identify unique buyer wallets. |
| 1h buy/sell USD-volume ratio | No supported buy/sell USD-volume evidence | Unavailable; transaction counts do not supply USD denominators. |
| 1h holder growth | No owner-distribution history source | Unavailable. |
| Liquidity / actual market-cap score component | DexScreener `liquidity.usd` and optional `marketCap` | Potentially derivable only when both values exist; the provider emits no separately verified analyst-score evidence. |
| Qualified smart-wallet count | No verified wallet allowlist or provenance source | Unavailable. |
| Entry/exit hypothetical executable quote bound to mint, pool, quote mint, decimals, and time | No validated route-quote source or quote adapter | Unavailable. DexScreener pair snapshots are not executable quote evidence. |
| Exact fee, spread, slippage, price-impact, and network costs | No source with validated component semantics or denomination | Unavailable. No fixed fee or estimated cost is substituted. |
| Fresh risk marks for open positions | No validated executable quote source | Unavailable; missing marks keep equity unknown and block new entries. |

These are real-source limitations, not missing synthetic values. The generated
fixtures in `scripts/memecoin-paper-execution-evidence/synthetic-fixtures.mjs`
are labeled `SYNTHETIC_FIXTURE_ONLY`; they must never be treated as provider
verification or evidence for a run.

The pinned provider builds each evidence record from the requested identity and
marks it verified only when its coverage is complete ([provider lines
433–451](https://github.com/Achi1984/meridian/blob/b000c6a6dcfcce102e61821e8316174a15a0dd58/scripts/memecoin-paper/provider-evidence.mjs#L433-L451)).
`getTokenSupply` is associated with that request, not cross-validated against a
mint address returned by the RPC value. Pair identity mismatch invalidates all
candidate evidence, including supply-derived decimals ([lines
475–480](https://github.com/Achi1984/meridian/blob/b000c6a6dcfcce102e61821e8316174a15a0dd58/scripts/memecoin-paper/provider-evidence.mjs#L475-L480),
[498–502](https://github.com/Achi1984/meridian/blob/b000c6a6dcfcce102e61821e8316174a15a0dd58/scripts/memecoin-paper/provider-evidence.mjs#L498-L502),
[528–531](https://github.com/Achi1984/meridian/blob/b000c6a6dcfcce102e61821e8316174a15a0dd58/scripts/memecoin-paper/provider-evidence.mjs#L528-L531)).
RPC results are separate finalized calls; finalized commitment does not make
them one shared-slot snapshot. `getAccountInfo` response bytes are schema-checked
but not decoded as authority or Token-2022 state ([lines
512–518](https://github.com/Achi1984/meridian/blob/b000c6a6dcfcce102e61821e8316174a15a0dd58/scripts/memecoin-paper/provider-evidence.mjs#L512-L518)).

The existing ledger consumer contract is `PaperLedger.authorizeEntry`,
`PaperLedger.executeEntry`, and `PaperLedger.observeExitQuote` in
`scripts/memecoin-paper/ledger.mjs`. It requires all hard filters and score
checks to pass, a live reservation, a later fresh identity-bound quote,
`mode: "HYPOTHETICAL"`, literal `executable: true`, matching decimals, and all
five nonnegative integer-cent cost components. The stage contracts are not
reimplemented here. The ledger continues to round affordable token atoms down,
entry notional up to cents, and exit proceeds down using integer arithmetic.

## Normalization boundary

`normalizeHypotheticalQuote` checks the expected Solana identity, mint, pool,
quote mint, decimals, event identity, quote freshness, quote ordering after
both the candidate sample and authorization, and literal hypothetical/executable
flags. It always returns `UNAVAILABLE` with `QUOTE_SOURCE_UNAVAILABLE`,
`QUOTE_SEMANTICS_UNVERIFIED`, and `quote: null`: the current sources do not
establish that the asserted fields represent an executable route quote.

`normalizeExactCosts` accepts only nonnegative integer micro-USD components
bound to the same source, identity, and observation time as the quote. Each component
rounds upward to integer cents with `ceil(microUsd / 10000)` using `BigInt`.
Its output is explicitly `NORMALIZED_UNVERIFIED`, marked
`CALLER_ASSERTED_NOT_SOURCE_VERIFIED`, and never eligible for authorization.
The micro-USD input shape is a testable arithmetic contract, not a claim about a
provider's units or fees.

## Concrete route-quote API considered

The concrete candidate for a future read-only adapter is Jupiter Swap API v1,
`GET https://api.jup.ag/swap/v1/quote`. The latest official
[Jupiter OpenAPI schema inspected](https://github.com/jup-ag/jupiter-quote-api-node/blob/6dbd33abfaa1f495f28ad122b3c06edf4ce28360/swagger.yaml)
declares schema version `1.0.0` (commit `6dbd33a`, committed 2025-12-28), the
server and endpoint at lines 1–51, and describes `/quote` as a
request for a quote to be used in `POST /swap`. Its request takes `inputMint`,
`outputMint`, raw `amount`, `slippageBps`, and `swapMode`; its response schema
includes raw `inAmount`/`outAmount` (the request `amount` is explicitly raw
before decimals, lines 525–535), `otherAmountThreshold`, `priceImpactPct`,
`routePlan`, optional `platformFee`, `contextSlot`, and `timeTaken` (lines
146–202, 219–254). This is a more specific integration target than a generic
provider proposal, but these schema fields still do not make a paper fill
executable:

- The schema says `outAmount` is calculated by the routing engine and includes
  platform and DEX fees, excluding slippage; `otherAmountThreshold` is the
  calculated minimum output after applying `slippageBps` and is not used by
  `/swap` to build the transaction (lines 164–174). These are quote amounts,
  not a guaranteed fill or independently itemized all-in costs.
- `routePlan` identifies route steps and AMM keys (lines 219–254), but a future
  adapter would still need to validate every hop and prove how the route binds
  to the selected pool. A multi-hop route is not equivalent to a quote for one
  selected pool.
- `contextSlot` is a slot, not a wall-clock observation or quote expiry; the
  schema supplies `timeTaken` but no expiry/freshness timestamp. The adapter
  would need its own injected receipt clock and strict bounded freshness rule.
- `platformFee.amount`/`feeBps` are optional and denomination is the swap token
  amount, not USD cents (lines 190–217). `priceImpactPct` is present, but the
  quote schema does not give independent exact cent costs for fee, spread,
  slippage, price impact, and network. Avoid double-counting route fees already
  reflected in `outAmount`.
- The OpenAPI describes version `1.0.0` and base `/swap/v1`; it has no
  authentication/security declaration. Its own description says rate-limit
  details were moved to the developer site after 2024-12-01 (lines 1–19).
  Direct access to the current official rate-limit/authentication documentation
  was unavailable during this review, and the inspected spec commit is from
  2025-12-28; current API support/deprecation status therefore remains
  unverified. This packet makes no API-key requirement or numeric rate-limit
  claim.

Therefore the next integration proposal is specifically a disabled,
read-only Jupiter v1 `/quote` adapter, with no `/swap`, `/swap-instructions`,
signing, wallet, or transaction-submission calls. It may preserve the official
quote response and route fields for review, but must continue to report quote
semantics, complete selected-pool binding, quote expiry, and all-in cost
semantics unavailable until independently established. It must not emit a
ledger-ready quote based on `outAmount`, `otherAmountThreshold`, `priceImpactPct`,
or a spot price alone. Other hard gates remain unchanged.

For primary source references on the existing snapshots, see the
[DexScreener API reference](https://docs.dexscreener.com/api/reference),
[Solana `getTokenSupply`](https://solana.com/docs/rpc/http/gettokensupply),
and [Solana token documentation](https://solana.com/docs/tokens). None is
treated here as an executable quote or a complete cost source.

## One minimal next integration

Implement one owner-approved, read-only route-quote adapter (quote retrieval
only; no wallet, signing, transaction submission, swap, or order endpoint).
Before enabling it, pin and review the official API version and document source
semantics for: exact input/output mint and raw-unit amounts; validated mint
decimals; every selected pool/route leg; the observation slot/time and quote
expiry/freshness; the minimum-output or equivalent conservative bound; and
whether the quote is hypothetical rather than a guaranteed fill. The adapter
must also provide or support independently verified, non-overlapping fee,
spread, slippage, price-impact, and network-cost amounts with exact
denominations and a sourced integer conversion to USD cents. It must bind all
quote and cost values to the same chain, mint, pool/route, quote mint, decimals,
and observation time.

That adapter alone will not satisfy today's entry gates. Separate complete
primary evidence is still required for LP protection, authorities/extensions,
owner concentration, developer attribution/history, bundled supply, and
qualified-wallet provenance. No hard gate should be waived while those inputs
remain unavailable.

## Focused verification

Run:

```sh
node --test test/memecoin-paper-execution-evidence.test.js
```

The tests use only generated synthetic fixtures and the existing stage/ledger
contracts. They cover exact integer cost normalization, conservative rounding,
missing/partial/stale/conflicting quote and cost evidence, ledger-compatible
entry and exit rejection, and unavailable hard gates. A passing test is not a
provider verification, trade authorization, or empirical result.
