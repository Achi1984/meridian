# BTC/EUR live-data paper pilot

This is a small, isolated operations experiment for the established BTC/EUR spot
pair. It is not a validated strategy, an approval to operate, or evidence of
profitability. There is no live execution, authenticated exchange access, wallet,
subscription, order, or credential path.

## CLI

Imports are network-free. A run requires a mode, an explicit data root and new
run ID, an explicit bounded duration and cycle count, and the opt-in `--network`
flag. The fixed public provider contacts only Kraken's public OHLC and Ticker
REST endpoints for `XBTEUR`.

```sh
node scripts/spot-paper-pilot/cli.mjs \
  --mode observe --network \
  --data-root /var/lib/meridian/spot-paper-pilot \
  --run-id review-btc-eur-001 \
  --max-cycles 1 --max-duration-ms 60000

node scripts/spot-paper-pilot/cli.mjs \
  --mode paper --network \
  --data-root /var/lib/meridian/spot-paper-pilot \
  --run-id review-btc-eur-002 \
  --max-cycles 480 --max-duration-ms 28800000

node scripts/spot-paper-pilot/cli.mjs \
  --mode report \
  --data-root /var/lib/meridian/spot-paper-pilot \
  --run-id review-btc-eur-002
```

The commands above are examples, not runs performed for this change. Every
observe/paper invocation also needs a fresh run ID. Existing run directories are
never overwritten or resumed. `report` is read-only and reports an incomplete
journal as incomplete; it cannot continue a run.

A created run records a `SPOT_PAPER_PILOT_MANIFEST_V1` manifest with the
effective limits, start time, mode, pair, and model version. For example, a
one-cycle manifest contains the equivalent of:

```json
{
  "schemaVersion": "SPOT_PAPER_PILOT_MANIFEST_V1",
  "model": "BTC_EUR_SMA5_SMA20_V1",
  "mode": "observe",
  "pair": "BTC/EUR",
  "limits": {
    "maxCycles": 1,
    "maxRequests": 2,
    "maxBytes": 67108864,
    "maxResponseBytes": 262144,
    "requestTimeoutMs": 5000,
    "maxDurationMs": 60000,
    "pollIntervalMs": 60000
  }
}
```

The effective request bound is at most twice the cycle count, up to 960 total.
These are engineering caps, not a recommendation to use all available runtime.
Do not run against real data or activate this pilot until the lead reviews the
exact build and approves a concrete manifest.

## Frozen experimental baseline

- BTC/EUR spot only, one long position at most, no shorting or leverage.
- Virtual starting balance EUR 1,000. Maximum all-in entry exposure EUR 100.
- Closed one-minute candles and SMA(5)/SMA(20): upward crossover enters, downward
  crossover exits.
- At least 21 consecutive closed candles are required. The initial latest
  closed candle establishes the decision cutoff; warmup bars never generate
  orders. Only a subsequently observed closed bar can signal. No forced trades;
  zero-entry is a valid result.
- Entry uses the freshly acquired ask plus modeled adverse slippage; exit uses
  the executable bid less modeled adverse slippage. A signal candle close is
  never a fill price.
- Assumptions are 50 bps fee and 10 bps adverse slippage per side. These are
  versioned modeling assumptions, not Kraken fee or execution evidence.
- EUR is integer cents and BTC is integer satoshis. Each side's rounded fee is
  included in entry affordability and the EUR 100 all-in cap. Entries are
  blocked at the EUR 20 modeled session-loss threshold. A sampled 2% stop
  compares the executable bid to the modeled entry; it is not a guaranteed
  loss bound.
- Decimal market-data fields are bounded to 90,071,992.54740991; notional and
  ledger results must remain safe integers in cents. Overflow is rejected before
  the quote is persisted or any simulated ledger effect is committed.
- Entries are rejected above a 50 bps spread. Exits do not use that entry-only
  filter. Invalid or stale observations cannot create fills. An open terminal
  position remains explicitly unresolved with its last mark and terminal mark
  age.

The report separates bounded operational completion from profitability.
Profitability is always `NOT_ASSESSED`; a no-entry run is not evidence of edge.

## Market-data contract and runtime limits

The provider makes only these GET requests, with fixed pair and interval
parameters:

- `https://api.kraken.com/0/public/OHLC?pair=XBTEUR&interval=1`
- `https://api.kraken.com/0/public/Ticker?pair=XBTEUR`

The implementation accepts only Kraken result keys `XXBTZEUR` or `XBTEUR`, and
requires exactly one matching pair (plus the documented OHLC `last` value). It
rejects API error arrays, schema errors, invalid or future candles, non-strict
or gapped candles, stale closed bars, invalid/crossed quotes, stale ticker
acquisition, and a backwards clock. Kraken's final OHLC row is treated as
unfinished and excluded. Ticker has no exchange event timestamp: the journal
stores request start and response receipt, and the report makes no event-time
claim. The runner determines a strategy signal before requesting its execution
quote, records the signal-known time, and rejects quotes whose request began
before that time, even if the quote otherwise meets the freshness bound.

