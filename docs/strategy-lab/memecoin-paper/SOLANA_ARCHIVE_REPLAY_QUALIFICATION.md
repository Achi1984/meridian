# HEDGE/USDC archival replay feasibility

**Disposition: NOT QUALIFIED; no bounded, independently verifiable OF1
reconstruction is established by the evidence available here.** This is a
retrospective feasibility assessment, not an acquisition authorization or a
gate change. HEDGE's existing 19/20 acquisition budget and all allowlists remain
frozen.

## Candidate and endpoint status

The technical target is the HEDGE mint
`wDSAqt4tEZpDAwB9XY6ejkZvMFuT1zUMjUh67txeYhf` (classic SPL Token), USDC mint
`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, and CPMM pool
`ishEsmyWEtrSksuaFP9xC16zy1w3ujV3idWACsNyriC`. The
[existing pool qualification receipt](PUBLIC_POOL_QUALIFICATION.md)
receipt does **not** establish a historical census endpoint pair:

| Existing observation | Recorded value | Why it is not a census endpoint |
|---|---|---|
| Raydium API `openTime` | `1793651039` = 2026-11-02 20:23:59 UTC | Explicitly a provider-reported proxy, not canonical pool-creation evidence or a selected `T`. |
| Finalized pool/account reads | slot `464996916` for both recorded account responses | Same-slot current account-binding reads; neither is a historical `T−60m` or `T` census. |
| Signature-history cursors | slot `464678719` at 2026-11-02 23:23:49 UTC; slot `464672680` at 23:02:13 UTC | Pagination cursor observations, not endpoint states; the history did not reach `openTime`. |
| Required endpoint pair | **UNKNOWN / NOT PINNED** | No authoritative UTC `T−60m`/`T` pair or finalized endpoint slots are present in the receipts. |

Do not treat the values above as selected endpoint slots. The account-response
SHA-256 receipts and the `19 of 20` request count are retained in the pool
receipt; this work made no additional provider or ledger-data request and
downloaded no archive data.

Before any census acquisition, freeze one retrospective UTC cutoff `T` and
compute `T−60m` by exact millisecond arithmetic. Bind both cutoffs to canonical
finalized source evidence: use the existing bounded
`createTimeBoundarySource()` in
[`scripts/memecoin-paper/history-time-boundary-source.mjs`](../../../scripts/memecoin-paper/history-time-boundary-source.mjs)
and the bridge in
[`scripts/memecoin-paper/history-window-bridge.mjs`](../../../scripts/memecoin-paper/history-window-bridge.mjs).
Record the requested UTC cutoff and its source-provided finalized slot and
recorded `getBlockTime`. The #1181 predecessor/successor search verifies
surrounding chain-time context; it does not relax the census endpoint contract:
the recorded timestamp for the selected slot must exactly equal the requested
UTC cutoff at **both** endpoints. A latest-at-or-before slot with a different
recorded time is not `observedAt` at that cutoff, even if its predecessor and
successor bracket it. Do not interpolate slot times, backdate acquisition
time, or substitute a nearby slot. Until accepted canonical finalized evidence
provides an exact matching timestamp for each endpoint, keep the endpoint pair
and census **UNKNOWN**. A proof acquired after a chosen historical endpoint
cannot be reused if it violates the boundary source's identity/time binding.
The boundary code labels source authentication `NOT_ESTABLISHED`; an
independent trust decision is still required.

An eventual replay can produce **retrospective proof** about reconstructed
historical state; it cannot establish that this evidence was available to a
decision-maker at that earlier decision time. Keep replay/acquisition time and
any prior decision-time evidence receipt distinct. Do not backdate a receipt or
describe retrospective availability as contemporaneous evidence.

## OF1 evidence and candidate-specific feasibility

The OF1/tool assessment is pinned to
[`rpcpool/yellowstone-faithful` v0.7.34](https://github.com/rpcpool/yellowstone-faithful/releases/tag/v0.7.34),
tag commit `fe631879f3830447ff481cba07e54b3cea4891c6` (published 2026-11-04).
GitHub release metadata publishes a Linux `faithful-cli` asset SHA-256
`d2e2a4b59a88f48c486b5961a4f3e82f111fe008a647344e109a6746d5d81c01`
(71,269,853 bytes); the asset was not downloaded or independently hashed here.
The [tagged project README](https://github.com/rpcpool/yellowstone-faithful/blob/v0.7.34/README.md)
describes Old Faithful as an RFC-stage project, not intended for production
use, and describes its input provenance as RocksDB **ledger** snapshots used
to build per-epoch CARs. It names Solana Foundation public warehouse buckets
and a private Triton source, and says CAR generation is deterministic for the
same ledger data. Those statements describe the project/tooling, not the source
or completeness of a particular HEDGE epoch.

| Route / property | What the pinned project establishes | HEDGE qualification |
|---|---|---|
| CAR contents | [`ledger.ipldsch`](https://github.com/rpcpool/yellowstone-faithful/blob/v0.7.34/ledger.ipldsch) models epoch, subset, block, entry, transaction, rewards, and transaction metadata. CAR CIDs/content hashes can detect changed bytes relative to the selected root. There is no account-state snapshot node or account-state root in this schema. | CAR is ledger-history input, not a holder snapshot or proof of canonical finalized state. Exact HEDGE epoch roots and per-epoch coverage were not captured. |
| RPC and indexes | The [tagged README](https://github.com/rpcpool/yellowstone-faithful/blob/v0.7.34/README.md) lists block/transaction/history/time RPC methods and epoch indexes; GSFA is an address-to-signatures index. | No historical `getProgramAccounts`/mint-filtered census or account-state-at-slot interface is documented by this tool. An address index cannot establish token balances or complete account enumeration. |
| GSFA key coverage | In v0.7.34, the [GSFA builder](https://github.com/rpcpool/yellowstone-faithful/blob/v0.7.34/cmd-x-index-gsfa.go) indexes static transaction message keys and appends loaded ALT keys **only for Protobuf metadata**; there is no corresponding Serde-metadata branch. `--require-tx-metadata` defaults true and missing metadata makes index creation fail; disabling it cannot prove transaction success. | Do not use GSFA as the completeness proof. Metadata format and availability for every HEDGE-interval transaction are unverified. Any missing metadata or ALT-key ambiguity is **UNKNOWN**. |
| CPI and transaction metadata | The tagged [metadata parser](https://github.com/rpcpool/yellowstone-faithful/blob/v0.7.34/solana-tx-meta-parsers/json.go) handles `inner_instructions`, grouping CPI records under top-level instruction indexes, with program/account indexes and instruction data. This can prove the recorded invocation structure when present and correctly bound to the transaction. | It does not prove a global slot scan is complete, reconstruct resulting account state, or authenticate the source. Missing inner-instruction metadata cannot be replaced by an empty CPI list. |
| Historical account state | The CAR is an epoch ledger archive; the inspected schema and CLI provide no authenticated account-DB snapshot for arbitrary slots. | A full validator replay needs a trusted, runnable validator and authenticated bank/account starting state. A mint-specific reconstruction may anchor at a proven successful mint initializer, but that instruction is not an account snapshot or validator starting state; reconstruction still needs verified complete canonical transaction/account history and independently validated state-transition semantics. |
| Exact coverage/provenance | The [published project report](https://docs.triton.one/project-yellowstone/old-faithful-historical-archive/public-report-epoch-208) is a dated report scoped to epoch 208; it is not a per-epoch proof for an unpinned 2026 HEDGE interval. The official files host and docs were not reachable from this environment during review, and no catalog or CAR was fetched. | Whether every required HEDGE epoch exists, has all canonical slots, contains complete metadata, and descends from a trusted finalized source remains **UNKNOWN**. |

In particular, a normal classic-SPL transfer instruction names source and
destination token accounts, authority, and program; it need not name the mint.
Mint-address GSFA lookup therefore cannot discover all transfers or account
closures. A complete CAR scan over the full interval is required to discover
affected accounts; processing CPI also requires present inner-instruction
metadata and all referenced static and loaded account keys. Even that scan is
not itself an execution replay or an account-state completeness proof.

**Feasibility result:** OF1 v0.7.34 supplies a plausible content-addressed
transaction archive and useful indexes, but the inspected tool and its
published project claims do not substantiate a bounded, independently
verifiable HEDGE holder census. This candidate remains **UNKNOWN / NOT
QUALIFIED**. The smallest missing inputs are (1) an owner-frozen `T` plus
source-bound endpoint slots with exact recorded timestamp matches, (2) either
an authenticated bank/account starting state for full validator replay or a
proven HEDGE mint-initialization transaction plus verified complete canonical
history and independently validated transition semantics for mint-specific
reconstruction, and (3) explicit authorization and trust criteria for the
archive/export and independent finalized-slot replay.

## Conditional bounded recipe (not authorized or executed)

Proceed only after the missing inputs above are supplied and the source path is
explicitly authorized. The bounded input set is determined by the approved
opening state and the two pinned endpoint slots—not by an unbounded
mint-address signature query:

1. **Freeze identifiers.** Record chain `mainnet-beta`, exact mint/pool/quote,
   requested UTC cutoffs `T−60m` and `T`, resolved finalized slots `S0` and
   `S1`, exact matching source block times, opening-state identifier and
   digest, and the decision/replay tool versions. Reject the pair if either
   recorded timestamp differs from its requested cutoff; predecessor/successor
   points are chain-time context only.
   If opening state is the mint initializer, pin its successful transaction,
   slot, and original source evidence; otherwise the initialized state is
   **UNKNOWN**.
2. **Resolve the finite archive set.** Map the opening and endpoint slots to
   mainnet epochs. For each required epoch `E`, identify
   `https://files.old-faithful.net/E/epoch-E.car`, its published
   `epoch-E.cid`, and the matching mainnet indexes:
   `epoch-E-<CAR_CID>-mainnet-slot-to-cid.index`,
   `epoch-E-<CAR_CID>-mainnet-sig-to-cid.index`,
   `epoch-E-<CAR_CID>-mainnet-cid-to-offset-and-size.index`,
   `epoch-E-<CAR_CID>-mainnet-sig-exists.index`, and
   `epoch-E-<CAR_CID>-mainnet-slot-to-blocktime.index`; a GSFA index is
   optional and is not a completeness substitute. Pin the CAR root CID, source
   catalog capture, local SHA-256, epoch/network/index metadata, and file
   sizes before parsing. The repo documents `faithful-cli index all
   <CAR> <INDEX_DIR>` and per-epoch CARs; the published bytes and catalog
   entries for the candidate epochs are **not yet known**.
