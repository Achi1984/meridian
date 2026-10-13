# Offline planned net CRV evaluator

`evaluate-trade-plan.mjs` exports the pure deterministic function `evaluateTradePlan(plan)`. It performs no I/O, networking, scheduling, persistence or orders. `executionAuthorized` is always false, including when `valid` and `qualifiesPlannedCRV` are true. Mathematical qualification is **not** strategy readiness, evidence of realistic costs, profitability, research permission or runtime enforcement.

## Exact input contract

```json
{
  "schemaVersion": "MERIDIAN_LINEAR_TRADE_PLAN_V1",
  "instrument": "LINEAR_SPOT",
  "direction": "LONG",
  "quantity": 1,
  "entryPrice": 100,
  "stopPrice": 90,
  "exits": [{"price": 138, "portionBps": 10000}],
  "targetCosts": {"fee": 1, "spread": 1, "slippage": 0, "fundingBorrow": 0},
  "stopCosts": {"fee": 1, "spread": 1, "slippage": 0, "fundingBorrow": 0}
}
```

Only one **linear** spot long or linear perpetual long/short position is supported. Inverse contracts, options, spot shorts, multi-leg trades, pair/carry payoff structures and unknown products are rejected. There is no leverage field and returns are never multiplied by leverage. This does not exempt unsupported strategies from the campaign's CRV policy; they remain research-only until separately reviewed appropriate models exist.

All object keys are exact; missing and extra fields reject the input. Quantity is the base-asset quantity, not contract count. Prices and every PNL/cost amount share one quote currency. Quantity/prices must be finite positive numbers. The stop must be strictly below entry for long, above entry for short. No stop is inferred, adjusted or moved to force qualification.

`exits` has 1–10 declared portions. Each `portionBps` is an integer in 1–10000; the sum is exactly 10000. Every remainder must have its own declared exit price. Mixed profitable and losing portions are allowed: the total planned outcome decides qualification, not the final or best target alone. Unknown runner exits reject by absence of a complete declared split.

The target and stop cost objects must each explicitly contain nonnegative finite `fee`, `spread`, `slippage`, and `fundingBorrow` values. They are whole-position quote-currency totals for the respective scenario, including entry and all applicable exit costs. No negative rebates or favorable funding credits are accepted. Zero must be supplied explicitly when appropriate; zero is not evidence the cost is truly zero. Supply conservative execution assumptions and adverse funding/borrow over a declared holding horizon externally. Avoid double-counting spread/slippage already embedded in assumed executable prices. The function cannot establish that these assumptions are realistic, complete or conservatively estimated.

## Calculation and examples

For sign +1 long / −1 short:

- Gross reward = sum of `quantity × portionBps / 10000 × sign × (exitPrice − entryPrice)`.
- Net reward = gross reward − all target-scenario costs.
- Gross stop loss = `quantity × sign × (entryPrice − stopPrice)` for the **full initial position**.
- Net risk = gross stop loss + all stop-scenario costs; it must be finite and strictly positive.
- Qualification = **net reward ≥ 3 × net risk**, by exact decimal cross-multiplication over every original input, without rounding the ratio or applying a tolerance.

The example gives gross reward 38, target costs 2, net reward 36; gross stop loss 10, stop costs 2, net risk 12. It qualifies exactly at 3:1. Changing the target from 138 to 137 gives 35/12 and fails.

For a partial-exit example, keep entry 100, stop 90, quantity 1 and costs 2 per scenario: 5000 bps at 124 and 5000 bps at 152 give gross reward 12 + 26 = 38, hence exactly 3:1 net. Replacing the second exit with 148 gives gross reward 36, net reward 34 and fails. A single faraway final target cannot mask an omitted earlier portion or runner.

For a short example, use `LINEAR_PERPETUAL`, `SHORT`, entry 100, stop 110 and a full exit at 62 with the same costs: gross reward 38 and gross stop loss 10 again yield exactly 3:1 net.

Invalid inputs or nonfinite intermediate/final reporting arithmetic fail closed: `valid:false`, `qualifiesPlannedCRV:false`, nonempty `errors`, and all numeric result fields null. Valid below-threshold plans have `valid:true` but `qualifiesPlannedCRV:false`. Reported numeric values use JavaScript IEEE-754 numbers and are approximate. Explicit detected quantity/risk underflow is rejected.

Qualification separately uses exact BigInt decimal arithmetic: each validated numeric input is interpreted as the exact decimal string produced by JavaScript `Number.toString()`. All original prices, quantities, basis-point portions and both scenario costs participate in that calculation. Precision already lost before calling the function cannot be recovered; the schema accepts numbers, not arbitrary decimal strings. Finite input exponents and the ten-portion cap bound this arithmetic.

Consequently, a reported ratio can round to 3 while qualification is false. Example: entry 100, stop 90, target 130, quantity 1, all costs zero except target fee `1e-16`. Exact decimal net reward is below 30 and the trade does **not** qualify, even if the approximate displayed net reward is 30. The same applies to any positive stop-scenario cost at the otherwise exact 3:1 boundary.

## Deliberate limits

This is a planned target scenario compared with a full initial stop scenario, **not** sequential partial-fill path simulation. Stops can gap or fail. This is not a liquidation, margin, maximum-loss, funding-history, probability or expectancy model. Time exits and emergency exits can realize less than 3:1 and require separate execution and strategy testing. No candidate or frozen LowVol reference is changed, approved or activated by this module.
