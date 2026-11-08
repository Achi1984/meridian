import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceEntryConfirmation, createEntryConfirmationState, ENTRY_COOLDOWN_MS,
  recordEntryConfirmationSell, SPOT_PAPER_ENTRY_CONFIRMATION_ID
} from "../scripts/spot-paper-research/entry-confirmation.mjs";
import { advanceStrategy, createStrategyState } from
  "../scripts/spot-paper-pilot/core.mjs";

const BASE = Date.UTC(2025, 0, 1);
const MINUTE = 60_000;
const price = value => String(BigInt(value) * 100_000_000n);

function candles(values, offset = 0) {
  return values.map((value, index) => ({
    timestamp: BASE + (offset + index) * MINUTE,
    closeNano: price(value)
  }));
}

function warmedState(values = Array(21).fill(100)) {
  const first = advanceEntryConfirmation(createEntryConfirmationState(),
    candles(values), { decisionAt: BASE + 22 * MINUTE });
  return first.state;
}

test("entry confirmation requires a fresh cross and a second distinct closed candle", () => {
  let state = warmedState();
  const warm = candles(Array(21).fill(100));
  assert.deepEqual(advanceEntryConfirmation(createEntryConfirmationState(), warm, {
    decisionAt: BASE + 22 * MINUTE
  }).signals, []);

  const crossing = candles([...Array(20).fill(100), 120], 1);
  const first = advanceEntryConfirmation(state, crossing, { decisionAt: BASE + 23 * MINUTE });
  state = first.state;
  assert.deepEqual(first.signals, []);
  assert.equal(state.pending.crossCandleAt, BASE + 21 * MINUTE);

  const backfill = advanceEntryConfirmation(state, candles(Array(21).fill(100)), {
    decisionAt: BASE + 24 * MINUTE
  });
  assert.equal(backfill.newCandleCount, 0);
  assert.deepEqual(backfill.signals, []);
  assert.deepEqual(backfill.state.pending, state.pending);

  const duplicate = advanceEntryConfirmation(state, crossing, { decisionAt: BASE + 24 * MINUTE });
  assert.equal(duplicate.newCandleCount, 0);
  assert.deepEqual(duplicate.signals, []);
  assert.deepEqual(duplicate.state.pending, state.pending);

  const confirmation = candles([...Array(19).fill(100), 120, 130], 2);
  const second = advanceEntryConfirmation(state, confirmation, {
    decisionAt: BASE + 24 * MINUTE
  });
  assert.equal(second.signals.length, 1);
  assert.equal(second.signals[0].direction, "ENTRY");
  assert.equal(second.signals[0].candleAt, BASE + 22 * MINUTE);
  assert.equal(second.signals[0].confirmationStartedAt, BASE + 21 * MINUTE);
  assert.equal(second.signals[0].strategyReason,
    "TWO_CONSECUTIVE_STRICT_FAST_ABOVE_SLOW");
  assert.match(second.signals[0].id, new RegExp(`^${SPOT_PAPER_ENTRY_CONFIRMATION_ID}:`));
  assert.notEqual(second.signals[0].id, `ENTRY:${BASE + 21 * MINUTE}`);
});

test("equality cancels confirmation and missed decision windows cannot confirm old crosses", () => {
  const state = warmedState(Array(21).fill(99));
  const crossing = candles([...Array(20).fill(99), 120], 1);
  const pending = advanceEntryConfirmation(state, crossing, {
    decisionAt: BASE + 23 * MINUTE
  });
  assert.ok(pending.state.pending);

  const equal = candles([...Array(19).fill(99), 120, 78], 2);
  const equalResult = advanceEntryConfirmation(pending.state, equal, {
    decisionAt: BASE + 24 * MINUTE
  });
  assert.equal(equalResult.signals.length, 0);
  assert.equal(equalResult.state.pending, null);

  const missed = candles([...Array(19).fill(99), 120, 130, 140], 2);
  const missedResult = advanceEntryConfirmation(pending.state, missed, {
    decisionAt: BASE + 25 * MINUTE
  });
  assert.equal(missedResult.missedDecisionWindow, true);
  assert.equal(missedResult.state.pending, null);
  const continued = candles([...Array(19).fill(99), 120, 130, 140, 150], 2);
  assert.deepEqual(advanceEntryConfirmation(missedResult.state, continued, {
    decisionAt: BASE + 26 * MINUTE
  }).signals, []);
});

test("cooldown discards active opportunities, allows a new cross at expiry, and never queues", () => {
  const boundary = BASE + 1_000_000;
  const warmValues = [120, ...Array(20).fill(80)];
  const warmCandles = candles(warmValues);
  const crossed = candles([...Array(20).fill(80), 120], 1);

  const atBoundary = advanceEntryConfirmation(
    recordEntryConfirmationSell(warmedState(warmValues), boundary - ENTRY_COOLDOWN_MS),
    crossed, { decisionAt: boundary }
  );
  assert.equal(atBoundary.state.cooldownUntil, boundary);
  assert.equal(atBoundary.state.pending.crossCandleAt, BASE + 21 * MINUTE);

  const oneMillisecondBefore = advanceEntryConfirmation(
    recordEntryConfirmationSell(warmedState(warmValues),
      boundary - ENTRY_COOLDOWN_MS + 1),
    crossed, { decisionAt: boundary }
  );
  assert.equal(oneMillisecondBefore.discarded, "COOLDOWN_ACTIVE");
  assert.equal(oneMillisecondBefore.state.pending, null);
  const stillAbove = candles([...Array(19).fill(80), 120, 130], 2);
  assert.deepEqual(advanceEntryConfirmation(oneMillisecondBefore.state, stillAbove, {
    decisionAt: boundary + 1
  }).signals, []);

  let state = atBoundary.state;
  const confirmation = candles([...Array(19).fill(80), 120, 130], 2);
  const entry = advanceEntryConfirmation(state, confirmation, {
    decisionAt: boundary + MINUTE
  });
  assert.equal(entry.signals[0].direction, "ENTRY");

  const baseline = advanceStrategy(createStrategyState(), warmCandles);
  assert.deepEqual(baseline.signals, []);
});

test("held-position downward crosses exit immediately regardless of entry controls", () => {
  const warm = candles(Array(21).fill(100));
  const up = candles([...Array(20).fill(100), 120], 1);
  const next = candles([...Array(19).fill(100), 120, 130], 2);
  let state = advanceEntryConfirmation(createEntryConfirmationState(), warm, {
    decisionAt: BASE + 22 * MINUTE
  }).state;
  state = advanceEntryConfirmation(state, up, { decisionAt: BASE + 23 * MINUTE }).state;
  state = advanceEntryConfirmation(state, next, { decisionAt: BASE + 24 * MINUTE }).state;
  state = recordEntryConfirmationSell(state, BASE + 24 * MINUTE);

  const full = [...Array(21).fill(100), 120, 130, ...Array(8).fill(80)];
  let exit;
  for (let index = 23; index < full.length; index++) {
    exit = advanceEntryConfirmation(state,
      candles(full.slice(index - 20, index + 1), index - 20), {
        decisionAt: BASE + (index + 2) * MINUTE, held: true
      });
    state = exit.state;
    if (exit.signals.length) break;
  }
  assert.equal(exit.signals[0]?.direction, "EXIT");
  assert.equal(exit.signals[0]?.strategyReason, "BASELINE_IMMEDIATE_DOWN_CROSS");
});
