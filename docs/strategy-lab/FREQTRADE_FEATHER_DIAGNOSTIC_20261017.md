# Freqtrade Feather diagnostic — exact input parity only

Op-ID OSS-FREQTRADE-FEATHER-20261017-01. Prepared on base
`c1740225b9682534cf1fdaa0128053604e4b86da`, depending on the five unchanged JSON
loader diagnostic files in PR #836. Publish only after that dependency merges
and this packet receives its own exact-head review. This packet adds four files;
it changes no JSON diagnostic, snapshot, engine, workflow or production dependency.

## Result

**All 3,200 retained candles passed exact Feather input comparison** through the
unmodified pinned Freqtrade raw and public loaders. All 16,000 OHLCV values match
bit-for-bit as binary64, not merely within a tolerance. Column order, float64
schema, UTC millisecond schema, chronological order, timestamps, 400 rows per
pair and the full 200-bar warmup were checked. No signal or strategy ran.

Every raw and public load observed exactly one real `pyarrow.dataset.dataset`
call and zero Feather fallback calls: **16 primary-path loads, zero fallbacks**.
A temporary Python profiler observes calls without replacing upstream functions;
its state is cleared in a `finally` block. Unexpected/fallback paths fail closed.
Public output must equal raw output, so public sorting/deduplication cannot hide
an input discrepancy. File hashes are rechecked after every pair has loaded;
input hashes are checked both before and after the diagnostic.

`FREQTRADE_FEATHER_RESULT_20261017.json` is the actual completed result. It binds
all eight generated Feather file hashes, the original bridge manifest/input,
the exact upstream commit and the existing dependency lock and JSON-verifier
hashes. It reports only `EXACT_FEATHER_INPUT_PARITY_ONLY`.

**The JSON loader remains a separate failure:** its 1,390 numeric differences
are not superseded, relabeled or tolerated. This new input path prevents that
parser from participating. Passing a format round trip is not evidence of
signal, accounting or performance parity, source authenticity or profitability.

## Exact data path

1. Reuse PR #836's existing verifier to validate the fixed bridge manifest and
   eight original JSON files. Decode through CPython's standard JSON decoder.
2. Construct explicit float64 OHLCV and UTC millisecond timestamps, then verify
   every constructed value against the input before writing.
3. Write via the **official unchanged** `FeatherDataHandler.ohlcv_store` into a
   new, previously nonexistent local directory. Upstream uses LZ4 level9;
   required LZ4 availability is checked. Existing output is never overwritten.
4. Invoke the real raw and public loaders with spot/1d, no timerange, no missing
   candle filling, no incomplete-candle drop and no startup trimming.
5. Validate the strict schema, timestamps/order and binary64 values. Signed zero
   is distinguished. The output `manifest.json` is written only after all data
   gates pass. That final write is not atomic: interruption or an I/O failure
   can leave a partial file. Completion requires a fully parsed report with all
   successful checks and a successful outer process exit (0); file existence
   alone is insufficient. An interrupted or failed directory cannot be reused
   automatically. No upstream JSON conversion command is used.

The Python socket/DNS/sendto/child-process guard is installed after local Git
verification and before upstream imports/loading, as in PR #836. It catches
accidental network use; it is not a hostile-code/native-code sandbox. Local
files are operator-controlled. The temporary output is diagnostic data only,
not a new canonical research dataset or automatic input-stage promotion.

## Reproduce with the existing isolated environment

Use the already prepared official checkout, CPython3.12.14/Linux x86_64 venv
and 47-wheel hash lock described in `FREQTRADE_LOADER_DIAGNOSTIC_20261017.md`.
No additional package or download is needed. Do not use the publisher environment.
Set Node20.20.2 on PATH for tests, which generate their own JSON fixture.

```sh
MERIDIAN_FREQTRADE_CHECKOUT=/tmp/freqtrade-loader-source /tmp/freqtrade-loader-env/bin/python -I -B -m unittest discover -s test -p test_freqtrade_feather.py -v
/tmp/freqtrade-loader-env/bin/python -I -B scripts/verify-freqtrade-feather.py --checkout /tmp/freqtrade-loader-source --data /tmp/freqtrade-loader-data --out /tmp/freqtrade-feather-new
```

