# Live Paper evidence policy — decision proposal v1.1

**Status: REVIEW REVISION v1.1 — PROPOSAL FOR LEAD REVIEW — NOT ADOPTED.**
This corrects the v1.0 draft in response to review; it recommends definitions
for four unresolved evidence families. It changes no code, accepted gate, score
threshold, source configuration, or operating authority. It is not an
activation request. Lead review must precede asking the owner to decide.

> **Material limitation:** the proposed launch-role holdings proxy is narrower
> than “developer-associated holdings.” It can miss other addresses controlled
> by the same person, including tokens transferred to an unproven related
> wallet. This is a material reduction in protection; keeping the numeric 3%
> limit does **not** preserve the current gate's intended coverage. Owner
> approval of this proposal alone does not clear a gate or make the experiment
> eligible. Named RPC trust and bundle-supply measurement remain separate
> unresolved owner decisions.

## Recommendation and minimum scope

Keep the current contract strict. If the owner accepts this proposal, implement
only the following narrow evidence scope:

- One explicitly selected Solana mainnet mint and pool per candidate; classic
  SPL Token and a supported Raydium CPMM pool only. Unsupported token or pool
  models remain `UNKNOWN`.
- Use the pair's `pairCreatedAt` for the existing inclusive 30-minute–72-hour
  **pair-age** gate. It is not mint age. Keep all other #996 hard gates and the
  `score-spec.md` weights, windows, normalizations, wallet thresholds, and
  score threshold unchanged.
- Treat direct on-chain launch roles as role evidence, not proof of a person's
  identity, beneficial ownership, or a complete developer roster. Unless a
  finite, reviewed attribution set is accepted, the existing developer
  holdings gate remains `UNKNOWN`. Even if accepted, the proxy misses
  unproven related addresses and is materially narrower than the current
  developer-holdings intent.
- Bound prior-history screening to the 90×24-hour UTC interval before candidate
  time and only the finite, reviewed role-address set for a negative screen.
  Known, credible, attributable qualifying positive evidence outside that
  interval still rejects. A negative result can describe only its complete
  90-day window; it cannot mean “never rugged.”
- Require source-verified bundle membership before calling any transaction a
  bundle. The existing bundle-supply gate stays `UNKNOWN` until both membership
  coverage and an owner-approved supply numerator are available. Same-slot
  clustering is not a fallback.
- Reuse the proposed qualified-wallet criteria verbatim: at least 10 completed
  round trips in the preceding 90 days, across at least 5 unrelated mints,
  positive aggregate realized result after explicit costs, attributable
  evidence, dated independent review, exclusion of the candidate mint and
  same-mint bundled-launch behavior. The deterministic accounting below
  clarifies these criteria; it does not lower or replace them. Until membership,
  evidence, and timing are approved, real wallet scoring remains unavailable.

This is deliberately not a path to a current `PASS`. The sources and accepted
adapters still lack the required authentication, coverage, or policy decisions.
Missing, truncated, unsupported, or ambiguous evidence remains `UNKNOWN`; a
measured threshold breach remains `REJECT`. A bounded scan can establish “no
qualifying event in the completely screened scope,” never universal absence.

### Decisions that remain blockers after proposal approval

1. The owner must name the RPC operator/endpoint and approve its identity,
   finalized-response, and untruncated-completeness trust basis before same-slot
   census diagnostics can become gate evidence.
2. The owner must approve a bundle-supply numerator/denominator and acceptable
   source for exact-signature bundle membership. Without both, the bundle gate
   remains `UNKNOWN`, even if the other proposal definitions are accepted.
3. The owner must explicitly accept or reject the material narrowing of the
   developer gate to the launch-role proxy. If not accepted, that gate remains
   `UNKNOWN`; if accepted, the proxy still must not be described as a complete
   human developer roster.

None of these decisions authorizes source use, acquisition, or a Paper run.

## Time, identity, and source-trust rules

Keep four times distinct:

1. **Candidate time `T`** is the frozen sample cutoff used by existing evidence
   and scoring, represented as UTC epoch milliseconds for lookback arithmetic.
2. **Historical event time** is the source-provided transaction/block time or
   state slot to which an event belongs. Do not infer it from response receipt,
   an injected local clock, or a slot-to-time interpolation.
