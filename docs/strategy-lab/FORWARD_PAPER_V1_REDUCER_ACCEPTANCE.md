# Forward Paper V1 — reducer acceptance design

**Contract:** [`FORWARD_PAPER_V1_CONTRACT_SPEC.md`](FORWARD_PAPER_V1_CONTRACT_SPEC.md), interface `MERIDIAN-FORWARD-PAPER-EVENT/1.0.0`. This document defines a generated-test design matrix only; it does not define another interface, executable fixture, or test implementation.
**Status:** documentation only. No tests, engine, market/network reads, or operational probes are requested or performed. Forward implementation remains blocked pending useful, independently assessed D2 evidence and separate owner authorization.

## 1. Test boundary and common setup

Future tests use bounded, in-memory generated values only. They must not load captured/CSV/market files, contact a provider, use a runtime database/service, run a strategy engine, create a schedule, or assert operational readiness. A generated case may supply an explicitly complete synthetic source/config only after the test confirms no `REQUIRED_UNSET` choice remains. Test values are not candidate defaults or operating recommendations.

Every transition case records:

1. interface version and initial durable state identity;
2. exact canonical event(s), source identity, event IDs, payload digests, source/local/candle/decision times, and configuration identity;
3. proposal and persistence acknowledgment sequence, including crash/timeout point if relevant;
4. expected final state, whether any decision/fill/account/mark effect is committed, and the exact reason code;
5. unchanged-state/no-effect assertions for rejection, duplicate, and unknown outcomes.

The reducer contract and proposal fields are defined only in §6 of the canonical contract. Each fixture uses that shared version; the tests must not locally redefine field names, retry rules, state meanings, or persistence acknowledgment semantics.

## 2. Generated transition and failure matrix

Unless a row says otherwise, start from a valid, fully specified but synthetic run with all required choices explicit, a valid durable parent state, and generated identity/digest values. The fixture's exact numeric values are arbitrary test data and MUST NOT be presented as selected policy.

