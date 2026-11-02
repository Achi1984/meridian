# Meme-Coin Paper source-readiness manifest

This is a source inventory and integration handoff, not an activation manifest.
The checked-in run manifest remains disabled. No provider was contacted for this
packet; source support below describes checked-in code or documented interfaces,
not live availability, completeness, authenticity, or entitlement.

The hard-filter ranges and Analyst score windows, weights, normalizations, and
threshold remain those already specified by #996 in
[`README.md`](README.md) and [`score-spec.md`](score-spec.md). In particular,
Analyst windows remain 15 minutes and 1 hour; no 1-hour aggregate is substituted
for 15-minute history, and missing score inputs still mean
`SCORE_UNAVAILABLE`.

## Required-input manifest

| Required input | Existing source/adapter and actual support | Status |
|---|---|---|
| Pair age, actual USD market cap, liquidity, trailing 1-hour USD volume, 1-hour price change | DexScreener pair snapshots through `scripts/memecoin-paper/provider-evidence.mjs` and `scripts/memecoin-paper/market-evidence-adapter.mjs`. Actual `marketCap` is not replaced with FDV. | **Implemented, partial snapshot only.** Missing fields remain unknown; snapshot event time, provider trust, and real-data readiness are not established. |
| Token decimals, mint/freeze authorities, supported token extensions | Solana `getTokenSupply` / `getAccountInfo` via the existing provider and token-safety adapters. | **Implemented for recognized layouts.** Unsupported layouts/extensions remain unknown; no live source was called. |
| Selected-pool LP burn or lock through the proposed hold | `scripts/memecoin-paper/evidence-sources/raydium-cpmm.mjs` decodes a supported Raydium CPMM pool, vaults, and LP mint state. Its own output says that this does not prove a burn, lock, duration, or LP-holder distribution. | **Implementation and external-proof gap.** There is no accepted LP protection proof source here. A pool-specific burn/lock decoder and reviewed proof are required; pool identity alone cannot pass this gate. |
| Top-ten owner concentration, excluding the selected pool and reviewed irrecoverable balances | `scripts/memecoin-paper/owner-census.mjs` uses injected `getProgramAccounts` data and returns incomplete/unverified census evidence. Existing `getTokenLargestAccounts` parsing is capped at 20 token accounts, not all owners. | **Partial implementation; completeness external fact missing.** The current public RPC result does not prove complete account enumeration, owner resolution, or reviewed exclusions. |
| Developer-associated holdings | No checked-in identity-attribution source. The pool decoder's `pool_creator` is not token-developer attribution. | **External fact and policy missing.** A documented, reviewable address-attribution source plus complete matching balances is required. |
| Attributable prior-rug history | No checked-in complete project/creator history source. Generic address history does not identify all controlled addresses or establish intent/outcomes. | **External fact and policy missing.** Incomplete history is not `found: false`; no negative rug conclusion is supported. |
| Bundled-launch supply | No checked-in transaction classifier or source. | **Implementation and policy missing.** Requires a versioned bundle definition, launch window, attributable addresses, complete transaction coverage, and a supply denominator. |
| 15-minute momentum in USD | DexScreener provides a current pair snapshot, not the required exact historical USD endpoints. Pyth documents historical price APIs, but feed coverage, access entitlement, and suitability for these tokens are not selected or verified. | **Historical-price source missing.** Do not substitute current prices, one-hour price change, or a stablecoin/USD parity assumption. |
| One-hour unique buyers | `scripts/memecoin-paper/launch-history-source.mjs` captures bounded finalized signature/transaction responses, preserving supplied slots, block times, and raw-response digests. `scripts/memecoin-paper/cpmm-swap-observations.mjs` decodes supported CPMM swaps. `history-window-bridge.mjs` accepts an injected timestamp-boundary source. | **Partial implementation; source readiness unavailable.** The accepted collector reports `UNKNOWN_ARCHIVAL_OR_INDEX_TRUNCATION`; no concrete receipt-bound timestamp sidecar exists. The decoder and collector do not establish complete history. |
| One-hour buy/sell USD-volume ratio | Uses the same bounded launch-history collector and CPMM decoder, plus historical prices for each swap flow and positive buy and sell denominators. | **Partial implementation; historical-price and source-completeness gaps.** The current collector remains unknown, and transaction counts or total pair volume are not substitutes. |
| One-hour holder growth | Requires two complete, comparable, owner-resolved census snapshots at the window endpoints under one reviewed denominator/exclusion policy. | **Implementation and external-completeness gaps.** The present census path does not provide a complete time series. |
| Liquidity / actual market-cap score component | Same-pair DexScreener snapshot fields can be parsed by the existing provider adapter. | **Implemented, partial snapshot only.** It does not establish historical endpoint coverage or executable liquidity. |
| Qualified smart-wallet count and provenance | No checked-in allowlist, qualification history, or review receipt. `score-spec.md` contains proposed criteria only. | **External fact and owner-policy decision missing.** No wallet list is fabricated; addresses alone are not qualified evidence. |

## Bounded history-window bridge

`scripts/memecoin-paper/history-window-bridge.mjs` adds a default-disabled,
injected `historySource.readWindow({identity, poolProof, startExclusiveMs,
endInclusiveMs, signal})` boundary. It makes no transport calls. The accepted
`scripts/memecoin-paper/launch-history-source.mjs` response shape supplies
`sourceVersion`, `source`, `rpcOrigin`, finalized commitment, declared subjects,
slot interval, signature/transaction rows, response events, counters, and
coverage. It now preserves each raw response digest and the RPC-supplied
signature/transaction `blockTime` values; absent timestamps remain null. The
collector has no time-fence witnesses or aggregate receipt, and its archival
history completeness remains unknown.

