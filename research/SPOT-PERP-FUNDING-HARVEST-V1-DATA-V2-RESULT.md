# Spot-Perp Funding Harvest V1 Data Foundation V2 — Frozen Result

Workflow run: **36589100677**  
Artifact: **11043501089**  
Artifact ZIP SHA-256: `a2bc190e52400f47ab159be1881c3adca426a6f17a1f740eae08c6403a925b14`  
Foundation JSON SHA-256: `d227d14d02a94b6c81bef7528d2ae38352e6cea3d59c06dc9e6e14db5401cbe7`

This records the first untouched result of `SPOT-PERP-FUNDING-HARVEST-V1-DATA-V2-FROZEN`.

## Frozen scope

Universe:
- OP
- INJ
- WLD
- SEI
- TIA
- PENDLE
- RUNE
- ICP

Interval:
- 2024-09 through 2026-08
- exactly 24 completed calendar months

Sources:
- Binance Spot 8h klines
- Binance USD-M perpetual 8h trade klines
- Binance USD-M realized funding archives

V2 changed only the perpetual execution-price source from V1 mark-price klines to public perpetual trade klines.

## Result

**FOUNDATION_PASS**

Qualified assets: **8 / 8**

Unexpected transport errors: **0**

Strategy PnL calculated: **false**

Funding threshold inferred: **false**

Synthetic backfill used: **false**

## Per-asset coverage

Every frozen asset has:
- 24/24 `JOINT_CORE_COMPLETE_V2` months
- 2,190 Spot 8h rows across the interval
- 2,190 Perpetual Trade 8h rows across the interval
- complete realized-funding coverage

Funding observations:
- OP: 2,190
- INJ: 2,190
- WLD: 2,190
- SEI: 2,190
- TIA: 4,379
- PENDLE: 2,190
- RUNE: 2,190
- ICP: 2,190

The higher TIA funding count is accepted because cadence is validated rather than assumed.

## Gate

Required:
- all 8 candidates represented
- zero unexpected transport errors
- >=6/8 fully qualified
- no strategy PnL
- no inferred funding threshold
- no synthetic backfill

Observed:
- **8/8 qualified**
- **0 unexpected transport errors**
- all non-PnL / anti-overfitting guards satisfied

## Decision

**FOUNDATION_PASS**

This authorizes only a separately frozen Spot-Perp Funding Harvest V1 strategy protocol.

It does not authorize:
- Paper shadow;
- live execution;
- threshold selection after viewing strategy PnL.

## Interpretation

The synchronized June-2026 failure in V1 was specific to the Binance USD-M mark-price archive. Replacing only that execution-price tape with public USD-M perpetual trade klines restores full joint Spot + Perp + Funding coverage across the entire frozen universe and interval.

V1 remains immutable.

## Anti-overfitting status

- universe unchanged;
- interval unchanged;
- 6/8 breadth gate unchanged;
- no asset substitution;
- no June-2026 exception;
- no 23/24 relaxation;
- no synthetic reconstruction;
- no strategy PnL;
- no funding threshold inference.

The next allowed step is to freeze the Spot-Perp Funding Harvest V1 strategy rules, costs, capital treatment, discovery/holdout split and promotion gates before first PnL.
