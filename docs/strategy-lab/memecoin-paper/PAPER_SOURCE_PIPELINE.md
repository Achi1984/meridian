# Bounded paper source pipeline

This is a disabled, read-only acquisition and canonical-evaluation seam. It does
not activate the one-shot manifest, call a provider without injected transport,
hold credentials, create production quotes, estimate costs, authorize execution,
or modify the external composition. `createTimeBoundarySource()` and
`createPaperSourcePipeline()` default to disabled.

## Time-boundary acquisition

An enabled time-boundary source requires an explicit inclusive `slotRange`,
injected transport and clock, and bounded limits. It uses the existing
`createBoundedHistoryRpcReader()` request/response path in
`launch-history-source.mjs`, including its fixed Solana RPC origin, redirect
rejection, omitted credentials, streamed response-byte caps, cancellation,
request timeout, and monotonic deadline. The only methods admitted by this
reader are:

1. `getSlot({commitment:"finalized"})`, which must anchor the full configured
   slot range;
2. `getBlocks(startSlot, endSlot, {commitment:"finalized"})`, which enumerates
   produced slots for that exact range; and
3. `getBlockTime(slot)` once for every enumerated produced slot.

`getBlocks` omissions are recorded as skipped-slot ranges. A missing, malformed,
unavailable, or regressing produced-slot timestamp makes the boundary result
`UNKNOWN`; it is never filled by interpolation. The source selects actual
before/after observations for the exclusive start and inclusive end and rejects
a slot range that does not straddle both fences. Four endpoint queries alone
are not treated as global coverage or monotonicity evidence.

Each successful RPC event records its fixed origin, method and parameters,
request/receipt times from the injected clock, consumed response bytes, and the
SHA-256 of the exact response bytes. The canonical `timestampEvidenceDigest()`
binds the time-boundary fields accepted by the history-window bridge. Its event
array contains the `getBlockTime` responses; the `getSlot` and `getBlocks`
responses, full produced-slot enumeration, skipped ranges, and auxiliary request
and byte counts are included in the digest-bound coverage object. Work units
include the full slot-range scan. Before bridge construction, the pipeline
reserves two bounded auxiliary requests and their maximum response bytes from
the configured request/byte budgets, so the accepted bridge's existing
timestamp-event counters plus collector limits remain within the original run
budget. Time and slot response timestamps remain provider claims:
`sourceAuthentication` and archival completeness are `NOT_ESTABLISHED`.

The default per-window caps are 2,100 requests, 10 MiB cumulative response
bytes, 1 MiB per response, 5,000 work units, 15 seconds elapsed, and a 5-second
request timeout; the produced-slot range is capped at 2,500 slots. A source may
narrow these limits; raising them is bounded by the current launch-history hard
ceilings. The caller must pass the run's remaining global budget when the module
is integrated into a multi-candidate run; no composition budget or
cross-candidate state is changed here.

The collector's read-method addition is intentionally narrow: the bounded
reader admits `getBlocks` and `getBlockTime` for the new boundary source; `getSlot`
was already part of the launch-history collector. No other RPC method, endpoint,
provider, run-manifest entry, credential, or provider activation is added.

## Canonical handoff and trust boundary

`createPaperSourcePipeline()` composes the checked-in
`acquireLaunchHistory()` → `createHistoryWindowSource()` →
`buildAnalystWindowEvidence()` → `evaluateWithCanonicalMarketAdapter()` path,
using the repository's `adaptMarketEvidence()`. It retains the provider
candidate's `sampledAt` as candidate T, captures actual injected-clock assembly
and decision times separately after bounded history acquisition, passes
`holdUntil`, and returns the canonical candidate with Analyst and source audit
receipts. Before assembly, a non-authoritative Analyst source-prefetch pass
invokes the actual price and census sources after obtaining history; their
results are cached by exact identity and request window. That pass returns no
Analyst packet and its temporary cutoff is never used for evaluation. The normal
builder then validates the same cached responses against the actual assembly
time, without repeating source reads or changing the candidate cutoff or
causality rules. History, price, census, and audit caches are evaluation-local,
so a callback that completes after its bounded wait cannot write into a later
evaluation. Concurrent evaluations on one pipeline instance are rejected. It
adds no candidate normalizer, ledger, quote, or execution schema.

