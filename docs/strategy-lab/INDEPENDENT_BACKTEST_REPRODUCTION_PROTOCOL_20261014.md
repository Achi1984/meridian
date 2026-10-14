# Independent backtest reproduction and bounded challenge protocol

- **Op-ID:** `STRATEGY-INDEPENDENT-REPRODUCTION-PLAN-20261014`
- **Status:** source preparation only; no implementation, data collection, evaluator run, PnL, dispatch, paid resource, authorization, Paper, or Live change
- **Prepared against main:** `efec133f4ff8a809722b79fa7c5fe8007667c1ea`
- **Pinned historical evidence source:** `386013c1e78c4be5ea5d6c89063c9c4b8dacda66`
- **Primary target:** `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`

This is an implementation plan, not an authorization or a claim that a backtest has been independently reproduced. The companion [`reproduction-challenge-matrix-20261014.json`](reproduction-challenge-matrix-20261014.json) is the machine-readable register of the proposed baseline, data receipts, bounded diagnostics, and known lineages.

## 1. Work boundary and gates

The only proposed first task is an independent, offline reproduction of the frozen LowVol V2 Development result, followed by a **historical Holdout audit** using the same frozen rules. The 48-week Development and 34-week Holdout have already been observed by Meridian. Recomputing those periods can test implementation fidelity; the Holdout is not fresh confirmation, cannot tune the strategy, and cannot restore prospective status.

This packet does not authorize:

- downloading, querying, replacing, reconstructing, or otherwise acquiring data;
- running an evaluator, backtest, PnL calculation, canonical workflow, or diagnostic;
- dispatching an agent or spending paid resources;
- changing a frozen rule, gate, authorization, workflow, Paper, or Live state;
- treating a source receipt, synthetic test, reproduced historical result, or technical pass as profitability evidence.

Before any eventual execution, separately require (a) an independently reviewed implementation and synthetic checks frozen by source/test hashes **before the implementation operator can inspect expected PnL**, (b) a reconciled complete trial ledger and confirmed budget, (c) explicit concrete execution authorization, (d) proof that all required already-receipted files are present and match their pins, and (e) a serial, offline execution environment within the proposed budgets below. The lead methodology agent and Claude review are later gates; neither review nor this plan authorizes execution. No self-merge.

An independent implementer must derive the engine from the frozen specification and implement it separately. Do not import, copy, vendor, or transliterate the Meridian evaluator, collectors, feature engine, or result parser. Before any expected result is unsealed, commit/hash the independent source, synthetic fixtures, test output, environment lock, and protocol version. A separate custodian/reviewer then verifies those pins and only afterward releases the existing expected result summaries for a blind comparison. If that separation cannot be enforced, stop and record the challenge as not independent.

## 2. Frozen LowVol V2 baseline

Use only the fixed identity and rules below, as specified by the pinned preregistration and implementation contract:

| Item | Frozen value |
|---|---|
| Identity | `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`; Binance USD-M perpetual long/short, not spot H7 |
| Universe | Exactly BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LINK, DOT, LTC, BCH, AVAX; no substitutions or exclusions |
| Decision anchor | Saturday 00:00:00 UTC |
| Feature | Exactly 672 preceding hourly close-to-close log returns; `RV28 = sqrt(sum(r²))`, `LOWVOL = -RV28`; no bar beginning at or after the anchor |
| Ranks and targets | Ascending average rank across all 12 (`1` is highest volatility, `12` lowest); center at `6.5`; `w_i=(rank_i-6.5)/sum(abs(rank_j-6.5))`; fail if denominator is nonpositive |
| Exposure | Gross 1.0, net 0, long gross +0.5, short gross −0.5; no leverage multiplier |
| Price interval | Public 1h kline open at anchor to open exactly seven days later; hold target weights constant for that interval |
| Funding | Official rate timestamps in `(t,t+7d]`; contribution `-target_weight * sum(rate)` |
| Turnover/cost | Sum `abs(new_target_weight - previous_target_weight)`; previous weights start at zero; mandatory final close adds `sum(abs(last_target_weight))`; 10 bps one-way baseline and 20 bps one-way stress |
| Development | 48 weekly periods; anchors are exactly `2025-02-01T00:00:00Z + 7d*k`, `k=0..47`; last anchor `2025-12-27T00:00:00Z`; terminal open `2026-01-03T00:00:00Z` |
| Historical Holdout audit | 34 weekly periods; anchors are exactly `2026-01-03T00:00:00Z + 7d*k`, `k=0..33`; last feature anchor `2026-08-22T00:00:00Z`; terminal open `2026-08-29T00:00:00Z` |

