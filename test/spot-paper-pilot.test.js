import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createKrakenProvider } from "../scripts/spot-paper-pilot/provider.mjs";
import { createRunJournal, readRunJournal } from "../scripts/spot-paper-pilot/journal.mjs";
import { runSpotPaperPilot } from "../scripts/spot-paper-pilot/runner.mjs";
import { main as pilotCli } from "../scripts/spot-paper-pilot/cli.mjs";
import { advanceStrategy, applyPaperObservation, createLedger, createStrategyState,
  parseKrakenOhlc, parseKrakenTicker, sha256, SPOT_PAPER_PILOT_LIMITS } from
  "../scripts/spot-paper-pilot/core.mjs";

const BASE = Date.UTC(2025, 0, 1);
const MINUTE = 60_000;
const INITIAL_NOW = BASE + 21 * MINUTE + 1_000;
const PRICE_100 = "100.00000000";
const PRICE_120 = "120.00000000";
const CLI_PATH = fileURLToPath(new URL("../scripts/spot-paper-pilot/cli.mjs", import.meta.url));


function priceRow(timestamp, price) {
  return [timestamp, price, price, price, price, price, "1.00000000", 1];
}

function ohlcData(closes) {
  const rows = closes.map((close, index) =>
    priceRow((BASE + index * MINUTE) / 1000, close));
  rows.push(priceRow((BASE + closes.length * MINUTE) / 1000, closes.at(-1)));
  return { error: [], result: { XXBTZEUR: rows, last: rows.at(-1)[0] } };
}

function tickerData({ bid = "29999.00000000", ask = "30000.00000000" } = {}) {
  return { error: [], result: { XXBTZEUR: {
    a: [ask, "1", "1.00000000"], b: [bid, "1", "1.00000000"],
    c: [bid, "1.00000000"], v: ["1.00000000", "1.00000000"],
    p: [bid, bid], t: [1, 1], l: [bid, bid], h: [ask, ask], o: bid
  } } };
}

function acquisition(data, nowMs, requestStartedAt = nowMs - 20) {
  const raw = JSON.stringify(data);
  return { data, raw, sha256: sha256(Buffer.from(raw, "utf8")),
    bytes: Buffer.byteLength(raw), requestStartedAt, receivedAt: nowMs };
}

function providerFor(clock, ohlcValues, tickerValues) {
  let ohlcIndex = 0;
  let tickerIndex = 0;
  return {
    async fetchOhlc() {
      const value = ohlcValues[Math.min(ohlcIndex++, ohlcValues.length - 1)];
      if (value instanceof Error) throw value;
      return acquisition(typeof value === "function" ? value() : value, clock.value);
    },
    async fetchTicker() {
      const value = tickerValues[Math.min(tickerIndex++, tickerValues.length - 1)];
      if (value instanceof Error) throw value;
      return acquisition(typeof value === "function" ? value() : value, clock.value);
    },
    counters: () => ({ requests: ohlcIndex + tickerIndex, bytes: 0 })
  };
}

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "spot-paper-pilot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function runnerConfig({ dataRoot, runId, provider, mode = "paper", cycles = 1,
  now = INITIAL_NOW, signal, sleep, durationMs, requestTimeoutMs,
  terminalReportGraceMs, journalOptions, clock: suppliedClock } = {}) {
  const clock = suppliedClock ?? { value: now, monotonic: 0 };
  return {
    dataRoot, runId, provider, mode, maxCycles: cycles,
    maxDurationMs: durationMs ?? Math.min(8 * 60 * 60 * 1000, cycles * 60_000 + 1),
    requestTimeoutMs,
    terminalReportGraceMs,
    journalOptions,
    pollIntervalMs: 60_000,
    now: () => clock.value,
    monotonicNow: () => clock.monotonic,
    sleep: sleep ?? (async ms => {
      clock.value += ms;
      clock.monotonic += ms;
    }),
    signal,
    clock
  };
}

