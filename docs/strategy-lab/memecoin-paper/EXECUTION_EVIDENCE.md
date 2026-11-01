# Paper execution evidence boundary

This packet is an offline, synthetic-only normalization boundary for a possible
future quote adapter. It does not change the existing ledger, stages, provider
adapters, controller, runner, manifest, or run workflow. Importing it performs
no I/O. It cannot authorize an entry or exit: no executable quote source or
verified cost semantics are available in the current adapter boundary. The
package is not imported by the observation-run path and does not change its
gates.

The referenced `provider1108` revision `b000c6a6` is not present in this
checkout's Git object database. The capability assessment below therefore uses
the current checked-in provider adapter, `scripts/memecoin-paper/adapters.mjs`,
and does not infer extra capabilities for that unavailable revision.

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
| Candidate sample timestamp | Caller-supplied `sampledAt` to `parseDexScreenerPair` | Available only as caller input; not a provider-issued observation timestamp. |
| Pair age (`pairCreatedAt`) | DexScreener pair response | Extracted when finite; freshness and the 30-minute–72-hour gate are checked separately. |
| Actual market cap ($300k–$20m) | DexScreener `marketCap` response field | Conditional: absent values remain null; `fdv` is explicitly not substituted. |
| Liquidity (at least $40k), trailing-hour volume (at least $50k), and 1h price change (below 80%) | DexScreener `liquidity.usd`, `volume.h1`, `priceChange.h1` | Snapshot fields are extracted when finite; they do not prove executable depth or complete coverage. |
| Token decimals (0–18) | Solana RPC allowlist includes `getTokenSupply`; current adapter has no verified decimals parser | Unavailable as validated candidate evidence. |
| Revoked mint/freeze authorities and supported token extensions absent | Solana RPC allowlist includes `getAccountInfo`; no account-layout or extension-state parser is implemented | Unavailable. |
| LP burn or lock covering the proposed hold | No checked-in source/parser | Unavailable. |
| Top-ten owner concentration, excluding selected pool and burned supply | `getTokenLargestAccounts` parser | Unavailable: response coverage is top-20 token accounts, not unique owners or the complete supply distribution. |
| Developer-associated holdings and complete attributed rug history | No checked-in source/parser | Unavailable. |
| Bundled-launch supply percentage | No checked-in source/parser | Unavailable. |
| 15-minute momentum | No supported 15-minute price-history evidence | Unavailable; 1h pair change is not a substitute. |
| Unique buyers in 1h | DexScreener `txns.h1` counts | Unavailable: transaction counts do not identify unique buyer wallets. |
| 1h buy/sell USD-volume ratio | No supported buy/sell USD-volume evidence | Unavailable; transaction counts do not supply USD denominators. |
| 1h holder growth | No owner-distribution history source | Unavailable. |
| Liquidity / actual market-cap score component | DexScreener `liquidity.usd` and optional `marketCap` | Potentially derivable only when both values exist; no separately verified analyst-score evidence is emitted. |
| Qualified smart-wallet count | No verified wallet allowlist or provenance source | Unavailable. |
| Entry/exit hypothetical executable quote bound to mint, pool, quote mint, decimals, and time | No validated route-quote source or quote adapter | Unavailable. DexScreener pair snapshots are not executable quote evidence. |
| Exact fee, spread, slippage, price-impact, and network costs | No source with validated component semantics or denomination | Unavailable. No fixed fee or estimated cost is substituted. |
| Fresh risk marks for open positions | No validated executable quote source | Unavailable; missing marks keep equity unknown and block new entries. |

These are real-source limitations, not missing synthetic values. The generated
fixtures in `scripts/memecoin-paper-execution-evidence/synthetic-fixtures.mjs`
are labeled `SYNTHETIC_FIXTURE_ONLY`; they must never be treated as provider
verification or evidence for a run.

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

No official quote or fee field semantics are asserted here. For primary source
references, consult the [DexScreener API reference](https://docs.dexscreener.com/api/reference)
and [Solana token documentation](https://solana.com/docs/tokens). This packet
does not interpret a spot price or estimate from either as an executable quote
or actual cost evidence.

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
