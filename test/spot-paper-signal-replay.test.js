import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED_SIGNAL_REPLAY_IDENTITY, replaySpotPaperSignals
} from "../scripts/spot-paper-pilot/signal-replay.mjs";
import {
  advanceStrategy, createStrategyState, sha256
} from "../scripts/spot-paper-pilot/core.mjs";

const BASE = Date.UTC(2025, 0, 1);
const MINUTE = 60_000;
const PRICE_100 = "100.00000000";
const PRICE_120 = "120.00000000";

function priceRow(timestamp, price) {
  return [timestamp / 1000, price, price, price, price, price, "1.00000000", 1];
}

function marketResponse(data, startedAt, receivedAt) {
  const raw = JSON.stringify(data);
  const digest = sha256(Buffer.from(raw, "utf8"));
  return {
    raw,
    reference: {
      path: `responses/${digest}.json`, sha256: digest,
      bytes: Buffer.byteLength(raw), requestStartedAt: startedAt, receivedAt
    }
  };
}

function ohlc(closes, startAt = BASE) {
  const rows = closes.map((close, index) =>
    priceRow(startAt + index * MINUTE, close));
  rows.push(priceRow(startAt + closes.length * MINUTE, closes.at(-1)));
  return { error: [], result: { XXBTZEUR: rows, last: rows.at(-1)[0] } };
}

function ticker() {
  return {
    error: [],
    result: { XXBTZEUR: {
      a: ["100.01000000", "1", "1.00000000"],
      b: ["100.00000000", "1", "1.00000000"]
    } }
  };
}

function identity() {
  return {
    schemaVersion: "SPOT_PAPER_PILOT_DISPATCH_MANIFEST_V1",
    ...EXPECTED_SIGNAL_REPLAY_IDENTITY,
    mode: "paper",
    pair: "BTC/EUR"
  };
}

function fixture() {
  const responseBodies = {};
  const events = [{ id: "run-start", type: "start" }];
  let state = createStrategyState();
  let cycle = 0;
  const addEvent = ({
    closes, startAt = BASE, type = "observation", dataGap = null,
    provisional = false, claimedSignals, fills = [], tickerRef = true
  }) => {
    cycle++;
    const ohlcAt = startAt + (closes.length + 1) * MINUTE;
    const ohlcResponse = marketResponse(ohlc(closes, startAt), ohlcAt - 100, ohlcAt);
    responseBodies[ohlcResponse.reference.sha256] = ohlcResponse.raw;
    const storedOhlc = {
      ...ohlcResponse.reference,
      latestClosedAt: startAt + (closes.length - 1) * MINUTE,
      ageMs: MINUTE
    };
    let advanced;
    try {
      advanced = advanceStrategy(state, parseCandles(closes, startAt));
    } catch {
      advanced = { state, signals: [] };
    }
    const signalKnownAt = ohlcAt + 10;
    const signals = claimedSignals ?? advanced.signals.map(signal => ({
      ...signal, signalKnownAt
    }));
    let storedTicker;
    if (tickerRef) {
      const tickerAt = signalKnownAt + 20;
      const tickerResponse = marketResponse(ticker(), signalKnownAt + 1, tickerAt);
      responseBodies[tickerResponse.reference.sha256] = tickerResponse.raw;
      storedTicker = {
        ...tickerResponse.reference,
        acquisitionAgeMs: 0
      };
    }
    const event = {
      id: `cycle:${cycle}`, type, dataGap, cycle, signalKnownAt,
      signals, fills
    };
    if (type === "data_gap" && dataGap !== "MISSED_DECISION_WINDOW") {
      event.acceptedOhlc = storedOhlc;
      if (storedTicker) event.acceptedTicker = storedTicker;
    } else {
      event.ohlc = storedOhlc;
      if (storedTicker) event.ticker = storedTicker;
    }
    events.push(event);
    if (!provisional) state = advanced.state;
    return { event, state, advanced, responseBodies };
  };
  return {
    responseBodies,
    addEvent,
    readback: () => {
      events.push({ id: "run-terminal", type: "terminal" });
      return {
        reconciliation: "TERMINAL_REPORT_AVAILABLE",
        runId: EXPECTED_SIGNAL_REPLAY_IDENTITY.runId,
        eventCount: events.length, resumed: false, executionImpact: false,
        manifest: { model: EXPECTED_SIGNAL_REPLAY_IDENTITY.model,
          mode: "paper", pair: "BTC/EUR" },
        checkpoint: { cycle, strategy: state },
        events
      };
    },
    get state() { return state; }
  };
}