test("import-safe Kraken provider makes only fixed public GETs when explicitly called", async () => {
  let calls = 0;
  let clock = 100;
  const provider = createKrakenProvider({
    now: () => clock++,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url.origin, "https://api.kraken.com");
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.accept, "application/json");
      if (url.pathname.endsWith("/OHLC")) {
        assert.deepEqual([...url.searchParams], [["pair", "XBTEUR"], ["interval", "1"]]);
        return new Response(JSON.stringify({ error: [], result: {
          XXBTZEUR: [priceRow(BASE / 1000, PRICE_100), priceRow((BASE + MINUTE) / 1000, PRICE_100)],
          last: (BASE + MINUTE) / 1000
        } }), { headers: { "content-type": "application/json" } });
      }
      assert.equal(url.pathname, "/0/public/Ticker");
      assert.deepEqual([...url.searchParams], [["pair", "XBTEUR"]]);
      return new Response(JSON.stringify(tickerData()), {
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.equal(calls, 0);
  assert.equal(provider.counters().requests, 0);
  await provider.fetchOhlc();
  await provider.fetchTicker();
  assert.equal(calls, 2);
  assert.equal(provider.counters().requests, 2);
});

test("transport stops at 429, rejects truncation and enforces byte ceilings without retries", async () => {
  let calls = 0;
  const limited = createKrakenProvider({
    now: () => 1_000,
    maxBytes: 16,
    fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ error: [], result: {} }), {
        headers: { "content-type": "application/json" }
      });
    }
  });
  await assert.rejects(limited.fetchOhlc(), /RUN_BYTE_LIMIT/);
  assert.equal(calls, 1);
  assert.ok(limited.counters().bytes > 16);

  const truncated = createKrakenProvider({
    now: () => 1_000,
    fetchImpl: async () => new Response("{}", { headers: {
      "content-type": "application/json", "content-length": "9"
    } })
  });
  await assert.rejects(truncated.fetchOhlc(), /TRUNCATED_HTTP_BODY/);

  calls = 0;
  const rateLimited = createKrakenProvider({
    now: () => 1_000,
    fetchImpl: async () => {
      calls++;
      return new Response("{}", { status: 429 });
    }
  });
  await assert.rejects(rateLimited.fetchOhlc(), /HTTP_429/);
  assert.equal(calls, 1);

  const large = createKrakenProvider({
    now: () => 1_000,
    fetchImpl: async () => new Response("x".repeat(256 * 1024 + 1), {
      headers: { "content-type": "application/json" }
    })
  });
  await assert.rejects(large.fetchOhlc(), /RESPONSE_BYTE_LIMIT/);

  calls = 0;
  const requestLimited = createKrakenProvider({
    now: () => 1_000,
    maxRequests: 1,
    fetchImpl: async () => {
      calls++;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }
  });
  await requestLimited.fetchOhlc();
  await assert.rejects(requestLimited.fetchTicker(), /REQUEST_BUDGET_EXHAUSTED/);
  assert.equal(calls, 1);
});

test("compressed body receipt uses decoded body bytes, while its wire Content-Length is not trusted", async () => {
  // The fake fetch returns the already-decoded body that standard fetch exposes.
  const raw = JSON.stringify({ error: [], result: {} });
  const provider = createKrakenProvider({
    now: () => 1_000,
    fetchImpl: async () => new Response(raw, { headers: {
      "content-type": "application/json", "content-encoding": "gzip",
      "content-length": "5"
    } })
  });
  const result = await provider.fetchOhlc();
  assert.deepEqual(result.data, { error: [], result: {} });
  assert.equal(result.bytes, Buffer.byteLength(raw));
});

test("provider bounds fetch and body reads that ignore abort, and cleans late responses", async () => {
  let resolveFetch;
  const provider = createKrakenProvider({
    fetchImpl: () => new Promise(resolve => { resolveFetch = resolve; })
  });
  const deadlineAt = performance.now() + 30;
  await assert.rejects(provider.fetchOhlc({
    deadlineAt, monotonicNow: () => performance.now()
  }), /REQUEST_TIMEOUT/);
  const late = new Response("{}", { headers: { "content-type": "application/json" } });
  resolveFetch(late);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.bodyUsed, true);

  let cancelCalled = false;
  const readerResponse = {
    ok: true, status: 200,
    headers: { get: name => name === "content-type" ? "application/json" : null },
    body: {
      getReader: () => ({
        read: () => new Promise(() => {}),
        cancel: () => {
          cancelCalled = true;
          return new Promise(() => {});
        }
      }),
      cancel: () => Promise.resolve()
    }
  };
  const readerProvider = createKrakenProvider({ fetchImpl: async () => readerResponse });
  await assert.rejects(readerProvider.fetchOhlc({
    deadlineAt: performance.now() + 30, monotonicNow: () => performance.now()
  }), /REQUEST_TIMEOUT/);
  assert.equal(cancelCalled, true);
});

