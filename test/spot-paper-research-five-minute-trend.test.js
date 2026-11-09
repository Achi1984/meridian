import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateClosedFiveMinuteCandles, advanceFiveMinuteTrendEntry,
  createFiveMinuteTrendState, evaluateFiveMinuteTrend,
  recordFiveMinuteTrendSell, SPOT_PAPER_5M_TREND_FILTER_ID
} from "../scripts/spot-paper-research/five-minute-trend.mjs";
import {
  advanceEntryConfirmation, createEntryConfirmationState,
  recordEntryConfirmationSell
} from "../scripts/spot-paper-research/entry-confirmation.mjs";
import {
  applyPaperObservation, createLedger
} from "../scripts/spot-paper-pilot/core.mjs";

const BASE = Date.UTC(2025, 0, 1);
const MINUTE = 60_000;
const price = value => String(BigInt(value) * 100_000_000n);

function oneMinuteCandles(values, offset = 0) {
  return values.map((value, index) => ({
    timestamp: BASE + (offset + index) * MINUTE,
    closeNano: price(value)
  }));
}

function expandFiveMinuteCloses(values) {
  return values.flatMap(value => Array(5).fill(value));
}

function quote(nowMs) {
  return {
    askNano: price(100),
    bidNano: "9990000000",
    spreadBps: 10,
    receivedAt: nowMs
  };
}

test("UTC aggregation emits only complete aligned bars from five contiguous closed minutes", () => {
  const candles = oneMinuteCandles(
    Array.from({ length: 9 }, (_, index) => 100 + index), 2);
  const bars = aggregateClosedFiveMinuteCandles(candles, {
    decisionAt: BASE + 11 * MINUTE
  });
  assert.deepEqual(bars, [{
    timestamp: BASE + 5 * MINUTE,
    closedAt: BASE + 10 * MINUTE,
    closeNano: price(107)
  }]);

  const currentMinute = oneMinuteCandles([999], 11);
  assert.deepEqual(aggregateClosedFiveMinuteCandles(
    [...candles, ...currentMinute], { decisionAt: BASE + 11 * MINUTE }), bars);
});

test("aggregation rejects duplicate, out-of-order, and missing one-minute bars", () => {
  const valid = oneMinuteCandles([100, 101, 102]);
  assert.throws(() => aggregateClosedFiveMinuteCandles(
    [valid[0], valid[1], valid[1]], { decisionAt: BASE + 10 * MINUTE }),
  /DUPLICATE_ONE_MINUTE_CANDLE/);
  assert.throws(() => aggregateClosedFiveMinuteCandles(
    [valid[0], valid[2], valid[1]], { decisionAt: BASE + 10 * MINUTE }),
  /OUT_OF_ORDER_ONE_MINUTE_CANDLES/);
  assert.throws(() => aggregateClosedFiveMinuteCandles(
    [valid[0], valid[2]], { decisionAt: BASE + 10 * MINUTE }),
  /GAP_IN_ONE_MINUTE_CANDLES/);
});

test("only fully closed 5-minute bars as of decisionAt are selected", () => {
  const closes = [...Array(20).fill(100), 120];
  const candles = oneMinuteCandles(expandFiveMinuteCloses(closes));
  const trend = evaluateFiveMinuteTrend(candles, {
    decisionAt: BASE + 104 * MINUTE
  });
  assert.equal(trend.status, "FIVE_MINUTE_SMA20_WARMUP_INSUFFICIENT");
  assert.equal(trend.availableBars, 20);
  assert.equal(trend.latestClosedAt, BASE + 100 * MINUTE);
});

test("trend requires 21 closed 5-minute bars and the frozen SMA20 condition", () => {
  const warmup = oneMinuteCandles(expandFiveMinuteCloses(Array(20).fill(100)));
  assert.equal(evaluateFiveMinuteTrend(warmup, {
    decisionAt: BASE + 100 * MINUTE
  }).status, "FIVE_MINUTE_SMA20_WARMUP_INSUFFICIENT");

  const flat = oneMinuteCandles(expandFiveMinuteCloses(Array(21).fill(100)));
  assert.equal(evaluateFiveMinuteTrend(flat, {
    decisionAt: BASE + 105 * MINUTE
  }).status, "FIVE_MINUTE_SMA20_TREND_NOT_CONFIRMED");

  const rising = oneMinuteCandles(expandFiveMinuteCloses([
    ...Array(20).fill(100), 120
  ]));
  const result = evaluateFiveMinuteTrend(rising, {
    decisionAt: BASE + 105 * MINUTE
  });
  assert.equal(result.status, "FIVE_MINUTE_SMA20_TREND_CONFIRMED");
  assert.equal(result.eligible, true);
  assert.equal(result.latestClosedAt, BASE + 105 * MINUTE);
});