An injected `timeBoundarySource.readWindow` must separately return source-bound,
receipt-digested `getBlockTime` witnesses immediately before and after each
requested time fence, its identity/window binding, coverage scope, response
events, and request/byte/work counters. It must use the same explicitly injected
RPC transport, not a parallel transport. No concrete sidecar is included. The
bridge derives milliseconds only from supplied block-time seconds and never
interpolates timestamps from slots. It validates the actual collector shape,
derives the `SOURCE_BOUND` aggregate receipt required by the Analyst consumer,
and hashes the canonical identity, fences, coverage, rows, counters, and source
response receipts. This payload binding is not provider authentication.

The bridge returns `COMPLETE` only when the selected pool and mint are bound,
the lower and upper timestamp fences straddle the requested
`(startExclusiveMs, endInclusiveMs]` window, slot/time ordering is monotone,
the collector's declared pool scope and inclusive slot interval cover both
complete time fences, pagination and successful transaction retrieval are
exhausted and untruncated, and the shared request/byte/work/row/deadline budgets
pass.
Transactions exactly at the start are excluded; those exactly at the end are
included. Empty rows alone never establish coverage. Missing block times,
ambiguous ordering, truncation, mismatched identity, an invalid receipt,
collector failure, cancellation, timeout, or exhausted budgets return `UNKNOWN`.
`COMPLETE` describes the receipt-backed response contract only:
`sourceAuthentication` and `archivalRetention` remain `NOT_ESTABLISHED`. The
current accepted collector returns `UNKNOWN_ARCHIVAL_OR_INDEX_TRUNCATION`, so
current production-shaped results remain `UNKNOWN`; positive bridge-to-Analyst
tests use explicitly fixture-trusted completeness and are not operational
readiness evidence.

**Integration prerequisite:** the accepted collector and swap decoder are now
present, but no accepted timestamp-boundary sidecar or proof of archival
completeness is available. The bridge tests use its actual response shape with
explicitly fixture-trusted boundary evidence and verify that the unchanged
collector output remains unavailable when its completeness is unknown. Those
fixtures are not evidence that a provider returned complete history.

Before integration, the owner must supply a narrowly reviewed sidecar using the
accepted injected transport, preserving exact response bytes/digests and genuine
`getBlockTime` values for both fences. It must report its scope and bounded
counters, and must not relabel an `UNKNOWN` collector result. The accepted source
must separately provide a defensible completeness guarantee; empty results,
finite pagination, or a successful decoder do not prove archival coverage. Do
not add a parallel RPC transport or bypass the existing Analyst adapter. Until
both source gaps are resolved, the bridge remains a tested seam, not a usable
real-history provider.

## Source proposals and unresolved choices

The smallest public-history proposal is the existing fixed Solana JSON-RPC
origin and accepted injected transport, extending it narrowly for
`getBlockTime`, using source-provided finalized slots and estimated block
timestamps. Solana
documents `getSignaturesForAddress` pagination parameters, transaction records,
and `getBlockTime` as an estimated Unix time in seconds. Those methods do not
guarantee archival retention, complete address history, monotone timestamps, or
authentic provider responses. A provider with documented cursor pagination may
be evaluated for census/history completeness, but no provider is selected or
authorized by this packet.

For historical USD prices, Pyth's official History API documentation describes
timestamp/range history endpoints. Access and feed entitlements must be checked
with the owner; do not provision a key or call the service. In particular, a
documented endpoint is not proof that the required token/quote feeds exist, that
coverage is free, or that its observation semantics match these windows.
DexScreener's existing pair snapshots remain the supported current-snapshot
source only, not a historical price series.

Owner/lead decisions required before any operational source integration:

1. Select the historical USD price source, exact feed coverage, timestamp and
   staleness policy, and whether any key-bearing or paid entitlement is allowed.
   Define how quote-asset USD conversion is sourced; do not assume parity.
2. Select the Solana history/census provider and acceptable archival,
   pagination, byte, and rate-limit guarantees. Decide whether an external
   cursor-enabled endpoint is permissible; classic `getProgramAccounts` has no
   completeness proof here.
3. Approve supported pool programs and LP burn/lock proof semantics, including
   lock expiry relative to the unchanged proposed hold.
4. Define developer attribution and prior-rug scope/lookback, the bundle rule
   and launch window, and the census denominator plus selected-pool/burned
   balance exclusions. No negative finding is allowed from missing coverage.
5. Review and approve a qualified-wallet evidence source and allowlist process.
   The score specification's proposed screening criteria are not an approval or
   a configured dataset.
6. Keep the one-shot manifest disabled until a separately reviewed exact source,
   mint/pool list, run window, and owner approval exist.

## Official references

- Solana RPC [`getSignaturesForAddress`](https://solana.com/docs/rpc/http/getsignaturesforaddress),
  [`getTransaction`](https://solana.com/docs/rpc/http/gettransaction), and
  [`getBlockTime`](https://solana.com/docs/rpc/http/getblocktime).
- Solana RPC [`getProgramAccounts`](https://solana.com/docs/rpc/http/getprogramaccounts)
  and [`getTokenLargestAccounts`](https://solana.com/docs/rpc/http/gettokenlargestaccounts).
- DexScreener [API reference](https://docs.dexscreener.com/api/reference).
- Pyth [History API](https://docs.pyth.network/pro/api/history) and
  [API-key access documentation](https://docs.pyth.network/price-feeds/pro/acquire-api-key).
- Helius [`getProgramAccountsV2`](https://www.helius.dev/docs/rpc/guides/getprogramaccountsv2)
  as one provider-specific pagination option for independent evaluation, not an
  approved source.

Documentation links were not directly fetchable from this sandbox; no endpoint
was probed. Provider capacity, current access terms, history retention, and
source authenticity remain unverified.
