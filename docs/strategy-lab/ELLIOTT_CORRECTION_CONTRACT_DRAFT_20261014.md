# Elliott correction verification contract — draft

Identity: ELLIOTT_CORRECTION_VERIFICATION_V1_DRAFT. Basis: synthetic characterization at strategy commit a16926d8c0fc291e41d0ae5c65b15c88e4b2b3b0 and Claude response6161560274. Status: SOURCE_DESIGN_ONLY, not implemented or frozen for empirical use. No candidate is reopened. Original frozen cores, stopping rules and historical outputs remain immutable.

## Scope and separation

The next implementation should be pure offline helpers plus synthetic tests for time admission, target eligibility and quantity-weighted accounting. It must not invoke a historical runner, fetch data, size a live order or replace a frozen core. Each output denies execution and empirical authorization. A later integrated engine requires its own identity, separate source review and reconciled candidate/run budget. Engineering correction does not itself confer profitability or permission to rerun research.

Distinguish deterministic bugs (wrong duration, unsigned payoff, missing residual quantity) from model choices (fills within a candle, gap price, break-even activation). The latter are explicit synthetic conventions here, not validated venue behavior.

## Time and input contract

- Raw bars use explicit openTimeMs and exclusive closeTimeMs. Require safe integer UTC timestamps, declared duration, positive finite OHLC, nonnegative finite volume, valid high/low bounds, exact contiguity, and unique timestamps. Reject rather than sort, coerce, drop or silently fill malformed observations.
- A pivot needs the declared number of completed bars on both sides. Its earliest geometric confirmation is the rightmost confirmation bar's exclusive close, using its actual timeframe duration: 4h for four-hour bars, 24h for UTC daily bars. Any publication delay and receipt admission occurs after geometric confirmation.
- Exact daily aggregation requires six distinct consecutive UTC-aligned four-hour intervals covering the entire day. A count of six is insufficient. Missing/duplicate/misaligned intervals make the aggregate invalid.
- Actual receipt and assumed historical publication are different APIs/metadata. Never backdate archive receipt. A historical assumption cannot establish historicalAvailabilityVerified or revisionHistoryVerified.
- Keep original asymmetric pivot ties as an explicitly named legacy comparator; changing tie rules is a separate declared change. Earlier admitted annotations must be invariant under appending observations unavailable at that earlier decision.

## Target admission and immutable risk denominator

Let sideSign be +1 for long and -1 for short; entry be the modeled fill; originalStop the pre-entry stop; D=sideSign*(entry-originalStop). Require D>0 and finite before position creation. Every target must satisfy sideSign*(target-entry)>0. Targets must be ordered strictly farther in the profit direction. Equality, reversed ordering or a gap that puts any target behind the fill yields INVALID_TARGET_GEOMETRY: do not open a position under this draft convention. Log the skipped candidate and reason; never retarget, clamp, take absolute distance or choose a favorable surviving target.

This pre-entry rejection is a hypothetical simulator convention; it does not assert that a real already-sent order could have been cancelled at its eventual fill price. A later real-order design needs explicit order type and price protection. Original-stop distance D stays fixed after partial exits and stop changes; do not renormalize R after losses or break-even relocation.

## Signed quantity accounting

Use fractions of initial quantity. Initial open fraction=1. Each exit has unique event identity, exit fraction q>0, actual modeled fill and cost in declared units. Require cumulative exited fraction<=1; duplicate events and over-exits reject without mutation. Gross realized R=sum(q*sideSign*(fill-entry)/D). Residual open quantity is never silently treated as exited at entry. Net realized R subtracts explicitly supplied entry/exit costs normalized by initial quantity times D. Entry cost is charged once, exit costs by actual executed quantity. Unknown costs yield netR:null plus COSTS_UNRESOLVED, never implicit zero or fixed0.05R. Explicit zero costs are allowed for arithmetic fixtures, labelled SYNTHETIC_ZERO_COSTS.

Keep realized exits, residual position and any separately timed mark-to-market distinct. A partial record is not a closed trade. Exactly-once event accounting is local deterministic validation, not durable journal/transport evidence.

## Proposed synthetic bar execution convention

