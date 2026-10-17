# Freqtrade loader diagnostic — exact parity failed

Op-ID OSS-FREQTRADE-LOADER-20261017-01. Implementation base
`80daf2b7a5cc2ae0af5b6792583999d69451282c`; follows issue #832 / PR #833.
Offline engineering diagnostic only. No strategy, feature, signal, PnL, exchange
instance, market download, research-stage transition or runtime credential use.
This does not modify the exporter, original snapshot, Freqtrade or frozen research.

## Result and meaning

The unmodified upstream raw JSON loader and its public `ohlcv_load` method both
loaded all **3,200 candles**, with exact row order, UTC timestamps, column order
and endpoints. Public output equals raw output; its cleaning/grouping step made
no observed changes on this snapshot. All 200 warmup candles per asset remained.

The predeclared **zero-tolerance numeric gate failed**: 1,390 of 16,000 OHLCV cells
differ from Python's standard JSON decoding of the bridge files. Count each
source cell once; raw/public comparison reports repeat the same differences.
No tolerance was widened and no successful parity claim follows from small errors.

| Pair | Numeric differences | Largest absolute difference |
| --- | ---: | ---: |
| AVAX/USD | 17 | 1.7763568394002505e-15 |
| BTC/USD | 0 | 0 |
| ETH/USD | 0 | 0 |
| HBAR/USD | 776 | 2.7755575615628914e-17 |
| LINK/USD | 25 | 3.552713678800501e-15 |
| SOL/USD | 0 | 0 |
| SUI/USD | 374 | 4.440892098500626e-16 |
| XRP/USD | 198 | 4.440892098500626e-16 |

See `FREQTRADE_LOADER_RESULT_20261017.json` for bounded examples including the
original JSON numeric token and both binary64 hexadecimal representations.
For example AVAX row272 open: JSON `6.637`, standard decoding `6.637`
(`0x1.a8c49ba5e353fp+2`), upstream `6.6370000000000005`
(`0x1.a8c49ba5e3540p+2`). This representative difference is one binary64 step.

## Bounded root-cause diagnosis

At the pinned commit, `JsonDataHandler._ohlcv_load` calls
`pandas.read_json(filename, orient="values")`, then normalizes columns, casts
dtypes and converts timestamps. Installed pandas3.0.6 defaults to engine
`ujson` and `precise_float=False`. Differences are already present in that raw
loader, before the public method groups dates. A **separate diagnostic call**
with `precise_float=True` produces zero numeric differences across the same
16,000 cells. The checker records this probe separately and never substitutes
it for upstream output, patches the loader or uses it to pass the gate.

These observations isolate the discrepancy to decimal-to-binary JSON parsing
for this environment and snapshot. They are not evidence of dropped candles,
quote conversion or volume fabrication. They also do not establish equivalence
of threshold-sensitive signals, portfolio accounting or performance. Those
steps have not run. Next engineering decision is a separately reviewed exact
input path or a prospectively specified numerical contract; no automatic
continuation, tolerance adjustment or strategy execution is included here.

## Reproduce

Use a separate CPython **3.12.14**, Linux x86_64 virtual environment and an
unmodified checkout of the official repository at the exact commit below.
Never use the publisher/runtime environment. Preparation downloads source and
packages; the actual diagnostic blocks Python socket connection/DNS/sendto and
child-process events after local checkout verification. This guard catches
accidental network use; it is not a security sandbox for hostile native code.

```sh
git clone https://github.com/freqtrade/freqtrade.git /tmp/freqtrade-loader-source
git -C /tmp/freqtrade-loader-source checkout --detach 1f394eaebc2f46a83d26971388628707802f8602
python3.12 -m venv /tmp/freqtrade-loader-env
/tmp/freqtrade-loader-env/bin/python -m pip install --index-url https://pypi.org/simple --only-binary=:all: --require-hashes -r scripts/freqtrade-loader-cp312-linux.lock
node scripts/export-arena-freqtrade.mjs --source research/results/strategy-arena-20261016 --out /tmp/freqtrade-loader-data
/tmp/freqtrade-loader-env/bin/python -I -B -m unittest discover -s test -p test_freqtrade_loader.py -v
/tmp/freqtrade-loader-env/bin/python -I -B scripts/verify-freqtrade-loader.py --checkout /tmp/freqtrade-loader-source --data /tmp/freqtrade-loader-data
```

The last command is expected to emit `LOADER_NUMERIC_PARITY_FAILED` and exit **2**.
Exit0 means exact parity, exit1 means an input/provenance/import/structural error.
An existing export directory is rejected by the exporter; select a new path.
The verifier intentionally accepts only this exact snapshot manifest. Upstream
checkout status must be clean; `-I -B` prevents ambient Python paths and bytecode
writes. Version checks are not a full runtime or installed-byte attestation.
Tests use Node to reconstruct their own export; they never download market data.

Eight contract tests passed: exact values including zero volume, strict tiny
numeric difference, dropped/filled rows, reordering, timezone/schema change,
missing/corrupt manifest, full snapshot with missing/corrupt candle file, and
network/child-process guard. These tests are a manually invoked isolated packet;
no CI workflow or production dependency was changed.

## Source and package provenance

Official upstream: https://github.com/freqtrade/freqtrade

Commit: `1f394eaebc2f46a83d26971388628707802f8602` (version2026.9).
GPLv3 is declared in upstream `pyproject.toml` and LICENSE. No upstream code or
wheel is vendored or distributed by this packet; this is an external comparison
harness, not a statement that GPL source may be incorporated without review.

| File at pinned upstream commit | SHA256 |
| --- | --- |
| LICENSE | `589ed823e9a84c56feb95ac58e7cf384626b9cbf4fda2a907bc36e103de1bad2` |
| freqtrade/data/history/datahandlers/jsondatahandler.py | `e33020f61b55a9784b8cba18e5772b3c03a65234dc0c6c502c47e4db657353d6` |
| freqtrade/data/history/datahandlers/idatahandler.py | `8459a25bef0c6dd1111d2b993f0b307ddadf67b65bdcaf070e96fe88ff9c3ad2` |
| freqtrade/candle_columns.py | `84190b0d77e0c3db96b58c365cbd93b5629465f8efb49eceedf4581044a401f3` |
| freqtrade/data/converter/converter.py | `3eb131e3523f71da5aa78b7a4b40eb3a04236e1679d8db1cfa38c4cb3efd2f97` |

The lock records 47 exact PyPI wheel versions and SHA256 hashes selected from
successful installation reports; wheel URLs were verified as
`files.pythonhosted.org`. A full upstream requirements wheel-only attempt stopped
at sdnotify (no wheel); instead only loader import dependencies were installed,
without sdnotify or a source build. An unused ast-comments dependency was removed.
The lock is a standalone diagnostic environment, **not** the complete official
Freqtrade production requirements lock. Transitive versions are recorded rather
than assumed to match upstream's full application deployment. Exact-version and
hash-required pip resolution was checked; Python itself is version-pinned, not
independently distribution-attested.

The report binds the dependency-lock digest, bridge manifest digest
`5aa35d41d585c5b866b6d46ec1f5868e840dd3dfaa5e227ddbdb6537b172bc66`, and arena input
`decf35415605bda739d08e9ac489951c21f5428d6b5f6362bd6e77abf265c473`.
Input hashes establish consistency, not market-source authenticity or a fresh
holdout. Snapshot files remain operator-controlled local inputs.