test("OHLC parser excludes Kraken's unfinished row and rejects stale, gapped, out-of-order, and wrong-pair data", () => {
  const data = ohlcData(Array(21).fill(PRICE_100));
  data.result.last = data.result.last + 17;
  const parsed = parseKrakenOhlc(acquisition(data, INITIAL_NOW), INITIAL_NOW);
  assert.equal(parsed.candles.length, 21);
  assert.equal(parsed.latestClosedAt, BASE + 20 * MINUTE);
  assert.equal(parsed.candles.at(-1).timestamp, BASE + 20 * MINUTE);

  const staleAt = BASE + 23 * MINUTE + 1_000;
  assert.throws(() => parseKrakenOhlc(acquisition(data, staleAt), staleAt), /STALE_OHLC/);
  const gap = structuredClone(data);
  gap.result.XXBTZEUR[8][0] += 60;
  assert.throws(() => parseKrakenOhlc(acquisition(gap, INITIAL_NOW), INITIAL_NOW), /OHLC_GAP/);
  const outOfOrder = structuredClone(data);
  outOfOrder.result.XXBTZEUR[4][0] = outOfOrder.result.XXBTZEUR[3][0];
  assert.throws(() => parseKrakenOhlc(acquisition(outOfOrder, INITIAL_NOW), INITIAL_NOW),
    /OHLC_OUT_OF_ORDER/);
  const otherPair = structuredClone(data);
  otherPair.result = { XXBTZUSD: otherPair.result.XXBTZEUR, last: otherPair.result.last };
  assert.throws(() => parseKrakenOhlc(acquisition(otherPair, INITIAL_NOW), INITIAL_NOW),
    /UNEXPECTED_OHLC_PAIR/);
  const missing = { error: [], result: { XXBTZEUR: [], last: 0 } };
  assert.throws(() => parseKrakenOhlc(acquisition(missing, INITIAL_NOW), INITIAL_NOW),
    /INSUFFICIENT_OHLC_ROWS/);
  const future = structuredClone(data);
  future.result.XXBTZEUR.at(-1)[0] += 60;
  future.result.last = future.result.XXBTZEUR.at(-1)[0];
  assert.throws(() => parseKrakenOhlc(acquisition(future, INITIAL_NOW), INITIAL_NOW),
    /INVALID_OHLC_TIMESTAMP/);
});

test("ticker validates bid/ask identity, crossing and acquisition age without inventing event time", () => {
  const data = tickerData();
  const parsed = parseKrakenTicker(acquisition(data, INITIAL_NOW, INITIAL_NOW - 500), INITIAL_NOW);
  assert.equal(parsed.ageMs, 0);
  assert.equal(parsed.requestStartedAt, INITIAL_NOW - 500);
  assert.equal(parsed.spreadBps, 1);
  assert.equal("exchangeTimestamp" in parsed, false);
  assert.throws(() => parseKrakenTicker(
    acquisition(tickerData({ bid: "30001.00000000", ask: "30000.00000000" }), INITIAL_NOW),
    INITIAL_NOW), /INVALID_TICKER_BOOK/);
  assert.throws(() => parseKrakenTicker(acquisition(data, INITIAL_NOW - 10_001), INITIAL_NOW),
    /STALE_TICKER/);
  const bad = structuredClone(data);
  bad.error = ["EGeneral:Unknown asset pair"];
  assert.throws(() => parseKrakenTicker(acquisition(bad, INITIAL_NOW), INITIAL_NOW),
    /TICKER_API_ERROR/);
});

