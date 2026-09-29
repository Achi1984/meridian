# Relative-Value / Beta-Neutral Perpetual Reversal V3 Data Foundation V1 — Result

Status: **FOUNDATION FAIL / DATA REDESIGN REQUIRED**  
Execution impact: **false**  
Strategy PnL observed: **false**

Workflow run: **36604678672**  
Head commit: `7ffd3534d820ac45b14db6a4d091b1d7808e09c2`  
Artifact: **11050019526**  
Artifact ZIP SHA-256: `f4a0b19c7811c8bf75e47eb6391b58a30691fe919b23c5fb466e6cd9c7aecd44`  
Foundation JSON SHA-256: `125b606444b88a1d39c09e720f544052f9ba96ddd85b08a5c3d32df25922fc20`

## Frozen gate result

**FAIL — `FOUNDATION_FAIL_DATA_REDESIGN`**

Only failed global gate:
- `V3_MARKET_FACTOR_READY_NE_5`

Strategy-neutral guards all passed:
- strategy PnL calculated: false
- reversal ranks calculated: false
- beta estimated: false
- residual returns calculated: false
- portfolio weights calculated: false
- synthetic backfill used: false
- unexpected transport errors: 0

## Candidate trading universe

Ready: **15/16**

Ready candidates:
ALGO, SAND, MANA, AXS, RUNE, SUSHI, DYDX, APE, ICP, THETA, EGLD, KAVA, CHZ, ZEC, COMP.

Failed candidate:
- **MKR** — complete through 2025-08, then missing the old MKRUSDT mandatory core interval from 2025-09 through 2026-08.

MKR remains a frozen failure. It must not be replaced inside Data V1.

## Market-factor benchmark

Ready under the V1 56/56-month rule: **3/5**
- BTC
- ETH
- BNB

Failed:
- SOL
- XRP

Both SOL and XRP have the same two incomplete daily-price archive months:
- 2022-02
- 2022-04

For both assets:
- 2022-02 contains 25/28 exact-daily rows and ends early;
- 2022-04 contains 28/30 exact-daily rows and starts late;
- the remaining 54/56 audited months are complete.

## Data-redesign diagnosis

The V1 benchmark gate required complete benchmark prices for all 56 months from 2022-01 through 2026-08.

That requirement is stricter than necessary for the intended later V3 architecture. The external beta-design motivation uses a one-year historical estimation window. If the earliest later V3 weekly validation anchor is no earlier than 2024, complete benchmark history from 2023-01 onward is sufficient for a full one-year pre-anchor beta history.

Therefore a separately named Data V2 may test one data-only redesign:
- preserve the exact 16 candidate assets;
- preserve the exact five benchmark assets;
- preserve candidate readiness unchanged;
- preserve all archive validation rules;
- change only benchmark readiness from 2022-01..2026-08 to **2023-01..2026-08**.

This redesign is based only on coverage topology and the already-fixed one-year external beta-estimation motivation. No V3 PnL, beta, residual signal or portfolio result has been inspected.

## Decision

Data V1 is immutable.

No V3 strategy protocol or strategy PnL is authorized from Data V1.

Next eligible step:
`RELATIVE-VALUE-REVERSAL-V3-DATA-V2` with the single benchmark-window correction above.
