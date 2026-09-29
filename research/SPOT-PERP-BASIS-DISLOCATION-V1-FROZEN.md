# Spot-Perp Basis Dislocation V1 — Frozen Strategy Protocol

Status: **FROZEN BEFORE FIRST STRATEGY PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parent:
- `SPOT-PERP-BASIS-DISLOCATION-V1-DATA-V1-FROZEN`

## Objective

Test one simple market-neutral hypothesis:

> When the USD-M perpetual trades at an unusually large positive premium to Spot, and recent realized funding is positive, a long-Spot / short-Perpetual pair may capture short-horizon basis convergence plus funding after conservative costs.

This is intentionally one-directional:
- LONG Spot
- SHORT USD-M Perpetual

Negative-basis trades are excluded because they would require short Spot/borrow mechanics that are not modeled in V1.

## Frozen universe

Exactly the eight assets that passed the synchronized data foundation:

- APT
- APE
- CRV
- SUSHI
- DYDX
- LDO
- GALA
- IMX

No asset substitution.

## Data

Binance Vision public archives only:

- Spot 8h trade klines
- USD-M Perpetual 8h trade klines
- USD-M realized funding

Only exact same-timestamp synchronized Spot/Perp bars may be used.

No interpolation, nearest-neighbor repair or synthetic fills.

## Frozen time split

### Warm-up only
- 2024-06-01 through 2024-08-31
- used only to seed the 90-day basis history

### Discovery
- signal/entry stage: 2024-09-01 through 2025-08-31 UTC
- the first strategy workflow loads no September-2025 holdout bars
- a candidate entry is eligible only when its exact +24h exit open also lies inside the loaded discovery stage
- therefore no discovery trade may require any 2025-09 data

### Temporal holdout
Authorized only after Discovery PASS:
- warm-up may use already-seen data through 2025-08-31
- holdout stage: 2025-09-01 through 2026-08-31 UTC
- a candidate entry is eligible only when its exact +24h exit open lies inside the loaded holdout stage
- therefore no trade may require any 2026-09 data
- no parameter changes

## Basis definition

At synchronized 8h bar close:

`basis = PerpClose / SpotClose - 1`

At execution-time synchronized 8h open:

`entry_basis = PerpOpen / SpotOpen - 1`

Only positive premium dislocations are tradable.

## Own-history basis extreme

For a signal bar:

- use exactly the **270 prior completed synchronized 8h basis closes**;
- 270 bars = 90 days;
- exclude the current signal bar from the reference history;
- sort the 270 prior basis observations;
- frozen empirical 95th-percentile estimator:
  - nearest-rank index = `ceil(0.95 × 270) - 1`;
- current signal basis must be >= that 95th-percentile value.

No z-score tuning and no asset-specific percentile.

## Cost-derived absolute basis floor

Frozen per-trade notional:
- $10,000 Spot
- $10,000 Perpetual

Frozen base execution assumptions:

Spot:
- taker fee = 10 bps per fill
- slippage = 3 bps per fill
- entry + exit => 26 bps of $10,000 = $26

Perpetual:
- taker fee = 5 bps per fill
- slippage = 3 bps per fill
- entry + exit => 16 bps of $10,000 = $16

Base round-trip cost:
- **$42**

Stress:
- additional 5 bps adverse per fill on all four fills
- +$20
- stressed round-trip cost = **$62**

Stress breakeven basis on one $10,000 leg:
- $62 / $10,000 = 0.0062 = **62 bps**

Frozen safety buffer:
- 1.25 × stressed breakeven

Frozen signal basis floor:
- **0.00775 = 77.5 bps**

Therefore a signal requires:

`signal_basis >= max(asset_trailing_95th_percentile, 0.00775)`

This floor is cost-derived and fixed before PnL.

## Funding confirmation

At the next executable 8h open time `t_entry`:

- sum all realized USD-M funding rates with timestamps in `[t_entry - 7d, t_entry)`;
- the 7-day funding sum must be **strictly > 0**.

No minimum positive funding threshold is optimized.

The funding confirmation only verifies that the short Perpetual leg has recently been on the receiving side of funding.

## Signal scan cadence and entry timing

For each asset, evaluate every completed synchronized 8h bar whose immediately following 8h open is inside the active stage and has an exact +24h exit open inside that same stage.

If the asset already has an open 24h trade, any intermediate 8h signals are ignored and cannot create overlapping exposure. A signal bar that completed while the prior trade was still open remains discarded; the earliest possible re-entry must be based on a newly completed 8h signal bar after that exit.

For each eligible scan:

1. Observe the completed synchronized 8h signal-bar close.
2. Evaluate the basis extreme using only prior completed bars.
3. Candidate entry is the immediately following synchronized 8h open.
4. Re-evaluate the exact execution-time basis at that open.
5. Entry is allowed only if execution-time basis is still >= **0.0062** (the stressed breakeven floor).
6. Evaluate trailing 7-day funding strictly before entry.
7. If all gates pass, enter LONG Spot / SHORT Perpetual.

If the next-open basis has already fallen below 0.0062:
- cancel the entry;
- no costs;
- count as `CANCELLED_BY_EXECUTION_BASIS`.

## Position sizing

Every active trade:

- Spot long notional = $10,000
- Perpetual short notional = $10,000
- quantities frozen from exact entry opens
- reserved capital per asset slot = $20,000
- fixed portfolio capital denominator = **$160,000** for eight assets
- no leverage multiplier
- no compounding into position size
- at most one open trade per asset

Signals while an asset already has an open trade are ignored.