Only the synthetic test mode can inject a collector fixture. The external mode
rejects fixture-labelled candidate/evidence and cannot inject a collector
fixture. The checked-in `acquireLaunchHistory()` still reports
`UNKNOWN_ARCHIVAL_OR_INDEX_TRUNCATION`, even after finite signature paging and
successful transaction retrieval; this source refuses to promote that result to
complete coverage. Thus fixture-trusted positive coverage is a test of the
handoff contract, not production readiness. An unavailable quote or any missing
cost remains no-entry.

The existing `EXTERNAL_READ_ONLY_INPUT` composition is unchanged: it continues
to normalize caller candidates as unverified, rejects caller adapters and clocks,
and supplies `null` entry and exit quotes. This work is not wired into that
composition. Before a future owner-approved integration, the module-owned
default-disabled path already binds the exact module-owned policy digest in its
manifest and start receipt. That binding is not approval: the providers remain
unapproved, the runtime host clock remains unattested, and the source pipeline
does not authorize an entry. Integration still requires an owner-approved source
policy, a reviewed time contract, accepted evidence sources, and the actual
source-bound quote and complete cost interfaces.

**Production runtime source integration: `BLOCKED_NOT_IMPLEMENTED`.** The
`createPaperRuntimeSourceAdapter()` production path still returns no candidates
with `SOURCE_POLICY_UNAPPROVED`, keeps the pipeline and quote adapter disabled,
and does not access the network. The existing provider adapters do not define an
approved candidate-intake/mint-pool allowlist or source-authentication/time
contract; the warmup handoff only stores UNKNOWN-trust evidence. The existing
quote adapter cannot supply an approved causal quote with all five source-bound,
nonoverlapping USD costs. These missing interfaces and owner decisions cannot be
implemented by adding caller-injected REVIEWED/approved booleans. The exact
requirements and decisions are itemized below.

The adapter also has an explicitly selected `SYNTHETIC_TEST_ONLY` composition
used by the offline runner tests. That path uses only the checked-in synthetic
transport/data, evaluates through the existing pipeline, and passes its
fixture-labelled candidate and quote through the existing simulated ledger. It
proves plumbing only; its output remains `SYNTHETIC_FIXTURE_ONLY`, does not
change the production constructor or policy, and grants no production trust or
entry authority.

## Source-orchestration partial checkpoint

For `meridian-source-orchestration-20261103-r1`, the verified starting
revision was `c24c339b763f48f64c2b018f2e12bb38d24efcf8`, with a clean
worktree. PR #1208 was merged at that revision. PR #1210 was open and owned the
host batch, its recovery tests, and the shared live checkpoint; none of those
files is changed here. The separately diagnosed baseline Safety failure remains
a historical failure, not a passed check or a repair by this packet.

The intended transition is **PENDING** exact-head hosted CI and independent
final review, not production admission. This bounded checkpoint does not change
routing, authority, last-seen state, or the shared live checkpoint. Issue #1207
remains open; no merge or production activation is implied.

This packet is **partial**, not the requested production orchestration. The
offline integration test joins the existing generated Birdeye response,
immutable UNKNOWN-trust warmup publication/readback and readers, canonical
synthetic-mode pipeline, generated candidate-bound Jupiter response, and
existing ledger. The ledger rejects the resulting blocked evaluation; the
actual quote adapter exposes neither an executable USD price nor known costs.
The history collector in that test is explicitly synthetic, not evidence of an
archive guarantee. The existing separate positive synthetic control and its
fixture-only one-cent cost schedule grant no real-data authority.

The pipeline now checks cancellation after history, source prefetch, Analyst
assembly, and canonical evaluation before returning a result. An uncooperative
price or census callback can still delay settlement until that callback returns;
this is not an end-to-end deadline implementation.

Remaining implementation blockers include a single enforceable cumulative
request/response-byte/work/deadline budget spanning provider acquisition,
warmup storage/readback, history and census/price readers, and entry/exit
quotes, including cancellation and late-result fencing across candidate runs.
The existing components have separate budgets and no approved common accounting
interface. A production composition also needs a module-owned authenticated
candidate/transport/time/policy boundary, complete archive and comparable
census guarantees, wallet/developer/rug/bundle/LP sources, and immutable
quote-response provenance. Quote-token/base-token ratios are not USD prices;
all five USD cost components remain UNKNOWN without source-bound conversions,
payer/settlement evidence, and a proven nonoverlapping gross/net basis.
Caller `REVIEWED`, approval flags, and finite pagination cannot supply these
guarantees. The runtime adapter remains disabled with `trustedUtc` unchanged.

## Accepted interface dependency

