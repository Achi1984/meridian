# Live Paper evidence policy — decision proposal v1.1

**Status: REVIEW REVISION v1.1 — PROPOSAL FOR LEAD REVIEW — NOT ADOPTED.**
This corrects the v1.0 draft in response to review; it recommends definitions
for four unresolved evidence families. It changes no code, accepted gate, score
threshold, source configuration, or operating authority. It is not an
activation request. Lead review must precede asking the owner to decide.

> **Not a launch-unblock:** even approval of these definitions would leave the
> named RPC source/trust and complete-enumeration basis undecided, and would
> leave bundle-source trust and the bundled-supply numerator/denominator
> undecided. The narrow launch-role holdings proxy materially narrows the
> developer-holdings protection; unchanged numeric thresholds do not preserve
> the same coverage. These are separate blockers to evidence eligibility.

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
  holdings gate remains `UNKNOWN`. This exact-address proxy can miss holdings
  transferred to another controlled but unproven address; it is materially
  narrower protection, not equivalent coverage under the unchanged 3% limit.
- Use a 90×24-hour UTC window only for a bounded negative prior-rug screen.
  Credible, attributable qualifying positive evidence from any known prior
  period must reject even if unrelated history is incomplete or the event is
  older than 90 days. A negative result means only “no qualifying event in the
  completely screened scope,” never “never rugged.”
- Anchor launch-bundle review at the successful finalized initialization of
  the exact selected supported pool, not mint initialization. Inspect the
  inclusive range from that slot through the next 32 slots (33 total), and
  establish the first supported candidate-token swap from the pool in that
  window. Require complete transaction coverage and source-verified,
  exact-signature bundle membership. The existing bundle-supply gate stays
  `UNKNOWN` until membership coverage, bundle-source trust, and an owner-approved
  supply numerator/denominator are available. Same-slot clustering is not a
  fallback.
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
narrowing of the existing “developer-associated holdings” protection: a
launch-role holder could transfer tokens to another address it controls that
is not directly evidenced as a launch role, and that balance would escape this
proxy. The unchanged 3% threshold therefore does **not** mean unchanged
protection or complete attribution. The owner must explicitly accept this
residual risk before the proxy can be used; otherwise this gate remains
`UNKNOWN`.

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

For a **negative** screen, inspect each address in the accepted finite
launch-role set over `[T − 90×24 hours, T)`, inclusive at the start and
exclusive at `T`, using UTC epoch time. Screen only supported token/pool models
and projects directly attributable to those addresses. Use finalized
transactions and source event times; the actual acquisition interval is
recorded separately. The existing launch-history limits (10 declared subjects,
20 pages per subject, 2,000 signatures and 1,000 transactions per invocation)
remain hard bounds; do not raise them to force a negative finding. If a limit
prevents interval closure, the negative result is `UNKNOWN`.

A bounded screen does not cap the age of a **positive** finding. Credible,
attributable qualifying rug evidence from any known prior period before `T`,
including evidence older than 90 days, must be evaluated and must `REJECT` when
the event meets the qualifying rule. Do not discard a known qualifying older
event because it is outside the negative-screen window. Positive evaluation
needs complete, trusted evidence for the qualifying event and its attribution,
but does not require complete coverage of unrelated addresses or the entire
historical interval.

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

The reducer returns `REJECT` as soon as credible, source-trusted, attributable,
independently reviewed evidence establishes a qualifying prior event. This
positive result is valid even when unrelated history is incomplete; the
records supporting the event itself must be complete enough to substantiate
the finding. A positive event in the 90-day scan also rejects even if another
subject or interval segment is incomplete.

It may return a negative result only as
`NO_QUALIFYING_EVENT_IN_COMPLETE_90D_SCOPE` when every declared subject and the
complete 90-day interval have accepted source coverage and no qualifying event
is present. That result says nothing about events older than 90 days unless
separately known, other addresses/projects, unobserved chains, or universal
absence of rugs. If the source cannot establish complete history for this
finite negative query, the result is `UNKNOWN`. Current RPC cursor exhaustion
alone does not establish archival completeness.

