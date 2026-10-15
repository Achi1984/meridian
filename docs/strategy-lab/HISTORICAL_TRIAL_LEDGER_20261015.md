# Historical strategy-trial ledger — 15 October 2026

- **Op-ID:** `STRATEGY-TRIAL-LEDGER-20261015`
- **Inventory:** bounded and incomplete; this is not a canonical complete ledger.
- **Pinned main:** `6807d47e5c8f678534770f8d3758d95429b405c4`
- **Machine-readable register:** [`historical-trial-ledger-20261015.json`](historical-trial-ledger-20261015.json)
- **Execution authorization:** `false`

The inventory base is historical, not the branch's current main. PR #811 was not merged at that pinned base and later merged to main as `a2eafbf3a9973afcace848713cad72ee31c7279c`; this packet does not depend on or use its files as evidence.

This source-only inventory reconciles documented results and workflow attempts from the merged reproduction protocol, challenge matrix, frozen passports, evidence review, receipt verification, and the exact result/evidence files listed in the JSON source index. Each index entry gives the repository path, Git blob SHA, and commit. Run IDs and result identities are transcribed from those sources; an Actions `runAttempt` number remains `UNKNOWN` where the pinned source does not state one. Source paths and hashes are asserted pointers, not authenticated execution receipts, reviewer signatures, or proof of evaluator execution.

No evaluator was run or imported; no market data or artifacts were downloaded; no PnL was recalculated; no workflow was dispatched. The scan does not establish a complete historical ledger. Unlisted manual, discarded, failed, or branch-local work is **UNKNOWN**, not zero.

## Bounded inventory

The JSON lists **12 result records**, **20 documented workflow run IDs** (14 evaluator-classified attempt records and 6 operational/source/prospective workflow records), and **7 non-empirical records** covering design, synthetic engineering, a prior data/hash audit, and a CI audit with no jobs. The 14 evaluator-classified count is a raw record-row count, not deduplicated run IDs or exact run-attempt identities. These are bounded inventory counts, not exact distinct workflow-attempt counts, total trial usage, capacity, or a remaining budget. All 20 `runAttempt` numbers are **UNKNOWN**; therefore exact distinct attempt identities and usage remain **UNKNOWN**.

The result records are not all strategy PnL:

- LowVol V1 run `37129972221` is feature evidence, not strategy PnL.
- LowVol V2 runs `37132394717` and `37133809945` are the recorded Development and historical Holdout results. The reported gates remain historical records, not newly verified metrics or fresh confirmation.
- LowVol V2 run `37131815781` stopped on a funding timestamp validation failure before returns and is retained as `TECHNICAL_INVALID`, not a strategy loss. Run `37132982310` is a separate workflow/run identity retained as a reproducibility check, not a second selected result.
- Cross-Venue V1 Discovery `36526460897` and its later failed transfer Holdout `36527605999` remain paired. Cross-Venue V2 validation `36563826168` and TSMOM V2 Discovery `36748128411` retain their recorded failures; TSMOM Holdout remains not evaluated.
- The evidence review also records Regime Trend Breakout V1 Discovery/Holdout (`37102449505`, `37113947919`), Taker Flow V1/V2 (`36609900324`, `37115162706`), and Regime-Gated Grid V2 (`36547247431`). The V2 taker-flow row is a feature-validation result with `strategyPnlCalculated: false`.
- LowVol V2 prospective source probes `37143326461` and `37143595493`, source-start verification `37143900156`, and snapshot/preservation workflows `38125893276`, `38149124458`, and `38156356512` are retained as operational attempts. They are not historical PnL trials; the recorded boundary snapshot had zero eligible observations.
- H5/H7 design notes, P1/C1 synthetic adapter evidence, X1 synthetic composition work, and the H5 direct-entry design rejection remain explicitly non-empirical. None is promoted to an executed result.
- The LowVol receipt report’s source/result hash checks are recorded separately as a prior data/hash audit, not a PnL result; this packet neither repeats that audit nor treats it as an independent reproduction.
- Release Safety run `38636260048` is included only as a CI audit non-execution record. The pinned receipt report states `action_required`, zero jobs, and no failed-job logs. The separate non-repository Actions API observation at `https://api.github.com/repos/Achi1984/meridian/actions/runs/38636260048` (observed `2026-10-15T11:03:00Z`) reports event `pull_request`, head `7a13ea11c49ba64b2f1cf6318a1c3d39c80f4633`, conclusion `failure`, and zero jobs from `https://api.github.com/repos/Achi1984/meridian/actions/runs/38636260048/jobs?per_page=100`. This metadata assertion has no Git source SHA and is not authenticated execution evidence; the conclusion discrepancy remains **UNKNOWN**. The run is explicitly excluded from trade/research-trial usage and does not establish evaluator execution.

