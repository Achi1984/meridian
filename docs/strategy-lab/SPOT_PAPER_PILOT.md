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
claim.

The OHLC/Ticker response shapes and unfinished final OHLC row follow Kraken's
[OHLC reference](https://docs.kraken.com/api-reference/market-data/get-ohlc-data)
and [Ticker reference](https://docs.kraken.com/api-reference/market-data/get-ticker-information).
No provider request is made by tests.

Transport is GET-only, timeout is 5 seconds, maximum response body is 256 KiB,
and maximum delivered response bytes per run is 64 MiB. Runs are limited to
480 cycles, 960 total requests, and 8 hours, with at least 60 seconds between
poll starts. There are no hidden retries or fallback providers. HTTP 429 is
recorded as a gap; the next attempt, if any, waits for the normal minimum poll
interval and remains within the same budgets. A malformed response terminates
the run without simulated effects. Stop signals cancel in-flight fetches and
attempt a terminal report within a five-second write grace. If that write times
out or durable storage fails, its commit is treated as ambiguous and success is
not asserted. The response hashes bind stored response bytes; they do not
authenticate Kraken as the origin.

## Journal, report and deployment seam

Each unique run ID owns a private directory. An exclusive writer claim prevents
another writer, and an existing directory is never silently resumed. Raw
accepted response bodies are stored separately by SHA-256 under `responses/`;
event records include those hashes, response sizes, and acquisition intervals.
`journal.json` is a checksummed atomic snapshot containing deduplicated event
IDs and a checkpoint with strategy/ledger state. Persistence succeeds before a
simulated fill is applied to the runner state or included in its returned
report. `report` verifies the snapshot and referenced response hashes but does
not resume or repair it.

Reports include observations, data gaps, signals, simulated fills and fees,
cash, position state, realized/unrealized PnL, terminal mark and age, stop
reason, and explicit limitations.

The next deployment seam is external to this change: lead review of the exact
source/build and a concrete manifest; an operator-selected durable local volume
and fresh run ID; then an explicitly approved bounded `observe` invocation.
Only after reviewing that report should a separate decision consider a bounded
`paper` invocation. No workflow, deploy configuration, existing strategy gate,
dashboard, or operational activation is changed here.
