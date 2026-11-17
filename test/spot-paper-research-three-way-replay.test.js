import test from "node:test";
import assert from "node:assert/strict";
import {sha256} from "../scripts/spot-paper-pilot/core.mjs";
import {compareThreeSpotPaperStrategies} from
  "../scripts/spot-paper-research/three-way-comparison.mjs";

const BASE = Date.UTC(2026, 0, 1);
const MINUTE = 60_000;
const acquisition = (data, requestStartedAt, receivedAt) => {
  const raw = JSON.stringify(data);
  return {data, raw, sha256: sha256(Buffer.from(raw, "utf8")),
    requestStartedAt, receivedAt};
};
const ohlc = (closes, startAt, spread = 0) => {
  const rows = closes.map((close, index) => {
    const value = close.toFixed(8);
    return [(startAt + index * MINUTE) / 1000, value, (close + spread).toFixed(8), (close - spread).toFixed(8), value,
      value, "1.00000000", 1];
  });
  const value = closes.at(-1).toFixed(8);
  rows.push([(startAt + closes.length * MINUTE) / 1000, value, value, value,
    value, value, "1.00000000", 1]);
  return {error: [], result: {XXBTZEUR: rows, last: rows.at(-1)[0]}};
};
const ticker = mid => ({error: [], result: {XXBTZEUR: {
  a: [(mid * 1.0001).toFixed(8), "1", "1.00000000"],
  b: [(mid * 0.9999).toFixed(8), "1", "1.00000000"]
}}});

function stream(closes) {
  return Array.from({length: closes.length - 20}, (_, index) => {
    const count = index + 21;
    const window = closes.slice(index, count);
    const latestAt = BASE + (count - 1) * MINUTE;
    const ohlcReceivedAt = latestAt + MINUTE + 1_000;
    return {
      at: ohlcReceivedAt + 100,
      decisionAt: ohlcReceivedAt,
      ohlc: acquisition(ohlc(window,
        latestAt - (window.length - 1) * MINUTE), ohlcReceivedAt - 100,
        ohlcReceivedAt),
      ticker: acquisition(ticker(window.at(-1)),
        ohlcReceivedAt + 1, ohlcReceivedAt + 20)
    };
  });
}

test("three-way replay executes all arms on one causal synthetic stream", () => {
  const result = compareThreeSpotPaperStrategies(Array(72).fill(100).length ?
    stream(Array(72).fill(100)) : []);
  assert.equal(result.status, "COMPARISON_AVAILABLE");
  assert.equal(result.schemaVersion, "SPOT_PAPER_THREE_WAY_COMPARISON_V1");
  assert.deepEqual(Object.keys(result.arms),
    ["baseline", "challenger", "rangePullback", "cash"]);
  for (const arm of Object.values(result.arms)) {
    assert.equal(arm.valuationAt, result.commonHorizonAt);
    assert.equal(arm.valuationStatus, "MARKED_AT_COMMON_HORIZON");
  }
  assert.equal(result.arms.rangePullback.fillCount, 0);
  assert.equal(result.arms.cash.finalCashCents, 100_000);
});

test("range replay ignores warm-up entries and records only filled entries and ATR exits", () => {
  const closes = [...Array(72).fill(100), 99, 98, 97, 96, 95, 95.1, 95.2, 89];
  const warmupEnd = closes.length - 2;
  const observations = [warmupEnd, warmupEnd + 1, warmupEnd + 2].map((count, index) => {
    const at = BASE + count * MINUTE + 1_000;
    const window = closes.slice(0, count);
    const quote = ticker(index === 2 ? 95 : window.at(-1));
    if (index === 1) quote.result.XXBTZEUR.a[0] = "99.00000000";
    return {at: at + 100, decisionAt: at,
      ohlc: acquisition(ohlc(window, BASE, 1), at - 100, at),
      ticker: acquisition(quote, at + 1, at + 20)};
  });
  const result = compareThreeSpotPaperStrategies(observations);
  assert.equal(result.status, "COMPARISON_AVAILABLE");
  const range = result.arms.rangePullback;
  assert.equal(range.fillCount, 0);
  assert.equal(range.rejectedEntryCount, 1);
  assert.equal(range.positionStatus, "FLAT");

  const allowed = observations.map((observation, index) => index !== 1 ? observation : {
    ...observation, ticker: acquisition(ticker(closes[warmupEnd]),
      observation.ticker.requestStartedAt, observation.ticker.receivedAt)
  });
  const completed = compareThreeSpotPaperStrategies(allowed);
  assert.equal(completed.status, "COMPARISON_AVAILABLE");
  assert.deepEqual(completed.arms.rangePullback.fills.map(fill => [fill.executionAt, fill.reason]), [
    [observations[1].at, "RANGE_PULLBACK_ATR_RSI"], [observations[2].at, "ATR_STOP"]
  ]);
  const riskExit = allowed.map((observation, index) => index !== 2 ? observation : {
    ...observation, ticker: acquisition(ticker(89),
      observation.ticker.requestStartedAt, observation.ticker.receivedAt)
  });
  const stopped = compareThreeSpotPaperStrategies(riskExit);
  assert.equal(stopped.status, "COMPARISON_AVAILABLE");
  assert.equal(stopped.arms.rangePullback.fills.at(-1).reason, "SAMPLED_2PCT_BID_STOP");
  assert.equal(stopped.arms.rangePullback.positionStatus, "FLAT");

});
