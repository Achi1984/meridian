# Spot-Perp Funding Harvest V1 Data Foundation — Frozen Result

Workflow run: **36584178441**  
Artifact: **11041027256**  
Artifact ZIP SHA-256: `0b7aef02154e6cea98ca04a06592144d7113adabd7d01ec7e3a504cd754c3e99`  
Foundation JSON SHA-256: `1a7a56cd07953a4865c30b861acd4faf4730a299923e29fdaf7a84598dd0bbd6`

This records the corrected first strategy-neutral coverage result of `SPOT-PERP-FUNDING-HARVEST-V1-DATA-V1-FROZEN`.

The earlier workflow attempt on the same frozen scope misclassified the official futures mark-price CSV header as a data row. No strategy PnL was calculated in either run. The parser-only correction did not alter universe, interval or gates.

## Frozen scope

Candidate universe:
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
- 24 completed calendar months

Required components:
- Binance Spot 8h klines
- Binance USD-M 8h mark-price klines
- Binance USD-M realized funding archives

## Result

**FOUNDATION_FAIL_DATA_REDESIGN**

Qualified assets: **0 / 8**

Unexpected transport errors: **0**

Strategy PnL calculated: **false**

Funding threshold inferred: **false**

Synthetic backfill used: **false**

## Synchronized failure

Every candidate has:
- 23 / 24 JOINT_CORE_COMPLETE months
- the same single failed month: **2026-06**

For every asset in 2026-06:

- Spot 8h: PASS, 90 rows
- Funding: PASS
- Perpetual mark 8h: FAIL, 87 rows
- reason: `NON_8H_CADENCE`

This is a synchronized mark-price archive/feed gap across the full frozen universe rather than an asset-specific coverage failure.

## Per-asset result

| Asset | Complete months | Failed month | Failed component | Qualified |
|---|---:|---|---|---|
| OP | 23/24 | 2026-06 | markPriceKlines 8h | NO |
| INJ | 23/24 | 2026-06 | markPriceKlines 8h | NO |
| WLD | 23/24 | 2026-06 | markPriceKlines 8h | NO |
| SEI | 23/24 | 2026-06 | markPriceKlines 8h | NO |
| TIA | 23/24 | 2026-06 | markPriceKlines 8h | NO |
| PENDLE | 23/24 | 2026-06 | markPriceKlines 8h | NO |
| RUNE | 23/24 | 2026-06 | markPriceKlines 8h | NO |
| ICP | 23/24 | 2026-06 | markPriceKlines 8h | NO |

## Frozen gate

Required:
- >=6/8 qualified assets

Observed:
- 0/8

Gate reason:
- `QUALIFIED_ASSETS_LT_6`

## Decision

**FOUNDATION_FAIL_DATA_REDESIGN**

No Spot-Perp strategy protocol is authorized from Data Foundation V1.

## Anti-overfitting / redesign boundary

V1 remains immutable:
- no June-2026 exception;
- no synthetic mark reconstruction;
- no 23/24 relaxation;
- no asset substitution;
- no strategy PnL;
- no threshold inference.

A successor data foundation may use a different independently motivated public execution-price source, such as USD-M perpetual trade klines, while preserving the same universe, interval and breadth gate. That successor must be frozen as a new ruleset before its coverage result is read.