3. **Acquisition interval** is the actual start and end of collection, with each
   request/response receipt time recorded as observed. Acquisition may happen
   after a historical event, but must never be backdated to `T` or the event.
4. **Decision time** is when evidence is evaluated. Existing freshness rules
   still apply; a historical lookback does not extend them.

A slot-only record cannot establish membership in a 90×24-hour UTC interval.
Require source-provided historical timestamps and accepted time-boundary
coverage; do not interpolate timestamps from slots. If only slots are available,
the calendar-time screen is `UNKNOWN`. Compute the start as
`T − 90×24×60×60×1000`; do not use local-calendar/DST arithmetic.

Bind every record to `chainId`, mint, selected pool, quote, source/method and
version, requested interval, actual acquisition interval, response/transaction
identity, and coverage disposition. Retain raw response bytes where the
accepted capture path does so, plus their digests. A digest binds bytes to a
receipt; **a response hash is not source authentication**.

### Same-slot owner-census assumptions

The #1251/#1252 capture contract is diagnostic, not a policy change: query
finalized classic-SPL `getProgramAccounts` for the exact mint with context, then
read mint supply with `getAccountInfo` at `minContextSlot` equal to the first
context slot. `minContextSlot` is only a lower bound. Accept a pair only when
both returned context slots are exactly equal; discard a mismatch and retry
only within the capture's existing three-attempt/six-request bounds. Require
unique, correctly owned and decoded accounts, exact raw-integer balance sum
equal to same-slot raw mint supply, and no truncation. Zero-balance accounts
remain distinct from omitted accounts. Do not mix Token-2022 or another mint,
pool, provider, or slot into the result.

These rules assume one explicitly trusted RPC source returns finalized,
untruncated results for the requested program/mint and does not omit matching
accounts. Slot equality plus a balance/supply reconciliation is a consistency
check under that assumption; it does not authenticate the RPC operator, prove
enumeration completeness, or prove a past snapshot. Capture acquisition start
and end are not the state time. A hash of returned bytes does not make an
untrusted endpoint trusted.

**Decision needed before #1252 diagnostics could become eligible:** the owner
must name and approve the exact RPC operator/endpoint and the trust basis for
its identity, finalized responses, and complete untruncated account
enumeration, including whether that basis is acceptable for an evidence gate.
The owner must separately accept the same-slot method and its finite retry
limits. A fixed URL, HTTPS, response hash, `minContextSlot`, or successful
reconciliation alone is not that trust decision. Until it is recorded, capture
remains diagnostic-only and existing census-dependent evidence remains
`UNKNOWN`.

## 1. Developer-associated address attribution

### Proposed finite meaning

Do not infer a developer or common-control cluster. Use the label
`launch-role-associated address` for the finite set of public keys directly
named in successful, finalized, supported token-program authority instructions
for this mint through `T`: the initial mint authority and any address explicitly
installed by a later authority-change instruction. Keep the instruction,
signature, slot, mint, old/new authority, and exact role for every membership.
Do not add a pool creator, fee payer, shared funder, same-slot buyer, top holder,
or address merely because it transacted with a role address.

A role field does not by itself prove that the named key controlled the
transaction or that its beneficial owner was the token developer. Record
separately whether the role address itself signed a successful
authority-required instruction; this is evidence of key-level control at that
event, not identity or control of other keys. An initial authority value set by
another signer proves only the value recorded by the instruction. A shared
funder is evidence of funding, not control. Never merge balances across addresses
on the basis of funding, co-occurrence, or a reviewer-supplied relationship
label.

The existing developer-holdings percentage may use this set only if an
independent, dated attribution record explicitly accepts it as the complete
address scope for the narrowly named launch-role proxy. At the candidate's
accepted same-slot census, sum positive raw balances by exact token-account
owner key in that set, deduplicate token accounts/owners, and divide by the
same-slot raw mint supply under the already reviewed exclusions. Transfers do
not transfer attribution: a balance counts only while its current token-account
owner is an address in the set. Do not infer the destination owner's relation
from a transfer.