## Holding period and exit

Frozen holding period:
- exactly **24 hours**

With 8h bars:
- entry at synchronized open `t`
- exit at synchronized open `t + 24h`

No early exit.
No stop.
No take-profit.
No basis-cross exit.
No intrahold signal reversal.

This avoids exit-rule optimization.

## Price/basis PnL

Spot:
- quantity = $10,000 / SpotEntryOpen
- PnL = quantity × (SpotExitOpen - SpotEntryOpen)

Perpetual:
- short quantity = -$10,000 / PerpEntryOpen
- PnL = quantity × (PerpExitOpen - PerpEntryOpen)

Basis/price PnL:
- Spot PnL + Perpetual PnL

## Funding PnL during holding

Because the Perpetual leg is short:

- include only realized funding events with timestamps strictly inside `(entry_time, exit_time)`;
- positive funding adds PnL;
- negative funding subtracts PnL;
- modeled funding PnL = $10,000 × sum(realized funding rates in the holding interval).

Boundary funding events are excluded to avoid ambiguous settlement ordering.

## Net PnL

Base:
- basis/price PnL
- + realized funding PnL
- - $42 round-trip modeled cost

Stress:
- basis/price PnL
- + realized funding PnL
- - $62 stressed round-trip modeled cost

## Data-integrity rules

For every signal/reference/holding interval:

- Spot/Perp timestamps must be exactly synchronized;
- all required opens/closes finite and positive;
- prior 270 basis observations must all exist;
- no duplicate timestamps;
- exact 8h cadence;
- funding finite and strictly increasing;
- no funding gap >12h in the trailing 7-day confirmation window;
- no funding gap >12h in the active 24h holding interval;
- exact exit open at +24h.

Missing required active-trade data => fail the stage closed with `DATA_INTEGRITY_FAILURE`.

Missing warm-up history simply makes the signal ineligible; no synthetic history.

## Portfolio accounting

Fixed capital denominator:
- $160,000

Monthly portfolio return:
- sum of trade PnL whose exits occur in that calendar month / $160,000

Months with no trades have 0 return.

Compounded discovery return:
- compound monthly portfolio returns.

## Mark-to-market drawdown

In addition to closed-trade/monthly drawdown, report an 8h mark-to-market equity curve.

At every synchronized 8h close:
- realized PnL from already closed trades is included;
- each open trade is marked using current synchronized Spot/Perp closes;
- funding accrued strictly after entry and before the mark is included;
- the full base round-trip cost is reserved against equity from trade entry onward.

Report:
- max closed/monthly drawdown;
- max 8h mark-to-market drawdown.

## Discovery metrics

Report:

- eligible signal evaluations
- percentile-qualified signals
- cancelled-by-execution-basis count
- active trades
- trades per asset
- active months
- net PnL
- compounded net return on $160k fixed capital
- basis/price PnL
- funding PnL
- modeled base costs
- stress PnL and stress return
- Profit Factor on trade net PnL
- win rate
- max monthly/closed drawdown
- max 8h mark-to-market drawdown
- five chronological-window returns
- per-asset PnL
- positive-PnL asset count
- positive-PnL concentration
- gross edge / base-cost ratio = (basis PnL + funding PnL) / base costs
- mean/median signal basis
- mean/median entry basis
- mean/median 24h basis compression

## Frozen Discovery gate

All must pass:

- >=32 completed trades
- >=6 of 8 assets have at least 3 completed trades
- >=8 active calendar months
- compounded net return >0
- net PnL >0
- Profit Factor >=1.20
- max closed/monthly drawdown <=5%
- max 8h mark-to-market drawdown <=7.5%
- >=4 of 5 chronological windows positive
- basis/price PnL >0
- funding PnL >0
- stress return >0
- gross edge / base-cost ratio >=1.25
- >=6 of 8 assets have positive net PnL
- no single positive asset contributes >40% of total positive PnL
- no data-integrity failure

PASS => `DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED`

FAIL => `DISCOVERY_FAIL_RESEARCH_REDESIGN`

## Frozen temporal-holdout gate

If and only if Discovery passes, run the untouched 2025-09 through 2026-08 window with all rules unchanged.

All must pass:

- >=32 completed trades
- >=6 of 8 assets have at least 3 completed trades
- >=8 active months
- compounded net return >0
- Profit Factor >=1.10
- max closed/monthly drawdown <=7.5%
- max 8h mark-to-market drawdown <=10%
- >=3 of 5 chronological windows positive
- basis/price PnL >0
- funding PnL >0
- stress return >0
- gross edge / base-cost ratio >=1.15
- >=5 of 8 assets positive
- positive-PnL concentration <=45%
- no data-integrity failure

PASS => `HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`

FAIL => `HOLDOUT_FAIL_RESEARCH_REDESIGN`

Even a holdout PASS does not authorize live execution.

## Anti-overfitting

- protocol committed before first strategy PnL;
- 90-day / 270-bar history fixed;
- 95th percentile fixed;
- 77.5 bps signal floor fixed;
- 62 bps execution floor fixed;
- 7-day funding confirmation fixed;
- 24h holding period fixed;
- no negative-basis/short-Spot trades;
- no asset-specific threshold;
- no threshold grid;
- no optimized exit;
- no cost reduction;
- no asset removal;
- no discovery/holdout date movement;
- no losing-trade removal;
- no gate relaxation;
- any redesign receives a new ruleset.

## Safety

Research only. No exchange credentials, live orders, leverage automation, liquidation model, wallet mutation or automatic promotion.
