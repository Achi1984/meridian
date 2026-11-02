# Market evidence adapter

This is an offline normalization boundary for evidence already acquired and
reviewed elsewhere. It makes no requests, selects no provider, has no execution
path, and always returns `realDataEntryEligible: false` and
`executionAuthorized: false`. A complete synthetic fixture can pass the
existing filter and analyst for contract tests; that result is not real market
evidence or permission to enter the Paper desk.

The adapter consumes the candidate returned by
`acquireProviderEvidence(...).candidates[n].candidate` in
[`provider-evidence.mjs`](../../../scripts/memecoin-paper/provider-evidence.mjs).
It uses that normalizer's candidate identity and already-normalized fields; it
does not parse HTTP or RPC responses. Supplemental records must carry the
candidate identity (`chainId`, `mint`, selected `pool`, and `quote`), millisecond
`observedAt`, nonnegative numeric `slot`, `source`, `sourceVersion`, complete
`coverage`, `review` metadata (`status: "REVIEWED"`, reviewer ID, review ID,
review time), and a typed `value`. Owner-census `value.context` also binds
`chainId`, `mint`, selected `pool`, `quote`, `slot`, `observedAt`, and
`commitment: "finalized"`; the context slot/time must equal the outer record.
The adapter discards caller `status` and
`verified` flags and derives its filter-facing values only after validating
those fields and the individual data contract.

The review object is a structural handoff contract, **not a signature** or
proof that a source is authentic, complete, or independently reviewed. A
source owner must validate the source response, decoder/version, completeness
claim, attribution, and review record before supplying it. The adapter cannot
establish those facts from an offline object. Missing, stale, future-dated,
wrong-slot, wrong-identity, incomplete, unreviewed, and synthetic/real-mixed
records remain `UNKNOWN`.

## Input contracts for missing source families

`adaptMarketEvidence({providerCandidate, evidence, analystEvidence, now,
holdUntil})` returns `{status, version, candidate, smartWalletAllowlist,
syntheticFixtureOnly, realDataEntryEligible, executionAuthorized}`. Unknown
source families are represented as incomplete candidate evidence rather than
safe defaults.

The `evidence.ownerCensus` record is the adapter's documented owner-census
handoff contract; it does not import unmerged PR #1152 code. Its value has
`pool` (exactly the selected pool), `supplyAtoms`,
`selectedPoolTokenAccounts`, `burnedTokenAccounts`, and a bounded `accounts`
array (at most `MAX_OWNER_ACCOUNTS` rows). Every row has a unique token-account
address, resolved owner address, decimal-string `amountAtoms`, and
classification `holder`, `selected_pool`, or `burned_supply`. Exclusion lists
must match the corresponding classified rows; coverage must give the burned
supply amount and explicitly attest complete account coverage, owner
resolution, and both exclusions. The adapter reconciles all row amounts to the
supplied supply, excludes selected-pool and burned-supply rows, aggregates
remaining amounts by owner, and computes the top-ten percentage against that
remaining denominator using integer arithmetic. Missing account-owner mapping,
unclassified balances, duplicates, non-reconciling supply, missing exclusions,
or an over-limit census leave concentration `UNKNOWN`. The upstream
owner-census source must document how it proves completeness and ties the
selected pool and burned-account exclusions to on-chain evidence; a list of the
largest accounts alone cannot satisfy this contract.

The census supply must also exactly equal both
`providerCandidate.tokenSupplyAtoms` and the amount in the provider-normalized
`evidence.tokenDecimals.coverage.amountAtoms`. That decimals record must be
source-bound to `Solana JSON-RPC getTokenSupply`, have a valid mint-account
match, and retain its supply slot. The census record declares one of two
`coverage.supplyContextPolicy` values:

- `same-finalized-slot`: census context slot must equal the normalized
  `getTokenSupply` slot.
- `distinct-finalized-slots-equal-supply`: slots must differ, while both
  records remain separately bound to finalized contexts, are fresh under the
  existing evidence-age limit, and supply amounts match exactly. This is an
  explicit cross-slot policy, not an assertion that the balance distribution
  is atomic across those observations. The census rows must reconcile to its
  own context supply. Missing/mismatched mint, amount, context time, slot, or
  unsupported policy remains `UNKNOWN`; slots are never silently treated as
  interchangeable.