This is narrower than a claim about “all developer wallets.” If a complete
reviewed role scope or trusted complete census is unavailable, the developer
gate is `UNKNOWN`, not 0%. If the owner does not accept launch-role addresses as
the operational proxy for the existing developer gate, it remains `UNKNOWN`;
do not rename the proxy as proven developer identity. This is a material
narrowing: tokens moved to another address controlled by the same person escape
the proxy unless that address is independently established as a launch role.
Holding the numeric 3% limit unchanged does not preserve the breadth of the
intended developer-protection gate. This proposal does not claim that protection
is equivalent.

### Evidence and outcomes

Required records: the exact successful initialization/authority-change
transactions; source-bound mint and instruction identity; finalized slot and
event time; direct signer facts; the selected-pool identity; complete,
same-slot owner census and supply; exclusions; and the versioned independent
review record declaring the scope complete for this proxy.

- **PASS example:** for one supported classic-SPL mint, a reviewed manifest
  declares the exact initial-authority key as the complete launch-role proxy;
  the matching finalized instruction is present; a trusted, complete census
  reconciles at one slot; its deduplicated owner balances are 2.4% of supply.
  The existing 3% limit is met. This proves only that narrow proxy and snapshot.
- **UNKNOWN example:** a third wallet funded the initialization fee payer and
  bought in the same slot, but no authority instruction or accepted attribution
  record ties it to a launch role. Do not add it to the set; do not conclude the
  developer has no other wallets. If the reviewed set cannot be declared
  complete, the gate is `UNKNOWN`.
- **REJECT example:** complete accepted evidence for the declared proxy shows
  holdings above the unchanged 3% limit.

**Failure:** missing role history, a caller-supplied or conflicting identity,
unreviewed/incomplete attribution, unsupported token layout, incomplete
account coverage, slot mismatch, supply mismatch, or untrusted source yields
`UNKNOWN`. Contradictory authenticated records require review and cannot be
resolved by choosing the smaller balance.

**Future code seam:** add a versioned reducer at the existing launch-history /
owner-census handoff, consuming `classifyLaunchHistory()` facts and the accepted
same-slot census. Do not duplicate the token normalizer, census collector, or
#1252 capture.

## 2. Bounded prior-rug screening

### Proposed finite scope and event rule

For each address in the accepted finite launch-role set, screen historical
events in `[T − 90×24 hours, T)`, inclusive at the start and exclusive at `T`,
using UTC epoch time. This is a bounded **negative-screen** window, not a
discard rule for older positive evidence. Any independently reviewed,
attributable qualifying rug evidence for an address in that accepted role set,
already available or discovered outside that interval, remains eligible to
trigger `REJECT`; do not suppress a known older event because it falls outside
the negative-screen window.
Screen only the supported token/pool models and projects directly attributable
to those role addresses. Use finalized transactions and source event times;
the actual acquisition interval is recorded separately. The existing
launch-history limits (10 declared subjects, 20 pages per subject, 2,000
signatures and 1,000 transactions per invocation) remain hard bounds; do not
raise them to force a negative finding. If a limit prevents interval closure and
no qualifying positive event has been established, return `UNKNOWN`.

For this proposal, raw facts such as a prior authority, a mint, a token transfer,
low price, price collapse, a pool-creator match, or a same-slot cluster are not
a “rug.” A positive prior-rug finding requires both:

1. directly evidenced launch-role attribution of the same key to the prior
   mint/project and complete accepted records for the relevant supported pool
   event; and
2. an independently reviewed, evidence-bound event disposition identifying
   deceptive extraction/abandonment, with its supporting on-chain transactions
   and outcome evidence. A liquidity withdrawal or price collapse alone is
   insufficient; price collapse is not proof of intent.

The reducer is monotonic for positive evidence: one credible, source-trusted,
directly attributable, independently reviewed qualifying event returns
`REJECT`, even when other subjects, transactions, or unrelated history are
incomplete. Full coverage is required only to return the negative result
`PASS: NO_QUALIFYING_EVENT_IN_COMPLETE_90D_SCOPE`, and only when every declared
subject and the complete 90-day interval have accepted source coverage with no
qualifying event. That result says nothing about earlier events, other
addresses/projects, unobserved chains, or universal absence of rugs. If the
source cannot establish complete history for this finite query and no
qualifying positive event is established, the result is `UNKNOWN`. Current RPC
cursor exhaustion alone does not establish archival completeness.

