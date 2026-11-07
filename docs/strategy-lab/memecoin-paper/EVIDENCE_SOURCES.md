# Meme-Coin Paper evidence sources

This package adds bounded candidate discovery and an opt-in Raydium CPMM
pool/vault account decoder. Neither source activates the one-shot manifest,
fetches at import/test time, classifies transactions, normalizes other evidence
families, authorizes a candidate, or connects to a runner. Both collectors are
disabled unless a caller explicitly supplies `enabled: true`, an injected
transport, and an injected clock. The checked-in run manifest remains disabled
and unchanged.

The candidate-discovery collector uses only these generated HTTPS requests:

- `GET https://api.dexscreener.com/token-profiles/latest/v1`
- `GET https://api.dexscreener.com/latest/dex/tokens/{comma-separated-addresses}`

Requests have no credentials, caller-provided URL, headers, or redirect
permission. The transport is injected; request and response origins/paths are
checked, responses are streamed under per-response and per-run byte caps, work
is bounded by profile/candidate/pair/request limits, each request has a deadline,
the whole operation has an elapsed-time ceiling, and cancellation is honored.
There are no retries. The tests use static official-schema-shaped fixtures and
never contact a provider.

The Raydium CPMM decoder uses only two generated requests to the fixed
`https://api.mainnet-beta.solana.com` origin: `getAccountInfo` for the supplied
pool and `getMultipleAccounts` for that same pool, its two state-named vaults,
and its LP mint. It does not accept caller-selected endpoints or RPC methods.
Response streaming, request count, byte totals, slot skew, deadlines, and
cancellation are bounded; there are no retries. Tests use synthetic account
bytes and injected transport only; they make no live requests.

The output binds each discovery hint to the exact returned Solana
`chainId`/base-token mint/pair address/quote-token tuple and local response
receipt time. Duplicate token profiles and duplicate pair identities are
deduplicated. A pair's `pairCreatedAt` is preserved as the provider-reported
pair creation time, not recast as token creation or response time. Profile
descriptions, links, images, and arbitrary profile URLs are ignored.

Latest token profiles are not an exhaustive new-pair feed. The pair lookup
returns a provider snapshot, not an authenticated or signed event stream. The
collector has no Solana slot, does not verify the provider's source clock, and
does not authenticate its own injected clock or transport. Candidate rows carry
empty filter/analyst evidence and explicit `UNKNOWN` entries for every mandatory
field. Passing a discovered row through the existing `scout`/`filterCandidate`
stages cannot turn discovery into eligibility.

## Mandatory field coverage matrix

“Free/public” below describes the public interfaces, not an availability,
quota, completeness, service-level, or production-capacity guarantee. Check
the cited official terms and capacity before any separately approved
acquisition. Every endpoint has source-response semantics; only Solana RPC
responses provide context slots. A local receipt timestamp is not an
authenticated source clock. Unsupported data remain `UNKNOWN`.