These rules govern a later test adapter only; pure accounting helpers consume explicit fills and do not infer them from OHLC.

1. Process an already-active protective stop at opening before intrabar tests. For a long opening below the stop, fill at the adverse opening; for a short opening above it, likewise. Additional adverse slippage is explicit. A stop is not a guaranteed price.
2. If the opening has not crossed a stop, but the bar range touches it, model a stop-level fill plus declared adverse slippage. If the same bar can touch both an active stop and target and order is unobservable, mark the case AMBIGUOUS_STOP_FIRST and use stop-first for this named proxy. This is a convention, not proof of the actual path or a universal worst-case bound.
3. Only eligible active target orders can fill. The synthetic target proxy gives no favorable gap improvement and uses the declared target price; document fill uncertainty. Never infer a fill merely from a chart line/zone or transformed candle.
4. The chosen two-target fixture exits half the initial quantity at target1 and the remainder at target2. A proposed break-even stop becomes active at the next bar opening after the target1 fill, never retroactively within that bar. For a long, the effective stop becomes max(originalStop,entry); for a short min(originalStop,entry). This is a declared model change, not a claim that frozen Wave3 already does it. OriginalStop remains stored for risk accounting.
5. At the next opening, a gap through the new effective stop fills at the adverse opening, not entry. If the original stop remains active under a separately named NO_RELOCATION comparator, its residual loss must be booked; a label cannot substitute for quantity arithmetic.
6. New entries require an observation strictly after signal availability. Reject a signal-candle entry. Intrabar entry-and-exit ordering is not specified by this contract; do not integrate a general OHLC strategy engine until that separate ambiguity is resolved.

## Required synthetic acceptance cases

| Area | Required expectation |
|---|---|
| Daily confirmation | Available only after the rightmost confirmation day's close and admission; 20h early label rejected; prefix-invariant annotations. |
| Aggregation/input | Five+duplicate, missing interval, nonfinite/negative OHLC, wrong duration, unordered and extra future observations reject without mutation. |
| Long and short geometry | Behind-entry, equal and misordered targets reject; valid mirrored geometry admits; no automatic target repair. |
| Signed exits | Entry136/stop120, hypothetical equal exits126.18 and130 produce gross -0.494375R in the fill-accounting helper; entry-admission helper rejects these targets. These test different layers. |
| Gap stop | Entry121/stop110, modeled exit90 produces -31/11R gross, with explicit costs applied separately; mirror for shorts. |
| Partial original-stop exit | Half at130, half at110 from entry121 and D11 gives -1/11R gross; no omitted residual. |
| Actual break-even | Half at130 then residual at121 gives 4.5/11R gross; next-open gap120 instead gives4/11R. Fees can make a nominal break-even exit a loss. |
| Event/quantity integrity | Repeated ID, over-exit, wrong side, zero/negative D, invalid fractions/costs fail without state changes; open residual cannot masquerade as closed. |
| Path conventions | Both stop/target touched, target1-bar return, next-bar effective stop and gap through it have separately asserted precedence and ambiguity labels. |
| Legacy comparison | Original8 characterization tests remain unchanged and pass; this proves baseline preservation, not corrected-engine completeness. |

Before implementation, specify exact helper schemas, error codes, cost units and numeric tolerances in the corresponding source/tests. Use bounded positive rational fixtures and tolerance justified by arithmetic; monetary production integration would need an explicit decimal/integer rounding contract. No exhaustive venue simulation is claimed.

## Exit criteria and remaining gates

Acceptance for this design packet is internal independent source review. Acceptance for a future helper packet requires independent synthetic tests, original blob integrity and explicit coverage limits. Include the implementation and findings in the next bounded Claude review after checking M11 resource use. No new Claude invocation is required merely to publish this draft.

Still outside scope: historical result-artifact authentication, order-book/venue validation, instrument sizing and rounding, full entry/fill engine, short borrowing/funding/margin, historical receipt/revision verification, cumulative trial allocation, untouched evaluation data and owner empirical authorization. No empirical runs, performance pass, strategy registration, Paper/Live promotion, trading, merge or scheduler activation follows from this document.
