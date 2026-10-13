# Exact EUR spot sizing prototype

`sizeSpotEntry(input)` is pure offline arithmetic for a long spot entry. It accepts
exactly currency (`EUR`), cashMicros, riskBudgetMicros, remainingExposureMicros,
entryPriceMicrosPerLot, stressedExitPriceMicrosPerLot, and feeBps. Monetary inputs
are canonical unsigned integer strings of at most 30 digits, including `"0"` for
budgets; both prices must be positive and stressed exit must be below entry.
feeBps is an integer number from 0 to 10,000 inclusive, applied to each side.
There are no inferred budgets, optimized defaults, leverage or reward:risk floor.

For each whole-lot quantity q, entry notional is q times entry price. Each side's
fee is independently rounded upward to whole EUR micros using exact BigInt:
`ceil(notional * feeBps / 10000)`. Modeled risk equals entry notional plus entry
fee minus stressed exit notional plus stressed exit fee. All three constraints
must hold simultaneously: entry debit <= cash; gross entry notional <= remaining
exposure; modeled risk <= risk budget. Modeled risk is monotone because the price
difference is positive and both rounded fees are nondecreasing. An upper bound
from cash/exposure and an upward-rounded binary search find the largest feasible
integer quantity in at most 100 iterations, without floating point arithmetic.

The result includes valid, candidate, errors, sizing, executionAuthorized:false
and researchOnly:true. Sizing contains lots, entryNotionalMicros, entryFeeMicros,
entryDebitMicros, stressedExitNotionalMicros, stressedExitFeeMicros,
stressedExitCreditMicros, modeledRiskMicros and cashRemainingMicros, all exact
integer strings of at most 30 digits. Zero feasible lots is valid with
candidate:false and zero trade amounts. Invalid input returns sizing:null.
Neither candidate nor valid means suitable, profitable or authorized to trade.

The stressed price is an explicit upstream assumption, not a guaranteed stop
fill or maximum loss. Gaps or worse fills can exceed modeled risk and can lose
the full invested notional plus costs. Entry should reflect ask-side pricing and
stressed exit bid-side pricing; spread must not then be added again. There is no
slippage estimator, FX conversion, lot-definition verification, minimum-notional
check, liquidity check or portfolio budget allocator here. Caller must validate
those assumptions and residual budgets independently. Existing holdings can also
cause the separate ledger's aggregate position capacity to reject an entry.
Cash, remaining exposure and risk budgets must already account for other positions
and reserved orders. This pure function does not reserve funds or prevent concurrent
double allocation. Exact BigInt intermediate products may exceed 30 digits;
only the bounded inputs and serialized output amounts have that limit.

Synthetic tests compare maximality with a small exhaustive reference and pass a
sized BUY into applySpotFill, verifying matching cash and fees. That narrow test
is bookkeeping compatibility only: no lifecycle wiring, actual execution,
historical data, strategy performance or PnL run is performed. Inputs are unchanged.
