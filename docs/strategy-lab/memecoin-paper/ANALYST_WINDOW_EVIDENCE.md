# Analyst window evidence packet

This is an offline, non-authorizing source adapter for the six existing Analyst
inputs. Importing it performs no network, filesystem, provider, scheduler, wallet,
or ledger operation. It is not wired into candidate acquisition or execution.
`executionAuthorized` and `authorizationEligible` remain false even when all six
metrics are present and the existing Analyst returns a score.

The implementation adds only:

- `scripts/memecoin-paper/cpmm-swap-observations.mjs`
- `scripts/memecoin-paper/analyst-window-evidence.mjs`
- `test/memecoin-paper-analyst-window-evidence.test.js` and its matching fixture
- this document

It does not change scoring, hard filters, weights, the ledger, history
pagination, pool discovery, or the census collector.

## CPMM transaction decoding

The decoder pins Raydium's CPMM program ID and Anchor v0.2.0 layout to official
immutable revisions:

- [Raydium CPMM IDL at `e7e0c96`](https://github.com/raydium-io/raydium-idl/blob/e7e0c96fe77bcf6a020b84a44c47a722aac8e359/raydium_cpmm/raydium_cp_swap.json)
- [Raydium `swap_base_input.rs` at `ec3b20d`](https://github.com/raydium-io/raydium-cp-swap/blob/ec3b20ddf74d4f3c69f6ac475fde85755a57b0e6/programs/cp-swap/src/instructions/swap_base_input.rs)
- [Raydium swap event definition at `ec3b20d`](https://github.com/raydium-io/raydium-cp-swap/blob/ec3b20ddf74d4f3c69f6ac475fde85755a57b0e6/programs/cp-swap/src/states/events.rs)

The pinned program is
`CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`. Only the pinned
`swap_base_input` and `swap_base_output` instructions are decoded. The decoder
requires the 13-account order from that layout, a successful transaction
(`meta.err === null`), one matching `SwapEvent`, and matching pool, mints,
vaults, instruction arguments, user token-account balance deltas, and vault
delta directions. Transfer-fee amounts are preserved separately and net
amounts are checked against the actual user-account deltas.

The trader/buyer is derived from the `owner` fields for the instruction's input
and output token accounts and their transaction balance changes. The fee payer
is not treated as the buyer. Failed transactions, transfers/non-swaps,
recognized pool deposit/withdraw instructions, inner/routed CPMM calls,
multiple swaps, malformed events, incomplete balances, and mismatched identity
are excluded. A potentially relevant but undecodable/routed transaction makes
swap-derived metrics unavailable rather than silently undercounting them.

## Injected source contract

The builder has no transport or pagination implementation. Callers inject the
existing history, pool-proof, and census products; they also inject historical
prices, accepted pair evidence, and a reviewed wallet list. In particular,
`historySource.readWindow({identity, poolProof, startExclusiveMs,
endInclusiveMs})` must return the already-paginated window with:

- `status: "COMPLETE"`, matching identity and exact requested endpoints;
- `coverage: {complete: true, truncated: false, cursorExhausted: true}`;
- transaction rows with `signature`, genuine on-chain `slot`, Unix-second
  `blockTime`, a raw transaction whose first signature equals the row signature,
  raw compiled instructions, transaction meta, token balances, and program logs;
  and
- a source receipt `{status: "SOURCE_BOUND", id, source, payloadSha256,
  receivedAt}`.

The builder validates receipt shape, binding, coverage, and time bounds. Each
injected callback receives an `AbortSignal` and is deadline-bounded; the default
total source-read budget is 15 seconds (tests may select a smaller bound). A
callback that ignores cancellation still cannot hold the builder open past its
deadline. Oversized responses fail closed: history is limited to 5,000 rows,
aggregate decode work to 25,000,000 units, quote/momentum lookups to 2,048,
census rows to 25,000 per endpoint / 50,000 total, and allowlist entries to
10,000. The transaction decoder separately caps account keys, instruction
counts/references, token balances, signatures, and program logs.

The adapter does not authenticate a provider or recompute the receipt digest;
the injected collector owns binding the receipt to the exact raw payload and
proving pagination exhaustion. An asserted receipt is not independent source
review.

`candidateT` is the candidate's immutable window cutoff. `assembledAt` records
when the packet was actually assembled and may be later than `candidateT`;
`decisionAt` records the later filter/scoring time. Endpoint observations must
be no later than their receipt; end-of-window history receipts must be received
at or after `candidateT`. All receipts precede packet assembly, and
`assembledAt <= decisionAt`; `decisionAt - candidateT` cannot exceed the
existing five-minute evidence freshness limit. Derived metrics use
`observedAt: candidateT` as their window-as-of time, while their receipt and
packet assembly/decision times remain separately recorded. No acquisition or
receipt time is backdated.

`poolProof` must be a `SOURCE_BOUND`, verified proof for the candidate's exact
pool and both mints, including the two vault addresses, decimals, a genuine
on-chain slot, observation time, and source receipt. The history transaction
slot is kept per decoded observation. Derived windows have `slot: null`; no
single transaction slot is borrowed for a multi-observation result.

`censusSource.readSnapshots({identity, startAtMs, endAtMs, policy})` returns
exactly two complete snapshots. Each binds the same identity, source,
aggregation version, denominator policy, and ordered exclusion list; endpoint
times must match exactly. Owner rows are already aggregated under that policy,
and only distinct owners with positive raw balances count. Duplicate owner
rows do not create extra holders. A snapshot with `slot: null` must explicitly
say `provenanceType: "OFFCHAIN_TIMESTAMP_NO_SOLANA_SLOT"`; one with a numeric
slot must say `"ONCHAIN_SLOT"`. The derived change itself has no single slot.

`priceSource.readObservation({mint, atMs, denomination, purpose})` must return a
source-bound observation at the exact requested source timestamp, with positive
USD value, matching methodology version, a receipt received no earlier than
the observation, and no later than packet assembly. There is no interpolation,
latest-value substitution, stablecoin peg assumption, or implicit FX. Prices
must meet an explicit reviewed policy; the default proposed policy deliberately
has no historical-price trust configured.

`marketPairEvidence` must bind actual market cap and liquidity from the same
accepted pair, and exactly match the candidate's existing verified, complete
hard-filter evidence. No FDV substitution is used. A wallet allowlist must be
externally reviewed, versioned, effective at candidate time, and contain
individually reviewed qualification records that exclude the candidate mint.
Real wallet qualification additionally requires an explicit owner-approved
membership-timing decision with mode `AS_OF_CANDIDATE_CUTOFF`; `REVIEWED` alone
does not authorize intersecting a current list with the preceding hour. The
fixture-only timing mode is accepted only for synthetic candidates.

Receipts and derived packet objects are frozen. `payloadSha256` syntax and
receipt claims are preserved for review, not treated as cryptographic
authentication by this adapter.

## Proposed windows and score components

`PROPOSED_ANALYST_WINDOW_POLICY` makes the current proposal inspectable. The
current score version is pinned to 900,000 ms momentum and 3,600,000 ms swap
and holder windows; other durations are rejected for this score version and
require a separately approved/versioned strategy:

| Metric | Proposed evidence window | Derivation |
| --- | --- | --- |
| `uniqueBuyers1h` | `(T − 60m, T]` | Distinct owners of token-receiving accounts in successful, directly decoded candidate-pool buys. |
| `buySellUsdRatio1h` | `(T − 60m, T]` | Quote-side input/output amounts priced by exact, trusted historical USD observations; buy and sell USD totals must both be positive. |
| `momentum15m` | `T − 15m` and `T` | Percent change between exact, comparable token-price observations in the explicitly reviewed denomination. No missing-endpoint substitution. |
| `holderGrowthPct1h` | `T − 60m` and `T` | Percent change in distinct positive-balance owners from complete, identically excluded census endpoints. |
| `liquidityMarketCapPct` | One accepted pair sample | `liquidityUsd / actualMarketCapUsd × 100` from the exact pair already bound to the hard-filter evidence. |
| `qualifiedSmartWallets` | `(T − 60m, T]` | Distinct decoded buyers intersected with the versioned, effective, externally reviewed allowlist. |

The pinned durations do not decide whether the proposed boundaries,
denomination, price-source trust, census aggregation/exclusions, or
wallet-qualification semantics are approved. Those remain explicit policy
inputs. `T` must equal the candidate sample time. Source timestamps and
endpoint observations are not manufactured. A missing input omits that metric
and records an unavailable reason; the existing `analyzeCandidate` then returns
`SCORE_UNAVAILABLE`.
No missing metric causes weight redistribution. The current score weights
(25/20/15/15/15/10) and threshold 70 are unchanged.

The packet emits `slot: null` for off-chain observations and derived
multi-observation windows. `bridgeAnalystWindowPacket` prepares typed records
for the canonical market adapter; it does not stamp candidate evidence itself.
That canonical adapter is on the separate #1158/#1157 change and currently
rejects null slots for supplemental Analyst records. Do not bypass it or borrow
an unrelated RPC slot. Its single-writer handoff is narrowly scoped: permit
`slot: null` for Analyst records only when `coverage.slotProvenance` is one of
`OFFCHAIN_TIMESTAMP_NO_SOLANA_SLOT`,
`DERIVED_ONCHAIN_WINDOW_NO_SINGLE_SLOT`,
`DERIVED_ONCHAIN_WINDOW_WITH_EXACT_HISTORICAL_USD_PRICES_NO_SINGLE_SLOT`,
`CENSUS_ENDPOINTS_TYPED_PROVENANCE_NO_SINGLE_SLOT`, or
`DERIVED_ONCHAIN_WINDOW_WITH_EXTERNALLY_REVIEWED_ALLOWLIST_NO_SINGLE_SLOT`.
Retain required numeric slots and `ONCHAIN_SLOT` provenance for on-chain
records, and keep every existing identity, review, coverage, freshness, and
hard-evidence check. Until that change lands, this packet cannot claim the full
canonical-adapter → filter → scorer acceptance path;
`evaluateWithCanonicalMarketAdapter` only runs that path when the canonical
adapter is supplied.

## Decisions required before real-source use

1. **Smart-wallet qualification, membership timing, and allowlist:** the score specification's
   round-trip, unrelated-mint, realized-cost, attribution, review, and
   candidate-mint exclusions are proposals, not owner approval. The owner must
   freeze the qualification definition and provide its independently reviewed,
   effective, versioned list. The owner must also choose when membership is
   evaluated; the current code only accepts an explicit owner approval of
   `AS_OF_CANDIDATE_CUTOFF`. Until qualification, list, and timing are approved,
   real `qualifiedSmartWallets` remains unavailable.
2. **Momentum denomination and historical USD trust:** the owner must identify
   the trusted historical source/methodology and confirm whether momentum is
   USD-denominated. Cross-currency quote pricing also needs an approved source
   and trust policy. A USDC/USDT symbol is not proof of USD parity. Until
   reviewed source policy and exact endpoint/price evidence are supplied,
   momentum and USD flows remain unavailable.
3. **Window and census semantics:** confirm the proposed `(T−60m,T]` swap
   window, exact `T−15m`/`T` momentum endpoints, `T−60m`/`T` census endpoints,
   and census denominator/exclusion policy before freezing a strategy version.

Merged #1152 returns `status: "UNKNOWN"`, `coverage.complete: false`, and
`accountCoverage: "RECONCILED_RPC_RESPONSE_ONLY"`; its current RPC census has
no authenticated complete two-endpoint receipt. `adaptAcceptedOwnerCensusResult`
preserves its actual slot and bounded owner rows while retaining `UNKNOWN`, so
it cannot produce `holderGrowthPct1h`. The 1167 pool/discovery and 1176 history
products remain caller-injected; this packet duplicates no transport,
pagination, or acquisition and imports no unmerged branch. No live schedule,
network request, paid provider, spending, or secret is involved. The fixtures
are synthetic plumbing only, not market or wallet evidence.

Focused offline validation:

```sh
node --test test/memecoin-paper-analyst-window-evidence.test.js
```
