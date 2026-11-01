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

Coverage is part of the DTO and rendered report. Discovery reports the supplied
`observedRecords`, source `truncated` flag, audited Scout rows, and any
unaccounted observed remainder. Scout emits one audit row per observed input,
including duplicate-mint rejects; duplicate rows remain rejected rows and are
not treated as missing records. For example, 100 observed records and five
Scout rows means five known outcomes and 95 unaccounted observed records, not
95 additional rejects. The number of records beyond a truncated discovery
prefix is unknown. Audit coverage separately exposes observed audit rows and
the logger/ledger truncation flags; a missing total is `UNKNOWN`.

Candidate details, nested reasons, no-trade reasons, stops, open positions,
unresolved fills, and provenance each expose `observedTotal`, `total`,
`displayed`, `displayTruncated`, `sourceTruncated`, and `unaccounted` coverage.
Rendered lists are limited to 40 rows, but reported totals are computed before
that display cap. The unresolved-fill headline uses the evidenced total, never
the number of displayed rows. Missing source totals remain `UNKNOWN`.

`ZERO_TRADES` is asserted only for a complete finished report with explicit
fill-decision evidence and no `FILLED_PAPER` entry. The ledger must also be
fully accounted and consistent with zero activity, including cash, realized and
unrealized P&L, costs, open positions, and an untruncated audit/event count. A
position, changed cash, nonzero P&L/cost, or `PAPER_FILL` audit event without a
fill receipt is rejected as contradictory evidence. Missing corroboration and
incomplete snapshots report `UNKNOWN`, not zero. A valid zero-trade result does
not imply profitability or operational safety. Missing candidate, reservation,
mark, cost, or clock details remain `UNKNOWN`. The report says
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
Candidate evidence: audited 2; unaccounted observed 0; discovery truncated NO; Scout audit truncated NO
Paper entry fills: 0 (ZERO_TRADES)
Source readiness: BLOCKED; operationally running: NOT EVIDENCED
Cash: 100000 cents; reservations: UNKNOWN; open positions: 0
Valuation: MARKED_AT_RUN_END; realized gross/net 0 cents / 0 cents; unrealized gross/net 0 cents / 0 cents
Reported costs: 0 cents
Unresolved positions: 0; unresolved fills: 0
Discovery coverage: 2 observed records; 2 Scout audit rows; source truncated NO; audit truncated NO; unaccounted observed 0
Audit coverage: 3 rows observed; total 3; truncated NO (replay logger NO, ledger NO)
Displayed candidate details: total 2, observed 2, displayed 2 (display capped: NO; source truncated: NO; unaccounted: 0)
Displayed no-trade reasons: total 3, observed 3, displayed 3 (display capped: NO; source truncated: NO; unaccounted: 0)
Displayed risk/clock stops: total 1, observed 1, displayed 1 (display capped: NO; source truncated: NO; unaccounted: 0)
Displayed open positions: total 0, observed 0, displayed 0 (display capped: NO; source truncated: NO; unaccounted: 0)
Displayed unresolved fills: total 0, observed 0, displayed 0 (display capped: NO; source truncated: NO; unaccounted: 0)
Displayed provenance: total 2, observed 2, displayed 2 (display capped: NO; source truncated: NO; unaccounted: 0)
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
Candidate evidence: audited 1; unaccounted observed UNKNOWN; discovery truncated UNKNOWN; Scout audit truncated UNKNOWN
Paper entry fills: 1 (TRADES_RECORDED)
Source readiness: NOT_READY; operationally running: NOT EVIDENCED
Cash: 92000 cents; reservations: UNKNOWN; open positions: 1
Valuation: UNRESOLVED; realized gross/net 0 cents / 0 cents; unrealized gross/net UNKNOWN / UNKNOWN
Reported costs: 0 cents
Unresolved positions: 1; unresolved fills: 1
Discovery coverage: UNKNOWN observed records; UNKNOWN Scout audit rows; source truncated UNKNOWN; audit truncated UNKNOWN; unaccounted observed UNKNOWN
Audit coverage: 4 rows observed; total 4; truncated NO (replay logger UNKNOWN, ledger NO)
Displayed candidate details: total 1, observed 1, displayed 1 (display capped: NO; source truncated: NO; unaccounted: 0)
Displayed no-trade reasons: total 0, observed 0, displayed 0 (display capped: NO; source truncated: UNKNOWN; unaccounted: 0)
Displayed risk/clock stops: total 1, observed 1, displayed 1 (display capped: NO; source truncated: NO; unaccounted: 0)
Displayed open positions: total 1, observed 1, displayed 1 (display capped: NO; source truncated: NO; unaccounted: 0)
Displayed unresolved fills: total 1, observed 1, displayed 1 (display capped: NO; source truncated: NO; unaccounted: 0)
Displayed provenance: total 1, observed 1, displayed 1 (display capped: NO; source truncated: NO; unaccounted: 0)
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
