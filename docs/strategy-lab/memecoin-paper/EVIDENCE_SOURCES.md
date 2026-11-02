# Meme-Coin Paper evidence sources

This package adds bounded candidate discovery only. It does not activate the
one-shot manifest, fetch at import/test time, classify transactions, normalize
the other evidence families, authorize a candidate, or connect to a runner.
`collectCandidateDiscovery()` is disabled unless a caller explicitly supplies
`enabled: true`, an injected transport, and an injected clock. The checked-in
run manifest remains disabled and unchanged.

The collector uses only these generated HTTPS requests:

- `GET https://api.dexscreener.com/token-profiles/latest/v1`
- `GET https://api.dexscreener.com/latest/dex/tokens/{comma-separated-addresses}`

Requests have no credentials, caller-provided URL, headers, or redirect
permission. The transport is injected; request and response origins/paths are
checked, responses are streamed under per-response and per-run byte caps, work
is bounded by profile/candidate/pair/request limits, each request has a deadline,
the whole operation has an elapsed-time ceiling, and cancellation is honored.
There are no retries. The tests use static official-schema-shaped fixtures and
never contact a provider.

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
| Pool-specific LP burn or lock through the proposed hold | Solana JSON-RPC `getAccountInfo` plus a pool-program-specific account/lock decoder and, where applicable, the protocol's official lock evidence | There is no generic pool-independent LP lock/burn schema. The collector does not decode a pool program, LP mint, locker, vault, burn instruction, or lock expiry. | A token mint or generic pool account does not bind proof to the selected pool or establish lock duration. No generic completeness/time/slot guarantee can establish the business claim. | Public chain reads may be available; a supported DEX pool model, versioned decoder, lock/burn semantics, and reviewed pool-bound proof source are required. `UNKNOWN`. |
| Top-ten owner concentration; selected-pool and burned-supply exclusions; comparable complete holder snapshots and 1-hour holder growth | Solana `getProgramAccounts` over supported token programs, paired with `getTokenSupply`; proposed #1152 census contract | Mint-filtered account results can provide token-account addresses, actual owners, and base-unit amounts for supported layouts. This source package does not implement a census or treat a top-20 token-account response as complete. | A response slot and supply reconciliation are necessary but do not alone authenticate complete RPC coverage. Owner aggregation must use actual owners; selected-pool vaults require separately decoded pool evidence; burned supply is already reflected in mint supply and must not be subtracted twice. Comparable snapshots also require matching source, mint, semantics, and appropriate slots/times. | Public RPC methods. Pending #1152 is a separate unmerged implementation and is not imported here. Until that interface is reviewed/available and exclusions are proven, concentration and growth remain `UNKNOWN`. |
| Developer-associated holdings; attributable prior-rug history | No selected public endpoint. Candidate inputs could include bounded Solana `getSignaturesForAddress`/`getTransaction` reads plus a separately reviewed attribution/history source. | Raw signatures/transactions do not establish developer identity, a comprehensive creator history, rug intent, or attributable outcomes. No identity is inferred from largest holders. | Generic transaction history cannot prove complete relevant history or identify all developer-controlled addresses. Source labels and review flags are not authentication. | Minimum decision: select and review a specific free source/provider (or separately authorize a product with appropriate coverage), define identity attribution and history scope, and document its completeness/provenance semantics. `UNKNOWN`. |
| Bundled-launch supply | Bounded Solana transaction history plus a versioned launch/bundle classifier tied to the selected token and launch window | There is no generic RPC “bundle supply” field. Transaction co-occurrence or top holders alone is not a bundle classification. | Requires complete transaction coverage over a defined launch window, a reproducible cluster rule, token-account/owner identity, denominator, and slot/time semantics. Generic RPC history does not prove these together. | Minimum decision: define “bundle,” launch window, treatment of coordinated but independent wallets, and a reviewed classifier/source with measurable coverage. No paid source is selected. `UNKNOWN`. |
| 15-minute momentum | Source-backed trade/candle series or repeated prospective pair snapshots | DexScreener pair snapshots expose selected aggregate periods, not a complete 15-minute event history in this collector. Repeated local snapshots establish only the observations actually collected. | A comparable 15-minute window needs stable mint/pool/quote identity, source event times, complete interval coverage, and a trusted clock/ordering policy. No RPC slot is available from DexScreener. | No history collector is implemented. A prospective, bounded series source and missing-interval policy are required. `UNKNOWN`. |
| One-hour unique buyers; separate buy/sell USD volume | Bounded Solana `getSignaturesForAddress`/`getTransaction` history plus a supported pool-program swap decoder and transaction-level quote pricing | Generic transaction balances/logs are not sufficient to distinguish swaps from transfers, liquidity changes, multi-hop transactions, or other activity. DexScreener `txns.h1` counts transactions, not unique buyers or side-specific USD volume. | Complete one-hour signature coverage, decoded successful swaps, unique owner identities, side classification, per-event USD conversion, slot/time consistency, and no truncated history are required. | Public RPC reads alone do not satisfy the evidence contract. Minimum decision: choose a pool model/decoder and a price/quote source with explicit completeness and USD semantics. `UNKNOWN`. |
| Liquidity / market-cap score component | DexScreener pair snapshot `liquidity.usd` and actual `marketCap` | Both values may appear in a pair snapshot; FDV is not a substitute for market cap. | Same-pair and response receipt binding is possible, but source-time freshness and market-cap methodology remain provider-defined; no slot. | Existing normalizer may provide partial values. No score input becomes verified solely because both fields parsed. `UNKNOWN` until reviewed evidence is accepted. |
| Qualified smart-wallet count/provenance | No selected public source; would require a reviewed wallet dataset and qualification history | Addresses alone are not qualified wallets. No allowlist or qualification criteria are configured. | Requires a versioned allowlist, identity and provenance of each wallet, measurement window, deduplication, and review/authentication semantics. | Minimum decision: define qualification criteria and approve a specific maintained source/review process. `UNKNOWN`; unset allowlist blocks scoring. |
| Executable quote, depth, fees and realized simulation costs | Not part of candidate-discovery endpoints | Pair liquidity/snapshot prices do not establish executable depth or complete fees, spread, impact, slippage, or network cost. | No quote identity/time/causal fill semantics or cost-completeness guarantee. | Separate source/provider and approved hypothetical-cost decision are still required; no entry or execution-realism claim follows from these collectors. `UNKNOWN`. |

