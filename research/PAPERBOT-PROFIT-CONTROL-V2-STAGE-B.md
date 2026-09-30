# Paper Profit Control V2 — Stage B Numeric Gates

Status: **FROZEN PREREGISTRATION / NUMERIC ACCEPTANCE GATES**
Parent control: `research/PAPERBOT-PROFIT-CONTROL-V2.md`
Stage A evidence: `research/PAPERBOT-PROFIT-CONTROL-V2-STAGE-A-EVIDENCE.md`
Execution impact: **false**
Paper/live parameter changes: **false**
Auto-promotion: **forbidden**

## Approved profile

Profile name: **PROFIT_FIRST_BALANCED_V1**

The following values were explicitly approved before any Stage-B candidate result inspection.

| Gate | Frozen value |
|---|---:|
| Maximum closed-equity drawdown | **20%** |
| Minimum Profit Factor | **1.15** |
| Maximum single-asset share of positive PnL | **35%** |
| Minimum evaluation periods | **30** |
| Positive chronological windows | **4 of 5** |
| Minimum positive assets | **5 of 8** |
| Baseline transaction-cost assumption | **8 bps turnover** |
| Mandatory stress transaction-cost assumption | **16 bps turnover** |
| Stress requirement | **net compounded return > 0** |
| Maximum research leverage | **2x** |

## Frozen universe

The Stage-B breadth gate uses the existing documented-edge universe unchanged:

- BTC
- ETH
- SOL
- XRP
- HBAR
- LINK
- AVAX
- SUI

No asset may be removed after results are viewed.

## Stability and breadth

- Exactly five chronological evaluation windows are used for the stability gate.
- At least four must have positive net compounded return.
- At least five of the eight frozen assets must contribute positive net PnL.
- No single positive asset may contribute more than 35% of total positive candidate PnL.
- A candidate with positive aggregate profit but insufficient breadth/stability fails.

## Cost gate

Each candidate is evaluated twice without changing strategy parameters:

1. baseline: **8 bps** turnover cost;
2. stress: **16 bps** turnover cost.

The candidate must remain net-positive under the stress-cost run. Costs may be increased for additional stress diagnostics, but may never be reduced below the frozen baseline to rescue a result.

## Drawdown and leverage

- Maximum allowed closed-equity drawdown: **20%**.
- Maximum research leverage: **2x**.
- No leverage escalation after losses.
- No martingale, pyramiding rescue or loss-chasing DCA.
- A drawdown breach is a hard failure regardless of absolute profit.

## Candidate families

Stage B allows preregistration/implementation of only:

1. volatility-managed time-series momentum;
2. regime-gated trend / breakout;
3. delta-neutral funding carry;
4. range/grid only after a separately frozen range-regime classifier passes.

Candidate-specific parameters must be frozen before candidate results are inspected.

## Holdout integrity

- Discovery and holdout are strictly separated.
- Holdout parameters are immutable.
- No candidate may be retuned after holdout inspection.
- No threshold may be relaxed after discovery or holdout results.
- No single asset, window or market regime can authorize advancement.
- A passing discovery candidate advances only to independent holdout.
- A passing holdout advances only to Paper shadow/forward evaluation.
- No Stage-B result authorizes live execution.

## Gate logic

A candidate passes the numeric research gate only if **all** are true:

- evaluation periods >= 30;
- net compounded return > 0 at 8 bps;
- Profit Factor >= 1.15;
- max drawdown <= 20%;
- positive windows >= 4/5;
- positive assets >= 5/8;
- positive-PnL concentration <= 35%;
- net compounded return > 0 at 16 bps;
- no anti-overfitting/provenance violation.

Highest return is considered only among candidates that pass every frozen gate.

## Stage-B state

`PAPER_PROFIT_CONTROL_V2_STAGE_B_GATES_FROZEN`

This state authorizes candidate preregistration and implementation only. It does not authorize result-driven tuning, Paper promotion or live execution.