async function attemptEntry(trendRising) {
  const values = trendRising ?
    [...Array(104).fill(100), 120, 130] :
    [...Array(105).fill(100), 120, 130];
  const candles = oneMinuteCandles(values);
  let state = advanceFiveMinuteTrendEntry(
    createFiveMinuteTrendState(), candles.slice(0, 21), {
      decisionAt: BASE + 21 * MINUTE
    }).state;
  let result;
  for (let index = 21; index < candles.length; index++) {
    result = advanceFiveMinuteTrendEntry(state, candles.slice(0, index + 1), {
      decisionAt: candles[index].timestamp + MINUTE
    });
    state = result.state;
  }
  return result;
}

test("candidate preserves confirmation2 and admits only the rising 5-minute trend", async () => {
  const admitted = await attemptEntry(true);
  assert.equal(admitted.signals.length, 1);
  assert.equal(admitted.signals[0].direction, "ENTRY");
  assert.equal(admitted.signals[0].strategyReason,
    "CONFIRM2_COOLDOWN10_AND_5M_SMA20_UPTREND");
  assert.equal(admitted.signals[0].id,
    `${SPOT_PAPER_5M_TREND_FILTER_ID}:ENTRY:${admitted.signals[0].candleAt}`);
  assert.equal(admitted.trendFilter.status,
    "FIVE_MINUTE_SMA20_TREND_CONFIRMED");

  const blocked = await attemptEntry(false);
  assert.deepEqual(blocked.signals, []);
  assert.equal(blocked.blockedEntryReason,
    "FIVE_MINUTE_SMA20_TREND_NOT_CONFIRMED");
  assert.equal(blocked.discarded, blocked.blockedEntryReason);
});

test("exit signals and downstream ledger risk behavior remain unchanged", () => {
  const warm = oneMinuteCandles(Array(21).fill(100));
  let baseState = advanceEntryConfirmation(createEntryConfirmationState(),
    warm, { decisionAt: BASE + 21 * MINUTE }).state;
  let candidateState = advanceFiveMinuteTrendEntry(createFiveMinuteTrendState(),
    warm, { decisionAt: BASE + 21 * MINUTE }).state;
  const entryCross = oneMinuteCandles([...Array(20).fill(100), 120], 1);
  const entryConfirm = oneMinuteCandles([...Array(19).fill(100), 120, 130], 2);
  baseState = advanceEntryConfirmation(baseState, entryCross, {
    decisionAt: BASE + 22 * MINUTE
  }).state;
  candidateState = advanceFiveMinuteTrendEntry(candidateState, entryCross, {
    decisionAt: BASE + 22 * MINUTE
  }).state;
  const baseEntry = advanceEntryConfirmation(baseState, entryConfirm, {
    decisionAt: BASE + 23 * MINUTE
  });
  const candidateEntry = advanceFiveMinuteTrendEntry(candidateState, entryConfirm, {
    decisionAt: BASE + 23 * MINUTE
  });
  baseState = recordEntryConfirmationSell(baseEntry.state, BASE + 23 * MINUTE);
  candidateState = recordFiveMinuteTrendSell(
    candidateEntry.state, BASE + 23 * MINUTE);
  assert.deepEqual(candidateState, baseState);

  const entryQuote = quote(BASE + 23 * MINUTE);
  const entryLedger = applyPaperObservation(createLedger(), {
    signal: baseEntry.signals[0], quote: entryQuote, nowMs: BASE + 23 * MINUTE
  }).ledger;
  const values = [...Array(21).fill(100), 120, 130, ...Array(8).fill(80)];
  let baseExit;
  let candidateExit;
  for (let index = 23; index < values.length; index++) {
    const window = oneMinuteCandles(values.slice(index - 20, index + 1),
      index - 20);
    baseExit = advanceEntryConfirmation(baseState, window, {
      decisionAt: BASE + (index + 2) * MINUTE, held: true
    });
    candidateExit = advanceFiveMinuteTrendEntry(candidateState, window, {
      decisionAt: BASE + (index + 2) * MINUTE, held: true
    });
    baseState = baseExit.state;
    candidateState = candidateExit.state;
    if (baseExit.signals.length) break;
  }

  assert.equal(baseExit.signals[0]?.direction, "EXIT");
  assert.deepEqual(candidateExit.signals, baseExit.signals);
  const nowMs = candidateExit.signals[0].decisionAt;
  const executionQuote = quote(nowMs);
  assert.deepEqual(
    applyPaperObservation(entryLedger, {
      signal: candidateExit.signals[0], quote: executionQuote, nowMs
    }),
    applyPaperObservation(entryLedger, {
      signal: baseExit.signals[0], quote: executionQuote, nowMs
    })
  );
});