Record every anchor and interval boundary as UTC epoch milliseconds and ISO-8601 UTC; assert the expected counts (48/34), 12 assets at every anchor, exact source bounds, continuous hourly bars, exact funding event timestamps/counts and coverage, ranks, average-rank tie handling, weights, exposures, and gate decision. The Development funding row count is not stated in the pinned summary; derive and record it only from the pinned receipted members during any later authorized run, otherwise stop. Preserve full per-asset/per-week records rather than comparing rounded summary tables only.

Apply the frozen preregistration’s original Development and Holdout gates, unchanged:

| Gate | Development | Historical Holdout audit |
|---|---:|---:|
| Valid periods | exactly 48 | exactly 34 |
| Eligible assets per period | exactly 12 | exactly 12 |
| Gross exposure | 1.0 every period under the frozen numerical invariant | 1.0 every period under the frozen numerical invariant |
| Absolute net exposure | `<=1e-12` every period | `<=1e-12` every period |
| Baseline compounded net return | `>0` | `>0` |
| Profit Factor | `>=1.15` | `>=1.15` |
| Annualized weekly Sharpe (`sqrt(52)`) | `>=0.75` | `>=0.75` |
| Maximum drawdown | `<=20%` | `<=20%` |
| Positive chronological blocks | `>=3/4` | `>=3/4` |
| Compounded return at 20-bps stress | `>0` | `>0` |
| Mean weekly Rank IC | `>0` | `>0` |
| Rank IC Newey-West t (lag 4) | `>=1.645` | `>=1.645` |
| Data, funding coverage, invariant, or lineage failure | none | none |

These are the gates already in the pinned preregistration, not proposed changes. Preserve the frozen gate calculation and decision names; a success in synthetic tests does not pass a strategy gate.

The baseline report must compare, at minimum: feature values; ranks and target weights; gross/net/long/short exposure; turnover including initial and terminal trades; funding timestamps, counts and contributions; per-asset and per-week price, funding, cost and net returns; baseline and stress weekly/net equity curves; compounded return; maximum drawdown; Profit Factor; annualized weekly Sharpe; four chronological block returns; mean Rank IC and Newey-West(4) statistic; each frozen gate and final decision. Retain exact missing-data and rejection reasons, not just aggregate metrics.

### Fixed data and original-run pins

Use the existing official-source artifacts only. Full source ZIP/member names, sizes, and member SHA-256 values are fixed by the receipt manifest identified in the matrix; do not reconstruct them from result summaries. Before any execution, verify the artifact/run/source-commit binding and every archive and member hash. A missing, extra, mismatched, malformed, or unavailable required file is a STOP; do not download or substitute a replacement.

The canonical Development lineage is evaluator implementation merge `257fcd3fba441e3ccb4103ba8c1382185d22c9a0`, run-authorization commit `a30a789ce058b08452bb4597f4a92b3bd58383e1`, workflow run `37132394717`, source artifact `11277247641`, and result artifact `11277656738`. The canonical Holdout lineage is Holdout implementation merge `76e7161ab00886932412a027b9e93b1061ecce4a`, run-authorization commit `b15bddb8f316b8d313dd8893a46654849db2a6cd`, workflow run `37133809945`, source artifact `11278085201`, and result artifact `11277199985`. These are the evaluator/result comparison targets, not code to import or reproduce by copying.

The pinned summaries record Development `DEVELOPMENT_PASS_HOLDOUT_REQUIRED` and historical Holdout `HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY`. Read the expected result JSON/Markdown only after independent source and synthetic-test hashes are frozen. Result ZIP, JSON, Markdown, source ZIP, source manifest, and every member are pinned in the matrix. Do not use the prospective snapshot or its data as a substitute for either historical sample.

### PR #805 receipt evidence attribution

The receipt audit is existing evidence, not this challenge and not a PnL reproduction. At inspection, PR #805 was open/draft at head `8c6eab1138e244170ae97e66be595270323133a1`, based on `c37343948f3d24c4105d9970e24dd3c0ac77905f`; the base had since advanced to current main `efec133f4ff8a809722b79fa7c5fe8007667c1ea`. GitHub’s formal review list was empty. The PR comments and pinned receipt report separately record:

