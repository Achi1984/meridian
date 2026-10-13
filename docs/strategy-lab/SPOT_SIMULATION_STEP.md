# Atomic synthetic spot step

`simulateSpotStep(book, envelope, policy)` composes the existing lifecycle, exact
EUR sizer and ledger using synthetic inputs only. book has exactly symbol,
lifecycle and account; envelope has exactly symbol and event. Symbols must match.
This is a dedicated single-instrument EUR account: no position when FLAT or
PENDING_ENTRY; exactly one positive-lot position of that symbol when LONG or
PENDING_EXIT. Account schema, amounts and full unique fill-ID history are checked
even when the event produces no fill. Lifecycle validation is delegated to its
reducer before any state is returned. Coherent forged histories are not authenticated.

Every lifecycle/event price in this bridge is a positive safe integer NUMBER of
EUR micros per whole lot. Fractional/unsafe prices reject, including existing
position/stop fields. There is no floating-point-to-micros conversion or FX.
Ledger monetary amounts and sizing policy amounts remain canonical unsigned
integer STRINGS, at most 30 digits. Policy always requires riskBudgetMicros,
remainingExposureMicros, stressedExitPriceMicrosPerLot and integer feeBps
from 0 through 10,000. Budgets, lot definitions and reserved funds are caller inputs.

For BUY, current ask is the sizing entry price and account cash supplies the cash
constraint. Stressed exit must be at/below the lifecycle initial stop, itself below
entry quote bid. A zero feasible quantity rejects the whole step: no phantom LONG
is committed. SELL uses all held lots, actual indicative bid (including stop gaps)
and an independently upward-rounded fee. It does not rerun entry budget or stress
orientation gates. Zero entry risk/exposure budgets do not prevent an otherwise
valid exit. Unused stressedExitPriceMicrosPerLot may also be `"0"` on SELL or
no-fill events; the sizer requires it positive only on BUY. A malformed policy
still rejects all events.

The ledger fill ID is event.id, restricted here to 1–64 ASCII letters, digits,
colon, underscore or hyphen. Signal IDs follow the lifecycle's separate 80-character
rule. Lifecycle quoteAt, receivedAt, fillAt, signalAvailableAt map respectively to
ledger quoteAtMs, quoteReceivedAtMs, fillAtMs, signalAvailableAtMs. The inherited
1,000 ms freshness bound is an uncalibrated prototype assumption. Bid/ask already
include spread; no additional spread charge is introduced. Fees only, no new cost
estimator, PnL, actual orders, network or strategy evaluation.

Success returns valid:true, next book, optional fill and BUY sizing, errors:[],
executionAuthorized:false and researchOnly:true. On ANY validation, sizing or
ledger rejection it returns the ORIGINAL book unchanged, fill:null and sizing:null.
Both candidate states are committed only to the returned object after all checks.
No-fill events advance only lifecycle after account validation. Inputs are not mutated.
Caller must persist/restore both states together. This function supplies no disk
transaction, locking, compare-and-swap, reservation or concurrent-write protection.

This is not production safety infrastructure. Both inherited 10,000-ID capacity
limits remain: exhaustion can block even a protective stop. Ledger overflow or
malformed inputs can likewise leave the prior open position unchanged. No emergency
execution path exists here. Modeled stress risk is not maximum loss, and indicative
quotes are not guaranteed fills. Synthetic tests establish only composition behavior.