No cancellation, abort, or discard event is invented. Their historical counts remain **UNKNOWN** because the bounded sources do not provide a complete attempt list. A duplicated reference to one workflow/attempt is deduplicated by the validator; separately identified, known run-attempt numbers remain distinct.

## Proposed reproduction cells (not historical usage)

The protocol’s two baseline cells and six Development-only diagnostic cells are recorded separately from history. All eight remain `NOT_EXECUTED` and do not consume historical usage. D3 (`D3_DELAY_1H`), D4 (`D4_DELAY_24H`), and D6 (`D6_FEATURE_35D`) remain unavailable on the cited Development receipt; no Holdout borrowing, partial interval, interpolation, or acquisition is proposed. CPU, wall-clock, memory, and output ceilings in the JSON are proposed limits, not observed usage or an authorized global cap.

## Reproduction blockers and coverage gaps

| Gap / prerequisite | Current evidence and consequence | Source that could close the gap |
|---|---|---|
| Complete historical attempts, including manual, failed, technical-invalid, cancelled/aborted, discarded, and synthetic/design work | The bounded sources establish listed entries only. PR #791’s cited reconciliation is explicitly partial; campaign `variants: []` does not establish zero prior work. Completeness and cumulative use remain `UNKNOWN`. | A canonical reconciled ledger tied to exact source commits and run/attempt identities, including manual/discarded records; reconcile the cited PR #791/#795/#768/#757 source heads with subsequent evidence. |
| Authorized cap and remaining budget | Complete authorized cap, consumed-attempt policy, and reconciled consumed list are not established. Remaining budget is `UNKNOWN_UNRECONCILED`; the protocol’s eight proposed cells are not a cap. | The explicit authorized cap and provenance, plus a complete attempt ledger reconciled under its counting policy. |
| Exact attempt/result lineage where metadata is incomplete | Some cited summaries omit Actions attempt number or full per-attempt record. No missing event is treated as zero. | Pinned run-attempt metadata and source-authenticated records for the exact affected run IDs; no artifact download was performed here. |
| D3/D4/D6 input coverage | Protocol and matrix mark these unavailable for current Development-only receipts. They cannot be counted as executed or silently replaced. | An already-receipted Development-only source proving the full delayed boundaries/lookback, if one exists; otherwise they remain unavailable. |
| Independent implementation/review and authorization | Protocol requires frozen independent code and synthetic checks, exact-head independent and methodology/Claude review, receipt verification at execution time, and concrete separate authorization. None is granted by this ledger. | The separately reviewed/hash-frozen implementation and checks, required reviews, current pinned-receipt verification, and concrete authorization specified by `INDEPENDENT_BACKTEST_REPRODUCTION_PROTOCOL_20261014.md`. |

## Validator contract

`validate-trial-ledger.mjs` is a pure deterministic validator for bounded parsed JSON data. It performs no file, network, environment, clock, random, evaluator, or state-write operations. It checks source provenance, identity types and sizes, unique and conflicting attempt/result identities, canonical result-to-attempt identity, status/count consistency, proposed/observed separation, and unavailable-cell handling. Numeric remaining budget requires complete coverage, an explicitly sourced `RECONCILED` counting policy and cap, a consumed-attempt set exactly equal to all observed policy-counted identities (including applicable failed/technical-invalid/discarded statuses), and known run-attempt numbers. Unrepresentable manual/nonworkflow attempts are an explicit blocking coverage gap. Duplicate references are deduplicated for inventory only; conflicting references fail closed. The validator never returns execution authorization or completeness certification.

The validator reports input consistency only; `CLAIMED_COMPLETE` is an input claim, not a completeness certification. The register intentionally leaves counting policy, authorized cap, consumed attempt references, and remaining budget as `UNKNOWN`. Empty arrays, empty campaign variant lists, unavailable cells, technical test success, and the proposed package size cannot establish zero historical usage, available capacity, execution approval, stage promotion, Paper/Live readiness, profitability, or complete evidence.
