# Forward Paper V1 — event, causality and accounting contract

**Interface:** `MERIDIAN-FORWARD-PAPER-EVENT/1.0.0`

**Status:** specification only. Owner-approved isolated synthetic test infrastructure may be implemented under [`SYNTHETIC_PAPER_INFRASTRUCTURE_V1.md`](SYNTHETIC_PAPER_INFRASTRUCTURE_V1.md), after contract review and when an implementation lane is available. Forward-Paper admission and operation remain blocked pending independently assessed D2 evidence, resolved operating choices, and the separate gates below.
**Audited source:** main commit `6bcaa74b35a7c093e67f144a03f82a6d77cdf9be`, tree `d2ef43696a037c1f84dc2d477bace85f34695cf4`. The references below identify the exact files and line ranges in that source tree. This specification does not claim that those historical files implement this contract.

## 1. Scope and non-authority

This document specifies an event boundary and pure reducer proposal for a future, isolated Forward Paper implementation. The only pre-qualification implementation scope is the generated-fixture test harness in [`SYNTHETIC_PAPER_INFRASTRUCTURE_V1.md`](SYNTHETIC_PAPER_INFRASTRUCTURE_V1.md); it is not D2 qualification, data access, engine execution, Paper operation, a persistence service, schedule, provider, credential, spending, order, or Live action. This contract makes no PnL, execution, profitability, readiness, or source-authenticity claim. Production warmup and historical/backfill inputs are not forward observations and cannot establish forward performance.

The versioned interface in this document is owned by work package A. Its proposal, acknowledgment, unknown-outcome, bounds, units, and reason-code semantics are canonical here. Any companion package may link to this contract, but must not restate or redefine that interface. A validly formatted hash or matching digest proves neither source authenticity nor approval; evidence validation likewise remains offline and non-authorizing (`docs/strategy-lab/PAPER_FIRST_EVIDENCE_CONTRACT.md:3,16-22`).

The accepted companion commit `a1c1b35656d501e4d2bcc74ae4a717110beca26c` remains the historical pin for the unchanged v1 event/transition wire contract. This documentation clarification does not claim that the pinned commit contains this text or changes its wire fields. The reconciliation-resolution receipt envelope is **UNSPECIFIED** in v1; a separate versioned contract amendment defining it is required before implementing reconciliation or resolving `UNKNOWN`.

## 2. Source audit and boundaries

| Source at audited commit | Existing capability and limit relevant to this contract |
|---|---|
| `research/paper-edge-v1-foundation.js:4-13,25-29` | Normalizes/sorts closed OHLC bars and provides prior-closed daily context. It is a research helper, not a durable observation watermark or event journal. |
| `research/paper-edge-v1-data-contract.js:5-11,13-31` | Canonicalizes/hash-receipts bars and funding and checks ordering, cadence, OHLC, overlap, and declared coverage. A digest is not an authenticated provider claim; this is not a forward receipt protocol. |
| `research/paper-edge-v1-state-machine.js:3-16` | Computes historical indicators, signals, stops, risk and a next-array-bar open. That index-based replay does not establish that a future event arrived after a durable decision. Its historical sizing/stop rules are not inherited by this contract. |
| `research/strategy-paper-arena.js:20-29,40-76,78-103,113-117` | Requires complete synchronized daily OHLC, accounts for cash/positions/costs in a retrospective replay, and includes 200-bar warmup. Historical candidates, capital, universe, costs, no-stop policy and strategy logic are not forward defaults. |
| `research/paper-execution-v2-replay.js:19-48` | Replays supplied closed trades/candles with candidate cost defaults. It is not a forward event loop, receipt store, or source of selected costs. |
| `paper-cost-policy.js:3-16` | Illustrates cost-aware sizing but has 5 bps fee and 3 bps slippage defaults. Those values are not approved or inherited. |
| `paper-position-accounting.js:1-18` | Marks one position and can subtract opening/closing fees. A future ledger must bind fee treatment once and not count the same fee again. |
| `market-feed-gateway.js:35-55,57-76` | The normalizer/provider mappings preserve `openTime`, `high`, `low`, `close`, `closeTime`, but drop `open`, volume, and trades. **This gateway does not provide full OHLC and is not a usable fill-price adapter.** Never infer `open` from `close`; provider availability and any complete-OHLC adapter remain unknown. Cache fetch/age time is not source candle time. |
| `docs/strategy-lab/PAPER_FIRST_EVIDENCE_CONTRACT.md:16-22,33-53` | Keeps completeness/readiness distinct, hashes unauthenticated, and historical defaults/research risk policies non-authoritative. |