### Evidence and outcomes

For a positive finding, require the versioned attribution record, prior
mint/pool identity, successful raw transactions and source evidence sufficient
to establish the qualifying event, event-time/slot mapping, relevant pool
state/outcome evidence, and an independent reviewer disposition bound to those
records. A complete scan of unrelated history is not required for this
positive. For a negative result, additionally require complete source coverage
of every declared subject over the entire 90-day interval, including
archival/truncation status and time-boundary evidence.

- **Negative example:** a reviewed role set contains one key; the approved source
  attests complete, finalized coverage for its entire prior 90-day history;
  all supported prior projects and relevant pool events are reconciled; there
  is no independently reviewed qualifying event. Result:
  `NO_QUALIFYING_EVENT_IN_COMPLETE_90D_SCOPE`, not “no rugs ever.”
- **REJECT example despite incomplete unrelated history:** complete trusted
  transaction and outcome records establish a qualifying, independently
  reviewed rug event attributable to one launch-role address from 18 months
  before `T`; a different address has truncated recent history. Reject on the
  proven older positive event. Do not require the unrelated address's history
  to be complete and do not discard the older finding due to the 90-day
  negative-screen window.
- **UNKNOWN example:** `getSignaturesForAddress` reaches its finite cursor/page
  bound before the 90-day start, an older transaction cannot be retrieved, or
  the source only has non-archival coverage, and there is no separate credible
  positive event record. Empty returned rows or a price-collapse chart cannot
  turn this into a negative pass.

**Failure:** any missing/truncated coverage, timestamp, transaction, or
attribution prevents the **negative** result and returns `UNKNOWN` unless
separately credible qualifying positive evidence already supports `REJECT`.
Missing outcome evidence or unreviewed event classification cannot establish a
positive rug. Disagreement over intent remains `UNKNOWN`; do not infer intent
from a price series.

**Future code seam:** extend the isolated launch-history classifier with a
versioned, receipt-bound prior-event reducer. Preserve raw positive observations
separately from reviewer disposition. Do not map the existing
`INITIAL_MINT_AUTHORITY_SET` fact to a rug finding.

## 3. Launch-bundle evidence

### Proposed finite meaning and unresolved metric

The launch anchor is the first successful finalized initialization transaction
for the **exact selected supported Raydium CPMM pool**, confirmed by decoding
the transaction and binding its pool address and token mints to the selected
pool record and decoded pool/vault/LP-mint state. Mint initialization is not
the pool-launch anchor. The finite transaction window is the anchor slot
`S` through `S + 32`, inclusive (33 slots total); include only successful
transactions that interact with that exact pool and involve the candidate
mint. Require complete finalized transaction coverage for the whole window,
including pool initialization and all swaps, and identify the first successful
supported candidate-token swap from that pool in the window. This first swap
establishes that the selected pool actually traded within the proposed launch
window; if none occurs, or if its ordering cannot be established from complete
coverage, the bundle finding is `UNKNOWN`, not an empty bundle result. This
slot window defines launch-bundle review only; it does not replace the existing
pair-age gate, which remains 30 minutes–72 hours from pair creation.

A bundle is proven only when an independently trusted bundle source returns a
bundle identifier/status that binds the exact successful member signatures
and their landed status. For a relevant pool swap, classify it as bundled only
if that exact signature is present in the trusted membership record. The
source must cover the entire finite window and report enough membership
coverage to distinguish “no member in this window” from “no response or
unsupported lookup.” Same-slot transactions, temporal clustering, common
funders, and top-holder overlap are not bundle membership. If the source cannot
provide faithful membership and coverage for this historical window, bundle
classification remains `UNKNOWN`; do not rename clusters as bundles.

The pool anchor still applies when the mint was created before the selected
pool: identify the later pool initialization and start the 33-slot window
there. If the mint predates the pool but only mint-creation time/slot or a
generic pair creation timestamp is available, with no decoded supported-pool
initialization record, the anchor and bundle scope are `UNKNOWN`.

