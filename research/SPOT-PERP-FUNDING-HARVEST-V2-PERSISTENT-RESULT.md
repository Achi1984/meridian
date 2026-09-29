# Spot-Perp Funding Harvest V2 Persistent Carry — Frozen Development Result

Workflow run: **36593775779**  
Artifact: **11045455889**  
Artifact ZIP SHA-256: `6e6957cfb63a9411545e671dbdd4172869f8a74320b199bf1f528f433829b83f`  
Summary SHA-256: `e3bd7e86890df87d7fd4446945d814340b79996636183e69f48d6d4aae4c4714`  
Full evidence SHA-256: `1103d42b67cf525e3e38bb9adf12fe0d0a603288abf5a874cb8eae3e5d96e461`  
Markdown SHA-256: `fd4e1800ae38c5c856095dc8cd308e6222ac6d305780f6c7828500aa23952563`

This records the first untouched development result of `SPOT-PERP-FUNDING-HARVEST-V2-PERSISTENT-FROZEN`.

## Frozen development scope

Universe:
- OP
- INJ
- WLD
- SEI
- TIA
- PENDLE
- RUNE
- ICP

Raw data:
- 2024-09 through 2025-08

Trade months:
- 2024-10 through 2025-08
- 88 decision slots

Direction:
- LONG Spot
- SHORT Binance USD-M perpetual

Entry:
- previous-month funding >= 77.5 bps

Persistent state:
- once active, remain active while previous-month funding > 0
- exit when previous-month funding <= 0
- no monthly rebalance
- fixed quantities across a streak
- final forced close at stage end

## Data integrity

- decision slots: **88/88**
- rejected slots: **0**
- data-integrity failure: **false**

## State / sample result

- exposure months: **50**
- entry events: **9**
- exit events: **9**
- persistent hold months: **33**
- average holding streak length: **5.556 months**

## Economic result

- compounded net return: **+1.1246%**
- net PnL: **+$1,794.21**
- Profit Factor: **15.3858**
- max drawdown: **0.0780%**
- funding PnL: **+$2,037.95**
- Spot+Perp price/basis PnL: **+$32.28**
- modeled base costs: **$276.03**
- funding/base-cost ratio: **7.3830**
- stress return: **+1.0418%**
- positive chronological windows: **4/5**
- positive assets: **7/8**
- positive-PnL concentration: **24.48%**

## Asset attribution

| Asset | Exposure | Entries | Exits | Persistent holds | Net PnL |
|---|---:|---:|---:|---:|---:|
| OP | 9 | 1 | 1 | 7 | +$259.88 |
| INJ | 4 | 1 | 1 | 2 | +$134.56 |
| WLD | 8 | 1 | 1 | 6 | +$211.13 |
| SEI | 4 | 1 | 1 | 2 | **-$20.66** |
| TIA | 4 | 1 | 1 | 2 | +$143.38 |
| PENDLE | 7 | 2 | 2 | 4 | +$444.20 |
| RUNE | 5 | 1 | 1 | 3 | +$296.24 |
| ICP | 9 | 1 | 1 | 7 | +$325.49 |

## Frozen gate result

**PASS**

All preregistered development gates passed.

## Decision

**DEVELOPMENT_PASS_INDEPENDENT_VALIDATION_REQUIRED**

This authorizes only the previously frozen independent temporal validation:

- signal warm-up: 2025-08
- trade months: 2025-09 through 2026-08
- 96 decision slots
- identical entry threshold
- identical hold/exit state rule
- identical cost model
- identical state/accounting semantics
- no retuning

No Paper or live promotion is authorized by development.

## Anti-overfitting status

- no threshold change;
- no asset removal;
- no state-rule change;
- no fee/slippage change;
- no date movement;
- no gate relaxation;
- no SEI exclusion despite negative development PnL;
- holdout remains untouched at the moment of this recorded PASS.