| Mandatory field(s) | Source endpoint / method | Supported model and response semantics | Completeness, identity, time, slot guarantees | Access and current disposition |
|---|---|---|---|---|
| Candidate discovery | DexScreener `GET /token-profiles/latest/v1`; then `GET /latest/dex/tokens/{addresses}` | Public token profile hints followed by pair snapshots. This collector supports Solana pairs where the discovered token is the pair's base token; it does not select a pool on behalf of a reviewed launch manifest. | Returned chain, base mint, pair and quote are checked and preserved. Profile/pair identity and provider payload are not authenticated; discovery is non-exhaustive. Receipt uses the injected local clock; no slot. | Public endpoints; bounded collector implemented. A later manifest must approve origins, budgets, candidate list, and operating window. |
| Pair age; actual USD market cap; liquidity; trailing 1-hour total USD volume; 1-hour price change | DexScreener token-pair snapshot; existing provider normalizer consumes pair-by-pool snapshots | Pair `pairCreatedAt`, `marketCap`, `liquidity.usd`, `volume.h1`, and `priceChange.h1` where returned. A missing `marketCap` is not replaced with FDV. | Snapshot is bound to the returned pair identity; only `pairCreatedAt` is a source event-time field. Other fields have no source event timestamp or slot. Receipt time is local and untrusted. A snapshot is not historical coverage, executable depth, or a quote. | Public endpoint. The discovery collector does not normalize or attest these fields; subsequent provider acquisition and existing gates are required. |
| Token decimals; mint/freeze authorities; supported Token-2022 restrictions | Solana mainnet JSON-RPC `getTokenSupply` and `getAccountInfo`; existing mint-safety decoder | Supply and mint-account bytes at a commitment/context slot; supported classic SPL/Token-2022 layouts and currently enumerated extensions only. | RPC response carries a context slot and requested mint identity. A slot identifies the read context, not a signed response or universal provider trust. Unknown extension/layout semantics remain unknown. | Public RPC method. Existing provider normalizer and token-safety bridge own this mapping; this package does not duplicate it. |
| Raydium CPMM pool-specific vault identity and exclusion candidate; LP mint state (not proof of protection) | Solana mainnet JSON-RPC `getAccountInfo` and `getMultipleAccounts`; pinned Raydium CPMM `PoolState` decoder | Supports only the pinned Raydium CPMM program and its 637-byte `PoolState`, classic SPL Token and base-layout Token-2022 vault accounts, and classic SPL LP mint. Binds sorted token mints/programs/decimals, both vaults, LP mint, canonical PDA derivations, vault mint/authority, LP mint authority/decimals, and pool creator. Unknown program, discriminator, size, account state, or authority fails closed. | The reads are requested at `finalized`; the second response includes the pool again plus both vaults and LP mint at `minContextSlot` from the first read. The collector checks pool bytes remain identical and bounds slot skew. Response SHA-256 covers each response body; pool bytes also have their own digest. RPC context slots are read-context metadata, not signed source proof. The injected RPC and local clock are unauthenticated, and reads do not prove account-set completeness outside the named pool accounts. | Bounded decoder implemented, default-disabled, with two fixed-origin injected RPC requests. Emits `DECODED_UNVERIFIED` pool-vault evidence and the selected-token vault address only. `pool_creator` is not token-developer attribution; the LP mint authority/supply is not proof of burn, lock, duration, LP holder distribution, or safety. |
| Top-ten owner concentration; selected-pool and burned-supply exclusions; comparable complete holder snapshots and 1-hour holder growth | Solana `getProgramAccounts` over supported token programs, paired with `getTokenSupply`; proposed #1152 census contract; selected-pool vault candidate from the Raydium CPMM decoder above | Mint-filtered account results can provide token-account addresses, actual owners, and base-unit amounts for supported layouts. The Raydium output's `ownerCensusHandoff.selectedPoolTokenAccounts` identifies the selected mint's pool vault for a supported CPMM pool; `poolExclusionEvidence.value` also carries both decoded pool vaults and mint-specific details. This package does not implement a census or treat a top-20 token-account response as complete. | A response slot and supply reconciliation are necessary but do not alone authenticate complete RPC coverage. Owner aggregation must use actual owners. The handoff has `verified: false`, `review: null`, and incomplete census/burn-exclusion coverage; its `burnedTokenAccounts` is empty, not proof that no burns exist. Burned supply is already reflected in mint supply and must not be subtracted twice. Comparable snapshots also require matching source, mint, semantics, and appropriate slots/times. | Public RPC methods. Pending #1152/#1158 integration is not imported here; their owners must explicitly map and review this handoff against the accepted census/adapter contract. Until that occurs and exclusions are independently proven, concentration and growth remain `UNKNOWN`. |
| Developer-associated holdings; attributable prior-rug history | No selected public endpoint. Candidate inputs could include bounded Solana `getSignaturesForAddress`/`getTransaction` reads plus a separately reviewed attribution/history source. | Raw signatures/transactions do not establish developer identity, a comprehensive creator history, rug intent, or attributable outcomes. No identity is inferred from largest holders. | Generic transaction history cannot prove complete relevant history or identify all developer-controlled addresses. Source labels and review flags are not authentication. | Minimum decision: select and review a specific free source/provider (or separately authorize a product with appropriate coverage), define identity attribution and history scope, and document its completeness/provenance semantics. `UNKNOWN`. |
| Bundled-launch supply | Bounded Solana transaction history plus a versioned launch/bundle classifier tied to the selected token and launch window | There is no generic RPC “bundle supply” field. Transaction co-occurrence or top holders alone is not a bundle classification. | Requires complete transaction coverage over a defined launch window, a reproducible cluster rule, token-account/owner identity, denominator, and slot/time semantics. Generic RPC history does not prove these together. | Minimum decision: define “bundle,” launch window, treatment of coordinated but independent wallets, and a reviewed classifier/source with measurable coverage. No paid source is selected. `UNKNOWN`. |
| 15-minute momentum | Source-backed trade/candle series or repeated prospective pair snapshots | DexScreener pair snapshots expose selected aggregate periods, not a complete 15-minute event history in this collector. Repeated local snapshots establish only the observations actually collected. | A comparable 15-minute window needs stable mint/pool/quote identity, source event times, complete interval coverage, and a trusted clock/ordering policy. No RPC slot is available from DexScreener. | No history collector is implemented. A prospective, bounded series source and missing-interval policy are required. `UNKNOWN`. |
| One-hour unique buyers; separate buy/sell USD volume | Bounded Solana `getSignaturesForAddress`/`getTransaction` history plus a supported pool-program swap decoder and transaction-level quote pricing | Generic transaction balances/logs are not sufficient to distinguish swaps from transfers, liquidity changes, multi-hop transactions, or other activity. DexScreener `txns.h1` counts transactions, not unique buyers or side-specific USD volume. | Complete one-hour signature coverage, decoded successful swaps, unique owner identities, side classification, per-event USD conversion, slot/time consistency, and no truncated history are required. | Public RPC reads alone do not satisfy the evidence contract. Minimum decision: choose a pool model/decoder and a price/quote source with explicit completeness and USD semantics. `UNKNOWN`. |
| Liquidity / market-cap score component | DexScreener pair snapshot `liquidity.usd` and actual `marketCap` | Both values may appear in a pair snapshot; FDV is not a substitute for market cap. | Same-pair and response receipt binding is possible, but source-time freshness and market-cap methodology remain provider-defined; no slot. | Existing normalizer may provide partial values. No score input becomes verified solely because both fields parsed. `UNKNOWN` until reviewed evidence is accepted. |
| Qualified smart-wallet count/provenance | No selected public source; would require a reviewed wallet dataset and qualification history | Addresses alone are not qualified wallets. No allowlist or qualification criteria are configured. | Requires a versioned allowlist, identity and provenance of each wallet, measurement window, deduplication, and review/authentication semantics. | Minimum decision: define qualification criteria and approve a specific maintained source/review process. `UNKNOWN`; unset allowlist blocks scoring. |
| Executable quote, depth, fees and realized simulation costs | Not part of candidate-discovery endpoints | Pair liquidity/snapshot prices do not establish executable depth or complete fees, spread, impact, slippage, or network cost. | No quote identity/time/causal fill semantics or cost-completeness guarantee. | Separate source/provider and approved hypothetical-cost decision are still required; no entry or execution-realism claim follows from these collectors. `UNKNOWN`. |