### Evidence and outcomes

Required records: the versioned finite attribution set; all relevant prior mint
and selected-pool identities; signatures and successful raw transactions for
the complete interval; source coverage including archival/truncation status;
event-time/slot mapping; pool state before/after any alleged extraction;
outcome evidence; and an independent reviewer disposition bound to those exact
records.

- **PASS example (negative only):** a reviewed role set contains one key; the
  approved source attests complete, finalized coverage for its entire prior
  90-day history; all supported prior projects and relevant pool events are
  reconciled; there is no independently reviewed qualifying event. Result:
  `NO_QUALIFYING_EVENT_IN_COMPLETE_90D_SCOPE`, not “no rugs ever.”
- **UNKNOWN example:** `getSignaturesForAddress` reaches its finite cursor/page
  bound before the 90-day start, or the source only has non-archival coverage,
  and no qualifying positive event is established. Empty returned rows or a
  price-collapse chart cannot turn this into a pass.
- **REJECT example:** the same directly attributed launch-role key has an
  independently reviewed prior event record, bound to successful supported
  pool transactions and outcome evidence, satisfying the approved
  deceptive-extraction disposition. This remains `REJECT` even if another
  address's history is incomplete or this known event predates the 90-day
  negative-screen interval.

**Failure:** absent a qualifying positive event for an accepted role address,
incomplete subjects, truncation, missing timestamps, failed or unsupported
transactions, unknown attribution, missing outcome evidence, unreviewed event
classification, or untrusted source returns `UNKNOWN`, not a clean-history
result. A qualifying positive event is not downgraded by unrelated gaps.
Disagreement over intent remains `UNKNOWN`; do not infer intent from a price
series.

**Future code seam:** extend the isolated launch-history classifier with a
versioned, receipt-bound prior-event reducer. Preserve raw positive observations
separately from reviewer disposition. Do not map the existing
`INITIAL_MINT_AUTHORITY_SET` fact to a rug finding.

## 3. Launch-bundle evidence

### Proposed finite meaning and unresolved metric

A bundle is proven only when an independently trusted bundle source returns a
bundle identifier/status that binds the exact successful member signatures.
Do not anchor the bundle window to mint initialization. For the supported
Raydium CPMM model, anchor it to the selected pool's successful finalized
`initialize` instruction: the instruction must name the exact selected pool,
and its pool/mint/vault/LP-mint identities must reconcile with the pinned
Raydium CPMM pool-state decoder. Then identify the first successful supported
candidate-token swap for that exact pool. Require complete transaction coverage
from pool initialization through that first swap to establish the trading
anchor; mint creation may precede pool creation by any duration.

The finite launch window is the inclusive slot range
`[poolInitializeSlot, poolInitializeSlot + 32]` (at most 33 slot numbers).
Enumerate produced/skipped slots and all transactions relevant to the selected
pool in that range. The first successful supported swap must occur within the
range; otherwise the proposed launch-bundle measure is `UNKNOWN`, not an empty
bundle result. A bundle candidate is only a successful supported swap in this
pool/window whose exact signature appears in independently trusted,
source-verified bundle membership. Same-slot transactions, temporal clustering,
common funders, and top-holder overlap are not bundle membership.

Proof of membership still does not determine “bundled-launch supply.” A
candidate-pool transaction's gross token output is not necessarily distinct
supply, retained ownership, or a non-duplicated bundle allocation. To preserve
the existing hard gate without inventing a misleading denominator, keep the
percentage and its 10% limit unchanged but leave the gate `UNKNOWN` until the
owner separately accepts a numerator/denominator rule and complete source
coverage. Recommended future numerator for decision is the end-of-window raw
candidate-token balance of distinct owners that received candidate tokens in a
verified bundle-member swap in the finite pool window; denominator is raw mint
supply at the same end slot. This requires complete token-account ownership and
account-change coverage through the end slot, including within-window transfers
and deduplication. This is a proposed bundle-recipient owner-exposure proxy,
not an accepted definition of “bundled-launch supply” and not a claim that every
counted unit originated in a bundle. It may include other holdings of a
recipient. Do not apply the existing 10% threshold to it without explicit
owner approval of that measurement rule.