No retrospective strategy, no-stop exception, historical product, or default cost, capital, risk, sizing, or timing policy transfers into Forward Paper.

## 3. Operating configuration: every choice is required and unset

The initial configuration contains explicit `REQUIRED_UNSET` values. A missing, null, empty, inferred, or inherited value is not a default: it blocks admission. The list below is exhaustive for the current specification; an owner-approved contract amendment is required to add a choice.

| Configuration field | Required type/unit once chosen | Current value | Rejection/block rule |
|---|---|---|---|
| `strategyIdentity` | Immutable strategy ID, semantic version, rules/code digest | `REQUIRED_UNSET` | No signal computation or run admission without an exact version. |
| `sourceIdentity` | Provider/source ID, adapter/schema version, source contract and identity | `REQUIRED_UNSET` | No source accepted based on a label or digest alone. |
| `universe` | Explicit ordered set of instrument identities and membership/effective-time policy | `REQUIRED_UNSET` | No implicit current, historical, or survivorship-biased universe. |
| `product` | Instrument/product type, venue, contract/settlement/margin semantics | `REQUIRED_UNSET` | Unsupported/unspecified product blocks valuation and fills. |
| `initialCapital` and `accountCurrency` | Positive decimal amount and explicit ISO currency | `REQUIRED_UNSET` | No EUR/USDT/USD equivalence or conversion assumption. |
| `observationPeriod` | Explicit start/end policy, duration and minimum observation/sample rules | `REQUIRED_UNSET` | No retrospective interval counts as forward exposure. |
| `feePolicy`, `slippagePolicy`, `liquidityPolicy` | Fee basis, fill-price/slippage treatment, spread/depth/impact and participation units | `REQUIRED_UNSET` | No inherited bps, zero costs, default depth, or silent cost substitution. |
| `riskPolicy`, `stopPolicy`, `exposureLimit`, `lossLimit` | Explicit method, currency/quantity basis, hard bounds and breach action | `REQUIRED_UNSET` | No inherited historical no-stop exemption or implicit unlimited risk. |
| `decisionTiming`, `fillEligibility`, `expiryPolicy`, `markPolicy` | Source/local time rules, event phase, lateness, explicit fill-expiry boundary/action, and mark eligibility rules | `REQUIRED_UNSET` | No past event/open or unselected candle/expiry convention may fill or mark. |
| `freshnessPolicy`, `gapPolicy`, `synchronizationPolicy` | Explicit durations/cadence in ms and alignment rules | `REQUIRED_UNSET` | No guessed freshness window, interpolation, or partial-universe decision. |
| `computeBounds` | Explicit max input/events/bytes/work per transition and timeout units | `REQUIRED_UNSET` | An absent/exceeded bound rejects without partial state mutation. |
| `reconciliationAuthority` | Named authority, permitted evidence and explicit durable-resolution procedure | `REQUIRED_UNSET` | No automatic retry, self-approval, or assumed settlement from `UNKNOWN`. |

Only after all values are explicitly selected, validated, frozen, and admitted by a separate decision may a run be considered configured. A configuration change creates a new configuration identity and run; it never mutates an existing run. No configuration choice is made by this specification.

## 4. Shared field and identity conventions

All timestamps are UTC epoch milliseconds represented as safe integers; source event time and local receipt time are distinct values. Decimal quantities/prices/cash are exact decimal strings with explicit currency or instrument units; exponent notation, NaN, infinity, implicit units, coercive parsing, and binary-float arithmetic are rejected. Every quantity has a declared scale and every rounding operation has a frozen direction and location. No scale, rounding rule, or tolerance is selected here.