### Provenance and dependency boundary

The collector's request/response event records include fixed endpoint kind and
path, request ID, unversioned API marker, request and receipt times, byte count,
and SHA-256 of the response bytes; candidate rows bind to both profile and pair
response digests. A digest binds these in-memory observations to bytes but does
not authenticate or preserve the response. Events also carry source label and
`slot: null`. The source does not sign returned values.
`sourceAuthentication` is
`NOT_ESTABLISHED`; `clockTrust` is
`INJECTED_LOCAL_CLOCK_UNVERIFIED`. The HTTPS origin restriction is not a claim
that a caller's injected transport is trusted.

This package emits identity tuples suitable for a later explicit request to the
current provider normalizer: `{chainId, mint, pool, quote}`. It neither imports
the unmerged #1152 census nor the unmerged #1158 market-evidence adapter. The
#1152 owner-census work must retain its `UNKNOWN` result without independent
pool-vault exclusion evidence. The #1158 adapter contract can map only
source-backed, identity/time/slot-bound records; discovery hints cannot
synthesize those records. Integration must wait for reviewed, pinned
dependencies and a separately approved bounded manifest.

## Official documentation

- [DexScreener API reference](https://docs.dexscreener.com/api/reference) —
  token profiles and pair/token lookup response families.
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

Run the new suite offline:

```sh
node --test test/memecoin-paper-evidence-sources.test.js
```

Fixtures represent the documented DexScreener endpoint shapes and are synthetic.
No live acquisition, credential use, paid provider, candidate entry, strategy
edge, or operating readiness is established by this package.
