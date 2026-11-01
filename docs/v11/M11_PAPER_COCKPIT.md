# M11 Paper cockpit

## Owned paths

This delivery owns the read-only Paper cockpit panel and its focused verification:

- `v11/paper-cockpit-model.js` — injected report reader, DTO presentation adapter, and generated demo fixture.
- `v11/paper-cockpit-view.js` — accessible text-only cockpit rendering.
- `v11/strategy-workspace-bootstrap.js` — mounts the panel at the top of the existing Strategies workspace.
- `test/v11-paper-cockpit.test.js` — report-shaped DTO and evidence-state tests.
- `test/v11-module-cache-identity.test.js` — served V11 module graph assertion.
- `docs/v11/M11_PAPER_COCKPIT.md` — scope and connection contract.

The cockpit uses the existing M11 Strategies navigation; it adds no new route.
The panel is independent of the readiness panel below it. No worker, filesystem,
gateway, authentication, report-producer, workflow, or runtime-control path is
owned or changed here.

## Evidence shown

The adapter consumes the `MEMECOIN_PAPER_OPERATOR_REPORT_V1` DTO described by
the #1104 operator-report contract. It preserves unknown counts and exact
integer-cent strings. Candidate totals are shown with their coverage metadata;
truncation or unaccounted observations remain visibly partial. Rejection
reasons, stops, open-position rows, and unresolved fills are rendered only from
their report arrays. Empty arrays are distinct from omitted arrays.

`READ_ONLY_PAPER_CHECKPOINT_RECEIPTS` is shown as observation-only with the
contract's caller-label-not-authenticated caveat. A synthetic report is shown
as simulated fixture evidence, never as a production run. `FINISHED` and
`INCOMPLETE` are report lifecycle values; neither is a live-worker signal.
Operational liveness is always **NOT EVIDENCED** here. A non-terminal lock is
not proof that a worker is alive.

The operator report does not include trade-level rows, so the cockpit displays
only its evidenced paper-entry-fill count and says that trade detail is
unavailable. Missing fill counts and PnL remain unavailable, not zero. PnL
colors are applied only to known signed amounts. The panel separately reports
that a DTO is present and that its storage durability is not established by
this projection.

The source report provides observation timestamps but explicitly does not
recompute freshness against the wall clock. The UI therefore defaults to
freshness **UNKNOWN**. A caller may inject a display-only clock and
`staleAfterMs` policy to label an observation stale; that is not a producer
health check or operational freshness guarantee.

## Current connection status and future contract

No runtime report endpoint is connected. The page makes no request, does not
poll, and does not read a worker file or checkpoint directory. Its main panel
therefore reports unavailable data. The collapsed generated example is
synthetic, visibly labelled, and is not production telemetry. There are no
start, stop, trade, or authorization controls and no unauthenticated route was
added.

`createPaperCockpitAdapter({readReport})` is the explicit injection boundary.
A future connector must be supplied by a separately reviewed owner and must:

1. Read a bounded `MEMECOIN_PAPER_OPERATOR_REPORT_V1` DTO through an
   authenticated, read-only application boundary; never expose worker
   filesystem paths to the browser.
2. Preserve report identity, mode/provenance, run window, status, evidence
   timestamps, coverage/truncation, exact amount strings, and unavailable
   values without deriving missing counts, fills, marks, or PnL.
3. Keep `CALLER_LABEL_ONLY_NOT_AUTHENTICATED` and durability limits visible;
   a report projection or non-terminal lock cannot establish source
   authenticity, durable storage, or current liveness.
4. Define an explicit observation freshness policy before supplying a
   display-only stale threshold. The UI must not poll until a real, authorized
   read endpoint and its request lifecycle are reviewed.

The injection callback is an interface contract, not a proof of read-only
behavior. No live data, worker availability, Northflank connection, or
production telemetry is claimed by this package.

## Focused verification

```sh
node --test test/v11-paper-cockpit.test.js test/v11-module-cache-identity.test.js
```

The tests use only generated report-shaped objects. They do not access a
provider, worker, checkpoint store, filesystem data source, network, or browser
runtime.