For each digest, canonicalization must be specified by the implementation's pinned serializer and hash algorithm; the v1 wire profile is UTF-8 RFC 8785 canonical JSON with SHA-256 lowercase hex. Digest input excludes its own digest field and includes every other identity-bearing field. Reject noncanonical encodings, unknown fields, malformed digests, unsafe numbers, and over-bound payloads. A syntactically valid digest is only a digest assertion; it neither authenticates its producer nor approves the content.

| Identity | Meaning and invariant |
|---|---|
| `eventIdentity` | Tuple `(sourceIdentity, sourceStream, productIdentity, sourceEventId)`. It identifies one claimed source event, not its payload. IDs are not reused within the declared source namespace. |
| `payloadDigest` | Digest of the canonical complete event payload. Same `eventIdentity` and same digest is an idempotent duplicate; same identity and different digest is a conflict and halts the run. Different IDs with equivalent payloads are not silently collapsed. |
| `strategyIdentity` | Exact strategy ID/version and immutable rules/code digest. No strategy behavior is specified here. |
| `configurationIdentity` | Immutable configuration ID/version and digest, bound to the run. Hash validity is not source authentication, approval, or owner authorization. |
| `runIdentity` | Unique forward run ID bound to exactly one strategy and configuration identity. |
| `stateIdentity` | Digest/identity of the last durably acknowledged reducer state, including its parent identity and transition receipt. |
| `receiptIdentity` | Unique identity for one proposed transition receipt, stable across a retry of that same proposal; never reused for different content. |

The source event ID and payload digest are separate required fields; one must never stand in for the other. Local receipt/decision times are local observations, not provider assertions.

## 5. Typed event and account envelopes

All envelopes are closed schemas under `MERIDIAN-FORWARD-PAPER-EVENT/1.0.0`; missing required fields, unknown enum values, extra fields, or invalid units reject. No unknown field may be ignored for identity or digest purposes.

### 5.1 Configuration envelope

| Field | Type | Rule |
|---|---|---|
| `interfaceVersion` | Literal string | Exactly `MERIDIAN-FORWARD-PAPER-EVENT/1.0.0`. |
| `runIdentity` | Opaque stable ID | Unique, immutable for the run. |
| `strategyIdentity` | `{id, version, rulesDigest}` | All three required; binds exact implementation/rules without asserting approval. |
| `configurationIdentity` | `{id, version, digest}` | Binds all required operating choices in §3; immutable. |
| `choices` | Closed object from §3 | No `REQUIRED_UNSET`, null, omitted, inferred, or historical default accepted by an implementation admission check. |
| `frozenAtLocalMs` | Safe integer | Local time at which the exact configuration was frozen; cannot be earlier than the decision that freezes it. |

Before a run accepts any `FORWARD_CANDIDATE`, its admission must have an exact `RUN_ADMITTED` durable receipt bound to `runIdentity`, `strategyIdentity`, and `configurationIdentity`. That receipt records `runStartDurableAtLocalMs` and either a source barrier acknowledged after admission or a trusted source/local clock mapping. A forward decision-input observation must be proven to occur after this run-start fence and before its consuming decision; it need not occur after that decision's durable receipt. Only an eligible fill/price event must additionally be proven strictly later than the exact decision's durable acknowledgment, as specified in §5.4. A run-start receipt or causal fence is not implied by configuration freeze. Without the applicable proof, observations remain warmup-only or are rejected; no forward observation count or performance effect is allowed.

### 5.2 Observation envelope

