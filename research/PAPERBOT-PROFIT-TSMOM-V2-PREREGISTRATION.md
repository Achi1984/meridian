# Volatility-Managed TSMOM V2 — Frozen Preregistration

Status: **FROZEN BEFORE RESULT INSPECTION**
Parent: `PAPER_PROFIT_CONTROL_V2_STAGE_B_GATES_FROZEN`
Execution impact: **false**
Auto-promotion: **false**

## Hypothesis

A diversified volatility-managed time-series momentum portfolio can produce positive net out-of-sample return across the frozen MERIDIAN universe while satisfying the Profit-first Balanced Stage-B risk, breadth, stability and cost gates.

This is a forward research hypothesis, not a claim that prior TSMOM results pass Stage B.

## Frozen universe

- BTC
- ETH
- SOL
- XRP
- HBAR
- LINK
- AVAX
- SUI

No asset may be removed after results are viewed.

## Frozen signal / sizing configuration

The candidate reuses the existing documented-edge TSMOM structure without result-driven parameter changes:

- lookbacks: **30 / 90 / 365 days**
- rebalance interval: **30 days**
- realized-volatility lookback: **60 days**
- annualized volatility target per market: **10%**
- maximum research leverage: **2x**
- baseline turnover cost: **8 bps**
- mandatory stress turnover cost: **16 bps**
- no pyramiding
- no martingale
- no averaging down
- both long and short signals remain eligible

## Frozen evaluation split

The first implementation must derive a deterministic chronological split from the available common dataset **before computing any candidate return**:

- **Discovery:** first 70% of common eligible timestamps.
- **Holdout:** final 30% of common eligible timestamps.
- Split timestamp is computed once from timestamps only and written into the run manifest before signal/return evaluation.
- Holdout rows are not used for parameter selection, candidate filtering or threshold changes.
- If either segment cannot satisfy the Stage-B minimum evaluation-period requirement under the frozen cadence, the candidate fails closed as `INSUFFICIENT_SPLIT_SAMPLE`; the split must not be moved to rescue it.

## Frozen Stage-B gates

Discovery and holdout are evaluated independently against the approved Stage-B hard gates:

- evaluation periods >= **30**
- net compounded return > **0**
- Profit Factor >= **1.15**
- max drawdown <= **20%**
- positive chronological windows >= **4/5**
- positive assets >= **5/8**
- positive-PnL concentration <= **35%**
- 16-bps stress net compounded return > **0**
- provenance confirmed
- holdout untouched

A discovery pass only unlocks holdout evaluation. A holdout pass only unlocks Paper shadow/forward research.

## No rescue rule

After the first result is computed, none of the following may change inside this candidate version:

- universe
- lookbacks
- rebalance cadence
- volatility lookback/target
- leverage cap
- transaction-cost assumptions
- discovery/holdout split rule
- acceptance gates

Any change requires a separately named/versioned hypothesis and a new preregistration before results.

## Decision labels

- `TSMOM_V2_DISCOVERY_FAIL`
- `TSMOM_V2_DISCOVERY_PASS_HOLDOUT_REQUIRED`
- `TSMOM_V2_HOLDOUT_FAIL`
- `TSMOM_V2_HOLDOUT_PASS_PAPER_SHADOW_REQUIRED`

No label authorizes live execution.
