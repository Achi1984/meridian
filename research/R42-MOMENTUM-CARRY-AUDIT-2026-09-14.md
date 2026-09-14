# R42 focus audit — momentum and carry

Read-only production observation at 2026-09-14 09:46 UTC. The engine was running,
market data was fresh and reported zero errors. No parameter or ledger was changed by
this audit.

## Decision

- **Relative Momentum:** continue the already open paper basket unchanged. It has one
  open basket, zero closed baskets and an unrealized result of -$3.27. There is no
  outcome sample from which to tune the score, holding period or risk.
- **BTC Funding Carry V1:** continue the frozen paper cycle. It reports -$24.55 total,
  composed of +$7.79 funding, -$0.41 basis and $31.93 estimated costs. The latest
  settlement was +$0.80. The negative headline is therefore the unamortized entry and
  reserved exit cost, not evidence that funding itself is negative.
- **Funding Carry V2 / R42 Carry:** do not open. V2 cost coverage is 1.24x versus its
  locked 2x hurdle; the R42 selector uses an even stricter 2.5x hurdle and reports
  `NO_COST_COVERED_CARRY`.
- **Residual Pairs:** seal with `NO_ROBUST_PAIR_IN_WALK_FORWARD`. The frozen 167-day
  replay produced zero eligible entries across 28 fixed pairs.
- **Squeeze Exhaustion:** keep as an inactive research idea, not a bot. Complete
  liquidation-event coverage is still unavailable.

## Next evidence gates

1. Momentum: wait for its first seven-day basket closure; do not interpret unrealized
   PnL as a strategy result. Evaluate only after at least 12 independent weekly baskets.
2. Momentum: before any successor parameters, run a frozen walk-forward replay with
   weekly rebalancing, four-leg costs, funding and beta-drift attribution.
3. Carry V1: report funding, basis and costs separately through its 30-day checkpoint.
   Do not close or optimize merely because upfront costs keep early PnL negative.
4. Carry V2: entry remains mechanical; only current net carry coverage may unlock it.
   Do not lower the hurdle after observing a quiet funding regime.

## Momentum walk-forward result

`MOMENTUM-WALKFORWARD-V1` reproduced the production calculation with 32 daily closes,
a 30-day return rank, four equal-dollar legs, net beta <= 0.10 and seven-day holding
periods. It used the same extended historical input as the pairs replay, 30 bps total
round-trip costs and actual funding settlements.

- 38 scheduled rebalances; 16 rejected by the beta/data signal gate.
- 22 completed baskets; win rate 27.3%; profit factor 0.14.
- Price PnL -$302.60; funding +$2.54; costs -$132.00; net -$432.06.
- Maximum closed-equity drawdown $432.06; no open historical basket at the end.

This rejects the current rank-continuation hypothesis. The live paper basket remains
managed under its frozen exit rules, then the ledger seals with
`HISTORICAL_WALK_FORWARD_REJECTED`. No successor or inverse-rank variant is authorized
from the same sample; that would be post-hoc parameter selection.

Reproduce with the frozen environment and collected snapshot:

```sh
/tmp/meridian-pairs-venv/bin/python research/momentum_walkforward.py /tmp/pairs-history.json --costs-bps 30
```