| Field | Type | Rule |
|---|---|---|
| `interfaceVersion`, `runIdentity` | Literal, stable ID | Must match the admitted run. |
| `eventIdentity` | Identity tuple in §4 | Required and unique by source namespace. |
| `payloadDigest` | SHA-256 digest string | Recomputed from canonical payload; equality does not prove authenticity. |
| `sourceIdentity`, `adapterSchemaVersion`, `productIdentity` | Nonempty immutable IDs | Must match frozen configuration; adapter must provide every required field. |
| `sourceEventTimeMs` | Safe integer | Provider-claimed event time; never replaced by local receipt time. |
| `localReceivedAtMs` | Safe integer | Local receipt time, monotonic for accepted events. |
| `kind` | Enum: `CANDLE`, `PRICE_EVENT`, `MARK` | Must be declared by the v1 contract and configured source. |
| `candle` | `{intervalMs, openTimeMs, closeTimeMs, open, high, low, close}` | Required for candle observations. Complete valid OHLC, positive prices and `openTimeMs < closeTimeMs`; the close is not known/usable until close time and closure are established. |
| `priceEvent` | `{phase, eventTimeMs, price, sourceEventId}` | Required for fill candidates. `phase` must be explicitly declared, price positive, and time distinct from local receipt time. |
| `mark` | `{markTimeMs, price}` | Required for a mark candidate; no stale/missing mark may be coerced to zero. |
| `observationUse` | Enum: `FORWARD_CANDIDATE`, `WARMUP_ONLY` | Required, identity-bound classification of intended use; not itself evidence of authenticity or prospective arrival. |
| `provenanceClass` | Enum: `PROSPECTIVE_SOURCE_EVENT`, `HISTORICAL_BACKFILL`, `REPLAY_OR_SYNTHETIC` | Required; must be consistent with `observationUse` under the rules below. This is a claimed provenance class, not authentication. |
| `provenanceReference` | `{referenceIdentity, referenceDigest}` or explicit `UNAVAILABLE` with reason | Required and included in the canonical event digest. References bind any source-native sequence/barrier or parent receipt; a digest alone does not authenticate it. |

`CANDLE` payloads must arrive complete, closed, strictly ordered, cadence-valid and synchronized for the configured universe before they can be decision inputs. Candle identity is not only its timestamp. Missing `open` is an invalid candle; do not synthesize it from close. Future, still-open, reordered, gapped, misaligned, stale, or conflicting observations cannot advance the accepted observation watermark or produce a decision.

The tuple `(runIdentity, eventIdentity, observationUse, provenanceClass, provenanceReference)` is included in the complete payload digest and copied into the durable observation receipt. `FORWARD_CANDIDATE` is admissible only with `PROSPECTIVE_SOURCE_EVENT`, a committed run-start fence, and causal proof that the source event occurred after that fence; the class label alone does not establish this. `HISTORICAL_BACKFILL` and `REPLAY_OR_SYNTHETIC` must be `WARMUP_ONLY`. A mismatch, missing use/provenance field, or change of classification under an existing event identity rejects the event (`PAYLOAD_INVALID` or `IDENTITY_CONFLICT`). `WARMUP_ONLY` may initialize strategy-owned state only; it can never create a forward decision, fill, account mutation, performance receipt, or observation count. `UNAVAILABLE` provenance is not admissible for a forward candidate. These values are caller/source assertions unless independently authenticated; they do not establish source availability or approval.

### 5.3 Signal proposal envelope

| Field | Type | Rule |
|---|---|---|
| `runIdentity`, `strategyIdentity`, `configurationIdentity` | Exact admitted identities | No mixed-version proposal. |
| `decisionIdentity` | Unique stable ID | Idempotency identity for one decision attempt. |
| `inputEventIdentities` | Ordered nonempty list | Exact accepted, closed, synchronized events consumed; every item precedes the decision by the configured causal rule. |
| `inputDigest` | Digest | Covers the ordered list and complete canonical input payloads. |
| `decisionTimeLocalMs` | Safe integer | Captured after all consumed inputs were received and validated. |
| `proposal` | Strategy-owned opaque typed value or explicit `NO_ACTION` | Its schema belongs to the future selected strategy, not this interface; no strategy logic is defined here. |
| `proposalDigest` | Digest | Covers the complete signal proposal. |

This is a proposal, not an effect. It does not authorize a fill, position, or account mutation before its durable decision acknowledgment.

### 5.4 Eligible price event and fill intent

| Field | Type | Rule |
|---|---|---|
| `priceEventIdentity`, `payloadDigest` | Event identity and payload digest | Must be a new, nonconflicting event from the frozen source. |
| `priceEventTimeMs`, `localReceivedAtMs` | Safe integers | Preserve both clocks; received time is not event time. |
| `phase`, `price`, `productIdentity` | Configured values and exact decimal | Must be a supported event phase and product with available price. |
| `decisionReceiptIdentity`, `decisionDurableAtLocalMs`, `causalOrderProof` | Durable acknowledged receipt, local ack time, and proof of event ordering | Must refer to the exact committed decision. The proof binds the candidate event to a source-side barrier acknowledged after decision commit that guarantees sequence order, or to a trusted source/local clock mapping whose conservative event-time lower bound is strictly later than that acknowledgment. |
| `quantity`, `side`, `costTreatment` | Exact decimal/unit and selected enums | Must satisfy selected risk, liquidity and product policy; no unit may be inferred. |