| Case | Generated input / precondition | Expected state | Expected effect | Exact reason / assertion |
|---|---|---|---|---|
| Versioned interface happy path | Exact v1 envelope; valid expected-state identity; bounded closed synchronized input; matching durable acknowledgment | `OBSERVED → VALIDATED → PENDING_DURABLE_DECISION → ELIGIBLE_FILL` | Observation and decision advance only after their exact durable acks; fill eligibility opens only after decision commit | No rejection reason; assert each receipt binds exact v1 and parent/proposed IDs |
| Unknown interface version | Envelope version differs by one character/unsupported version | `HALTED` | No observation, decision, fill, or accounting mutation | `VERSION_MISMATCH` |
| Missing configuration choice | Any §3 field is `REQUIRED_UNSET`, omitted, null, or empty | `HALTED` | No source admission or strategy decision | `CONFIGURATION_INCOMPLETE` |
| Configuration digest/identity change mid-run | Event/decision uses changed strategy or configuration identity against frozen run | `HALTED` | No mixed-version event/decision or account mutation | `IDENTITY_CONFLICT` |
| Future candle | Candle close time is later than trusted decision boundary | State unchanged or `HALTED` per the frozen terminal-integrity policy | No accepted watermark, decision, or fill | `EVENT_FUTURE` |
| Unclosed candle | Candle close has not been established by event/source contract | State unchanged | No feature/signal proposal, fill, or forward observation count | `CANDLE_UNCLOSED` |
| Invalid/full-OHLC missing open | `open` absent, malformed, or the adapter supplies only `high/low/close` | State unchanged or `HALTED` if adapter contract is violated | No inferred open; no fill synthesized from close | `MISSING_REQUIRED_FIELD` |
| Reordered candle | Input has a lower open/source time than the accepted watermark | State unchanged or `HALTED` | No history rewrite, decision, or fill | `EVENT_REORDERED` |
| Cadence gap | Two otherwise valid closed candles violate configured expected cadence, without explicit approved gap semantics | State unchanged or `HALTED` by frozen gap policy | No interpolation, zero-fill, signal, or fill | `CADENCE_GAP` |
| Misaligned universe | Required instruments have different interval boundaries or incomplete synchronized set | State unchanged | No partial-universe decision or fill | `UNIVERSE_MISALIGNED` |
| Missing required source event | No required instrument/candle/price event or event field | State unchanged or `HALTED` by source-integrity policy | No substituted observation, mark, or price | `MISSING_REQUIRED_FIELD` |
| Stale source observation | Source/candle age exceeds the configured freshness bound | State unchanged | No signal/fill; stale data cannot be used as current | `SOURCE_STALE` |
| Exact duplicate event | Same namespaced event identity and identical canonical payload digest, including after restart | Existing committed state | Idempotent no-op; no second observation effect, decision, fill, cost, or account delta | `DUPLICATE_IDEMPOTENT` |
| Conflicting duplicate event | Same source identity/event ID but changed payload digest | `HALTED` | No second event/account effect; preserve conflict for diagnosis | `IDENTITY_CONFLICT` |
| Same payload under a different ID | Two distinct source event IDs with equivalent candle values | `OBSERVED` only as two source claims subject to ordering/duplicate policy | Must not silently deduplicate by payload; any second decision depends on configured cadence and identity | Assert source IDs remain distinct |
| Past open received after decision | `localReceivedAtMs` is after the ack but the source event/candle open occurred before or at the durable decision under trusted causal ordering | `OBSERVED` or `HALTED` per late-data policy | No fill, even if open price is present; record missed/late event if permitted | `LATE_OR_PAST_EVENT` |
| Event received later but source-time relation unprovable | Local receipt follows decision; no trusted clock mapping or source sequence proves event occurred after it | `ELIGIBLE_FILL` must not advance | No fill or account mutation | `LATE_OR_PAST_EVENT` |
| Future eligible event | Fill candidate is proven by a post-commit source barrier or trusted clock mapping to have occurred strictly after durable decision; all fill gates pass | `ELIGIBLE_FILL → MARKED` after exact fill ack | One simulated fill and one accounting delta only after durable acknowledgment | No rejection reason; assert strict `>` in trusted common ordering, not equality |
| Event equal to decision boundary | Source event time/order equals decision durable boundary | Remains `ELIGIBLE_FILL` | No fill; equality is not future | `LATE_OR_PAST_EVENT` |
| Past/backfill event | Historical or cached event supplied after decision, including an array's “next bar” whose open time is already past | State unchanged or `OBSERVED` with explicit late receipt | No fill or forward performance | `LATE_OR_PAST_EVENT` |
| Warmup/backfill only | Input tagged `WARMUP_ONLY`, even if candles are valid and contiguous | `WARMUP` or transition to `OBSERVED` only after warmup closure | No signal, fills, account delta, performance, or forward observation count | Assert no performance receipt exists |
| No-action proposal | Valid closed synchronized input yields explicit `NO_ACTION` and durable acknowledgment | `OBSERVED` after committed no-action receipt | No fill/account mutation; input still has durable decision trace | No rejection reason |
| Decision not durable | Fill event is presented while decision proposal lacks `DURABLE_COMMITTED` | `PENDING_DURABLE_DECISION` | No eligible state, fill, or balance mutation | `DECISION_NOT_DURABLE` |
| Durable decision rejected | Persistence returns exact `DURABLE_REJECTED` | `VALIDATED` or `HALTED`, according to reason | No decision/fill effect | `PERSISTENCE_REJECTED` |
| Decision ack lost / timeout | Persistence may have committed, but caller cannot verify the exact acknowledgment | `UNKNOWN` | Fence retained; no retry, later fill, or assumed decision | `PERSISTENCE_UNKNOWN` |
| Fill ack lost / timeout | Fill/account proposal may have committed, acknowledgment is uncertain | `UNKNOWN` | No repeated fill/fee/accounting mutation; reconciliation required | `PERSISTENCE_UNKNOWN` |
| Restart after committed receipt | Durable receipt/state identities match; restart reloads last committed state | Resume from acknowledged state | No replay of committed side effect | Assert receipt identity and state hash are unchanged |
| Restart with event but no committed receipt | Event was read before crash, no durable observation receipt exists | `UNKNOWN` if commit outcome is uncertain; otherwise last proven state after authoritative absence proof | Do not infer, retry, or apply effect based on in-memory data | `PERSISTENCE_UNKNOWN` or explicit `PERSISTENCE_REJECTED` only after proof |
| CAS/state identity mismatch | Proposal expected-state ID differs from persisted state ID | State unchanged or `HALTED` for conflict | No receipt with effect; no account mutation | `STATE_IDENTITY_MISMATCH` |
| Bounds exact maximum | Generated payload/work count equals each declared bound | Valid next state if all other checks pass | Complete bounded transition | Assert no truncation or overrun |
| Bounds one unit over | Any bytes/events/work/time/array bound exceeded | State unchanged or `HALTED` | No partial parsing into a different valid event; no effect | `BOUND_EXCEEDED` |
| Invalid numeric/unit value | NaN/infinity, coercible string, exponent form, missing scale/currency, or unsupported product unit | State unchanged or `HALTED` | No account or price effect | `PAYLOAD_INVALID` |
| Missing/stale mark | Position lacks fresh configured mark, or mark is older than freshness limit | `MARKED` with valuation unavailable, or unchanged if mark receipt is rejected | Equity is `UNAVAILABLE`; do not use zero, stale carry-forward, or fabricate return | `MARK_UNAVAILABLE` |
| Missing FX/settlement valuation | Holding cannot be expressed in configured account currency under an approved conversion/model | `MARKED` with equity unavailable | No implied currency parity or assumed value | `MARK_UNAVAILABLE` |
| Balance insufficiency | Proposed quantity/cost would violate selected available cash/margin/balance constraint | `HALTED` | Reject whole fill; cash/holdings unchanged | `BALANCE_INVARIANT` |
| Risk/exposure/loss breach | Proposed state crosses any frozen selected bound | `HALTED` | Reject whole fill and persist halt before further decision | `RISK_LIMIT` |
| Unselected risk/stop/cost policy | Fill proposal lacks selected stop/risk/cost/liquidity treatment | `HALTED` | No fill, not even with zero cost/no stop | `COST_POLICY_INCOMPLETE` or `CONFIGURATION_INCOMPLETE` |
| Fee charged once | Unique fee charge identity attached to a committed fill | `MARKED` after commit | Cash includes fee once; valuation does not subtract it again | Assert conservation and one charge identity |
| Fee double-count attempt | Same charge ID applied twice or opening/closing fee subtracted again after cash booking | `HALTED` | Reject entire duplicate accounting update | `COST_DUPLICATE` |
| Slippage double count | Fill price embeds selected slippage and a second equal slippage charge is proposed | `HALTED` | No duplicate cost/cash deduction | `COST_DUPLICATE` |
| Cost arithmetic nonconservation | Cash, holdings, cost deltas and resulting equity do not reconcile within the explicitly frozen rounding policy | `HALTED` | No partial balance transition | `BALANCE_INVARIANT` |
| Mark changes without a new mark event | Recompute attempts to reuse a stale mark beyond configured freshness | `MARKED` with equity unavailable | No synthetic new mark or valuation | `MARK_UNAVAILABLE` |
| Halted run offered ordinary event | New event arrives before cause repair and new admitted run/config | `HALTED` | No transition/effect | Assert halted state is non-resumable in-place |
| Unknown run offered ordinary event/retry | Any dependent event or automatic retry while state is `UNKNOWN` | `UNKNOWN` | Fence remains; no fill, account, or state change | `RECONCILIATION_REQUIRED` |
| Explicit reconciliation proves committed | Selected authority emits durable receipt binding original attempt and exact committed state | Resolved acknowledged state or `HALTED` | Do not replay already committed effects | Assert original receipt/fill/cost occurs exactly once |
| Explicit reconciliation proves absent | Selected authority durably proves no commit and binds last state | Reconciled last state or `HALTED` | A new proposal is permitted only under the resolved fence and same exact state; do not replay unknown blindly | Assert authority and absence proof are recorded |
| Reconciliation authority unset/ambiguous | No selected authority or conflicting authority outcomes | `UNKNOWN` | No retry/resume/effect | `RECONCILIATION_REQUIRED` |