Proof of membership still does not determine “bundled-launch supply.” A
candidate-pool transaction's gross token output is not necessarily distinct
supply, retained ownership, or a non-duplicated bundle allocation. To preserve
the existing hard gate without inventing a misleading denominator, keep the
percentage and its 10% limit unchanged but leave the gate `UNKNOWN` until the
owner separately accepts a numerator/denominator rule and complete source
coverage. Recommended future numerator for decision is the raw candidate-token
balance, at the end of `anchorSlot + 32`, of unique owners that received
candidate tokens in a verified bundle-member launch swap; denominator is
mint supply at the same end slot. This requires complete token-account
ownership and balance/transfer reconstruction through that slot, including
deduplication and exact slot provenance. It is a proposed
bundle-associated-holder measure, not an already accepted definition of
“bundled supply,” and must not be implemented without owner approval. It may
include unrelated holdings of a bundle recipient at the end slot, so it is a
conservative owner-exposure proxy, not a tracing claim that each counted unit
originated in the bundle.

### Evidence and outcomes

Required records: the decoded exact-pool initialization transaction/signature
and anchor slot; selected-pool/mint identity; all successful pool-interacting
transactions through `anchorSlot + 32` and complete finalized slot coverage;
a trusted bundle response binding bundle ID/status and landed state to exact
member signatures across the full window; decoded token flows; token-account
owner/balance changes and supply through the same end slot; the proposed
independent owner aggregation; and an owner-approved versioned
numerator/denominator policy.

- **PASS example (conditional on the outstanding decisions):** a decoded
  supported pool initialization establishes anchor slot `S` for the exact
  selected pool. Complete records cover `S…S+32` and establish the first
  successful supported swap at `S+1`; a trusted bundle response binds specific
  successful pool-swap signatures in that window to a bundle ID and landed
  status; complete end-slot owner/supply records support the separately
  approved measure, which is 8%. Only then could the unchanged 10% gate pass.
- **UNKNOWN counterexample:** the mint was initialized well before a later
  supported pool was created, and the evidence contains only mint
  initialization plus same-slot swaps. Without the later pool's decoded
  initialization transaction and exact pool binding, do not use mint
  initialization as the anchor; bundle scope is `UNKNOWN`.
- **UNKNOWN example:** several unrelated buys share a slot with pool
  initialization, but no trusted response binds their signatures to a bundle
  ID. Record the transactions as same-slot purchases only; bundle membership
  and bundled supply remain `UNKNOWN`.
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
complete opening positions at the 90-day boundary and event-window closing
positions; candidate-mint identity; and verified bundle facts. All amounts
use exact integer base units and exact monetary units. No nearest-price, peg,
or missing-cost substitution.

Use FIFO lots separately for each exact wallet-owner key and mint:

- Each successful swap buy within the 90-day interval creates a lot keyed by
  signature and acquired base units. Its cost basis is exact historical USD
  value plus explicit acquisition costs.
- Successful swap sells consume eligible lots FIFO. Lots determine basis and
  realized portions; they are not themselves round-trip counts. A completed
  round trip is one zero-to-zero wallet/mint swap-inventory cycle wholly within
  the interval: eligible inventory starts at zero, is acquired through
  successful swaps, then all of that cycle's units are closed through successful
  swaps. Multiple buy lots or sell transactions in that cycle still count as
  one round trip. A cycle starting from an opening balance or ending with a
  remainder does not count. After opening inventory reaches zero, a later
  in-window acquisition may start a countable cycle.
- Count completed round trips independently from the performance calculation.
  At least 10 completed zero-to-zero cycles are required; a partially closed
  cycle does not count toward 10 until its entire eligible inventory is closed
  within the interval.