The second command's paths must refer to the prepared checkout and manifest-bound
JSON export; choose a new output directory each time. Expected result: exit0,
`EXACT_FEATHER_INPUT_PARITY_ONLY`; numeric bit mismatch gives exit2, structural,
provenance, codec or path failure gives exit1. Data-gate failures do not create
a completion manifest; interruption or I/O failure during the final write may
leave a partial file. Accept only a fully parsed successful report together with
outer exit0, never mere manifest existence. The report is printed to stdout;
generated binaries remain outside the repository. No source/wheel/market-data binaries are vendored.

## Tests and limits

Nine isolated tests passed, including the real full-snapshot store/load and real
negative cases for changed values, missing/corrupt Feather, reordering and
public sorting, duplicate rows and public deduplication. Other tests reject
float32/wrong timestamp schema, distinguish negative zero from zero, reject a
post-write hash change and verify refusal to overwrite an existing completed
output. The full snapshot also checks every actual Arrow path observation.
Corrupt-file tests intentionally trigger upstream diagnostics before rejection.

No strategy, feature, signal, PnL, exchange instance, market download, credential,
runtime recovery, workflow, live activation or research-stage transition occurs.
Version checks and package hash-lock provenance do not constitute independent
attestation of every installed byte or the Python interpreter.

## Additional upstream provenance

Official source: https://github.com/freqtrade/freqtrade

Commit `1f394eaebc2f46a83d26971388628707802f8602`; GPLv3 provenance and shared
loader source hashes remain in the JSON diagnostic report. No upstream source
was copied or modified. Additional inspected source SHA256:

| Path | SHA256 |
| --- | --- |
| freqtrade/data/history/datahandlers/featherdatahandler.py | `64aa94cec192f357c30e3a9e016f6d7f3c06b3e9efb5b10d2b6f759cec16e0ed` |
| freqtrade/data/history/datahandlers/arrowdatahandler.py | `b2c01cf88ef361549f0d9e6a92a7142ecfcc6c45e310a3ac594c61d62aa2c5aa` |

The unchanged dependency files are `scripts/verify-freqtrade-loader.py`,
`scripts/freqtrade-loader-cp312-linux.lock`, `test/test_freqtrade_loader.py`,
`docs/strategy-lab/FREQTRADE_LOADER_DIAGNOSTIC_20261017.md` and
`docs/strategy-lab/FREQTRADE_LOADER_RESULT_20261017.json`. Only the first two are
runtime imports/inputs of this verifier. Any dependency revision requires
reconciliation and rerunning this packet before publishing its evidence.

## Stored-evidence consistency gate — 2026-10-17 follow-up

Intent: issue #832, comment6231315640. This follow-up adds the producer's
`featherVerifierSha256` to its actual generated report. The isolated official
Feather comparison was rerun after that source change; the field was not inserted
by hand into an old result. The nine Python tests and a second genuine run with
byte comparison passed; the data result remains 3,200 rows with zero binary64
mismatches. The original JSON failure remains unchanged.

`test/freqtrade-feather-report.test.js` runs automatically through the existing
`node --test test/*.test.js` command, with no new workflow or dependency. It
checks stored report consistency against current Feather/JSON verifier bytes,
the dependency lock, the existing exporter commit reference and a freshly
reconstructed offline bridge manifest. It also checks exact pair/row agreement,
reported zero mismatch/path conditions, warmup, strict scope flags and preservation
of the separately stored JSON failure. Six Node tests cover real repository
inputs and mutations of hashes, lineage, universe, row counts, mismatch/path
claims, scope and prior-failure evidence. No Python process or Freqtrade loader
is started by this Node gate.

Run the focused gate locally with Node20:

```sh
node --test test/freqtrade-feather-report.test.js
```

The gate is named **stored evidence consistency**, not execution verification.
An internally consistent report is not cryptographic proof that its producer ran,
that the reported Arrow calls occurred, or that its outer process exited0. Static
CI cannot attest installed package/interpreter bytes or establish current Python
runtime compatibility. Feather binaries are not stored in this repository: their
reported hashes are checked only for valid syntax and pair/filename association,
**not** against unavailable binary bytes. Actual local loading and independent
reproduction remain separate evidence. No source authenticity, strategy, signal,
accounting, performance or promotion claim follows from this gate. Coordinated
changes to source and self-reported hashes still require independent review.
