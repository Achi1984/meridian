import test from "node:test";
import assert from "node:assert/strict";
import { advanceRangePullback, createRangePullbackState, SPOT_PAPER_RANGE_PULLBACK_ID } from
  "../scripts/spot-paper-research/range-pullback.mjs";

const BASE = Date.UTC(2026, 0, 1);
const candle = (timestamp, close, spread = 2) => ({ timestamp, openNano: close * 1e8,
  highNano: (close + spread) * 1e8, lowNano: (close - spread) * 1e8, closeNano: close * 1e8 });

test("range pullback remains inert before 70 closed bars", () => {
  const result = advanceRangePullback(createRangePullbackState(),
    Array.from({ length: 69 }, (_, i) => candle(BASE + i * 60_000, 100)),
    { decisionAt: BASE + 70 * 60_000 });
  assert.deepEqual(result.signals, []);
});

test("range pullback rejects duplicate candles and preserves identity", () => {
  const candles = Array.from({ length: 70 }, (_, i) => candle(BASE + i * 60_000, 100));
  const first = advanceRangePullback(createRangePullbackState(), candles,
    { decisionAt: BASE + 71 * 60_000 });
  const second = advanceRangePullback(first.state, candles,
    { decisionAt: BASE + 72 * 60_000 });
  assert.deepEqual(second.signals, []);
  assert.equal(first.state.candles.length, second.state.candles.length);
  assert.equal(SPOT_PAPER_RANGE_PULLBACK_ID, "BTC_EUR_RANGE_PULLBACK_ATR_RSI_V1");
});