A fill candidate is eligible only when its source event is proven to have occurred strictly after the decision became durable. Source and local clocks are not directly comparable: either a source-side barrier is issued/acknowledged after decision commit and guarantees that events with a greater sequence cannot have been produced before the barrier, or a trusted source/local clock mapping proves that the candidate's conservative source-time lower bound is strictly greater than `decisionDurableAtLocalMs`. The barrier and its guarantee must be durably bound to the decision receipt before accepting a candidate. A last-seen sequence sampled at decision time alone is insufficient. Equality, missing mapping/barrier, or unbounded clock uncertainty is ineligible. Local receipt after the ack, by itself, proves only later receipt—not later event occurrence. A past candle open remains past even if first received after the decision; late receipt cannot make it a future event. A full OHLC candle does not imply its open is still executable. No price may be synthesized from close, and no fill is emitted by backfill, replay, cache, warmup, or a retrospective next-array-bar lookup.

### 5.5 Account state and committed receipt

| Field | Type | Rule |
|---|---|---|
| `accountIdentity`, `runIdentity` | Stable IDs | One isolated simulated account per configured run. |
| `baseCurrency`, `cash` | Explicit currency and exact decimal amount | Currency must be selected; no implicit FX. |
| `holdings` | Map of product identity to signed exact quantity, unit/scale, cost basis and provenance | Every holding must use configured product and quantity units. |
| `marks` | Per holding: price/unit, source event identity, source time, local receipt time, availability | Each mark must satisfy configured freshness/as-of rules; unavailable marks remain unavailable. |
| `equity` | Exact decimal amount or `UNAVAILABLE` with reason | Defined only when all required cash/holding valuations and conversions are available. Never use zero for an absent mark or FX rate. |
| `riskSnapshot` | Selected risk measures, units, input receipt IDs, or `UNAVAILABLE` | No default policy or inferred risk value. |
| `parentStateIdentity`, `stateIdentity` | Stable identities | State identity binds its parent and exact canonical contents. |
| `receiptIdentity`, `transitionIdentity`, `transitionDisposition` | Proposal linkage and `COMMITTED`/`REJECTED`/`UNKNOWN` | A committed receipt acknowledges exactly one proposal and resulting state. |
| `durableAtLocalMs` | Safe integer in the committed receipt metadata | Set only by the persistence acknowledgment; not caller-provided decision time and not a reducer-proposal input. |

Receipt also binds the interface version, input/event identities and digests, strategy/config identities, transition reason, state before/after, accounting deltas, cost-charge identities, and any mark availability/reconciliation evidence. It makes no profitability or execution-quality claim.

## 6. Pure proposal and persistence acknowledgment

The reducer is a deterministic pure transition proposal over one acknowledged state and one bounded event. It may validate and calculate a proposed next state but performs no I/O, persistence, fill, or account effect by itself.

```text
TransitionProposal {
  interfaceVersion: "MERIDIAN-FORWARD-PAPER-EVENT/1.0.0",
  expectedStateIdentity,
  eventIdentity,
  proposedStateIdentity,
  receiptIdentity,
  disposition: "PROPOSE" | "IDEMPOTENT_NOOP" | "REJECT" | "HALT"
}
```

The proposal binds canonical full inputs and proposed output by their identities/digests. It MUST fail closed on a version mismatch, unknown field/reason, missing or exceeded bound, identity conflict, invalid units, stale/future/unclosed event, out-of-order input, or state compare-and-swap mismatch. The reducer cannot choose a source, strategy, cost, risk, or authority.

Only the persistence boundary may acknowledge a proposal:

