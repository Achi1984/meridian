# Low-Volatility Rank-Weighted V2 — Prospective Shadow Start Authorization

Status: **PROSPECTIVE START AUTHORIZED / ZERO ELIGIBLE OUTCOMES OBSERVED / PAPER AND LIVE BLOCKED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Corrected prospective implementation merge: `4b4b8aa8ec23a813ecb86b9b865dbf6852762c3e`  
Execution impact: **false**

## Exact future boundary

The prospective evidence clock is authorized to start at:

**2026-10-10T00:00:00Z**

At the time of this authorization that boundary is still in the future. Therefore zero fully prospective holding periods have completed and no eligible prospective return has been inspected.

The first eligible outcome is:

**2026-10-10T00:00:00Z → 2026-10-17T00:00:00Z**

## Failed pre-start transport probe

Workflow run **37143326461** failed before collecting any market payload because the primary public Binance USD-M host returned HTTP 451 from the GitHub-hosted runner.

That failed run is not evidence and cannot count in the prospective ledger.

The reviewed transport correction is frozen in:

- correction document blob: `2697a57b6bf268516ebc2b50da33d7a324c44d2b`;
- corrected collector blob: `1292033cc3ce4e752d2ee3f16c159c2c11eed6cd`;
- corrected invariant-test blob: `1780a7c94a35ba52ee224225e8cf5cc0af7e1995`;
- corrected frozen-research guard blob: `e4fa948d8f38bd983642b2f96e7bd8fd783987ff`.

The correction changes only public-host transport failover. Strategy, data fields, start date, costs, gates, and safety boundaries are unchanged.

## Frozen strategy/implementation lineage

This authorization also requires:

- prospective preregistration blob: `738965343f5fc28835f15bbbcdc0a12d8cf3cfbe`;
- prospective implementation contract blob: `d156db5409c94bc6cfface2a65e5fb6bef9a6f40`;
- prospective engine blob: `3bc3777d2c6cec08eca0bf25ef963543d9e39fae`;
- snapshot runner blob: `0287e968a22c5c2be197fb10e5ef35b0189d0bc0`;
- workflow blob: `2c82aeb72a67e61d47acbe5c197cc3982dfda722`.

All upstream Development and Holdout evidence remain frozen.

## Frozen decision window

Exactly the first **12** fully completed prospective weeks determine the performance gate.

Fixed gate endpoint:

**2027-01-02T00:00:00Z**

The automatic performance gate cannot promote Paper or live execution. A PASS only produces:

`PROSPECTIVE_PERFORMANCE_PASS_LEDGER_REVIEW_REQUIRED`

A separate human-reviewed evidence-ledger decision is mandatory afterward.

## Canonical evidence ledger

Append-only branch:

`research/low-volatility-rank-weighted-v2-prospective-evidence`

This authorization push may create a diagnostic pre-start baseline snapshot. It must contain zero eligible completed prospective observations and cannot contribute to performance.

Required final ledger:

- 2026-10-10 start-boundary snapshot with 0 completed weeks;
- 12 weekly outcome snapshots through 2027-01-02;
- every required snapshot timely;
- no rewritten dated snapshot.

## Explicit prohibitions

This authorization does not permit Paper orders, live orders, credentials, account access, parameter changes, asset changes, cost changes, or retrospective rescue.

Phase C is authorized only as **forward-only shadow evidence collection**.
