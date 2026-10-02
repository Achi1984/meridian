# Quarter-Hour Boundary Imbalance — Strategy V1 Historical Run Authorization

Status: **AUTHORIZED AFTER EXACT-HEAD IMPLEMENTATION REVIEW**  
Authorization scope: **one frozen historical Strategy V1 evidence run only**  
Paper/live authorization: **false**

## Canonical dependencies

Data V1.3:
- full data-quality run: **36690368732**
- aggregate artifact: **11090766829**
- aggregate digest: `sha256:49211d4059f8cecc38133f8bea9ac5b4ce9bf23a041c242440cb25b335dbb344`
- decision: **120/120 PASS**
- missing / duplicate / unexpected shards: **0 / 0 / 0**

Strategy V1 preregistration:
- original frozen design: **PR #354**
- Data V1.3 dependency rebind: **PR #435**
- no own historical Strategy V1 PnL was observed before implementation.

Strategy V1 implementation:
- canonical merge: **PR #440**
- merge SHA: `4c918dbed34c8bbe8a90b026a393063161bba41b`
- exact-head Strategy V1 workflow: **37002623576 — PASS**
- synthetic invariants: **13/13 PASS**
- exact-head MERIDIAN Release Safety: **37002623631 — PASS**
- post-merge Northflank: **PASS**
- post-merge runtime smoke: **PASS**

## Independent implementation review

Review confirmed the implementation preserves the frozen preregistration:
- continuation OI from the first 10 seconds after each 00/15/30/45 UTC boundary;
- primary 12h / 48-cohort horizon;
- fixed 1/6 per-asset target cap;
- first valid individual trade in `[t+10s,t+60s)` as execution reference;
- 6 bp one-way primary turnover cost;
- latest valid pre-funding individual trade for funding valuation;
- fixed B1-B4 blocks;
- exactly six frozen primary research gates;
- 4h/8h, 3/10 bp and funding-coincidence diagnostics remain diagnostics only.

Pre-result hardening also passed review:
- exact trade/funding SHA-256 + byte-count source lock is rebuilt from the successful Data V1.3 shard evidence;
- any source mismatch fails closed even if a newly published CHECKSUM is otherwise valid;
- no new cohort is admitted if its full frozen horizon would extend beyond the validated evaluation window;
- terminal target must flatten to zero at the final executable boundary;
- missing terminal execution reference fails closed.

## Authorized execution

Run exactly one historical Strategy V1 workflow over the fixed 120 asset-month source shards:
- BTCUSDT, ETHUSDT, XRPUSDT, SOLUSDT, DOGEUSDT, ADAUSDT;
- 2025-01 through 2026-08;
- maximum six concurrent shards;
- exact Data V1.3 source lock required before shard extraction;
- raw archives temporary and deleted after compact evidence is written.

The aggregate may calculate the frozen directional signal, positions and Strategy V1 research PnL only after all 120 compact source shards are present and source-locked.

## Decision rule

The primary 6 bp result controls the decision.

PASS requires all six frozen gates:
1. full-window net return > 0;
2. maximum drawdown < 15%;
3. at least 3 of 4 chronological blocks positive;
4. B4 positive;
5. at least 4 of 6 assets positive;
6. no single asset contributes more than 40% of total positive asset PnL.

Decision:
- `STRATEGY_V1_PASS_PAPER_RESEARCH_PROPOSAL_REQUIRED`, or
- `STRATEGY_V1_FAIL`.

The preregistered 4h/8h, 3 bp/10 bp, funding-coincidence and side-attribution diagnostics cannot rescue the primary result.

## No-rescue / safety rule

After this authorization commit:
- no strategy rule, horizon, threshold, cost, universe, block, source semantic or gate may change based on the observed result;
- a failed result is frozen as Strategy V1 FAIL;
- a passed result authorizes only a **separate Paper-research proposal**;
- Paper execution is not authorized;
- live execution is not authorized;
- no exchange-order mutation is authorized.
