# MERIDIAN v7.101 — Simultaneous Portfolio Risk Budget Design

Status: PREDECLARED / RESEARCH ONLY / NO PROMOTION  
Declared: 2026-09-06, before the first v7.101 result

## One structural hypothesis

Frozen v7.97 evaluates assets independently. When several assets produce a trade at the same decision timestamp, their incoming risk multipliers can create concentrated simultaneous exposure. A portfolio-level allocator should preserve every opportunity but proportionally normalize the timestamp bundle to a fixed aggregate budget of 1.00 research-risk unit.

For each identical decision timestamp:

`bundleScale = min(1, 1.00 / sum(incoming v7.97 riskMultiplier))`

Every row in the bundle receives incoming risk x `bundleScale`. Gross R, costs and net R are scaled identically.

This is portfolio risk allocation, not a new alpha signal. It uses no realized outcome, trailing performance, asset quality, side, regime, funding, OI or taker flow.

## Leakage and invariants

- Inputs are only the simultaneous frozen v7.97 decisions and their already-computed risk multipliers.
- No future or matured result is read.
- Every v7.97 trade remains; no blocking, ranking or winner selection.
- Relative risk inside a bundle is preserved.
- Risk may only decrease and aggregate outgoing bundle risk may not exceed 1.00.
- Single/opportunistically small bundles remain unchanged.
- No Baseline, Paper, live execution, Pionex, `server.js`, entry or exit change.
- Seven-asset universe, costs, horizons and timestamps remain frozen.

The 1.00 budget is fixed before results as one full research-risk unit. It will not be tuned after results.

## Frozen evaluation

Compare v7.93, v7.96, v7.97 and v7.101 on identical rows:

- primary horizon 24h; sensitivity 4h and 12h
- 30d, 60d and 90d
- three chronological 90d folds
- PF, expectancy, net R, maximum drawdown and opportunity count
- net-R/max-DD ratio as a portfolio efficiency diagnostic
- LONG/SHORT x regime and asset concentration
- scaled trade/bundle count, average scale, maximum incoming and outgoing bundle risk

## Decision rule

v7.101 survives as a research candidate only if:

1. opportunity count is identical in every comparison;
2. outgoing risk never exceeds 1.00 per timestamp;
3. max drawdown improves on all primary 24h windows;
4. net-R/max-DD improves on 60d and 90d without PF falling by more than 0.05;
5. no chronological fold has a materially worse loss/DD profile;
6. the benefit is not merely deletion by scaling almost all risk toward zero.

Failure means no budget tuning. It returns research to the locked prospective holdout or a separately designed allocator architecture. Promotion remains forbidden regardless of outcome.
