# Spot-Perp Basis Dislocation V1 Data Foundation V1 — Frozen Result

Workflow run: **36595118222**  
Artifact: **11045157913**  
Artifact ZIP SHA-256: `28800a4ea1c1f0c880501beb7a9dd316950474a129bd9875278fc2202b9e4662`  
Foundation JSON SHA-256: `32d2481012bf748fb38160a1bdacbb7e8c7572b62d0bfaf13703f9acb7ad3583`

This records the first untouched result of `SPOT-PERP-BASIS-DISLOCATION-V1-DATA-V1-FROZEN`.

## Frozen scope

Universe:
- APT
- APE
- CRV
- SUSHI
- DYDX
- LDO
- GALA
- IMX

Audit interval:
- 2024-06 through 2026-08 inclusive
- 27 completed calendar months

Sources:
- Binance Vision Spot 8h trade klines
- Binance Vision USD-M perpetual 8h trade klines
- Binance Vision USD-M realized funding archives

## Result

**FOUNDATION_PASS**

Qualified: **8 / 8**

Unexpected transport errors: **0**

Strategy PnL calculated: **false**

Basis threshold inferred: **false**

Funding threshold inferred: **false**

Synthetic backfill used: **false**

## Coverage

Every candidate passed all 27 months:

- exact monthly Spot 8h row count;
- exact monthly Perp 8h row count;
- exact 8h cadence;
- exact month-start and month-end boundaries;
- Spot/Perp open-time sets identical;
- basis finite at every synchronized row;
- funding finite and monotonic;
- no duplicate funding timestamps;
- monthly funding count >=60;
- funding max gap <=12 hours.

## Gate decision

The preregistered minimum breadth was 6/8 fully qualified assets. All eight candidates pass.

This authorizes only a separately frozen Spot-Perp Basis Dislocation strategy protocol.

It does not authorize:
- strategy PnL;
- basis percentile/threshold selection after looking at returns;
- funding-threshold tuning;
- Paper shadow;
- live execution.

## Anti-overfitting status

- universe unchanged;
- interval unchanged;
- no asset substitution;
- no synthetic reconstruction;
- no basis distribution statistics used for strategy selection;
- no PnL;
- no signal threshold inferred.

The next allowed step is to freeze basis lookback, entry/exit rule, funding confirmation, costs, discovery/holdout split and promotion gates before first strategy PnL.