| Acknowledgment | Required contents | Permitted consequence |
|---|---|---|
| `DURABLE_COMMITTED` | Exact `receiptIdentity`, expected and proposed state identities, committed receipt bytes/digest, `durableAtLocalMs`, and either a trusted source/local clock mapping or a source barrier durably acknowledged after decision commit | Advance the accepted state only if all bindings match exactly. Any associated signal/fill/account effect is recognized only from that committed receipt. A last-seen sequence alone is not a causal fence. If no proof can establish an event strictly later than decision durability, no fill can be eligible. |
| `DURABLE_REJECTED` | Exact proposal identity and rejection reason | No state/effect advancement; a rejected proposal is not evidence of a commit. A new proposal requires a newly validated input/state. |
| `UNKNOWN` | Exact attempted proposal identity, last known state, fence/attempt identity, uncertainty reason | No retry, fill, later dependent transition, or assumed commit. Hold the fence and enter `UNKNOWN` until the selected reconciliation authority makes an explicit durable resolution. |

Timeout, lost response, process restart, or disagreement between state and receipt is `UNKNOWN`, not rejection or success. Replaying the exact same proposal identity is permitted only as an idempotent persistence lookup under the same fence; it must never reapply its effects. Such a lookup may establish `OP_APPLIED` only by finding the exact original committed result. The v1 interface defines no reconciliation-resolution receipt envelope for other outcomes; its schema and binding rules are **UNSPECIFIED**. A separate versioned contract amendment must define and accept that envelope before reconciliation can be implemented or can resolve `UNKNOWN`. Until then, retain the fence and do not retry or resume.

## 7. Causality and event admission

1. Admit only exact-version, bounded, well-typed observations. Preserve provider event time, candle interval/open/close times, local receipt time, and local decision time separately.
2. A decision consumes only closed candles that are strictly ordered by source interval, have no unexplained gap, and are synchronized for the complete configured decision universe. No partial or unaligned bundle is a decision input.
3. A candle is closed only once source `closeTimeMs` is no later than a trusted decision-time boundary and the source marks/contract establishes closure. Local receipt alone does not establish closure.
4. Accepted source-time watermarks cannot move backward. Future, reordered, conflicting, or stale inputs are rejected or halt according to §8; they never rewrite committed history. Source time is not compared directly with local time without the configured trusted clock mapping or source-order proof.
5. Warmup/backfill may initialize strategy-owned state only. Every observation has identity-bound `observationUse` and `provenanceClass`; historical/replay inputs must be `WARMUP_ONLY`. Mark each such input accordingly; it produces no forward decision, fill, cash/holding mutation, return, performance receipt, or forward observation-day count.
6. Persist the decision receipt before accepting any fill candidate. A candidate event is proven strictly after the persisted decision under §5.4, using a post-commit source barrier or trusted clock mapping. Any candidate that happened before/equal to the durable decision, or whose ordering cannot be proven, is `LATE_OR_PAST_EVENT`, even if it is first observed later.
7. Persist each fill/account transition and each mark transition before subsequent dependent effects. At a restart, read only the last durably committed state and receipts; do not infer missing effects from current market data.
8. A missing, stale, or invalid mark makes affected equity unavailable. It cannot be carried forward past its selected freshness limit, replaced with zero, or counted as a current mark.

## 8. State and transition contract

States are `WARMUP`, `OBSERVED`, `VALIDATED`, `PENDING_DURABLE_DECISION`, `ELIGIBLE_FILL`, `MARKED`, `HALTED`, and `UNKNOWN`. `MARKED` is a committed account snapshot state; its valuation may explicitly be unavailable until a fresh mark exists. It is not terminal: a later valid forward observation may begin another decision cycle from `MARKED`, carrying forward the exact committed account identity, cash, holdings, costs, and parent receipt. A cycle does not reset capital or discard positions. State names do not imply that any operational dependency exists.

