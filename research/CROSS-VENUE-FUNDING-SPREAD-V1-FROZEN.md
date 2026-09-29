# Cross-Venue Funding Spread V1 — Frozen Research Protocol

Status: **FROZEN BEFORE RESULT**  
Execution impact: **false**  
Auto-promotion: **false**  
Parent: canonical MERIDIAN main after PR #258

## Objective

Test a simple delta-neutral cross-venue funding-spread hypothesis without rescuing or retuning the retired single-venue Funding Carry V1/V2 rules.

The frozen direction is:
- **LONG Binance USD-M perpetual**
- **SHORT Hyperliquid perpetual**

The direction is selected before results from independent 2026 evidence reporting a persistent Hyperliquid-vs-centralized-venue funding spread. No ex-post venue flipping is allowed in V1.

## Universe

Fixed assets:
- BTC
- ETH
- SOL

No asset may be removed after results are inspected.

## Evaluation interval

- Start request: 2023-01-01 UTC
- End: 2026-09-01 UTC
- Only fully completed calendar months are eligible.
- A month/asset cycle is included only when both venues pass the data gate.

## Position model

Per asset cycle:
- $10,000 notional LONG Binance perpetual
- $10,000 notional SHORT Hyperliquid perpetual
- conservative capital denominator: $20,000
- entry at the first valid 8h close in the month
- exit at the final valid 8h close in the month
- fixed base quantity per leg from its own entry mark
- no leverage credit, no collateral yield, no rehypothecation benefit
- no intramonth timing, stop, rotation or funding forecast

## Funding PnL

Funding is calculated from realized historical funding rates.

Frozen normalized funding model:
- Hyperliquid SHORT funding contribution = +$10,000 × sum(realized Hyperliquid funding rates)
- Binance LONG funding contribution = -$10,000 × sum(realized Binance funding rates)
- net funding = Hyperliquid contribution + Binance contribution

This fixed-notional normalization avoids inventing unavailable historical position-level margin state. Funding, basis and costs are reported separately.

## Basis PnL

For each venue, fixed base quantity is derived from entry mark:
- Binance long basis PnL = q_binance × (exit_binance - entry_binance)
- Hyperliquid short basis PnL = q_hyperliquid × (entry_hyperliquid - exit_hyperliquid)

Cross-venue basis risk is therefore included rather than assumed to converge.

## Costs

Per fill, frozen before results:
- fee: 5 bps
- slippage: 3 bps

Four fills per monthly cycle (open/close × two venues):
- modeled base round-trip cost = 32 bps of one-leg notional = $32 per cycle

Stress:
- add 5 bps per fill on top of the base model
- stressed cost = 52 bps of one-leg notional = $52 per cycle

No maker rebates, VIP discounts or token-fee discounts are assumed.

## Data gate

Hyperliquid:
- public `fundingHistory`
- public `candleSnapshot` at 8h
- time-range pagination for funding history
- no synthetic backfill

Binance:
- public USD-M historical funding-rate endpoint
- public USD-M mark-price 8h klines
- no synthetic backfill

A cycle fails closed when:
- either venue has no valid entry/exit mark;
- funding observations are missing for a material interval;
- timestamps are non-monotonic or duplicated after normalization;
- required source response is invalid;
- cycle duration is materially shorter than the calendar month.

## Discovery gate

The V1 research hypothesis passes only if **all** are true:
- >= 24 completed asset-month cycles
- aggregate net return > 0
- Profit Factor >= 1.15
- max closed-equity drawdown <= 10%
- >= 4 of 5 chronological windows positive
- BTC, ETH and SOL each have positive net PnL
- no single asset contributes > 60% of positive net PnL
- aggregate result remains positive under the +5 bps/fill stress
- data gate passes without synthetic reconstruction

A pass is **research discovery only**. It does not authorize Paper shadow or live execution.

## Anti-overfitting rules

- This protocol must be committed before the first real result.
- No venue direction flip after seeing results.
- No asset removal after seeing results.
- No date-window selection after seeing results.
- No fee/slippage reduction after seeing results.
- No gate relaxation after seeing results.
- No smart timing filter may be added to rescue a failed V1 result.
- If V1 fails, any successor receives a new ruleset and new preregistration.

## External evidence and data references

- Lau (2026), *The Funding Carry and a Cross-Venue Spread on Perpetual Futures*, SSRN 6993978.
- Hyperliquid public info API: fundingHistory, candleSnapshot and pagination rules.
- Binance USD-M public funding-rate and mark-price historical data endpoints.
- OKX funding documentation is retained as a possible future independent venue, not part of V1.

Research only. No order functions. No Pionex/OKX/Hyperliquid/Binance account credentials are required.