Terminal-vs-recoverable treatment for source freshness, gaps, late input and event-integrity failures is itself an operating choice and remains unset. Tests must verify that the implementation uses the explicit frozen policy rather than inventing a favorable recovery path.

## 3. Generated property and sequence design

Future generated tests should permute event order, duplicate/restart points, payload changes, and acknowledgment outcomes, asserting these properties:

- **Causality:** every committed decision consumes only closed accepted inputs; every fill receipt references a durable decision and a proven strictly later event. A post-commit source barrier or trusted clock mapping is required; a last-seen sequence or later local receipt alone is insufficient proof.
- **No backfill fills:** transforming any eligible historical candle into a late/backfill event cannot create a fill, even when its OHLC contains an apparently favorable open.
- **Idempotency/conflict:** exact duplicate identity+digest never duplicates effects; changed payload under the same ID halts; different IDs do not collapse merely because payloads match.
- **Persistence gate:** removing or changing any durable acknowledgment prevents the associated state/effect from becoming committed. Ambiguous acknowledgment always fences in `UNKNOWN`.
- **Restart equivalence:** replaying only exact durable receipts after restart yields the same state identity as uninterrupted processing; uncommitted in-memory proposals do not become effects.
- **Conservation:** for each committed fill, cash/holdings/cost deltas reconcile under the selected units/rounding model, and a duplicate fee or slippage charge cannot be booked.
- **Mark availability:** missing/stale/unsupported marks propagate `UNAVAILABLE`; they never become zero, a current mark, or an implied gain/loss.
- **Warmup isolation:** adding/removing/changing only `WARMUP_ONLY` inputs cannot add a forward fill, account mutation, performance receipt, or forward observation count.
- **Version and configuration isolation:** changing interface, strategy, or configuration identity cannot reuse a prior run's state or mix receipts.
- **Bounds:** exact maxima are accepted where otherwise valid; one-over inputs reject atomically with no state/account mutation.

Generated test coverage is a future acceptance design, not D2 evidence, market evidence, operational proof, or authorization. Passing it would not establish provider availability, authenticity, execution, profitability, or readiness.

## 4. Current blockers and handoff boundary

The audited `market-feed-gateway.js:35-55` drops the `open` field as well as volume/trades. Therefore it cannot supply the full OHLC needed by source contracts requiring an open, nor can its past candle opens serve as forward fills. No open-from-close synthesis or presumed live availability is permitted. A source adapter/schema with complete fields, provenance, causal timing, and actual availability evidence remains an explicit gap.

The interface owner must publish the exact commit containing §4-§8 of the canonical contract to the Lead and companion-package writer before their dependent work. Companion documents may link to this version but must not define a competing envelope or transition protocol. The D2 implementation gate remains closed until useful independent D2 assessment precedes any forward implementation.
