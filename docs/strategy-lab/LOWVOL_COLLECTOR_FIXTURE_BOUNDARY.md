# LowVol collector: executable source-boundary fixtures

Status: **test-only repair foundation, no production collector correction**.
Baseline: `ad276e787078b5afdb2260a5f3e703bd9fd4da28`.

The [ledger reconciliation](LOWVOL_LEDGER_RECONCILIATION_20261031.md) identifies
six collection failures for two missing weekly cutoffs. A successful start
snapshot did not exercise funding collection. This packet makes that gap
executable against the existing collector source without collecting anything.

## Exact production source, isolated execution

`test-support/lowvol/collector-plan-fixture.py` reads the collector as text and
parses its AST. It compiles only its current `month_start`, `next_month`,
`archive_plan`, and `load_rows` function bodies. It also extracts the exact
top-level funding `if cutoff > PROSPECTIVE_START` branch and requires its complete
AST to match the existing branch contract. It never imports the collector,
executes its module initialization, creates its output directory, loads its
network function, or computes strategy results.

Literal BASE/start constants come from the source. Call/statement checks reject
unexpected extracted operations; stdlib datetime's internal import is restricted
to the already-loaded `time` module. The test injects generated fetch/parser and
funding-validation adapters. The no-op funding validator is deliberately not
source-completeness evidence. This is a targeted source-extraction fixture, not
a general sandbox for untrusted Python. An intentional source refactor may
require an explicit fixture update rather than a permissive fallback.

The Node test invokes this Python fixture with isolated mode, a 10-second
deadline, 8 KiB output cap and only PATH/LANG environment variables. Unsupported
hosts fail explicitly. Production source and workflow files are unchanged.

## Seven generated cases

1. September-to-October split: monthly September plus daily October through the
   inclusive October 17 cutoff-day archive.
2. Year boundary: December monthly funding and January 1–2 daily funding.
3. Start cutoff: neither funding loading nor funding validation is called.
4. First eligible-week cutoff: eight daily funding plans, October 10–17, and
   one funding-validation invocation with the actual source start/end bounds.
5. First funding archive unavailable: exact source exception propagation,
   one attempted fixture load, no fallback, no partial funding assignment and
   no validation call.
6. Cutoff-day kline unavailable after a previous fixture success: no accumulated
   partial rows returned and no replacement archive selected.
7. Top-level collection is excluded; altered funding-gate semantics and an
   unexpected I/O call inside an extracted function fail the fixture contract.

No test downloads archives, contacts an API, opens a portfolio, imports the
strategy, runs P/L, persists a prospective observation or selects operating
parameters. A synthetic unavailable exception models `fetch_zip` failure after
its internal retry budget; this packet does not execute or validate that network
retry implementation. Planned URLs are existing source assumptions, not proof
that the provider publishes those archives or that they are timely/reachable.

## Observed validation and limits

`node --test test/lowvol-collector-plan-fixture.test.js`: **1 Node test passed,
covering 7 Python cases; 0 failures, 0 skips**. The initial local run exposed
CPython `datetime.strftime`'s lazy `time` import under the restricted namespace;
the targeted time-only shim corrected it and the full focused fixture passed.
Hosted CI has not run for this packet at preparation time.

This protects the current plan and failure semantics, not the correctness of
the provider assumptions. It does not fix the observed 404s. Current cutoff-day
and daily-funding URLs, the fixed observation window, completion lag and frozen
source provenance remain unchanged. Missing October 17/24 outcomes remain
missing and cannot be repaired by later backfill.

## Next correction contract

Before changing the active collector, define an independently reviewed source
contract demonstrating a funding source that can actually meet the fixed
cutoff/deadline, exact schema and time boundaries, bounded pagination if relevant,
deduplication/conflict policy and immutable source receipts. Treat any alternative
source explicitly as a provenance change; never silently substitute REST or a
monthly archive. Historical HTTP451 remains a real unresolved access limitation,
not a reason to bypass restrictions. Source availability is not established here.

A future production pure-helper extraction can reuse these exact-body fixtures
to show behavior preservation before a separately reviewed source change. No
source change, rerun, new prospective window, schedule, deadline extension,
Paper/Live activation or strategy qualification is requested by this packet.
