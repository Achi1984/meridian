# Paper Profit TSMOM V2 — Frozen First Result

Status: **DISCOVERY FAIL / HOLDOUT UNTOUCHED**
Execution impact: **false**
Auto-promotion: **false**

## Provenance

- Workflow: MERIDIAN Paper Profit TSMOM V2
- Run: **36748128411 — SUCCESS**
- Artifact: **11113377407**
- Artifact digest: `sha256:d0049137ef899fedff2e01a9185bbcc11a036343ecbc6c37c122c896db611dd5`

## Frozen split

- Common timestamps: **1246**
- Discovery timestamps: **872**
- Holdout timestamps: **374**
- Discovery: 2023-05-03 through 2025-09-19
- Holdout starts: 2025-09-20
- Holdout returns were **not evaluated** because discovery failed.

## Discovery

- Evaluation periods: **37**
- Net compounded return: **-7.84%**
- PnL: **-783.55**
- Profit Factor: **0.751**
- Max drawdown: **13.28%**
- Positive windows: **1/5**
- Positive assets: **5/8**
- Positive-PnL concentration: **30.77%**
- 16-bps stress return: **-8.10%**

## Frozen gate decision

`TSMOM_V2_DISCOVERY_FAIL`

Failed gates:
- baseline net return not positive;
- Profit Factor < 1.15;
- positive windows < 4/5;
- 16-bps stress return not positive.

Passed/within-limit observations do not rescue the candidate:
- max drawdown was within 20%;
- positive assets met 5/8;
- positive-PnL concentration was within 35%.

No threshold, universe, lookback, cost, split or leverage parameter may be changed to rescue this version.

Holdout remains untouched and unauthorized.