The accepted history-window bridge from PR #1182 is present at the merged
`main` baseline (`dc04ab0aa800839e0b33120054d424c8bb4211f6`). The pipeline imports
that canonical `createHistoryWindowSource()` and its
`timestampEvidenceDigest()` contract; the timestamp module contains no second
bridge implementation. The current collector's archival result remains
`UNKNOWN`; successful integration through the bridge does not establish a
separately defensible global completeness policy.

## Remaining source and provider policy facts

- `scripts/memecoin-paper/run-manifest.json` remains disabled, with its stop
  switch engaged and empty mint/pool allowlists. No provider was called and no
  credential or paid entitlement was provisioned.
- The manifest's disabled Solana provider list does not include `getBlocks` or
  `getBlockTime`. The code-level allowlist above is limited to this disabled
  module seam; it does not amend or activate the run manifest.
- The checked-in Solana history collector explicitly reports archival/index
  truncation as `UNKNOWN`. RPC pagination exhaustion, empty pages, four time
  witnesses, or complete enumeration within a caller-bounded slot range do not
  establish global address-history completeness or provider authenticity.
- DexScreener's checked-in adapter supports current pair snapshots, not the
  required exact historical USD endpoints. A historical price/feed source,
  timestamp and staleness policy, quote-asset USD conversion, entitlement, and
  any key/paid-access policy remain unselected and unverified.
- The owner census is not a complete, authenticated owner enumeration with
  reviewed pool/burn exclusions. Developer attribution, complete prior-rug
  scope, bundle membership, and a reviewed qualified-wallet source/list remain
  unavailable or unapproved.
- No accepted source-bound quote and complete five-component cost estimate is
  supplied by this pipeline. Missing quote or cost must continue to produce no
  entry.

## Current #996 integration and evidence matrix

This matrix describes the unchanged #996 hard filters and all six Analyst inputs.
Existing parsers and evaluators are code support, not evidence that a provider
returned authentic, complete, or entitled data. `EXTERNAL_READ_ONLY_INPUT`
review evidence is deliberately ignored: caller-supplied `REVIEWED` labels cannot
bridge Analyst inputs. The source-shaped and acquired-evidence path is exercised
only in `SYNTHETIC_TEST_ONLY`; it proves wiring only and sets neither runtime
authority flag. Production integration remains `BLOCKED_NOT_IMPLEMENTED`; no
real-data policy is enabled by this document.

For evidence rows, the common receipt policy is exact
`{chainId, mint, pool, quote}` binding, source/version and digest-bound response
receipts, a source observation no later than candidate T, receipt no earlier than
the observation, and no future/stale evidence. Hard-filter evidence must be
complete, verified at the module-owned composition boundary, and at most five
minutes old at decision time; on-chain items also bind finalized slot/account
context. Analyst rows must additionally bind their exact 15-minute or
`(T-1h, T]` window and comparable endpoints. No caller assertion or pagination
exhaustion can satisfy these requirements.