test("warmup fixes the cutoff, produces no retroactive signal, and deduplicates closed bars", () => {
  const historicalCross = [PRICE_120, ...Array(20).fill(PRICE_100)];
  const first = advanceStrategy(createStrategyState(),
    parseKrakenOhlc(acquisition(ohlcData(historicalCross), INITIAL_NOW), INITIAL_NOW).candles);
  assert.equal(first.state.warmupComplete, true);
  assert.equal(first.state.cutoffAt, BASE + 20 * MINUTE);
  assert.deepEqual(first.signals, []);
  const duplicate = advanceStrategy(first.state,
    parseKrakenOhlc(acquisition(ohlcData(historicalCross), INITIAL_NOW), INITIAL_NOW).candles);
  assert.equal(duplicate.newCandleCount, 0);
  assert.deepEqual(duplicate.signals, []);

  const conflicting = ohlcData(historicalCross);
  conflicting.result.XXBTZEUR[20] = priceRow((BASE + 20 * MINUTE) / 1000, PRICE_120);
  assert.throws(() => advanceStrategy(first.state,
    parseKrakenOhlc(acquisition(conflicting, INITIAL_NOW), INITIAL_NOW).candles),
  /CONFLICTING_CLOSED_CANDLE/);

  const flatWarmup = advanceStrategy(createStrategyState(),
    parseKrakenOhlc(acquisition(ohlcData(Array(21).fill(PRICE_100)), INITIAL_NOW),
      INITIAL_NOW).candles);
  const nextAt = BASE + 21 * MINUTE;
  const newBar = [...Array(21).fill(PRICE_100), PRICE_120];
  const next = advanceStrategy(flatWarmup.state,
    parseKrakenOhlc(acquisition(ohlcData(newBar), BASE + 22 * MINUTE + 1_000),
      BASE + 22 * MINUTE + 1_000).candles);
  assert.equal(next.signals[0]?.direction, "ENTRY");
  assert.equal(next.signals[0]?.candleAt, nextAt);
});

test("integer EUR/BTC paper ledger reconciles costs and exits even when the entry spread filter would reject", () => {
  const quote = parseKrakenTicker(acquisition(tickerData(), INITIAL_NOW), INITIAL_NOW);
  const entry = applyPaperObservation(createLedger(), {
    signal: { id: "ENTRY:1", direction: "ENTRY", candleAt: 1 },
    quote, nowMs: INITIAL_NOW
  });
  assert.equal(entry.fills.length, 1);
  assert.ok(Number.isInteger(entry.fills[0].quantitySat));
  assert.ok(entry.ledger.cashCents >= 0);
  assert.ok(entry.ledger.position.entryGrossCents + entry.ledger.position.entryFeeCents <=
    SPOT_PAPER_PILOT_LIMITS.maxExposureCents);
  assert.equal(100_000 - entry.ledger.cashCents,
    entry.ledger.position.entryGrossCents + entry.ledger.position.entryFeeCents);

  const wideSpread = parseKrakenTicker(acquisition(
    tickerData({ bid: "29999.00000000", ask: "36000.00000000" }), INITIAL_NOW),
  INITIAL_NOW);
  const exit = applyPaperObservation(entry.ledger, {
    signal: { id: "EXIT:2", direction: "EXIT", candleAt: 2 },
    quote: wideSpread, nowMs: INITIAL_NOW + 1_000
  });
  assert.equal(exit.fills[0].reason, "SMA20_DOWN_CROSS");
  assert.equal(exit.ledger.position, null);
  assert.equal(exit.ledger.cashCents - exit.ledger.realizedPnlCents, 100_000);
  assert.equal(exit.ledger.feesCents,
    entry.ledger.feesCents + exit.fills[0].feeCents);

  const noEntry = applyPaperObservation(createLedger(), {
    signal: { id: "ENTRY:3", direction: "ENTRY", candleAt: 3 },
    quote: { ...quote, spreadBps: 51 }, nowMs: INITIAL_NOW
  });
  assert.deepEqual(noEntry.fills, []);
});

test("sampled stop exits at modeled bid less slippage and leaves no claimed live execution", () => {
  const initialQuote = parseKrakenTicker(acquisition(tickerData(), INITIAL_NOW), INITIAL_NOW);
  const entry = applyPaperObservation(createLedger(), {
    signal: { id: "ENTRY:stop", direction: "ENTRY", candleAt: 1 },
    quote: initialQuote, nowMs: INITIAL_NOW
  });
  const stopQuote = parseKrakenTicker(acquisition(
    tickerData({ bid: "29000.00000000", ask: "29001.00000000" }), INITIAL_NOW + 1_000),
  INITIAL_NOW + 1_000);
  const stopped = applyPaperObservation(entry.ledger, {
    quote: stopQuote, nowMs: INITIAL_NOW + 1_000
  });
  assert.equal(stopped.stopReason, "SAMPLED_2PCT_BID_STOP");
  assert.equal(stopped.ledger.position, null);
  assert.equal(stopped.fills[0].priceNano,
    String((BigInt(stopQuote.bidNano) * 9_990n + 5_000n) / 10_000n));
});

