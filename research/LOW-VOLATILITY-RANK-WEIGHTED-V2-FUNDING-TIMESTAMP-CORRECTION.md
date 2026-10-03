# Low-Volatility Rank-Weighted V2 — Funding Timestamp Coverage Correction

Status: **TECHNICAL VALIDATOR CORRECTION / NO V2 STRATEGY RESULT INSPECTED / HOLDOUT SEALED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Original implementation merge: `edae7eca1dacc348e76aad7de1e0ed0a31e356f0`  
Original run-authorization commit: `3f894b14f03146c2e1032a7fa54263396973994e`  
Original workflow run: **37131815781**  
Execution impact: **false**

## Why a correction is required

The first authorized V2 Development workflow completed its source collection and stopped in the evaluator before any baseline or stress strategy return was produced.

Frozen first-run result:

- decision field: `DEVELOPMENT_FAIL_RESEARCH_STOP`;
- `dataIntegrityFailure=true`;
- error: `BTC:FUNDING_INTERNAL_GAP`;
- `result=null`;
- `stress=null`;
- Holdout evaluated: **false**.

Therefore the first run produced no V2 compounded return, Profit Factor, Sharpe, drawdown, funding contribution, transaction-cost result, or Development gate result beyond the data-integrity stop.

Source artifact:

- artifact ID: **11277585916**;
- ZIP digest: `sha256:207c116332410d2de0435fa76e381b097661bb79ddd4104526341bbfa6545307`;
- source receipt digest used by the evaluator: `c632e7a00c30625fc3efb7a58c400e9c9b481bb0c603aa95bf68e0be44ba6220`.

Result artifact:

- artifact ID: **11276907747**;
- ZIP digest: `sha256:a4a5a48891643b8a28edf82bdc562f27f4859cc7da062d4c100068fc3091402f`.

## Independent diagnosis

The exact source artifact was inspected only for source-integrity timing, not strategy returns.

For every one of the 12 frozen assets:

- exactly **1,008** retained funding rows were present;
- funding rows remained strictly monotonic;
- declared funding intervals remained valid;
- the largest observed gap above the declared interval grid was only **16 milliseconds**;
- no observed excess gap represented a missing 8-hour funding event.

Example shape from the official source:

- nominal settlement: `...2800000`;
- following settlement may be timestamped `...1600016`;
- the resulting interval is **8 hours + 16 ms**, not a missing funding period.

The original coverage validator required `gap <= interval_hours * 1h` with zero timestamp tolerance. It therefore classified official millisecond timestamp jitter as a missing funding interval.

## Narrow correction

The strategy, data period, asset universe and gates are unchanged.

The only engine change is a fixed:

`FUNDING_TIME_TOLERANCE_MS = 1000`

applied solely to funding **coverage validation** for:

- head-gap validation;
- internal-gap validation;
- tail-gap validation.

The exact funding inclusion rule is unchanged:

`start < funding_timestamp <= end`

Funding values are unchanged. No timestamp is rounded, moved, interpolated, synthesized, or added.

A genuinely missing 8-hour event still creates an approximately 16-hour internal gap and therefore still fails closed; a 1-second tolerance cannot mask it.

## Unchanged frozen rules

This correction does **not** change:

- the V1 28-day / 672-return Low-Volatility feature;
- the 12-asset universe;
- continuous average-rank weights;
- gross exposure 1.0 and net exposure 0;
- weekly open-to-open price return;
- funding contribution formula;
- 10-bps baseline cost;
- 20-bps stress cost;
- turnover or terminal-close accounting;
- Development dates or 48-period count;
- any Development threshold;
- the untouched 34-period Holdout;
- Paper/live authorization.

## Rerun policy

A corrected Development run may occur only after:

1. this correction receives exact-head CI/review and is merged;
2. corrected implementation/test blobs are frozen in the research guard;
3. a new documentation-only run authorization names the corrected merge and exact blobs.

The corrected run is the first run permitted to calculate a valid V2 Development strategy result.

If that corrected evaluation returns a scientific Development FAIL, V2 closes and Holdout remains untouched.

If it returns a Development PASS, only a separately reviewed and separately authorized untouched Holdout stage may follow.