### Provenance and dependency boundary

DexScreener request/response event records include fixed endpoint kind and path,
request ID, unversioned API marker, request and receipt times, byte count, and
SHA-256 of the response bytes; candidate rows bind to both profile and pair
response digests. A digest binds these in-memory observations to bytes but does
not authenticate or preserve the response. Events carry `slot: null`.

The Raydium collector requests only the fixed Solana mainnet RPC origin and
allows only `getAccountInfo` and `getMultipleAccounts`. It binds the RPC request
IDs, context slots, local request/receipt times, per-response byte counts and
SHA-256 digests, plus the decoded pool-state digest. It does not preserve the
response bytes or authenticate the RPC operator. Both sources report
`sourceAuthentication: NOT_ESTABLISHED` and
`clockTrust: INJECTED_LOCAL_CLOCK_UNVERIFIED`. The HTTPS origin restriction is
not a claim that a caller's injected transport is trusted.

This package emits identity tuples suitable for a later explicit request to the
current provider normalizer: `{chainId, mint, pool, quote}`. The Raydium result's
`ownerCensusHandoff` fields are `schema`, `identity`, `observedAt`, `slot`,
`source`, `sourceVersion`, `decoderVersion`, `responseSha256`, `pool`,
`selectedPoolTokenAccounts`, `burnedTokenAccounts`, `coverage`, `verified`, and
`review`. This is a proposed evidence handoff, not an accepted or verified
census input: `verified` is false, `review` is null, `coverage.ownerCensusComplete`
and `coverage.burnedSupplyExcluded` are false, and no burned account is asserted.
The `poolExclusionEvidence` additionally carries `value.poolVaults`,
`value.selectedMintVault`, and `value.quoteMintVault` for independent review.