3. **Scan and reconstruct.** Sequentially scan every block/transaction from
   the approved starting point through the end of `S1`, not just transactions
   returned by GSFA. Reject an epoch if its CAR/root, slot map, transaction
   ordering, required metadata, inner-instruction records, or ALT-loaded keys
   cannot be verified for every relevant transaction. Choose exactly one
   reconstruction route and record its distinct prerequisite:
   - **Full validator replay:** use a trusted, runnable, pinned validator and
     authenticated bank/account starting state. Verify slot progression and
     compare resulting bank/state evidence against an independent canonical
     source.
   - **Mint-specific reconstruction:** anchor only at the proven successful
     HEDGE mint initializer, then require verified complete canonical
     transaction/account history for every state-changing effect and
     independently validated transition semantics, including CPI and loaded
     addresses. The initializer alone is not a snapshot or validator starting
     state.

   For either route, compare finalized slot/block evidence from an independent
   canonical source. CAR integrity alone is not this comparison.
4. **Emit two independent state checkpoints.** At each exact finalized
   endpoint slot `S`, the census reader's contract is a context-bearing
   historical mint-filtered `getProgramAccounts` response plus a raw mint
   `getAccountInfo` response requested at `S`; both response context slots
   must equal each other and exactly equal `S`. Retain raw mint supply and
   every active classic-SPL token-account row for the mint, including zero
   balances, token-account address, token-account authority, and raw amount.
   Track creation, authority changes, transfers, burns, CPI effects, and
   closures through replay. Require unique accounts and exact `BigInt` sum of
   all account amounts equal to raw same-slot mint supply **before**
   exclusions. Then exclude only separately verified selected-pool vault
   token accounts at the token-account level; keep the unexcluded raw census
   and excluded amounts in the receipt. Closed accounts are historical replay
   events, not endpoint rows.