`burned_supply` means a reviewed, currently evidenced irrecoverable token
account balance that is still included in the observed mint supply and in the
census rows. It does **not** mean historical SPL burn transactions: those
already reduce mint supply and must not be subtracted a second time. The census
source must prove each excluded account's irrecoverability and amount; if that
proof is unavailable, the owner distribution is incomplete and remains
`UNKNOWN`.

`evidence.developerAttribution` is a separate reviewed record with
`value.method: "documented"`, explicit `developerOwners`, and nonempty
`evidenceIds`. The adapter looks up only those explicitly attributed owners in
the reconciled census. It never labels a largest holder as a developer.

`evidence.lpProtection` must identify the selected pool and either a reviewed
burn proof ID or a lock whose `lockedUntil` covers the requested `holdUntil`.
Pool identity is not inferred from the token mint or another pool. Unsupported
pool/LP programs remain unknown.

`evidence.priorRug` requires reviewed `historyCoverage: "complete"` and a
boolean `found`. A positive finding also needs attributable text and evidence
IDs. It is not a reputation assertion; the existing filter reports the
attribution and references. Incomplete history is not `found: false`.

`evidence.bundledLaunch` supplies `bundledSupplyAtoms`; complete reviewed
detection coverage is required. The adapter computes its share against the
reconciled mint supply. Transaction counts or largest-holder balances are not a
bundle detector.

The six analyst records map to the existing `SCORE_SPEC` and require their
documented one-hour or 15-minute window. Buy/sell scoring uses positive USD
volume denominators, not transaction counts; unique buyers require explicit
deduplicated addresses; holder growth is computed from start/end unique-holder
counts; liquidity/market-cap is computed only after the record's values match
the normalized pair evidence; and qualified-wallet count requires a separately
reviewed allowlist ID and evidence references. `SCORE_SPEC` weights,
normalizations, and threshold are unchanged. Any missing component yields
`SCORE_UNAVAILABLE`; no weight is redistributed.

The current provider evidence output is an in-process normalization contract,
not a signed provider payload. Its filter-facing records receive the local
`PROVIDER_NORMALIZER_VERSION`; that identifies this code contract, **not** a
DexScreener or Solana API release. The provider API has no version binding in
the existing normalized record. A source-specific version, verified response
capture, and independent source review remain external prerequisites.

## Source coverage against current consumers

The filter and analyst consumers are
[`stages.mjs`](../../../scripts/memecoin-paper/stages.mjs). “Available” means
the current checked-in normalizer can produce the field, not that it proves
real-data eligibility, complete history, executable prices, or trustworthy
source provenance.