| Current state | Event/guard | Proposed next state | Effect and required acknowledgment |
|---|---|---|---|
| New run | Frozen config missing any §3 choice | `HALTED` | `CONFIGURATION_INCOMPLETE`; no observation, decision, or account effect. |
| New run | Fully specified, separately admitted run with exact durable `RUN_ADMITTED` receipt; warmup input | `WARMUP` | Admission receipt binds run/strategy/config identities and run-start causal fence. Persist warmup receipt only; no forward outputs or account changes. |
| `WARMUP` | Warmup complete under frozen strategy contract | `OBSERVED` | Only newly arriving forward input can enter `OBSERVED`; warmup itself remains non-performance. |
| `OBSERVED` | New event identity, valid bounded envelope | `VALIDATED` | Validation is pure until its observation receipt is durably committed. |
| `OBSERVED` | Identical duplicate identity and digest | Same state | `IDEMPOTENT_NOOP`; no duplicate receipt effect, signal, fill, or accounting mutation. |
| Any active state | Same identity, different digest; event order conflict; unsupported version/schema | `HALTED` | Conflict receipt/reason is durable; no dependent effect. |
| `OBSERVED` | Future, unclosed, malformed, stale, gapped, missing, or misaligned input | Same state or `HALTED` | Rejected with exact reason and no accepted watermark advance; halt if selected policy declares the integrity fault terminal. |
| `VALIDATED` | Complete synchronized closed input; strategy returns proposal or `NO_ACTION` | `PENDING_DURABLE_DECISION` | No signal/effect is recognized until exact proposal has `DURABLE_COMMITTED`. |
| `PENDING_DURABLE_DECISION` | Exact durable decision acknowledgment | `ELIGIBLE_FILL` for actionable proposal; `OBSERVED` for committed `NO_ACTION` | Only after acknowledgment may a strictly later event be considered. A decision does not mean a fill occurred. |
| `PENDING_DURABLE_DECISION` | Persistence rejection | `VALIDATED` or `HALTED` per reason | No decision/fill effect; reason is retained. Never reinterpret as committed. |
| Any transition with uncertain persistence | Timeout, lost/ambiguous ack, restart ambiguity, conflicting receipt | `UNKNOWN` | Fence retained; no retry/effect/dependent transition absent explicit durable reconciliation. |
| `ELIGIBLE_FILL` | New event proven strictly later than durable decision by post-commit source barrier or trusted clock mapping; all fill/risk/liquidity gates pass | `MARKED` after fill receipt | Proposed simulated fill/account update must be durably acknowledged. Snapshot mark status may be unavailable. No historical/past open is eligible. |
| `ELIGIBLE_FILL` | Balance, cost, risk, product, or exposure invariant fails | `HALTED` | Reject fill and commit reason; no partial account mutation. |
| `MARKED` | New fresh valid mark and conservation checks pass | `MARKED` | Persist mark and valuation receipt. `equity=UNAVAILABLE` if any required mark/conversion is absent or stale. |
| `MARKED` | New `FORWARD_CANDIDATE` passes observation admission and event-order checks | `OBSERVED` | Persist the new observation receipt and carry forward the exact committed account snapshot; no reset, duplicate opening balance, or position loss. This begins the next decision cycle. |
| `MARKED` | New `WARMUP_ONLY` or backfill input | `MARKED` | No forward cycle or performance effect; prior account snapshot is unchanged. |
| `ELIGIBLE_FILL` | Configured expiry boundary is durably observed with no eligible fill event before it | `OBSERVED` or `HALTED` per frozen expiry action | Commit a no-fill transition with reason `MISSED_OR_EXPIRED`; no fill/account delta. Expiry is unset until chosen and cannot be inferred from absence alone. |
| Any active state | Hard risk/loss bound or accounting invariant breached | `HALTED` | Persist halt and reason before any further decision/fill. |
| `HALTED` | Cause repaired and selected authority approves a new immutable run/config | New run in `WARMUP` | No in-place resume under changed inputs/config; old state remains auditable. |
| `UNKNOWN` | Explicit authority resolves original proposal | No v1 reconciliation transition is defined; retain `UNKNOWN` and its fence pending a separately accepted contract amendment | The reconciliation receipt envelope is **UNSPECIFIED**; no new fields or receipt schema are implied here. No automatic retry. |