### Evidence and outcomes

Required records: exact supported pool initialization transaction/slot and
reconciled pool/mint/vault/LP-mint state; first successful supported swap
transaction/slot and complete signature/transaction coverage from initialization
through it; all produced/skipped slots and all pool-address transaction
dispositions in the 33-slot maximum window; a trusted bundle response binding
bundle ID/status to exact member signatures; decoded token flows; complete
end-slot token-account owner/balance state and same-slot supply; the proposed
independent owner aggregation; and an owner-approved versioned
numerator/denominator policy.

- **PASS example (conditional on that additional decision):** complete
  pool initialization is verified at slot 150, the first supported swap at
  slot 151, complete coverage establishes all relevant transactions through
  slot 182, and trusted membership binds exact swap signatures. Under a
  separately approved owner-exposure numerator, deduped recipient-owner
  balances are 8% of raw supply at slot 182. Only then could the unchanged 10%
  gate pass.
- **UNKNOWN example:** mint initialization is at slot 100, but the selected
  pool is initialized at slot 150 and first trades at slot 151. A scan anchored
  only at mint initialization does not establish this pool's launch window.
  Correct pool anchoring still requires verifying pool initialization and
  complete coverage to its first swap; if either is missing, result is
  `UNKNOWN`.
- **UNKNOWN example:** several unrelated buys share a slot with pool
  initialization, but no trusted response binds their signatures to a bundle
  ID. Record them as same-slot purchases only; membership and supply remain
  `UNKNOWN`.
- **UNKNOWN example:** membership is proven, but recipient balances or
  end-of-window transfers are incomplete, the first swap cannot be established,
  or no numerator definition is accepted.
  Do not substitute gross swap volume or cluster size.

**Failure:** missing bundle source/status, signature mismatch, incomplete slot
coverage, unsupported pool initialization/swap model, untrusted response,
unknown owner, ambiguous transfer accounting, or unapproved supply semantics
returns `UNKNOWN`. If no source can provide
faithful bundle proof, explicitly retain this blocker; do not relabel launch
clustering as bundles or treat “no bundle record received” as zero bundles.

**Future code seam:** a separate injected bundle-membership source and a
versioned reducer beside `classifyLaunchHistory()`, plus a pinned historical
Raydium CPMM initializer decoder that binds the initialize transaction to the
selected pool and its decoded state. The existing pool-state decoder does not
establish the historical initialize transaction or first swap. No current
source or classifier produces trusted bundle membership; do not change the
existing hard-gate adapter to accept same-slot observations.

## 4. Qualified-wallet selection and accounting

### Preserve the existing proposed criteria

Keep the existing candidate score version and qualification thresholds exactly:
for each proposed allowlisted wallet, at least 10 independently verified
completed round trips in `[T−90×24 hours, T)`, across at least 5 unrelated
mints, with positive aggregate realized result after explicit costs; exclude
self-transfers, same-mint bundled-launch behavior, and the candidate mint;
deduplicate overlapping wallets; require attributable transaction evidence and
a dated independent review. Wallet addresses alone do not qualify. Membership
must be on a versioned, externally reviewed list effective at candidate cutoff
`T`; real scoring requires the existing explicit
`AS_OF_CANDIDATE_CUTOFF` decision.

### Proposed deterministic accounting

Inputs per wallet and mint: successful supported swap signature, slot and
source event time; wallet owner and token-account identities; raw base-unit
input/output and decimals; quote asset and amount; exact historical USD
observations and methodology; each explicit cost component; transfer rows;
complete opening positions at the start and closing positions at `T`; candidate-
mint identity; and verified bundle facts. All amounts use exact integer base
units and exact monetary units. No nearest-price, peg, or missing-cost
substitution.

Use FIFO lots separately for each exact wallet-owner key and mint:

- Each successful swap buy within the 90-day interval creates a lot keyed by
  signature and acquired base units. Its cost basis is exact historical USD
  value plus explicit acquisition costs.
- Successful swap sells consume eligible lots FIFO. A lot counts as one
  completed round trip only when all its acquired units are closed by
  successful swaps within the interval. Count these completed buy lots
  separately from the P&L calculation below. Partial sales accumulate against
  the lot; an open remainder means it is not a completed round trip. One lot
  counts once, regardless of the number of sell transactions. A sale closing
  several lots may close each distinct buy lot, not create extra lots.