| Consumer requirement | Existing source and current coverage | Adapter / remaining prerequisite |
|---|---|---|
| Solana mint, selected pool, quote, sample identity | DexScreener pair response is checked against the requested chain, mint, pool, and quote by `acquireProviderEvidence`. | Preserved from the normalized candidate; mismatch remains unknown. Discovery is not exhaustive. |
| Pair age, actual USD market cap | DexScreener `pairCreatedAt` and optional `marketCap`. | Reuses the normalizer. Missing `marketCap` stays unknown; FDV is not substituted. Pair age is not token creation age. |
| Token decimals, mint/freeze authority | `getTokenSupply`, `getAccountInfo`, and the existing mint-safety evidence bridge. | Existing bridge binds account/supply identity, time, and slot. For census use, the adapter additionally requires decimals evidence to bind `amountAtoms`, `mintAccountMatch`, and `accountSlot` to `candidate.tokenSupplyAtoms`; it does not broaden decoder support. |
| Token-2022 transfer restrictions | The current decoder reports transfer fee, transfer hook, default-frozen accounts, and permanent delegate. | Other/unrecognized extensions remain unknown. Revoked mint/freeze authority alone is not universal transfer-safety proof. |
| Pool-specific LP burn or lock | No current provider parser or source-bound record. | Requires an independently reviewed, pool-specific lock/burn decoder and proof; unknown pool models block. |
| Liquidity, trailing 1-hour volume, 1-hour price change | DexScreener `liquidity.usd`, `volume.h1`, and `priceChange.h1`. | Snapshot fields feed existing thresholds only. They are not executable depth, complete history, or event-time guarantees. |
| Top-ten owner concentration excluding selected pool and burned supply | `getTokenLargestAccounts` returns up to 20 **token accounts**, not all token accounts or unique owners. | Requires the complete owner-census contract above and an independently supported full-coverage source. The existing RPC adapter intentionally leaves this gate unknown. |
| Developer-associated holdings | No checked-in identity attribution source. | Requires separately reviewed developer-address attribution plus complete owner balances. Largest holders are not developer identities. |
| Attributable prior-rug history | No checked-in complete project/creator history source. | Requires bounded, reviewed history with attribution and evidence references; “no known history” is not a clean history. |
| Bundled-launch supply | No checked-in transaction-history classifier or source. | Requires a reviewed, reproducible launch/bundle definition and complete transaction coverage. |
| 15-minute momentum | Current pair snapshot only has a one-hour price-change field. | No 15-minute series; do not substitute the one-hour metric. |
| Unique buyers in one hour | DexScreener `txns.h1` contains buy/sell transaction counts, not deduplicated buyer identities. | Requires source-backed unique-address aggregation. Transaction count is not unique buyers. |
| One-hour buy/sell USD-volume ratio | Current normalizer does not supply buy-side and sell-side USD volume denominators. | Requires sourced side-specific USD volume; counts and total volume cannot be converted into it. |
| One-hour holder growth | No owner-distribution time series. | Requires complete owner snapshots at both window boundaries, same identity and source semantics. |
| Liquidity / market-cap score component | The same-pair snapshot may provide both fields. | Adapter computes the ratio only when reviewed values match normalized pair evidence; otherwise unknown. |
| Qualified smart wallets | No checked-in reviewed allowlist, qualification method, or provenance. | Requires a reviewed versioned allowlist and traceable evidence. Unset provenance blocks scoring. |
| Executable quote and validated costs | DexScreener pair snapshots are not execution quotes; current source has no validated fee/spread/slippage/impact/network-cost source. | Remains unavailable and cannot support execution-realistic claims. |

### Official source references

- [DexScreener API reference](https://docs.dexscreener.com/api/reference): pair fields include market/pair snapshots; the current code consumes `pairCreatedAt`, `marketCap`, liquidity, volume, transaction counts, and price change. The reference does not establish LP protection, owner attribution, bundle classification, developer history, or smart-wallet qualification.
- [Solana `getTokenLargestAccounts`](https://solana.com/docs/rpc/http/gettokenlargestaccounts): returns the largest token accounts (up to 20), not a full owner distribution.
- [Solana `getProgramAccounts`](https://solana.com/docs/rpc/http/getprogramaccounts): describes program-account queries and filters; using it does not by itself prove a provider returned a complete, single-slot, owner-resolved census. It is not added to the current RPC allowlist.
- [Solana token authority documentation](https://solana.com/docs/tokens/basics/set-authority) and [Token Extensions](https://solana.com/docs/tokens/extensions): authority and extension semantics constrain what the existing mint-safety decoder can establish; unsupported extension behavior remains unknown.

The official reference pages were not directly fetchable in this environment.
These links are the primary documentation pointers; the matrix intentionally
separates the existing parser's actual output from source capabilities that
still need independent verification.

## Test and activation boundary

Run the focused offline test:

```sh
node --test test/memecoin-paper-market-evidence-adapter.test.js
```

The fixture exercises the actual `filterCandidate` and `analyzeCandidate`
consumers, including every individual hard evidence key and each of the six
score components. The fixture is synthetic, fixed-time, and never authorizes
real-data entry. No network request, public-data acquisition, credential,
provider selection, dependency, runtime, workflow, ledger policy, threshold, or
gate change is part of this adapter.

Before any real-data eligibility work, the unresolved external prerequisites
are: a reviewed owner-census source with demonstrated completeness and account
owner resolution; pool-specific LP proof; attributed developer and rug-history
sources; complete bundle detection; source-backed unique-buyer, USD side-volume,
15-minute price, and holder-growth time series; and a reviewed qualified-wallet
allowlist. Provider/API-version binding and authenticity of any reviewer
receipt also remain unestablished. Until those prerequisites are independently
verified and separately authorized, missing evidence remains `UNKNOWN`.
