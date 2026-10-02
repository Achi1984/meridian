# Quarter-Hour Boundary Imbalance — Individual Trades Data V1.3 Result

Status: **FULL DATA QUALITY PASS — 120/120**  
Decision: **INDIVIDUAL_TRADES_DATA_V1_3_PASS_STRATEGY_PREREGISTRATION_REQUIRED**  
Execution impact: **false**  
Signal / forward-return / position / PnL calculated: **false**

## Provenance

- Frozen protocol/code head: `6c61574f0029d535c99d20420742ca02503f5e99`
- Documentation-only authorization head: `65d783103b8d8311b17277c01ee6b4071526642e`
- Canary workflow: **36687150944 — PASS**
- Canary Release Safety: **36687150858 — PASS**
- Full 120-shard workflow: **36690368732**
- Aggregate artifact: **11090766829 — qh-individual-trades-data-v1-3**
- Aggregate artifact digest: `sha256:49211d4059f8cecc38133f8bea9ac5b4ce9bf23a041c242440cb25b335dbb344`

## Aggregate gate

- expected shards: **120**
- observed shards: **120**
- missing shards: **0**
- duplicate shards: **0**
- unexpected shards: **0**
- gate reasons: **none**
- empty quarter-hour bins: **0**

The frozen decision rule therefore resolves to:

`INDIVIDUAL_TRADES_DATA_V1_3_PASS_STRATEGY_PREREGISTRATION_REQUIRED`

## Corpus diagnostics

These values are diagnostic only under the preregistered V1.3 protocol and did not participate in the hard PASS gate:

- retained individual-trade source rows: **10,534,731,145**
- non-increasing trade-ID events: **5**
- adjacent duplicate trade-ID events: **5**
- decreasing trade-ID events: **0**
- source-row timestamp decreases: **2**
- trade-ID gap events: **14,828,846**
- missing numeric trade IDs implied by gaps: **19,638,008**
- empty first-10-second windows: **35**
- raw quoteQty mismatch rows: **1,299**
- diagnostic kline mismatch minutes: **1,433**
- structural 1m-kline rows: **5,253,120**
- funding rows: **10,944**

These diagnostics must not be retrospectively promoted into thresholds for V1.3.

## Safety / anti-leakage confirmation

The aggregate explicitly confirms:

- directional order imbalance calculated: **false**
- forward returns calculated: **false**
- signal/return relationship calculated: **false**
- positions calculated: **false**
- strategy PnL calculated: **false**
- Paper authorized: **false**
- live authorized: **false**

## Next authorized milestone

Only strategy preregistration is authorized. The existing docs-only Quarter-Hour Strategy V1 preregistration from PR #354 may be restored onto the validated V1.3 dependency **without changing its strategy rules, thresholds, costs, gates or accounting definitions**. Any such restoration must receive an exact-head review and Release Safety PASS before the first MERIDIAN V1.3 signal/forward-return/PnL computation.