- Aggregate **all eligible realized portions** for the wallet during the
  interval, not just completed lots: matched proceeds less basis and all
  explicit costs for every supported in-window partial or full sale across the
  entire eligible mint set, plus any in-window realization of opening
  inventory whose acquisition basis is independently established. Do not
  restrict the P&L calculation to the 5 mints that count toward independence.
  Opening inventory does not count toward the completed-round-trip threshold
  unless its cycle starts and closes within the interval. Losses from partially
  closed cycles reduce the aggregate even though those cycles do not count
  toward 10. For each integer cost attached to a trade and mint, allocate cost
  to partial quantities by cumulative proportional allocation:
  `floor(totalCost × cumulativeRawUnits / totalRawUnits) − previouslyAllocated`;
  the final quantity receives the exact remainder. Apply this separately to
  buy- and sell-side costs using the relevant acquired or disposed raw units.
  This makes every allocation deterministic and sums exactly to the source
  cost. Costs must be independently supported; no missing cost is zero. The
  aggregate of all eligible realized portions must be strictly positive.
- Transfers are not buys or sells and realize no P&L. A transfer between token
  accounts with the same exact owner key moves the same lot unchanged. Units
  transferred to or from a different owner key are excluded from qualification;
  do not infer a shared wallet from a common payer or cluster. A sale of
  transferred-in units cannot complete a qualifying lot without its eligible
  acquisition basis. If a cross-owner transfer is sold and its basis or
  disposition cannot be reconciled, qualification is `UNKNOWN`, not a silent
  exclusion of that realized effect.
- At the 90-day opening boundary, represent any verified opening balance as
  inventory whose acquisition basis and event provenance must be resolved to
  include any later realized portion. FIFO sales consume that older inventory
  before in-window lots. Never assume an absent initial position is zero or
  omit a realized result because its basis is unknown. An unknown basis or
  bundle disposition that can affect the aggregate or cycle count, missing
  opening positions, gaps in signatures/transactions, or uncertain transfer
  provenance makes qualification `UNKNOWN`.
- Count a mint only once regardless of pools, quote pairs, or repeat trades.
  The existing 5-mint criterion means eligible, verified swap activity across
  at least 5 distinct mint pubkeys, each bound to its own successful
  initialization transaction and pool identity, with no positive evidence of
  a shared launch-control key, common verified project identity, or shared
  verified bundle. The 10 completed cycles are counted independently; they
  need not be evenly distributed across those mints. Unknown relationship
  evidence does not count as independent. This is an operational “no known
  direct relation” rule, not proof that different mint keys have unrelated
  human owners.
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
  coverage, 12 completed zero-to-zero cycles across 6 distinct independently
  initialized mints, plus all eligible partial realized portions, no
  transfer-derived cycles, proven exclusion of the candidate mint and
  bundled-launch lots, all explicit costs and historical USD values, and
  positive aggregate realized net result. The dated list is effective at `T`.
  This meets the existing proposed criteria; it is not evidence that the wallet
  predicts returns.
- **Not qualified example:** the wallet has 10 completed round trips with
  aggregate net gain of USD 10, but a separately eligible partial lot has a
  realized net loss of USD 100. The total eligible realized result is USD −90,
  so it does not meet the positive-result criterion.
- **UNKNOWN example:** the wallet has 10 apparent buy/sell cycles, but opening
  balances at `T−90d` are missing, transferred-in units cannot be costed, a
  cost or historical price is missing, an unknown basis can affect the
  aggregate, a relevant mint's bundle status is unknown, or only 4 mints can
  be shown unrelated. Do not count transactions, assume zero opening
  inventory, omit realized partial results, or relax the existing thresholds.