Every acknowledged transition must bind exact expected state identity. A compare-and-swap mismatch rejects without writing a new effect. Rejection/transition reasons are stable uppercase identifiers, not free-text control flow. The closed v1 reason vocabulary includes `CONFIGURATION_INCOMPLETE`, `VERSION_MISMATCH`, `IDENTITY_MISSING`, `IDENTITY_CONFLICT`, `DUPLICATE_IDEMPOTENT`, `PAYLOAD_INVALID`, `BOUND_EXCEEDED`, `EVENT_FUTURE`, `CANDLE_UNCLOSED`, `EVENT_REORDERED`, `CADENCE_GAP`, `UNIVERSE_MISALIGNED`, `SOURCE_STALE`, `MISSING_REQUIRED_FIELD`, `LATE_OR_PAST_EVENT`, `DECISION_NOT_DURABLE`, `PERSISTENCE_REJECTED`, `PERSISTENCE_UNKNOWN`, `STATE_IDENTITY_MISMATCH`, `BALANCE_INVARIANT`, `RISK_LIMIT`, `COST_POLICY_INCOMPLETE`, `COST_DUPLICATE`, `MARK_UNAVAILABLE`, `MISSED_OR_EXPIRED`, and `RECONCILIATION_REQUIRED`. `MISSED_OR_EXPIRED` is the required reason for the committed no-fill transition when the explicitly configured expiry boundary is observed without an eligible event; it is not a fill disposition or an inference from missing data. Unknown reason codes reject.

## 9. Accounting invariants

Accounting is a conservation contract, not a return or profitability measure. The selected product must define valuation/settlement before this formula can be used. For a supported single-currency linear account, let `s=+1` for buy/long and `s=-1` for sell/short; `q` be exact positive units; `p` the eligible fill price; `k` the one-time cost charged for that fill:

```text
cash_after      = cash_before - (s × q × p) - k
holding_after   = holding_before + (s × q)
equity          = cash + Σ(holding_quantity × fresh_mark_price)
```

Other product types, currencies, derivatives, margin, funding, settlement, short liabilities, and FX require an explicit selected model and may not use the linear formula by assumption. If no selected valuation model can value every balance, equity is `UNAVAILABLE`.

Required invariants:

- Each fill has one unique fill identity, one source price-event identity, exact units, and one accounting delta. Duplicate fill/charge identities are idempotent only when their complete payload digest matches; a differing payload halts.
- Cash, holdings, costs, and derived equity use exact decimal arithmetic and the frozen unit/scale/rounding policy. A post-rounding breach of balance, exposure, capital, or risk bounds rejects the entire proposed transition; no partial update.
- Costs are charged once, identified individually, and bound to the fill. If slippage is embedded in the eligible fill price, it cannot also be deducted as a separate slippage charge. Opening costs already in cash are not subtracted again from equity or unrealized PnL; closing costs likewise enter cash once.
- After every committed fill and mark, recompute the conservation identity from committed cash/holdings/cost receipts. Differences beyond the explicitly selected rounding policy halt; there is no implicit epsilon.
- Cash or holding insufficiency, unvalued product, missing FX, stale/missing mark, invalid quantity, negative unsupported balance, or risk bound breach blocks fill/valuation as applicable. Missing values remain unavailable, not zero.
- No forward performance, PnL, profitability, or execution-quality claim is specified or produced here.

## 10. Bounds and operational gate

The implementation must enforce the frozen `computeBounds` before parsing/processing and before proposing a state change. Byte/event/array/work/time limits must be explicit and tested at exact limit and one unit over; oversize input rejects without truncation into a different valid event. No values are chosen here.

This remains documentation only except for the narrowly approved generated-fixture harness in [`SYNTHETIC_PAPER_INFRASTRUCTURE_V1.md`](SYNTHETIC_PAPER_INFRASTRUCTURE_V1.md). Forward-Paper admission and operation remain blocked until useful D2 evidence is independently assessed, owner choices in §3 are resolved, source capability/identity and full-OHLC event availability are established, the reconciliation-resolution receipt contract is separately amended and accepted, and a separate owner decision authorizes the bounded operational package. Any future work must use verified existing resources only, at `$0` additional spend, with no provisioning or other spending; current availability/capacity is unverified. Storage location/durability and authoritative clock/source-time mapping are additional operational implementation gates, not additional §3 choices, and must be explicitly selected and verified. D2 usefulness permits consideration only; it does not authorize Forward-Paper operation.