- Calculate aggregate realized net result over **all eligible realized
  portions** in the interval, not only fully closed lots. Include realized
  portions from partially closed lots and from opening inventory when its
  acquisition basis is fully known; include matched proceeds, basis, and
  explicit buy/sell costs for each disposed quantity. Do not include
  unrealized value for units still held. Allocate integer cost remainders
  deterministically (cumulative proportional allocation, with the final
  allocation receiving the exact remainder) so partial fills reconcile exactly.
  The aggregate must be strictly positive after costs.
- An unknown basis or cost that affects any realized eligible portion, opening
  inventory consumed by a sale, or the completed-round-trip count makes
  qualification `UNKNOWN`; do not omit it to improve the result. Fees/costs
  must be independently supported; no missing cost is zero.
- Transfers are not buys or sells and realize no P&L. A transfer between token
  accounts with the same exact owner key moves the same lot unchanged. Units
  transferred to or from a different owner key are excluded from qualification;
  do not infer a shared wallet from a common payer or cluster. A sale of
  transferred-in units cannot complete a qualifying lot without its eligible
  acquisition basis. If a cross-owner transfer is sold and its basis or
  disposition cannot be reconciled, qualification is `UNKNOWN`, not a silent
  exclusion of that realized effect.
- At the 90-day opening boundary, represent any verified opening balance as
  inventory that does not count toward the 10 round trips. FIFO sales consume
  that older inventory before in-window lots; its realized portions still enter
  aggregate P&L when the exact basis and costs are known. Unknown opening
  inventory consumed by a sale makes the aggregate `UNKNOWN`. Never assume an
  absent initial position is zero. Missing opening balances, gaps in
  signatures/transactions, or uncertain transfer provenance make affected
  qualification `UNKNOWN`.
- Count a mint only once regardless of pools, quote pairs, or repeat trades.
  For this proposal, 5 unrelated mints means 5 distinct mint pubkeys, each with
  at least one counted completed round trip, its own successful initialization
  transaction and pool identity, and no positive evidence of a shared
  launch-control key, common verified project identity, or shared verified
  bundle. Unknown relationship evidence does not count as independent. This is
  an operational “no known direct relation” rule, not proof that different
  mint keys have unrelated human owners.
- Exclude the candidate mint entirely. Exclude lots from same-mint launches
  whose bundle status is proven; if bundle status is unknown for an otherwise
  relevant launch, do not count those lots. Do not infer “not bundled” from
  absent bundle data.

### Evidence and outcomes

Required records: exact wallet key (no address-cluster inference); full
`[T−90×24 hours, T)` finalized event coverage and opening balances; complete
signature/transaction binding; supported swap decoding; transfer classification;
FIFO lot ledger; exact historical prices, quote conversion and costs; mint
independence evidence; bundle disposition; and dated, independent, versioned
qualification review. Overlapping wallet entries are deduplicated by exact
public key and count once in the Analyst window.

- **PASS example:** one reviewed wallet has complete opening and event
  coverage, 12 completed FIFO buy lots across 6 distinct independently
  initialized mints, no transfer-derived lots, proven exclusion of the candidate
  mint and bundled-launch lots, all explicit costs and historical USD values,
  and positive aggregate realized net result after including partial-sale
  realizations. The dated list is effective at `T`. This meets the existing
  proposed criteria; it is not evidence that the wallet predicts returns.
- **NOT QUALIFIED example:** the wallet has +USD 10 net from completed lots but
  −USD 100 realized on an eligible partially closed lot. Aggregate realized
  result is −USD 90, so the positive-after-cost criterion fails even though
  the completed-round-trip count may pass.
- **UNKNOWN example:** the wallet has 10 apparent buy/sell cycles, but opening
  balances at `T−90d` are missing, transferred-in units cannot be costed, a
  cost or historical price is missing for realized eligible portions, a
  relevant mint's bundle status is unknown, or only 4 mints can be shown
  unrelated. Do not count transactions, assume zero opening inventory, omit
  partial-sale losses, or relax the existing thresholds.