**Failure:** fewer than 10 qualifying completed round trips, fewer than 5
unrelated mints, or a fully evidenced aggregate realized result that is not
positive means the wallet does not qualify. Incomplete evidence, ambiguous
accounting, missing costs, any unknown basis that could affect the aggregate,
unknown mint relation, unavailable bundle proof, or missing dated review
returns `UNKNOWN`/unavailable, not a negative P&L substitution. No allowlist
entry means the current real `qualifiedSmartWallets` component remains
`SCORE_UNAVAILABLE`.

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
| Developer holdings | At most 3%; “developer-associated” attribution is unresolved | Narrow launch-role proxy materially reduces address coverage; transfers to other controlled but unproven keys can escape. Owner must accept residual risk; otherwise `UNKNOWN` |
| Prior rug | Credible evidence rejects; unknown history is not clean | Any credible attributable positive event may reject, including older evidence and incomplete unrelated history; only a negative result requires complete 90-day scope |
| Bundled launch | At most 10%; bundle meaning/source unresolved | Exact selected-pool initialization anchor and `S…S+32` window proposed; exact-signature bundle proof required; trust and percentage measurement remain unresolved |
| Qualified wallet | Proposed 90d / 10 round trips / 5 unrelated mints / positive after-cost result | Same thresholds; 10 closed zero-to-zero cycles counted separately from aggregate all eligible realized portions, including partial-cycle results |
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
  19–31, 92–129; `EVIDENCE_SOURCES.md` lines 61–68, 79–96, 110–115).
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
- Raydium CPMM
  [`initialize.rs` at the pinned revision](https://github.com/raydium-io/raydium-cp-swap/blob/3d69122790e97cd6aff24e8ba95940793773f58c/programs/cp-swap/src/instructions/initialize.rs)
  for supported pool initialization fields and account bindings. The proposed
  anchor still requires future transaction decoding and exact selected-pool
  binding; this proposal does not claim that existing collection captures it.
- Jito [Low Latency Transaction Send](https://docs.jito.wtf/lowlatencytxnsend/)
  for Jito's documented bundle submission/identifier context. This proposal has
  no selected retrospective membership endpoint or validated coverage
  guarantee. A Solana slot or RPC transaction history is not a
  bundle-membership receipt.

## Exact owner decision text for lead review

If lead review accepts this proposal, the following is the recommended owner
decision to request. It approves definitions for implementation/review only;
it does not make any source trusted, clear an evidence gate, or permit
acquisition or a Paper run:

> “I approve Evidence Policy Decision Proposal v1.1 for implementation and
> review only, subject to these limits: pair age remains 30 minutes–72 hours
> from pair creation; all existing hard-gate and Analyst thresholds remain
> unchanged. I accept the launch-role address measure solely as a materially
> narrower developer-holdings proxy: balances transferred to another
> controlled but unproven address may escape the 3% measure. This is not
> equivalent protection or a complete developer roster. The gate remains
> UNKNOWN until this limited scope and all required source evidence are
> separately reviewed. Prior-rug review uses the preceding 90×24-hour UTC
> interval only for a bounded negative screen. Credible attributable qualifying
> positive evidence from any known prior period must reject even if unrelated
> history is incomplete; a negative result means only
> `NO_QUALIFYING_EVENT_IN_COMPLETE_90D_SCOPE`. A price collapse, shared funder,
> or same-slot activity is not proof of a rug, common control, or bundle. Bundle
> review uses the first proven initialization of the exact selected supported
> pool, establishes the first supported swap in slots S through S+32 inclusive,
> and requires complete coverage. Bundle membership requires trusted
> exact-signature evidence; bundled-supply measurement remains UNKNOWN until
> I separately approve its numerator and denominator. Qualified wallets retain
> the existing 90-day, 10 completed round-trip, 5 unrelated-mint,
> positive-after-cost criteria, with all eligible realized portions included
> independently of completed-trip counting. This proposal does not approve any
> RPC or bundle source. Before diagnostics can be gate-eligible, I will make a
> separate source-specific trust decision naming the endpoint/operator and
> evidence for identity, finalized responses, and complete account
> enumeration; I will separately resolve bundle-source trust and supply
> measurement. Until those decisions and complete evidence exist, every
> dependent gate remains UNKNOWN. Nothing in this decision approves a provider
> request, credential, paid service, live acquisition, run, activation, or
> readiness claim.”

No owner decision has been made by publishing this proposal. Until separately
decided and implemented, all current code behavior and `UNKNOWN` dispositions
remain unchanged.