function parseCandles(closes, startAt) {
  return closes.map((close, index) => {
    const closeNano = String(BigInt(close.replace(".", "")));
    return {
      timestamp: startAt + index * MINUTE,
      openNano: closeNano, highNano: closeNano, lowNano: closeNano, closeNano
    };
  });
}

function run(fixtureData, provenance = identity(), bodies = fixtureData.responseBodies) {
  return replaySpotPaperSignals({
    readback: fixtureData.readback(), provenance, responseBodies: bodies
  });
}

test("replays and confirms a real SMA5/SMA20 upward crossover", () => {
  const data = fixture();
  data.addEvent({ closes: Array(21).fill(PRICE_100) });
  const crossing = data.addEvent({
    closes: [...Array(21).fill(PRICE_100), PRICE_120]
  });
  const result = run(data);
  assert.equal(result.outcome, "PASS", JSON.stringify(result));
  assert.equal(result.signalReplay, "PASS");
  assert.equal(result.replayedSignals, 1);
  assert.deepEqual(crossing.event.signals.map(signal => [
    signal.id, signal.direction, signal.candleAt, signal.closeNano
  ]), [[`ENTRY:${BASE + 21 * MINUTE}`, "ENTRY",
    BASE + 21 * MINUTE, "12000000000"]]);
});

test("rejects a fabricated ENTRY on the flat 21-candle startup cutoff", () => {
  const data = fixture();
  const closes = Array(21).fill(PRICE_100);
  const event = data.addEvent({
    closes,
    claimedSignals: [{
      id: `ENTRY:${BASE + 20 * MINUTE}`, direction: "ENTRY",
      candleAt: BASE + 20 * MINUTE, closeNano: "10000000000",
      signalKnownAt: BASE + 22 * MINUTE + 10
    }]
  });
  const result = run(data);
  assert.equal(event.event.signals.length, 1);
  assert.equal(result.outcome, "FAILED");
  assert.ok(result.discrepancies.includes("SIGNAL_CLAIM_MISMATCH"));
});

test("reports conflicting closed candles and skipped decision bars", () => {
  const conflict = fixture();
  conflict.addEvent({ closes: Array(21).fill(PRICE_100) });
  const changed = [...Array(21).fill(PRICE_100), PRICE_120];
  const changedEvent = conflict.addEvent({ closes: changed });
  const rawRef = changedEvent.event.ohlc;
  const changedRaw = JSON.parse(conflict.responseBodies[rawRef.sha256]);
  changedRaw.result.XXBTZEUR[20] = priceRow(BASE + 20 * MINUTE, "101.00000000");
  const altered = marketResponse(changedRaw, rawRef.requestStartedAt, rawRef.receivedAt);
  conflict.responseBodies[altered.reference.sha256] = altered.raw;
  changedEvent.event.ohlc = {
    ...rawRef, ...altered.reference,
    latestClosedAt: rawRef.latestClosedAt, ageMs: rawRef.ageMs
  };
  const conflictResult = run(conflict);
  assert.equal(conflictResult.outcome, "FAILED");
  assert.ok(conflictResult.discrepancies.includes("CONFLICTING_CLOSED_CANDLE"));

  const gap = fixture();
  gap.addEvent({ closes: Array(21).fill(PRICE_100) });
  gap.addEvent({ closes: [PRICE_100], startAt: BASE + 22 * MINUTE });
  const gapResult = run(gap);
  assert.equal(gapResult.outcome, "FAILED");
  assert.ok(gapResult.discrepancies.includes("CLOSED_CANDLE_GAP"));
});

