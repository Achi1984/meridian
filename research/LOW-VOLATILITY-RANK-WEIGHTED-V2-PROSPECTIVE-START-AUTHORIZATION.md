# Low-Volatility Rank-Weighted V2 — Prospective Shadow Start Authorization

Status: **PROSPECTIVE START AUTHORIZED / ZERO ELIGIBLE OUTCOMES OBSERVED / PAPER AND LIVE BLOCKED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Corrected prospective implementation merge: `1a34e9dae390ca91de59588b4b102da43579f527`  
Execution impact: **false**

## Exact future boundary

The prospective evidence clock is authorized to start at:

**2026-10-10T00:00:00Z**

At this authorization time that boundary is still in the future. Zero fully prospective holding periods have completed and no eligible prospective return has been inspected.

The first eligible outcome is:

**2026-10-10T00:00:00Z → 2026-10-17T00:00:00Z**

## Pre-start source corrections

Two earlier pre-start probes failed before collecting any eligible prospective evidence:

- workflow **37143326461**: primary USD-M REST host returned HTTP 451;
- workflow **37143595493**: fapi/fapi1-4 were unusable from the GitHub-hosted runner.

Neither failed run produced a prospective snapshot or eligible performance result.

The final reviewed source correction uses only official Binance Vision public USD-M monthly+daily archives and is frozen in:

- Binance Vision correction blob: `9fa92d998c1360692016ee0b67161a03c28ce297`;
- prospective engine blob: `c20a2befade217bdf37c058378f98ac7793f16c5`;
- archive collector blob: `57c74bb8099e3e92d73331e6061d910c6b17c4ef`;
- invariant-test blob: `8848a1ddf0678989d9d84c02db74f3601c597736`;
- workflow blob: `252abe8d8c775eaadc671ffe16ce9cc0ea214ab4`;
- frozen-research guard blob: `0791e89bcc9eb92459d17a5bc29cc2c9dddd82bb`.

The strategy, start boundary, cost model, decision window, and gate thresholds are unchanged.

## Archive-safe canonical timing

Canonical collection is scheduled for **Sunday 02:15 UTC**.

Each Saturday cutoff is considered timely when its first immutable snapshot is collected within **36 hours** after Saturday 00:00 UTC.

The collector refuses to use a Saturday cutoff until at least 24 hours have elapsed, ensuring the required completed daily archive can exist.

## Frozen strategy lineage

Also required:

- prospective preregistration blob: `738965343f5fc28835f15bbbcdc0a12d8cf3cfbe`;
- implementation contract blob: `d156db5409c94bc6cfface2a65e5fb6bef9a6f40`;
- snapshot runner blob: `0287e968a22c5c2be197fb10e5ef35b0189d0bc0`.

All Development and Holdout evidence remain frozen.

## Fixed prospective gate

Exactly the first **12** fully completed prospective weeks determine the performance gate.

Fixed endpoint:

**2027-01-02T00:00:00Z**

A performance PASS can only produce:

`PROSPECTIVE_PERFORMANCE_PASS_LEDGER_REVIEW_REQUIRED`

It does not authorize Paper or live execution.

## Append-only evidence ledger

Canonical ledger branch:

`research/low-volatility-rank-weighted-v2-prospective-evidence`

A pre-start diagnostic snapshot may be created and cannot contribute to performance.

Required decision ledger:

- 2026-10-10 start-boundary snapshot with zero completed weeks;
- 12 completed weekly snapshots through 2027-01-02;
- all required snapshots timely;
- no dated snapshot rewritten.

Phase C is authorized only as forward-only shadow evidence collection.