The OHLC/Ticker response shapes and unfinished final OHLC row follow Kraken's
[OHLC reference](https://docs.kraken.com/api-reference/market-data/get-ohlc-data)
and [Ticker reference](https://docs.kraken.com/api-reference/market-data/get-ticker-information).
No provider request is made by tests.

Transport is GET-only, timeout is at most 5 seconds, maximum response body is 256 KiB,
and maximum delivered response bytes per run is 64 MiB. Runs are limited to
480 cycles, 960 total requests, and 8 hours, with at least 60 seconds between
poll starts. One shared monotonic deadline bounds run initialization, polling,
provider calls, and all journal I/O; stop handling gets a separate five-second
terminal-write grace. There are no hidden retries or fallback providers. HTTP 429 is
recorded as a gap; the next attempt, if any, waits for the normal minimum poll
interval and remains within the same budgets. A malformed response terminates
the run without simulated effects. Stop signals cancel in-flight fetches and
attempt a terminal report within a five-second write grace. If that write times
out or durable storage fails, its commit is treated as ambiguous and success is
not asserted. The response hashes bind stored response bytes; they do not
authenticate Kraken as the origin. Provider and journal operations also recheck
the monotonic deadline when awaited work resolves. On timeout or abort, owned
network readers are cancelled without waiting indefinitely, and journal handles
are given a separate bounded close attempt, including handles from late opens.

## Journal, report and deployment seam

Each unique run ID owns a private directory. An exclusive writer claim prevents
another writer, and an existing directory is never silently resumed. Raw
accepted response bodies are stored separately by SHA-256 under `responses/`;
event records include those hashes, response sizes, and acquisition intervals.
Response writes and journal snapshots require exact persisted readback before
acknowledgement. Journal publication is serialized and fenced by a
predecessor-bound pending marker; failure or timeout after a mutation begins is
reported as `JOURNAL_UNKNOWN`, poisons the writer, and leaves the lock/pending
marker for read-only reconciliation. The reader distinguishes a visible
candidate with unconfirmed acknowledgement from a still-visible predecessor;
neither case resumes or retries. `journal.json` is a checksummed atomic snapshot
containing deduplicated event IDs and a checkpoint with strategy/ledger state.
Persistence succeeds before a simulated fill is applied to the runner state or
included in its returned report. `report` verifies the snapshot and referenced
response hashes but does not resume or repair it.

Reports include observations, data gaps, signals, simulated fills and fees,
cash, position state, realized/unrealized PnL, terminal mark and age, stop
reason, and explicit limitations.

## Manual bounded observation evidence

The `.github/workflows/spot-paper-pilot-observe-only.yml` workflow is manual
only and permits only its first dispatch and first attempt. After it has been
reviewed and merged, an authorized operator can dispatch its fixed observation
once from the repository root with:

```sh
gh workflow run spot-paper-pilot-observe-only.yml --ref main
```

The workflow has no runtime inputs. It checks out accepted source
`81edf0b5dc3d455c2c1e1906791d56c731bea0c9`, creates a fresh private directory
and run ID, and executes exactly:

```sh
node approved-source/scripts/spot-paper-pilot/cli.mjs \
  --mode observe --network \
  --data-root "$RUNNER_TEMP/spot-paper-pilot-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT/data" \
  --run-id "spot-observe-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" \
  --max-cycles 2 --max-duration-ms 120000 --poll-interval-ms 60000
```

It then runs only read-only `--mode report` reconciliation. A terminal report
and verified readback establish bounded completion, but data acceptance also
requires at least one accepted observation. A zero-observation run therefore
fails data acceptance even when its process exits zero and its terminal report
is clean. The evidence artifact includes command/environment/timing metadata,
raw CLI and readback reports, journal and response files, assessment, and
SHA-256 hashes. Artifacts are retained for 14 days, including on failure. The
workflow is not run automatically or from pull requests; do not dispatch before
the exact workflow/source has been reviewed. This does not authorize paper mode.

### First bounded attempt

One attempt was made on the accepted source in an isolated agent-runtime
directory; it was not a GitHub Actions run and no GitHub artifact was available
for it. Environment: Linux `7.0.0-1017-azure` x86_64, Node `v22.23.4`.
Start: `2026-11-07T15:28:17Z`; end: `2026-11-07T15:29:17Z`; CLI exit status: `0`.
It made 2 requests (maximum 4), delivered 0 bytes, accepted 0 observations,
and recorded 2 `fetch failed` data gaps. The report ended with
`COMPLETED_BOUNDED` / `CYCLE_LIMIT`; read-only reconciliation returned
`TERMINAL_REPORT_AVAILABLE` with 4 events. This is clean bounded termination,
but **failed data acceptance** and is not market-data evidence. No retry or
fallback was performed.

The temporary run ID was
`gha-agent-btc-eur-20261107T152816Z-4231`. SHA-256 evidence file hashes:

| File | SHA-256 |
| --- | --- |
| `metadata.txt` | `ce16c6961c8ebeb4fa51f08d2c014c8cc93694c533a5083aec5c4caeabc369d7` |
| `observe.stdout.json` | `1aad9dcfe9f173c563d2d1ea8e9f006160f5dc0dddbaa3d4a5a44063f05097a9` |
| `observe.stderr.txt` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `readback.stdout.json` | `0b69399982d09f048eb058857d851304333ed2f6d22acf9291ec58e162836a08` |
| `readback.stderr.txt` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `data/<run-id>/journal.json` | `c7dd4973b48ec5cdf26625330c98500c65846423abad9baa0dca7699034eae41` |

This single attempt does not justify changing the provider's 5-second timeout,
freshness, strategy, or paper/execution gates. No paper invocation was made.