**Failure:** insufficient qualifying lots/mints or nonpositive fully evidenced
net result over all eligible realized portions does not qualify the wallet.
Incomplete evidence, unknown basis that impacts the aggregate, ambiguous
accounting, missing costs, unknown mint relation, unavailable bundle proof, or
missing dated review returns `UNKNOWN`/unavailable, not a negative P&L
substitution. No allowlist entry means the current real `qualifiedSmartWallets`
component remains `SCORE_UNAVAILABLE`.

**Future code seam:** the existing offline
`evaluateWalletQualificationDiagnostics` in
`scripts/memecoin-paper/analyst-window-evidence.mjs`, followed by the existing
reviewed allowlist/window injection. Extend only after policy approval and
fixture review. Its current output is `UNVERIFIED` and never admits an
allowlist; do not treat diagnostic output as qualification.

## Current contract versus this proposal

| Topic | Current accepted/proposed contract | Decision proposal v1.1 |
|---|---|---|
| Pair age | 30 minutes–72 hours using pair creation, not mint age | No change |
| Developer holdings | At most 3%; “developer-associated” attribution is unresolved | Materially narrows attribution to reviewed launch-role addresses; unproven controlled addresses and their transferred balances escape the proxy; unchanged 3% does not preserve coverage; gate remains `UNKNOWN` unless owner accepts the limitation and evidence is complete |
| Prior rug | Credible evidence rejects; unknown history is not clean | Full coverage of the 90-day finite scope is required only for a negative result; any known credible attributable qualifying positive, including older evidence, rejects despite unrelated gaps |
| Bundled launch | At most 10%; bundle meaning/source unresolved | Anchor at selected supported pool initialize and first supported swap; inspect only inclusive 33-slot window; exact-signature bundle proof required; supply measure and trusted source remain separate owner decisions; same-slot clustering never passes |
| Qualified wallet | Proposed 90d / 10 round trips / 5 unrelated mints / positive after-cost result | Same criteria and Analyst thresholds; count completed lots separately from aggregate all eligible realized portions, including partial-sale losses; adds FIFO, transfer, opening-position, mint-independence, and bundle accounting |
| Analyst score | Existing six inputs, score threshold 70, no missing-component redistribution | No changes; unavailable evidence stays unavailable |
| Source trust | Hashes and caller receipts are not authentication | Explicit named RPC trust/completeness decision remains unresolved; proposal acceptance alone does not make diagnostics gate-eligible |

Repository evidence for the existing boundaries and implementation seams:

- `docs/strategy-lab/memecoin-paper/README.md` — pair-age and unchanged
  hard-gate thresholds; unknown blocks; no token-age substitution
  (lines 46–75).
- `docs/strategy-lab/memecoin-paper/score-spec.md` — proposed score and exact
  wallet criteria; no configured allowlist (lines 26–42).
- `docs/strategy-lab/memecoin-paper/ANALYST_WINDOW_EVIDENCE.md` — injected
  source contract, current wallet timing decision, and unauthenticated receipt
  digests (lines 47–86, 175–201).
- `docs/strategy-lab/memecoin-paper/LAUNCH_HISTORY_EVIDENCE.md` — initial
  authority is not a developer roster; same-slot is not bundle proof; price
  movement does not infer rug intent (lines 89–113, 122–159).
- `docs/strategy-lab/memecoin-paper/SOURCE_READINESS_MANIFEST.md` and
  `EVIDENCE_SOURCES.md` — missing attribution, complete history, bundle,
  source-trust, and wallet evidence (`SOURCE_READINESS_MANIFEST.md` lines
  19–31, 92–129; `EVIDENCE_SOURCES.md` lines 61–68, 79–96).
- `docs/strategy-lab/memecoin-paper/PAPER_FIRST_EVIDENCE_CONTRACT.md` —
  offline assertions do not establish readiness or authority (lines 16–22).