test("keeps a failed-ticker signal provisional until the next accepted observation", () => {
  const data = fixture();
  data.addEvent({ closes: Array(21).fill(PRICE_100) });
  const signalCloses = [...Array(21).fill(PRICE_100), PRICE_120];
  const failed = data.addEvent({
    closes: signalCloses, type: "data_gap", dataGap: null,
    provisional: true, tickerRef: false
  });
  const accepted = data.addEvent({ closes: signalCloses });
  assert.equal(failed.event.signals[0].id, accepted.event.signals[0].id);
  assert.equal(data.state.lastSeenAt, BASE + 21 * MINUTE);
  const result = run(data);
  assert.equal(result.outcome, "PASS", JSON.stringify(result));
  assert.equal(result.replayedSignals, 2);
});

test("passes valid zero-entry evidence and keeps sampled stops separate", () => {
  const empty = fixture();
  empty.addEvent({ closes: Array(21).fill(PRICE_100) });
  const emptyResult = run(empty);
  assert.equal(emptyResult.outcome, "PASS");
  assert.equal(emptyResult.replayedSignals, 0);

  const stopped = fixture();
  const baseline = stopped.addEvent({ closes: Array(21).fill(PRICE_100) });
  const tickerRef = baseline.event.ticker;
  baseline.event.fills = [{
    id: "exit:sampled-stop", side: "SELL", reason: "SAMPLED_2PCT_BID_STOP",
    signalAt: tickerRef.receivedAt, quoteReceivedAt: tickerRef.receivedAt
  }];
  const stopResult = run(stopped);
  assert.equal(stopResult.outcome, "PASS", JSON.stringify(stopResult));
  assert.equal(stopResult.replayedSignals, 0);
  assert.equal(stopResult.sampledStopCount, 1);
});

test("distinguishes missing raw, identity, and timestamp evidence", () => {
  const missing = fixture();
  const missingEvent = missing.addEvent({ closes: Array(21).fill(PRICE_100) }).event;
  const missingHash = missingEvent.ohlc.sha256;
  const missingBodies = { ...missing.responseBodies };
  delete missingBodies[missingHash];
  assert.equal(run(missing, identity(), missingBodies).outcome, "UNKNOWN");

  const wrongIdentity = fixture();
  wrongIdentity.addEvent({ closes: Array(21).fill(PRICE_100) });
  assert.equal(run(wrongIdentity, {
    ...identity(), workflowRunId: "42395522898"
  }).outcome, "FAILED");

  const wrongTimestamp = fixture();
  const event = wrongTimestamp.addEvent({ closes: Array(21).fill(PRICE_100) }).event;
  event.ohlc.latestClosedAt += MINUTE;
  assert.equal(run(wrongTimestamp).outcome, "FAILED");
});

test("rejects stale and pre-signal fill quotes", () => {
  const data = fixture();
  data.addEvent({ closes: Array(21).fill(PRICE_100) });
  const event = data.addEvent({
    closes: [...Array(21).fill(PRICE_100), PRICE_120]
  }).event;
  event.fills = [{
    id: `entry:${event.signals[0].id}`, side: "BUY",
    signalAt: event.signals[0].candleAt,
    quoteReceivedAt: event.ticker.receivedAt
  }];
  event.ticker.requestStartedAt = event.signalKnownAt - 1;
  const result = run(data);
  assert.equal(result.outcome, "FAILED");
  assert.ok(result.discrepancies.includes("PRE_SIGNAL_FILL_QUOTE"));
});