- audit code head `7a13ea11c49ba64b2f1cf6318a1c3d39c80f4633`, verifier SHA-256 `32e5f193c215b464c16c2a4b5fbcf93a863ca3dc463218da9cd721d39f0010df`, and a reported exact-head `VERIFIED` result for 52/52 existing inputs, 0 unavailable, 0 mismatches;
- PR #805 receipt-manifest Git blob `6dbb807aa251ef9d49a2ed96884e5c88f10e93b8` and report Git blob `0ca51fdb18a443d7c65bf8773d9064ce6c9a40a3`;
- owner comments #6177484124 and #6177783380 report separately attributed in-memory checks of the existing Holdout and Development source/result artifacts. Comment #6177831281 records independent source review of the then-reviewed package; #6178491881/#6178523406 record base synchronization and unchanged five-file scope.

These records establish receipt/byte-identity claims only, not raw-data authenticity, economic validity, independent strategy PnL, or a review of this protocol. Attribute the writer’s 52-input audit and the lead’s artifact checks to their respective report/comment and exact state; do not describe them as checks performed in this task. PR #805 and M11 files are out of scope and must not be edited.

## 3. Comparison tolerances and stop behavior

Freeze these comparison rules before expected results are unsealed. For numeric values, pass only when `abs(actual-expected) <= max(abs_tol, rel_tol * abs(expected))`; both values must be finite. Nullability, sign, exact timestamps, row/asset counts, ranks, scenario availability, and categorical decisions compare exactly. No post-result tolerance widening, rounding to hide divergence, or alternate gate interpretation is allowed.

| Quantity | Absolute tolerance | Relative tolerance |
|---|---:|---:|
| Feature RV/LOWVOL | `1e-12` | `1e-10` |
| Weights and exposure invariants | `1e-12` | `1e-10` |
| Turnover, funding, costs, weekly returns and equity values (decimal return units) | `1e-10` | `1e-8` |
| Aggregate metrics and block returns (decimal units) | `1e-8` | `1e-7` |
| Sharpe, Profit Factor, Rank IC and Newey-West statistics | `1e-7` | `1e-6` |

These are proposed float64 arithmetic tolerances, not estimated from observed output: feature/weight checks allow only near-roundoff differences; the slightly wider weekly and aggregate limits allow finite summation/compounding-order differences; statistics receive a small additional allowance for their multi-step calculation. They are far below the precision of rounded report tables, so compare full-precision results, not displayed values. The exact-rank and exact-gate requirements prevent numeric tolerances from masking changes in ordering or decisions. A separate reviewer must accept these values before execution; once expected results are inspected they cannot be changed.

Ranks and all gate booleans/decisions must match exactly even where the feature/weight values are within tolerance. An in-tolerance numeric difference that changes a gate is a gate flip and stops the challenge. The first baseline discrepancy outside tolerance, gate flip, lineage/hash mismatch, incomplete coverage, or failed synthetic check stops all follow-on diagnostics and yields `DIVERGED` or `UNAVAILABLE` under the matrix definitions. Do not continue to diagnostics to explain away a baseline discrepancy.

## 4. Separate economic-model audit

Faithful reproduction first preserves the original rules and accounting exactly, including approximations. Do not silently “correct” them inside the reproduction. A separate reviewer should audit and report economic validity as a distinct deliverable without changing this baseline or creating a corrected PnL run:

1. **Turnover:** frozen turnover uses successive target weights rather than drifted live positions. Compare with executable position drift only as an audit question; no alternative portfolio is authorized here.
2. **Funding:** frozen funding contribution is `initial_target_weight * sum(funding rates)`, not quantity multiplied by settlement marks at each funding event. Funding notional, mark, sign, and settlement timing need economic review.
3. **Signal/execution timestamp:** the feature cutoff and entry open share anchor `t`. Review whether the signal is actually available before that open and model realistic execution latency separately.
4. **Lookahead and availability:** verify close/open timestamp semantics, information availability, as-known data, bar completion, and funding event timing.
5. **Execution and terminal costs:** evaluate fill latency, spread, slippage, market impact, rebalancing and terminal-close feasibility; baseline costs are assumptions, not executable quotes.
6. **Coverage and universe bias:** audit missing/delisted assets, survivorship, source gaps, and whether the fixed universe was selected retrospectively.
7. **Short/margin feasibility:** audit borrow/venue constraints, funding mechanics, collateral, margin, liquidation, leverage, and short-side feasibility. None is proven by the historical return series.
8. **Venue basis/capital denominator:** assess price basis, the USD research denominator, collateral/netting and capital requirements; no EUR/account return follows from this model.
9. **Instrument mismatch:** daily spot history or a spot candidate does not validate a perpetual long/short strategy, short availability, or leverage.