The source neither imports the unmerged #1152 census nor the unmerged #1158
market-evidence adapter. Their owners must explicitly coordinate and review
mapping, identity/time/slot binding, and evidence acceptance; until then the
handoff cannot clear a census exclusion gate. Discovery hints cannot synthesize
these records. Integration must wait for reviewed, pinned dependencies and a
separately approved bounded manifest.

## Official documentation

- [DexScreener API reference](https://docs.dexscreener.com/api/reference) —
  token profiles and pair/token lookup response families.
- [Raydium CPMM `PoolState` at pinned commit](https://github.com/raydium-io/raydium-cp-swap/blob/3d69122790e97cd6aff24e8ba95940793773f58c/programs/cp-swap/src/states/pool.rs) —
  packed account fields, length, and seed constants.
- [Raydium CPMM initializer at pinned commit](https://github.com/raydium-io/raydium-cp-swap/blob/3d69122790e97cd6aff24e8ba95940793773f58c/programs/cp-swap/src/instructions/initialize.rs) —
  sorted mint order, vault and LP mint PDA constraints, token-program and
  authority initialization. `pool_creator` is the pool creator and is not
  evidence of token-developer identity.
- [Solana `getAccountInfo`](https://solana.com/docs/rpc/http/getaccountinfo)
  and [Solana `getMultipleAccounts`](https://solana.com/docs/rpc/http/getmultipleaccounts) —
  account data and context-slot response semantics.
- [Solana `getProgramAccounts`](https://solana.com/docs/rpc/http/getprogramaccounts) —
  program-account query semantics and filters.
- [Solana `getTokenSupply`](https://solana.com/docs/rpc/http/gettokensupply) —
  mint supply response and context.
- [Solana `getSignaturesForAddress`](https://solana.com/docs/rpc/http/getsignaturesforaddress)
  and [Solana `getTransaction`](https://solana.com/docs/rpc/http/gettransaction) —
  raw transaction-history interfaces, not generic swap or bundle decoders.
- [Solana token authority documentation](https://solana.com/docs/tokens/basics/set-authority)
  and [Token Extensions](https://solana.com/docs/tokens/extensions) —
  authority and extension semantics.

## Verification

Run the evidence-source suites offline:

```sh
node --test test/memecoin-paper-evidence-sources*.test.js
```

Fixtures represent the documented DexScreener response shapes and pinned
Raydium CPMM account layouts; they are synthetic. No live acquisition,
credential use, paid provider, candidate entry, strategy edge, or operating
readiness is established by this package.