test("runner integrates injected data, SMA, paper ledger, raw-response journal and read-only report", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW, monotonic: 0 };
  const candles = [Array(21).fill(PRICE_100), [...Array(21).fill(PRICE_100), PRICE_120]];
  const provider = providerFor(clock, candles.map(ohlcData), [tickerData(), tickerData()]);
  const config = runnerConfig({ dataRoot, runId: "e2e-paper", provider, cycles: 2 });
  config.now = () => clock.value;
  config.sleep = async ms => { clock.value += ms; clock.monotonic += ms; };
  const report = await runSpotPaperPilot(config);
  assert.equal(report.mode, "paper");
  assert.equal(report.stopReason, "CYCLE_LIMIT", JSON.stringify(report));
  assert.equal(report.profitability, "NOT_ASSESSED");
  assert.equal(report.executionImpact, false);
  assert.equal(report.fills.length, 1);
  assert.equal(report.positionStatus, "OPEN_UNRESOLVED_AT_TERMINAL");
  assert.ok(report.lastMark.ageMs >= 0);
  const journal = await readRunJournal({ dataRoot, runId: "e2e-paper" });
  const observations = journal.events.filter(event => event.type === "observation");
  assert.equal(observations.length, 2);
  for (const response of [observations[0].ohlc, observations[0].ticker]) {
    const raw = await readFile(join(dataRoot, "e2e-paper", response.path));
    assert.equal(sha256(raw), response.sha256);
    assert.equal(raw.length, response.bytes);
    assert.ok(response.receivedAt >= response.requestStartedAt);
  }
  assert.equal(journal.checkpoint.ledger.cashCents, report.cashCents);
  assert.equal(journal.events.at(-1).report.stopReason, "CYCLE_LIMIT");
  assert.notEqual(report.fills[0].priceNano, report.signals[0].closeNano);
  await assert.rejects(runSpotPaperPilot(config), /EEXIST/);

  const readOnly = JSON.parse(execFileSync(process.execPath, [CLI_PATH,
    "--mode", "report", "--data-root", dataRoot, "--run-id", "e2e-paper"], {
    encoding: "utf8"
  }));
  assert.equal(readOnly.reconciliation, "TERMINAL_REPORT_AVAILABLE");
  assert.equal(readOnly.resumed, false);
  assert.equal(readOnly.report.stopReason, "CYCLE_LIMIT");
});

test("runner reports a valid zero-entry observe run without promoting warmup bars", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW };
  const provider = providerFor(clock,
    [ohlcData([PRICE_120, ...Array(20).fill(PRICE_100)])], [tickerData()]);
  const config = runnerConfig({
    dataRoot, runId: "observe-zero-entry", provider, mode: "observe", cycles: 1
  });
  config.now = () => clock.value;
  const report = await runSpotPaperPilot(config);
  assert.equal(report.stopReason, "CYCLE_LIMIT");
  assert.equal(report.observations, 1);
  assert.deepEqual(report.signals, []);
  assert.deepEqual(report.fills, []);
  assert.equal(report.cashCents, SPOT_PAPER_PILOT_LIMITS.initialCashCents);
  assert.equal(report.profitability, "NOT_ASSESSED");
});

test("429 creates a gap and waits for the bounded next poll instead of retrying immediately", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW };
  const starts = [];
  const provider = {
    async fetchOhlc() {
      starts.push(clock.value);
      if (starts.length === 1) {
        throw new Error("HTTP_429");
      }
      return acquisition(ohlcData(Array(21).fill(PRICE_100)), clock.value);
    },
    async fetchTicker() {
      return acquisition(tickerData(), clock.value);
    }
  };
  const config = runnerConfig({ dataRoot, runId: "rate-limited", provider, cycles: 2 });
  config.now = () => clock.value;
  config.sleep = async ms => { clock.value += ms; clock.monotonic += ms; };
  const report = await runSpotPaperPilot(config);
  assert.equal(report.dataGaps, 1);
  assert.equal(report.requests, 3, JSON.stringify(report));
  assert.equal(starts[1] - starts[0], 60_000);
});