- Issues [#996](https://github.com/Achi1984/meridian/issues/996),
  [#1163](https://github.com/Achi1984/meridian/issues/1163), [#1251](https://github.com/Achi1984/meridian/issues/1251),
  and [#1252](https://github.com/Achi1984/meridian/pull/1252) — unchanged
  strategy gates; same-slot capture limits; source and policy blockers.

## Official capability references

These URLs identify method/source documentation, not a selected or trusted
provider, a completeness guarantee, present access/entitlement, or a factual
claim that a live source was queried. Repository docs note that provider pages
were not reachable during prior sandbox review; no endpoint was probed for this
proposal.

- Solana RPC [`getProgramAccounts`](https://solana.com/docs/rpc/http/getprogramaccounts),
  [`getAccountInfo`](https://solana.com/docs/rpc/http/getaccountinfo), and
  [`getTokenSupply`](https://solana.com/docs/rpc/http/gettokensupply) for
  program-account, context-slot, account, and supply response semantics.
- Solana RPC [`getSignaturesForAddress`](https://solana.com/docs/rpc/http/getsignaturesforaddress),
  [`getTransaction`](https://solana.com/docs/rpc/http/gettransaction), and
  [`getBlockTime`](https://solana.com/docs/rpc/http/getblocktime)
  for address-scoped history, transaction retrieval, and slot-time estimates;
  these method docs do not establish archival completeness or an attributable
  rug.
- Solana [Create a Mint](https://solana.com/docs/tokens/basics/create-mint)
  and [SPL Token Program](https://spl.solana.com/token) for mint initialization
  and authority instruction semantics.
- The pinned [Raydium CPMM initializer](https://github.com/raydium-io/raydium-cp-swap/blob/3d69122790e97cd6aff24e8ba95940793773f58c/programs/cp-swap/src/instructions/initialize.rs)
  documents the supported pool initialization instruction/layout; the current
  repository pool-state decoder does not decode its historical transaction.
- Jito [Low Latency Transaction Send](https://docs.jito.wtf/lowlatencytxnsend/)
  for Jito's documented bundle submission/identifier context. A Solana slot or
  RPC transaction history is not a bundle-membership receipt.

## Exact owner decision text for lead review

If lead review accepts this proposal, the following is the recommended owner
decision to request. It makes the developer-proxy narrowing explicit and adopts
definitions only; it does not resolve source-trust or bundle-measurement
blockers and is not permission to activate acquisition or a Paper run:

> “I approve Evidence Policy Decision Proposal v1.1 for implementation and
> review only, subject to these limits: pair age remains 30 minutes–72 hours
> from pair creation; all existing hard-gate and Analyst thresholds remain
> unchanged. I understand and accept that the launch-role holdings measure is
> materially narrower than all developer-associated holdings: it can miss
> other addresses under the same human controller, and balances transferred
> to an address outside the proven role set are not counted. The unchanged 3%
> limit does not preserve the prior intended breadth of protection; this
> definition is only a limited proxy, not a complete developer roster. A
> negative prior-rug result requires complete coverage only for the preceding
> 90×24-hour UTC interval
> and finite reviewed address/project scope, and means only
> `NO_QUALIFYING_EVENT_IN_COMPLETE_90D_SCOPE`; known credible attributable
> qualifying positive evidence, including evidence older than 90 days, remains
> REJECT even if unrelated history is incomplete. A price collapse, shared
> funder, or same-slot activity is not proof of a rug, common control, or bundle.
> Bundle membership requires independently trusted exact-signature evidence
> within the selected supported pool's verified initialize-to-first-swap
> 33-slot window. This statement does not approve or select a bundle source or
> numerator/denominator; the bundled-launch supply gate remains UNKNOWN.
> Qualified wallets retain the existing 90-day, 10 completed round-trip,
> 5 unrelated-mint, positive-after-cost criteria; completed round-trip count
> is separate from aggregate P&L, which includes all eligible realized portions
> and costs, including partial-sale losses. FIFO, transfer, opening-position,
> mint-independence, candidate-mint, and bundle exclusions remain as specified.
> This statement does not name or approve an RPC source or its trust/
> completeness basis; same-slot diagnostics remain ineligible as gate evidence
> until that separate decision is made. Nothing in this decision approves a
> provider request, credential, paid service, live acquisition, run,
> activation, or readiness claim; missing or unsupported evidence continues
> to block.”

No owner decision has been made by publishing this proposal. Until separately
decided and implemented, all current code behavior and `UNKNOWN` dispositions
remain unchanged.