An unresolved audit finding remains `UNKNOWN`; it is not fixed by a technical reproduction or by a favorable historical metric.

## 5. Bounded Development-only diagnostics

There are at most the six listed scenarios in the matrix; no Cartesian product, asset sweep, threshold sweep, or ad hoc variant is permitted. Existing 20-bps stress is part of baseline reproduction, not an extra scenario. Every available scenario is Development-only and uses the exact Development asset list and period count. The Holdout receives baseline historical-audit reproduction only; never run a scenario or use a Holdout result for selection, retuning, or renewed confirmation. No variant winner selection, promotion, frozen-rule change, or removal of a losing asset is permitted.

`D1_COST_30BPS` and `D2_COST_40BPS` change only the one-way cost scalar, using the frozen baseline turnover, initial trade, and terminal close. `D5_FEATURE_21D` replaces only the feature lookback with exactly 504 preceding hourly log returns and keeps all other Development rules fixed. The 35-day feature (`D6_FEATURE_35D`) needs 840 preceding returns, but the existing Development source begins at `2025-01-03T23:00:00Z` and the first Development anchor is `2025-02-01T00:00:00Z`; this does not provide complete 35-day prior coverage. Mark it `UNAVAILABLE`; do not borrow Holdout files or acquire data.

For delayed execution (`D3_DELAY_1H` and `D4_DELAY_24H`), define decision at anchor `t`, entry/rebalance at the exact 1h or 24h-later public kline open, next rebalance/exit at the same offset after `t+7d`, funding events in `(delayed_entry, delayed_exit]`, and target-weight turnover at those execution boundaries, from zero at the first entry, plus the mandatory close at the delayed terminal exit. Require exact timestamps and complete seven-day intervals; never forward-fill or use a nearest price. The Development-only source ends at the baseline terminal open `2026-01-03T00:00:00Z`; the last shifted exit is beyond that boundary. Therefore the existing Development receipt cannot support either full delayed scenario without borrowing post-Development/Holdout data: mark both `UNAVAILABLE` unless an already-receipted Development-only artifact proves complete coverage. No data acquisition or partial-week fallback.

Before execution, register every baseline and proposed scenario (including unavailable, failed, manual, and discarded attempts) against the complete historical trial ledger. Reconcile cumulative usage and remaining budget explicitly; empty campaign variant arrays are not evidence of capacity. The remaining budget is currently `UNKNOWN / UNRECONCILED`; this blocks all execution until resolved. Baseline-only per-asset and chronological-block attribution is descriptive output from the frozen portfolio, not permission to form new portfolios or choose assets.

## 6. Proposed offline implementation and resource limits

These are conservative **proposed** limits, not measured runtime or observed resource use. Use one isolated, network-disabled worker with one CPU core, Python 3.12 standard library only, fixed locale/timezone (`C`, UTC), deterministic sorting, no optional market-data packages, and read-only copies of the pinned existing inputs. No credentials, APIs, network, GPU, paid runner, workflow dispatch, or parallel variants.

| Limit | Proposal |
|---|---:|
| Per attempt | 10 CPU minutes; 15 minutes wall clock; 1 GiB resident memory; 64 MiB output |
| Entire authorized package | 70 CPU minutes maximum; 105 minutes wall clock maximum; 1 GiB resident memory; 512 MiB output |
| Execution | Serial only: one baseline; at most six registered diagnostics, unavailable scenarios consume no evaluator run but remain in the ledger |

On limit breach, stop; retain logs and partial outputs with `UNAVAILABLE`/`DIVERGED`, never silently restart or increase limits. Proposed eventual commands (not present or run by this source-preparation task) are:

```sh
python3 -B -m unittest discover -s independent/tests -p 'test_*.py' -v
python3 -B independent/reproduce_lowvol_v2.py --receipts /readonly/lowvol-receipt-manifest.json --stage development --output /output/development.json
python3 -B independent/reproduce_lowvol_v2.py --receipts /readonly/lowvol-receipt-manifest.json --stage historical-holdout-audit --output /output/holdout-audit.json
```