test("stale quote after a new-bar signal cannot create a fill", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW };
  let ohlcCalls = 0;
  let tickerCalls = 0;
  const provider = {
    async fetchOhlc() {
      const closes = ohlcCalls++ === 0 ? Array(21).fill(PRICE_100) :
        [...Array(21).fill(PRICE_100), PRICE_120];
      return acquisition(ohlcData(closes), clock.value);
    },
    async fetchTicker() {
      tickerCalls++;
      return tickerCalls === 1 ?
        acquisition(tickerData(), clock.value) :
        acquisition(tickerData(), clock.value - 10_001, clock.value - 10_021);
    }
  };
  const config = runnerConfig({ dataRoot, runId: "stale-quote", provider, cycles: 2 });
  config.now = () => clock.value;
  config.sleep = async ms => { clock.value += ms; clock.monotonic += ms; };
  const report = await runSpotPaperPilot(config);
  assert.equal(report.stopReason, "INVALID_DATA");
  assert.equal(report.fills.length, 0);
  assert.equal(report.cashCents, SPOT_PAPER_PILOT_LIMITS.initialCashCents);
  assert.equal(report.dataGaps, 1);
});

test("runner bounds an injected provider that ignores abort and discards its late response", async t => {
  const dataRoot = await temporaryRoot(t);
  let resolveOhlc;
  let observedSignal;
  let tickerCalls = 0;
  const provider = {
    fetchOhlc({ signal }) {
      observedSignal = signal;
      signal.addEventListener("abort", () => {}, { once: true });
      return new Promise(resolve => { resolveOhlc = resolve; });
    },
    fetchTicker() {
      tickerCalls++;
      assert.fail("ticker must not start after timed out OHLC");
    }
  };
  const config = runnerConfig({
    dataRoot, runId: "late-provider-response", provider,
    cycles: 1, durationMs: 500, requestTimeoutMs: 30
  });
  const report = await runSpotPaperPilot(config);
  assert.equal(observedSignal.aborted, true);
  assert.equal(tickerCalls, 0);
  assert.equal(report.fills.length, 0);
  assert.equal(report.cashCents, SPOT_PAPER_PILOT_LIMITS.initialCashCents);
  assert.equal(report.dataGaps, 1);
  resolveOhlc(acquisition(ohlcData(Array(21).fill(PRICE_100)), INITIAL_NOW));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(report.fills.length, 0);
});

test("CLI refuses observe and paper modes without explicit network opt-in", async t => {
  const dataRoot = await temporaryRoot(t);
  await assert.rejects(pilotCli([
    "--mode", "paper", "--data-root", dataRoot, "--run-id", "no-network",
    "--max-cycles", "1", "--max-duration-ms", "60000"
  ]), /Network access is disabled/);
});

test("abort cancels an outstanding provider request and writes a terminal report", async t => {
  const dataRoot = await temporaryRoot(t);
  const controller = new AbortController();
  let requests = 0;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const provider = {
    fetchOhlc() {
      requests++;
      markStarted();
      return new Promise((_, reject) => controller.signal.addEventListener("abort",
        () => reject(new Error("ABORTED")), { once: true }));
    },
    fetchTicker() { assert.fail("ticker must not start after cancelled OHLC"); }
  };
  const config = runnerConfig({
    dataRoot, runId: "cancelled", provider, cycles: 2, signal: controller.signal
  });
  const running = runSpotPaperPilot(config);
  await started;
  controller.abort();
  const report = await running;
  assert.equal(requests, 1);
  assert.equal(report.stopReason, "SIGNAL");
  const journal = await readRunJournal({ dataRoot, runId: "cancelled" });
  assert.equal(journal.events.at(-1).type, "terminal");
});

