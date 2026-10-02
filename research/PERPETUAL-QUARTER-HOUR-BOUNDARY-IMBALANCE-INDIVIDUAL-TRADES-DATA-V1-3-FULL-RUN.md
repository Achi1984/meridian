# Quarter-Hour Boundary Imbalance — Individual Trades Data V1.3 Full-Run Authorization

Status: **AUTHORIZED AFTER FROZEN 6/6 CANARY GATE**  
Authorization scope: **strategy-neutral 120-shard data-quality audit only**  
Signal / forward-return / position / PnL authorization: **false**

## Frozen protocol head before authorization

PR: **#358**  
Protocol/code head: `6c61574f0029d535c99d20420742ca02503f5e99`

No protocol, parser, threshold, gate, strategy, Paper or execution file changed after the V1.3 canary results were observed.

This authorization file is documentation-only and exists solely to unlock the predeclared push-gated full-run workflow.

## Canary and invariant gate

Workflow run: **36687150944 — SUCCESS**  
Release Safety: **36687150858 — PASS**

Invariant tests: **PASS**

Required frozen canaries:

- ETHUSDT / 2025-08 / known duplicate-ID + source-row-order fixture: **PASS**
- XRPUSDT / 2025-08 / known duplicate-ID fixture: **PASS**
- ADAUSDT / 2025-08 / known duplicate-ID fixture: **PASS**
- BTCUSDT / 2026-07 / independent parser-regression canary: **PASS**
- SOLUSDT / 2025-04 / independent parser-regression canary: **PASS**
- DOGEUSDT / 2026-06 / independent parser-regression canary: **PASS**

Canary artifacts:

- ETHUSDT/2025-08: artifact `11084902761`, digest `sha256:dd3e43004003475cbfd2e40d3c4dd6365a697bb64dc54cd93630d61cd148fe94`
- XRPUSDT/2025-08: artifact `11084696841`, digest `sha256:b6d2eb89f3e8a888dada4082ccf08ea13137df8ef6a7ee971755a3eac9eab04e`
- ADAUSDT/2025-08: artifact `11084791353`, digest `sha256:4bf1075df3e445f417baff706edc3f23611ffa664fbca5a5582642d4d676faf3`
- BTCUSDT/2026-07: artifact `11084316449`, digest `sha256:6b5bef9b6de938fcdd451300d375b02c7ec35c48c1e6755fbd5a0d97b52db88b`
- SOLUSDT/2025-04: artifact `11084541310`, digest `sha256:1178d39ee38f7a41239a5715fdc2f99f0d25e2f9996f7d15552e82fb5442fdc0`
- DOGEUSDT/2026-06: artifact `11084186064`, digest `sha256:27fe2629df5e03a26de46c124b83f546c807f7dfc3ff87b8646ed476ba355d6f`

## Authorized full run

The already-frozen Data V1.3 code is authorized for the fixed **120 asset-month shard** audit:

- BTCUSDT, ETHUSDT, XRPUSDT, SOLUSDT, DOGEUSDT, ADAUSDT
- 2025-01 through 2026-08
- official Binance USD-M monthly individual-trades archives as the primary source-record stream
- official 1m klines for structural cadence plus diagnostic cross-source evidence
- official funding-rate archives for funding coverage
- maximum six concurrent shards
- raw archives deleted after compact quality evidence is written

## Frozen V1.3 source semantics

Every CHECKSUM-verified source row is retained exactly once.

Source-record identity:

`archive SHA-256 + ZIP member + 1-based data-row ordinal`

The exchange-provided `tradeId`:
- must parse as an integer;
- remains diagnostic metadata;
- is not a unique event key;
- is not a temporal-order gate;
- does not authorize deduplication.

Physical source-row timestamp order:
- is diagnostic only;
- may decrease;
- does not control temporal assignment.

Temporal binning uses the timestamp value on each retained source row.

## Hard gates

The full-run hard gates remain exactly those frozen before canary execution:

- published CHECKSUM verification;
- exactly one ZIP member per archive;
- valid numeric/schema fields;
- valid millisecond trade timestamps inside the target month;
- contiguous source-record ordinals for every retained source row;
- complete quarter-hour trade-source coverage;
- complete structural 1m-kline cadence;
- funding coverage and gap limits;
- all strategy/execution authorization flags false.

## Diagnostic-only fields

These remain diagnostic-only exactly as frozen:

- repeated/non-increasing/decreasing trade IDs;
- numeric trade-ID gaps;
- source-row timestamp decreases;
- raw source `quoteQty` consistency;
- first-10-second activity coverage;
- exact kline count/base/quote reconciliation.

No post-result threshold or tolerance may be introduced.

## Forbidden calculations

The full run must not calculate or inspect:
- buyer-minus-seller flow;
- directional order imbalance;
- forward returns;
- signal/return relationships;
- positions;
- position sizing;
- strategy fees/funding;
- strategy PnL;
- Paper promotion;
- live execution.

## Decision rule

Only **120/120 PASS** may advance to the strategy-preregistration milestone.

PASS decision:

`INDIVIDUAL_TRADES_DATA_V1_3_PASS_STRATEGY_PREREGISTRATION_REQUIRED`

Any shard failure freezes Data V1.3 as:

`INDIVIDUAL_TRADES_DATA_V1_3_FAIL_DATA_QUALITY`

If a failure occurs, V1.3 itself must not be edited to rescue the observed result. Any semantic change requires a separately versioned successor.