5. **Checkpoint and stop.** Preserve source requests/exports, exact CAR and
   metadata bytes or immutable export references, hashes, catalogs, tool
   binaries, replay logs, slot proof, and both endpoint manifests. Stop with
   **UNKNOWN** on an unexplained slot gap, incomplete catalog/index, missing
   transaction metadata, ambiguous ALT/CPI keys, missing opening state,
   non-finalized/mismatched endpoint, supply mismatch, unexplained account,
   hash/root mismatch, or replay/bank-hash disagreement. Never convert a
   failed/truncated run into a partial census or negative holder finding.

**Footprint:** not estimable from the evidence captured. The required epoch
set is unknown until `S0`, `S1`, and the opening state are fixed; the inspected
public sources supplied no verified sizes or replay timings for that set.
GSFA indexing scans CAR input sequentially and can be costly; it does not reduce
the need for a complete state replay. Set an owner-approved byte, disk, CPU,
and wall-time ceiling before acquisition; stop rather than extrapolate beyond
it. The pinned project README notes that building GSFA for a large epoch can
take many hours; no HEDGE-specific duration is published.

No new fixture-driven preflight was added. The proven ALT-key asymmetry is in
the external v0.7.34 GSFA builder; this repository has no OF1 adapter to test,
and a synthetic fixture here could not prove an archive's real metadata format,
epoch coverage, or completeness. A local census preflight would duplicate the
diagnostic merged in #1398 (`5c517a4df3f183c22bed9158aa197f8a79726d3e`),
rather than close a demonstrated Meridian interface gap.