test("journal event IDs deduplicate identical records, reject conflicts, and detect partial corruption", async t => {
  const dataRoot = await temporaryRoot(t);
  const journal = await createRunJournal({
    dataRoot, runId: "dedupe", manifest: { startedAt: INITIAL_NOW }
  });
  const event = { id: "event-1", type: "observation", value: 1 };
  assert.equal((await journal.append(event, {})).duplicate, false);
  assert.equal((await journal.append(event, {})).duplicate, true);
  await assert.rejects(journal.append({ ...event, value: 2 }, {}), /CONFLICTING_EVENT_ID/);
  await journal.close();
  const loaded = await readRunJournal({ dataRoot, runId: "dedupe" });
  assert.equal(loaded.events.length, 1);
  const path = join(dataRoot, "dedupe", "journal.json");
  const contents = await readFile(path, "utf8");
  await (await import("node:fs/promises")).writeFile(path, contents.slice(0, -1));
  await assert.rejects(readRunJournal({ dataRoot, runId: "dedupe" }),
    /JOURNAL_CHECKSUM_MISMATCH|INVALID_JOURNAL_JSON/);
});

test("journal readback ACK loss fences writes and read-only reconciliation reports UNKNOWN", async t => {
  const dataRoot = await temporaryRoot(t);
  const journal = await createRunJournal({
    dataRoot, runId: "ack-lost", manifest: { startedAt: INITIAL_NOW },
    phase: async (name, marker) => {
      if (name === "after-readback" && marker.nextSequence === 1) {
        throw new Error("ack channel failed");
      }
    }
  });
  await assert.rejects(journal.append({ id: "commit-1", type: "observation" }, {}),
    /JOURNAL_UNKNOWN/);
  assert.equal(journal.poisoned, true);
  await assert.rejects(journal.append({ id: "commit-2", type: "observation" }, {}),
    /JOURNAL_UNKNOWN/);
  const reconciled = await readRunJournal({ dataRoot, runId: "ack-lost" });
  assert.equal(reconciled.sequence, 1);
  assert.equal(reconciled.events.length, 1);
  assert.equal(reconciled.reconciliationStatus,
    "UNKNOWN_CANDIDATE_VISIBLE_ACK_UNCONFIRMED");
});

test("runner reports ambiguous signal-ledger persistence as UNKNOWN without another effect", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW, monotonic: 0 };
  let ohlcCalls = 0;
  let tickerCalls = 0;
  const closes = [Array(21).fill(PRICE_100),
    [...Array(21).fill(PRICE_100), PRICE_120]];
  const committedSequences = [];
  const provider = {
    async fetchOhlc() {
      return acquisition(ohlcData(closes[Math.min(ohlcCalls++, 1)]), clock.value);
    },
    async fetchTicker() {
      tickerCalls++;
      return acquisition(tickerData(), clock.value);
    }
  };
  const config = runnerConfig({
    dataRoot, runId: "unknown-fill-commit", provider, cycles: 2,
    durationMs: 120_000, requestTimeoutMs: 30,
    clock,
    journalOptions: {
      phase: async (name, marker) => {
        if (name === "after-readback") committedSequences.push(marker.nextSequence);
        if (name === "after-readback" && marker.nextSequence === 3) {
          throw new Error("simulated acknowledgement loss");
        }
      }
    }
  });
  config.sleep = async ms => { clock.value += ms; clock.monotonic += ms; };
  await assert.rejects(runSpotPaperPilot(config), /JOURNAL_UNKNOWN/);
  assert.deepEqual(committedSequences, [0, 1, 2, 3]);
  assert.equal(ohlcCalls, 2);
  assert.equal(tickerCalls, 2);
  const reconciled = await readRunJournal({ dataRoot, runId: "unknown-fill-commit" });
  assert.equal(reconciled.events.filter(event => event.type === "terminal").length, 0);
  assert.equal(reconciled.events.at(-1).fills.length, 1);
  assert.equal(reconciled.reconciliationStatus,
    "UNKNOWN_CANDIDATE_VISIBLE_ACK_UNCONFIRMED");
});

