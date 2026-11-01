# Offline Paper operator report

This is a read-only projection of the existing disabled Paper prototype's
`SYNTHETIC_FIXTURE_REPLAY_ONLY` result or
`SYNTHETIC_CHECKPOINT_ORCHESTRATION_ONLY` result/receipt snapshot. It does not
add a runner, read a checkpoint journal, touch the disabled manifest, call a
provider, schedule work, or integrate with the UI.

```js
import {runSyntheticReplay} from "../../../scripts/memecoin-paper/replay.mjs";
import {
  projectOperatorReport,
  renderOperatorReport
} from "../../../scripts/memecoin-paper/operator-report.mjs";

const dto = projectOperatorReport(runSyntheticReplay({now: Date.now()}));
const text = renderOperatorReport(dto);
```

`projectOperatorReport` returns a strict JSON-safe DTO with the experiment
identity and reported time bounds, freshness statuses and timestamps, candidate
outcomes and attributable reasons, fills, risk/clock stops, reservations and
positions, capital, realized and unrealized valuation, reported cost totals,
and evidenced unresolved fills. `renderOperatorReport` presents the same
information as bounded plain text. Headline lines omit mint/pool/quote
identifiers; sanitized provenance is retained in the details section.

The projection uses only the existing shapes:

- The replay provides `discovery`, `filters`, `analysis`, `simulatedFill`,
  `runEnd`, `ledger`, and `audit`. The scan count comes from the bounded Scout
  audit and `discovery.observedRecords`; decision status and reasons come from
  the reported Filter/Analyst checks.
- Checkpoint orchestration provides `metadata`, ordered `results`, and
  `snapshot.summary`/`snapshot.auditEvents`. The experiment and clock state
  come from metadata, financial state from the summary, and actions/stops from
  acknowledged results. Authorization receipts are not a complete scan record,
  so the report explicitly says scan counts are unavailable when those receipts
  are absent.

Inputs are limited to 1 MiB, 50,000 data nodes, 1,000 audit/receipt rows, and
24 levels of nesting. Output is limited to 256 KiB. Amounts must be bounded
integer decimal strings or BigInts from an existing result; all displayed
aggregates use exact BigInt addition. The projector does not derive strategy
P&L, revalue positions, infer missing zeroes, or compute freshness against the
current clock. When a finish receipt has no complete run-end marks, unrealized
valuation is `UNKNOWN` and the open position remains unresolved even if an older
summary contains a prior mark.

Conflicting experiment IDs, inconsistent run windows, mismatched open-position
identity/counts, conflicting summary/run-end accounting, receipt sequence
counts, or duplicate command IDs with different contents are rejected. An
identical duplicate receipt is counted once. Untrusted text is length-bounded;
control/ANSI characters and URLs are neutralized before rendering.

`ZERO_TRADES` is asserted only for a complete finished report with explicit
fill-decision evidence and no `FILLED_PAPER` entry. The ledger must also be
consistent with zero activity; a position, changed cash, realized P&L, or
reported cost without a fill is rejected as contradictory evidence. An
incomplete snapshot without a fill receipt reports `UNKNOWN`, not zero. A valid
zero-trade result does not imply profitability or operational safety. Missing
candidate, reservation, mark, cost, or clock details remain `UNKNOWN`. The report says
`operationally running: NOT EVIDENCED`: it is not a live monitor. Synthetic
evidence is labelled as such, and `BLOCKED`/`NOT_READY` source readiness is not
runtime operation. Checkpoint hashes and result digests are treated as the
existing binding fields, not as authenticated signatures or provenance.

Run the focused offline suite:

```sh
node --test test/memecoin-paper-operator-report.test.js
```

## Generated example: fully blocked scan

The following readable text is generated from
`reportFixtures.blockedScan()` in
`test/fixtures/memecoin-paper-operator-report/scenarios.mjs`. It is synthetic
fixture evidence, not an observation:

```text
PAPER OPERATOR REPORT
Report status: FINISHED
Experiment: operator-fixture-run
Run bounds: 2026-01-01T10:00:00.000Z to 2026-01-01T18:00:00.000Z
Evidence freshness: UNKNOWN (reported timestamps; not recomputed)
Candidates: considered 2, accepted 0, rejected 1, unknown 1
Paper entry fills: 0 (ZERO_TRADES)
Source readiness: BLOCKED; operationally running: NOT EVIDENCED
Cash: 100000 cents; reservations: UNKNOWN; open positions: 0
Valuation: MARKED_AT_RUN_END; realized gross/net 0 cents / 0 cents; unrealized gross/net 0 cents / 0 cents
Reported costs: 0 cents
Unresolved positions: 0; unresolved fills: 0
No-trade reasons:
- scout [REJECT]: duplicate mint; selected pool evidence is not mixed
- liquidity [UNKNOWN]: required liquidity evidence is unavailable
- momentum15m [UNKNOWN]: score evidence unavailable
Risk and clock stops:
- RUN_WINDOW [STOPPED]: run ended; new work is disabled
Details (identifiers and provenance; sanitized):
- chain=UNKNOWN mint=So11111111111111111111111111111111111111112 pool=11111111111111111111111111111112 duplicatePool=11111111111111111111111111111113 quote=UNKNOWN sampledAt=UNKNOWN status=REJECT
- chain=solana mint=So11111111111111111111111111111111111111112 pool=11111111111111111111111111111112 quote=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v sampledAt=2026-01-01T10:00:00.000Z status=UNKNOWN
Evidence sources: SYNTHETIC_FIXTURE_ONLY
```

## Generated example: unresolved exit

This report is generated from the checkpoint-style receipt fixture
`reportFixtures.unresolvedExit()`. The exit remains unresolved because its
receipt says `UNFILLED`; no terminal fill or end-of-run valuation is inferred.
The complete example is synthetic:

```text
PAPER OPERATOR REPORT
Report status: FINISHED
Experiment: operator-fixture-run
Run bounds: 2026-01-01T10:00:00.000Z to 2026-01-01T11:00:00.000Z
Evidence freshness: UNKNOWN (reported timestamps; not recomputed)
Candidates: considered 1, accepted 1, rejected 0, unknown 0
Paper entry fills: 1 (TRADES_RECORDED)
Source readiness: NOT_READY; operationally running: NOT EVIDENCED
Cash: 92000 cents; reservations: UNKNOWN; open positions: 1
Valuation: UNRESOLVED; realized gross/net 0 cents / 0 cents; unrealized gross/net UNKNOWN / UNKNOWN
Reported costs: 0 cents
Unresolved positions: 1; unresolved fills: 1
No-trade reasons:
- None attributable from the supplied result/receipt snapshot.
Risk and clock stops:
- RUN_WINDOW [STOPPED]: run ended; new work is disabled
Unresolved fills:
- EXIT_UNRESOLVED [UNFILLED]: later identity-bound executable exit quote is unavailable
Details (identifiers and provenance; sanitized):
- chain=solana mint=So11111111111111111111111111111111111111112 pool=11111111111111111111111111111112 quote=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v sampledAt=2026-01-01T10:00:00.000Z status=ACCEPTED
Evidence sources: UNKNOWN
```