## Observed commands and results

- `git status --short --branch` before this review amendment → clean working
  tree on `copilot/qualify-solana-archive-replay` at submitted head `b0b8af2`.
- `git log -5 --oneline` → branch begins at `53527cc Initial plan` over
  `d713c5a Fix PostgreSQL V2 progress migration constraints (#1396)`.
- GitHub PR #1398 read → **MERGED** at `5c517a4df3f183c22bed9158aa197f8a79726d3e`;
  that main commit is included in this branch. Its raw-response diagnostic is
  now available from `scripts/memecoin-paper/owner-census.mjs` and
  `test/memecoin-paper-prospective-owner-census.test.js`; reuse it rather than
  adding a duplicate.
- GitHub release/tag metadata read for `rpcpool/yellowstone-faithful`
  `v0.7.34` → tag commit `fe631879f3830447ff481cba07e54b3cea4891c6`, published
  Linux asset metadata above. No `faithful-cli` binary was downloaded or run.
- Public docs host fetch → DNS resolution failed for `docs.old-faithful.net`
  and `docs.triton.one`; no claim was inferred from a failed fetch. No request
  was sent to `files.old-faithful.net`, Solana RPC, or any provider, and no
  CAR/index/ledger data was downloaded.

## Primary references

- [Old Faithful v0.7.34 release and asset metadata](https://github.com/rpcpool/yellowstone-faithful/releases/tag/v0.7.34)
- [Tagged README: RPC methods, epoch files/indexes, provenance, RFC status](https://github.com/rpcpool/yellowstone-faithful/blob/v0.7.34/README.md)
- [Tagged ledger CAR schema](https://github.com/rpcpool/yellowstone-faithful/blob/v0.7.34/ledger.ipldsch)
- [Tagged GSFA builder and metadata/key handling](https://github.com/rpcpool/yellowstone-faithful/blob/v0.7.34/cmd-x-index-gsfa.go)
- [Tagged GSFA index writer](https://github.com/rpcpool/yellowstone-faithful/blob/v0.7.34/gsfa/gsfa-write.go)
- [Tagged transaction metadata parser, including inner instructions and ALT resolution](https://github.com/rpcpool/yellowstone-faithful/blob/v0.7.34/solana-tx-meta-parsers/json.go)
- [Triton public report for epoch 208](https://docs.triton.one/project-yellowstone/old-faithful-historical-archive/public-report-epoch-208)
- [Solana `getBlock` RPC method](https://solana.com/docs/rpc/http/getblock)
- [SPL Token Program](https://spl.solana.com/token)