test("journal rejects concurrent append and fences the late ambiguous commit", async t => {
  const dataRoot = await temporaryRoot(t);
  let entered;
  const enteredPhase = new Promise(resolve => { entered = resolve; });
  const monotonicNow = () => performance.now();
  const journal = await createRunJournal({
    dataRoot, runId: "concurrent-append", manifest: { startedAt: INITIAL_NOW },
    phase: async (name, marker) => {
      if (name === "after-file-sync" && marker.nextSequence === 1) {
        entered();
        return new Promise(() => {});
      }
    }
  });
  const deadlineAt = monotonicNow() + 2_000;
  const first = journal.append({ id: "first", type: "observation" }, {},
    { deadlineAt, monotonicNow });
  const didEnterPhase = await Promise.race([
    enteredPhase.then(() => true),
    first.then(() => false, () => false)
  ]);
  assert.equal(didEnterPhase, true);
  await assert.rejects(journal.append({ id: "second", type: "observation" }, {}),
    /JOURNAL_BUSY/);
  await assert.rejects(first, /JOURNAL_UNKNOWN/);
  assert.equal(journal.poisoned, true);
  await assert.rejects(journal.append({ id: "third", type: "observation" }, {}),
    /JOURNAL_UNKNOWN/);
  const reconciled = await readRunJournal({ dataRoot, runId: "concurrent-append" });
  assert.equal(reconciled.reconciliationStatus, "UNKNOWN_CANDIDATE_NOT_VISIBLE");
});

test("journal bounds initialization, response persistence and close; unresolved writes remain read-only", async t => {
  const dataRoot = await temporaryRoot(t);
  const monotonicNow = () => performance.now();
  await assert.rejects(createRunJournal({
    dataRoot, runId: "hung-init", manifest: { startedAt: INITIAL_NOW },
    deadlineAt: monotonicNow() + 1_000, monotonicNow,
    phase: async name => {
      if (name === "before-pending") return new Promise(() => {});
    }
  }), /JOURNAL_UNKNOWN/);
  assert.equal((await readRunJournal({ dataRoot, runId: "hung-init" }))
    .reconciliationStatus, "UNKNOWN_WRITER_OR_INTERRUPTED");

  const response = acquisition(tickerData(), INITIAL_NOW);
  const responseJournal = await createRunJournal({
    dataRoot, runId: "hung-response", manifest: { startedAt: INITIAL_NOW },
    phase: async name => {
      if (name === "response-after-sync") return new Promise(() => {});
    }
  });
  await assert.rejects(responseJournal.persistResponse(response, {
    deadlineAt: monotonicNow() + 40, monotonicNow
  }), /JOURNAL_UNKNOWN/);
  await assert.rejects(responseJournal.append({ id: "must-not-commit" }, {}),
    /JOURNAL_UNKNOWN/);
  assert.equal((await readRunJournal({ dataRoot, runId: "hung-response" }))
    .reconciliationStatus, "UNKNOWN_WRITER_OR_INTERRUPTED");

  const closeJournal = await createRunJournal({
    dataRoot, runId: "hung-close", manifest: { startedAt: INITIAL_NOW },
    phase: async name => {
      if (name === "close-before-unlock") return new Promise(() => {});
    }
  });
  await assert.rejects(closeJournal.close({
    deadlineAt: monotonicNow() + 40, monotonicNow
  }), /JOURNAL_UNKNOWN/);
  assert.equal(closeJournal.poisoned, true);
  assert.equal((await readRunJournal({ dataRoot, runId: "hung-close" }))
    .reconciliationStatus, "UNKNOWN_WRITER_OR_INTERRUPTED");
});

test("terminal report write is bounded by the separate stop grace and remains UNKNOWN if late", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW };
  const provider = providerFor(clock,
    [ohlcData(Array(21).fill(PRICE_100))], [tickerData()]);
  const config = runnerConfig({
    dataRoot, runId: "hung-terminal", provider, mode: "observe",
    cycles: 1, durationMs: 500, requestTimeoutMs: 30, terminalReportGraceMs: 40,
    journalOptions: {
      phase: async (name, marker) => {
        if (name === "after-readback" && marker.nextSequence === 3) {
          return new Promise(() => {});
        }
      }
    }
  });
  config.now = () => clock.value;
  await assert.rejects(runSpotPaperPilot(config), /JOURNAL_UNKNOWN/);
  const reconciled = await readRunJournal({ dataRoot, runId: "hung-terminal" });
  assert.equal(reconciled.events.at(-1).type, "terminal");
  assert.equal(reconciled.reconciliationStatus,
    "UNKNOWN_CANDIDATE_VISIBLE_ACK_UNCONFIRMED");
});