The implementation and command-line interface must be separately reviewed and concretely authorized before use. This proposal does not add those files, run commands, or imply that `independent/` exists.

## 7. Outcomes, lineages, and prerequisites

Use only these reproduction outcomes:

- `REPRODUCED`: all required receipts/coverage are valid; the independent baseline matches every predeclared comparison and decision within the fixed tolerances. This means implementation fidelity only, not profitable, economically valid, independently confirmed, Paper-ready, or Live-ready.
- `DIVERGED`: valid pinned inputs were available but a frozen output, rank, metric, gate, decision, or lineage differs beyond the fixed rules. Stop; retain the full mismatch; no tolerance widening or diagnostic continuation.
- `UNAVAILABLE`: required existing input/coverage/review/ledger/budget prerequisite is missing or exceeds a resource limit. No replacement, acquisition, or inferred success.

Follow-on candidates are separately budgeted and not authorized by this packet: Cross-Venue V1 Discovery **and its failed transfer Holdout**; Cross-Venue V2 failed validation; and TSMOM V2 failed Discovery only (Holdout remains null/not evaluated). Preserve LowVol V1, RegimeTrendBreakout V1, taker-flow V1/V2, and regime-grid failure records where source receipts exist; see the matrix for pinned source paths, result identifiers, and explicit missing fields. H5/H7/P1/C1/X1 are not established backtests: their cited sources support design or synthetic-engineering status only. No complete historical attempt ledger or remaining trial budget is established; do not infer it from draft arrays or incomplete reconciliation.

Faithful reproduction, the economic-model audit, and parameter sensitivity are three different work products. Robustness must not turn into retuning an already observed Holdout. Any changed strategy requires a new identity, separately reviewed preregistration and genuinely untouched future confirmation. Every failure, manual run, discarded attempt, unavailable scenario, and technical-invalid run must remain in the reconciled ledger; technical test success never changes a strategy gate.

## 8. Source index and checks performed for this plan

All historical main-tree strategy sources below are pinned to commit [`386013c1e78c4be5ea5d6c89063c9c4b8dacda66`](https://github.com/Achi1984/meridian/tree/386013c1e78c4be5ea5d6c89063c9c4b8dacda66), not a moving branch:

- LowVol V2: `research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PREREGISTRATION.md`, `research/LOW-VOLATILITY-RANK-WEIGHTED-V2-IMPLEMENTATION.md`, `research/LOW-VOLATILITY-RANK-WEIGHTED-V2-HOLDOUT-IMPLEMENTATION.md`, `research/LOW-VOLATILITY-RANK-WEIGHTED-V2-DEVELOPMENT-EVIDENCE.md`, `research/LOW-VOLATILITY-RANK-WEIGHTED-V2-HOLDOUT-EVIDENCE.md`, and `research/results/low-volatility-rank-weighted-v2-{development,holdout}-frozen-summary.json`;
- strategy inventory: `docs/strategy-lab/FROZEN_STRATEGY_PASSPORTS_20261014.md` and `docs/strategy-lab/STRATEGY_EVIDENCE_REVIEW_20261014.md`;
- the exact PR #805 receipt evidence is pinned separately by the PR head and manifest/report Git blobs in §2 and the JSON matrix.

The source-preparation checks were read-only: refresh/fetch and verify live main; inspect `MERIDIAN_LIVE_CHECKPOINT.json`, bootstrap/workflow instructions and the bounded latest mailbox tail for issue #571; inspect pinned strategy sources and existing PR #805 evidence. No evaluator, strategy test, data job, network market-data request, artifact download, PnL calculation, authorization change, or PR #805/M11 file edit was performed. Before delivery, validate only JSON syntax and consistency between this document and the matrix. Independent methodology review and Claude challenge remain future prerequisites.

**Unresolved prerequisites:** complete trial-ledger reconciliation; remaining budget; reviewed and hash-frozen independent implementation/synthetic tests; confirmation that the source artifacts remain available and match all pins at the time of any later authorization; resolved missing coverage for unavailable scenarios or acceptance that they remain unavailable; independent economic-model audit; explicit execution authorization; future lead methodology review and Claude review. No execution is proposed until each applicable gate is satisfied.
