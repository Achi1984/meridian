# BTC/EUR paper signal replay

`scripts/spot-paper-pilot/signal-replay.mjs` is a standalone, offline checker for
the retained BTC/EUR paper run `spot-paper-42395522899-1`. It is separate from
`paper-evidence-assessment.mjs`; it does not change that assessment's
`signalReplay: "NOT_PERFORMED"` result or revise any historical report.

Run it only against retained readback and raw-response evidence:

```sh
node scripts/spot-paper-pilot/signal-replay.mjs \
  readback.stdout.json pilot-manifest.json \
  data/spot-paper-42395522899-1 signal-replay.json
```

The checker is pinned to source
`81edf0b5dc3d455c2c1e1906791d56c731bea0c9`, workflow
`ddae14f01583196dfc9e9da906dcd03d41d58369`, and run
`42395522899` attempt 1. A different or missing identity is not replayed by
default; the default profile and its exact historical identity remain unchanged.
Reads are limited to a 16 MiB readback, 64 KiB manifest, at most 240 referenced
responses, at most 256 KiB per response, and 64 MiB total response bytes. No
provider, network, scheduler, workflow, runtime, or activation interface is
used.

The separately allowlisted `BTC_EUR_PAPER_4H_V1` profile supports the new
first-dispatch BTC/EUR paper identity with exactly 240 cycles, 480 requests,
14,400,000 ms, 60,000 ms polling, a 5,000 ms request timeout, 64 MiB of
responses, and 256 KiB per response. It still requires a valid fresh run ID,
first run/attempt, the pinned runtime source, paper mode, and matching engine
manifest. Profile selection is an optional final CLI argument; any profile
name not in `evidence-profiles.mjs` is rejected:

```sh
node scripts/spot-paper-pilot/signal-replay.mjs \
  readback.stdout.json pilot-manifest.json \
  data/spot-paper-<workflow-run-id>-1 signal-replay.json BTC_EUR_PAPER_4H_V1
```

The new profile is for offline replay only. It does not dispatch, resume, or
modify a run, and its distinct bounds do not loosen the historical default.

The replay uses the pilot's existing `createStrategyState` and
`advanceStrategy` behavior over retained chronological closed candles. It
checks the startup cutoff and reported signal IDs, direction, candle time, and
close. Accepted observations and `MISSED_DECISION_WINDOW` gaps commit replayed
strategy state; data-error gaps with accepted OHLC and provisional signals are
recognized by their canonical `gap:<cycle>:<requests>:<code>` journal ID,
checked without committing state, and may omit both a cycle field and fills.
An unavailable raw-response file produces `UNKNOWN` in the output report.
Fill quote checks are limited to freshness,
closed-candle age, signal ordering, and signal linkage. A sampled stop sell is
counted separately and is not an SMA signal.

The compact JSON output has an overall `outcome` (`PASS`, `FAILED`, or
`UNKNOWN`) and explicit `identity`, `signalReplay`, `fillCausality`, and
`startupCutoff` scopes, with observed discrepancies. Missing raw evidence
remains `UNKNOWN`; identity, data, signal, or causal quote mismatches are
`FAILED`. A `PASS` supports only that the retained signal claims replay against
the retained closed candles and that checked fills meet the stated causal
quote bounds. It is not independent strategy validation, quote/accounting
reconciliation, fill-path validation, or profitability evidence.