| #996 gate or metric | Existing implementation | Required source and guarantee | Receipt identity/time policy | Missing external data vs. missing code | Minimum concrete decision |
|---|---|---|---|---|---|
| Candidate identity / selected pool and quote | `stages.mjs` identity filter; Scout deterministically selects one pool/quote per mint. Discovery is explicitly non-exhaustive. | Reviewed candidate intake bound to the exact Solana mint, selected pool, and quote; snapshot is not a new-pair feed. | Bind all four identity fields and candidate T; reject any source or evidence identity mismatch. | Intake contract and trusted source provenance are not approved; identity validation code exists. | Approve a bounded intake contract and mint/pool allowlist; do not infer exhaustive discovery. |
| Pair age, 30 minutes–72 hours | `provider-sources` parses DexScreener pair snapshots; `market-evidence-adapter` and `stages.mjs` enforce the pair-created-time range. | Selected-pair creation time from a fixed, reviewed provider response; must be pair age, not token age. | Same-pair receipt, source time no later than T, fresh at decision, and exact candidate identity. | Parser/filter exist; authenticated source-time semantics and live receipt are unavailable. | Approve the pair timestamp semantics, source, and freshness policy. |
| Actual USD market cap, $300,000–$20,000,000 | DexScreener adapter parses `marketCap`; filter rejects missing value and does not substitute FDV. | Actual market cap for the selected pair/mint in USD; no FDV fallback or assumed quote parity. | Bind mint/pool/quote, denomination USD, source timestamp and response digest; observation no later than T. | Parsing and range gate exist; accepted source authenticity and USD valuation guarantee are unavailable. | Select and approve the market-cap field and USD methodology. |
| Liquidity, at least $40,000 | DexScreener snapshot field and canonical filter exist. | Selected-pool USD liquidity; a snapshot is not proof of executable depth. | Same pair and USD basis as market cap, identity-bound and fresh at T. | Snapshot parser/filter exist; trusted USD conversion and executable depth are not provided. | Approve liquidity semantics and the quote-asset USD conversion source. |
| Trailing one-hour USD volume, at least $50,000 | DexScreener pair snapshot parser and hard filter exist. | Exact selected-pair trailing-hour USD volume, not a count or an unrelated pool aggregate. | Same pair, source time no later than T and within freshness; response digest bound to identity. | Snapshot support exists; authenticated interval/data semantics are not accepted. | Approve the source's interval and aggregation semantics. |
| One-hour price change, strictly below +80% | DexScreener snapshot parser and filter exist. | Same-pair one-hour change with defined price and source-time semantics. | Pair identity, source timestamp ≤ T, five-minute decision freshness. | Parser/filter exist; provider trust/time contract is missing. | Approve the precise provider field and its source-time policy. |
| Mint authority revoked | Token-safety bridge and existing `getAccountInfo`/mint evidence path normalize supported layouts. | Finalized mint account bytes/layout sufficient to prove the authority is null. | Mint account, mint identity, finalized slot, response digest, and source/receipt times. | Decoder support is partial; no authenticated source receipt or live account data is accepted. | Approve supported layouts/commitment and reject unknown layouts. |
| Freeze authority revoked | Same token-safety/account-info path and hard filter. | Finalized mint account bytes proving freeze authority is null. | Same mint/slot/digest/time requirements as mint authority; no account substitution. | Parser/filter exist for recognized layouts; trusted current account evidence is missing. | Approve account decoding and finalized observation semantics. |
| Supported token extensions | Token-safety bridge recognizes transfer fee, transfer hook, default-frozen, and permanent delegate flags. | Complete mint extension enumeration proving all four disallowed conditions absent. | Mint/account identity, finalized slot and raw-response digest; unsupported extension layouts remain unknown. | Known-layout decoder exists; exhaustive extension coverage/source guarantee is absent. | Approve supported token program/layout versions and explicit fail-closed handling for all others. |
| Pool LP burn or lock through hold | Raydium CPMM decoder checks supported pool state; `lp-protection-source.mjs` does not prove a reviewed burn/lock. | Pool-specific LP supply/ownership and irrecoverability, or lock authority, duration and expiry past hold. | Exact pool and LP mint, receipt digest, finalized slot and source time; lock expiry must exceed proposed hold. | Pool decoding exists; accepted burn/lock proof source and semantics are missing. | Select supported pool programs and define acceptable burn/lock evidence and hold policy. |
| Top-ten owner concentration, at most 25% | `owner-census.mjs` and canonical adapter calculate concentration only from complete owner-resolved census evidence. Top-20 token accounts are explicitly insufficient. | Complete account enumeration, owner resolution, nonzero supply denominator, and reviewed selected-pool/burn exclusions. | Same identity/policy and comparable finalized observation; bind account set, supply denominator, exclusions and response receipts. | Calculation code exists; complete authenticated owner census and exclusions are unavailable. | Select a completeness-capable census source and approve denominator/exclusion policy. |
| Developer-associated holdings, at most 3% | Canonical adapter validates a reviewed attribution and joins it to the owner census; no attribution source is checked in. | Documented attributable developer identities plus complete balances and defined scope. | Bind attribution receipt, census receipt, identity and common observation/supply context; no unresolved attribution may count as zero. | Join/check code exists; attribution facts and policy are missing. | Define attribution evidence, scope, and how uncertain ownership blocks. |
| Attributable prior-rug history | Canonical adapter requires reviewed attributable history coverage; generic address history is not sufficient. | Complete attributable project/creator history for a reviewed lookback and definition of rug outcomes. | Bind identities, history scope/lookback, source receipts and time; “not found” requires demonstrated complete scope. | Validation path exists; attributable identities, complete history and policy are missing. | Define attribution, lookback, qualifying outcomes and completeness guarantee. |
| Bundled-launch supply, at most 10% | Canonical adapter consumes reviewed bundle amount and reconciles it to census supply; no launch classifier/source is checked in. | Versioned bundle definition, launch window, attributable addresses, complete transaction coverage and supply denominator. | Bind mint/pool, transaction-window receipts, source timestamps, denominator and classifier version. | Consumption/reconciliation exists; classifier, complete history, attribution and policy are missing. | Approve bundle definition/window and a source that guarantees complete transaction coverage. |
| Analyst momentum, 15 minutes | `analyst-window-evidence.mjs` computes from historical price observations; weights/normalization remain #996. | Exact historical USD endpoints or a reviewed equivalent time series for the candidate and quote asset; never assume USD parity. | Identity, USD denomination, method/version, source/receipt digests, no future observations, exact 15-minute window and owner-approved staleness. | Computation and receipt checks exist; historical price/feed and quote-USD conversion are unselected/unverified. | Select feed coverage, access entitlement, endpoint semantics, staleness and conversion policy. |
| Analyst unique buyers, trailing 1 hour | Launch-history bridge, swap decoder and Analyst calculator deduplicate buyer addresses. | Complete finalized pool swap history, correct buyer extraction, and defensible archive completeness; pagination exhaustion alone is not completeness. | Identity and `(T-1h, T]` window, source receipts and timestamp fence witnesses; all rows finalized and within the window. | Collector/decoder/calculation exist; accepted archive completeness and authenticated timestamps are missing. | Approve an archival provider/completeness guarantee and buyer-classification rule. |
| Analyst buy/sell USD-volume ratio, trailing 1 hour | Swap decoder and Analyst calculator require positive buy and sell USD denominators. | Complete direction-classified swap flows and historical USD prices for each quote/base amount. | Same history-window binding plus receipt-bound historical prices and an explicitly nonzero denominator for each side. | Calculation exists; complete history, historical USD prices and quote conversion are missing. | Approve the history and price sources/methods; never substitute transaction count or pair aggregate volume. |
| Analyst holder growth, trailing 1 hour | Owner census and Analyst calculator compare endpoint owner counts. | Two complete, owner-resolved and comparable censuses under one denominator/exclusion policy. | Same identity and census-policy version; endpoints exactly bound to T−1h and T, finalized/source-timed, with receipts. | Comparison code exists; complete time-series census and source guarantees are missing. | Select census provider and approve comparability, endpoint and exclusion semantics. |
| Analyst liquidity / market-cap percentage | Canonical market adapter derives from selected-pair liquidity and actual market cap; #996 normalization unchanged. | Same-pair fields in a common accepted USD basis; market cap cannot fall back to FDV. | Reuse both identity-bound fresh receipts; same decision snapshot/methodology and USD conversion. | Derivation exists; accepted USD market-data trust and conversion are missing. | Approve the pair data and USD methodology; preserve existing threshold/weight. |
| Analyst qualified smart wallets | Analyst builder supports an allowlist input; no qualified-wallet allowlist or provenance source is configured. | Owner-reviewed qualifying wallet records with the existing #996 round-trip/activity/cost criteria and attributable evidence. | Bind allowlist version, review receipt, candidate identity and `(T-1h, T]` transaction evidence; deduplicate addresses. | Scoring support exists; source/list, qualification history, cost evidence and review are absent. | Approve the qualification source and allowlist process. **HEDGE remains NOT QUALIFIED.** |
| Causal entry/exit quote and five nonoverlapping costs (execution prerequisite) | `market-quote-adapter.mjs` binds Jupiter route identity/time; current authorization remains false. Offline quote scenarios are review-only. | Same-mint/pool/quote causal quote plus separately supported fee, spread, slippage, price-impact and network costs; no estimate or parity assumption. | Exact identity/side/amount, route/selected pool, receipt time later than decision and candidate T, bounded response digest; each cost has its own source/basis. | Quote parsing and scenario projections exist; accepted source-bound USD quote and all five real cost components do not. | Approve quote and cost source/methodologies; until all five are present, keep no-entry. |

No provider request is authorized for this packet (19/20 requests have been
used). HEDGE remains **NOT QUALIFIED**; no eligibility, allowlist, or source trust
is implied. Product decisions and external source guarantees above cannot be
replaced by code-only assertions. The run manifest, thresholds, weights, six
metrics, and policy approval state remain unchanged.

Focused offline verification:

```sh
node --test test/memecoin-paper-source-pipeline.test.js
node --test test/memecoin-paper-launch-history.test.js
```

Fixtures use RPC-shaped responses only; no endpoint was contacted.
