import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceStrategy, applyPaperObservation, createLedger, createStrategyState,
  parseKrakenOhlc, parseKrakenTicker, sha256
} from "../scripts/spot-paper-pilot/core.mjs";
import { compareSpotPaperStrategies, maximumSampledEquityDrawdown } from
  "../scripts/spot-paper-research/comparison.mjs";
import {
  advanceEntryConfirmation, createEntryConfirmationState,
  recordEntryConfirmationSell, SPOT_PAPER_ENTRY_CONFIRMATION_ID
} from
  "../scripts/spot-paper-research/entry-confirmation.mjs";

const BASE = Date.UTC(2025, 0, 1);
const MINUTE = 60_000;

function acquisition(data, requestStartedAt, receivedAt, extra = {}) {
  const raw = JSON.stringify(data);
  return {
    data, raw, sha256: sha256(Buffer.from(raw, "utf8")),
    requestStartedAt, receivedAt, ...extra
  };
}

function ohlcData(closes, startAt) {
  const rows = closes.map((close, index) => {
    const price = close.toFixed(8);
    return [(startAt + index * MINUTE) / 1000, price, price, price, price, price,
      "1.00000000", 1];
  });
  const unfinishedPrice = closes.at(-1).toFixed(8);
  rows.push([(startAt + closes.length * MINUTE) / 1000,
    unfinishedPrice, unfinishedPrice, unfinishedPrice, unfinishedPrice,
    unfinishedPrice, "1.00000000", 1]);
  return { error: [], result: { XXBTZEUR: rows, last: rows.at(-1)[0] } };
}

function tickerData(mid) {
  return {
    error: [],
    result: { XXBTZEUR: {
      a: [(mid * 1.0001).toFixed(8), "1", "1.00000000"],
      b: [(mid * 0.9999).toFixed(8), "1", "1.00000000"]
    } }
  };
}

function closedCandles(closes, offset = 0) {
  return closes.map((close, index) => ({
    timestamp: BASE + (offset + index) * MINUTE,
    closeNano: String(BigInt(close) * 100_000_000n)
  }));
}

function stream(closes, quoteMids = {}) {
  const observations = [];
  for (let count = 21; count <= closes.length; count++) {
    if (count !== 21 && count <= 21) continue;
    const window = closes.slice(Math.max(0, count - 21), count);
    const latestAt = BASE + (count - 1) * MINUTE;
    const ohlcReceivedAt = latestAt + MINUTE + 1_000;
    const at = ohlcReceivedAt + 100;
    const ohlc = acquisition(ohlcData(window, latestAt - (window.length - 1) * MINUTE),
      ohlcReceivedAt - 100, ohlcReceivedAt);
    const ticker = acquisition(tickerData(quoteMids[count - 1] ?? closes[count - 1]),
      ohlcReceivedAt + 1, ohlcReceivedAt + 20);
    observations.push({ at, decisionAt: ohlcReceivedAt, ohlc, ticker });
  }
  return observations;
}

function snapshots(closedSnapshots) {
  return closedSnapshots.map((closes, index) => {
    const latestAt = BASE + (closes.length - 1) * MINUTE;
    const ohlcReceivedAt = latestAt + MINUTE + 1_000;
    const at = ohlcReceivedAt + 100;
    return {
      at, decisionAt: ohlcReceivedAt,
      ohlc: acquisition(ohlcData(closes, BASE), ohlcReceivedAt - 100, ohlcReceivedAt),
      ticker: acquisition(tickerData(closes.at(-1)), ohlcReceivedAt + 1,
        ohlcReceivedAt + 20),
      cycle: index + 1
    };
  });
}

function fillSummary(fills) {
  return fills.map(({ id, side, grossCents, feeCents, priceNano, reason }) =>
    ({ id, side, grossCents, feeCents, priceNano, reason }));
}

test("three-arm comparison preserves baseline ledger parity on a synthetic trend", () => {
  const observations = stream([...Array(21).fill(100), 120, 130, 140, 150]);
  const comparison = compareSpotPaperStrategies(observations);
  assert.equal(comparison.status, "COMPARISON_AVAILABLE");
  assert.equal(comparison.profitability, "NOT_ASSESSED");
  assert.deepEqual(Object.keys(comparison.arms), ["baseline", "challenger", "cash"]);

  let state = createStrategyState();
  let ledger = createLedger();
  for (const observation of observations) {
    const ohlc = parseKrakenOhlc(observation.ohlc, observation.at);
    const quote = parseKrakenTicker(observation.ticker, observation.at);
    const advanced = advanceStrategy(state, ohlc.candles);
    const applied = applyPaperObservation(ledger, {
      signal: advanced.signals.at(-1) ?? null, quote, nowMs: observation.at
    });
    state = advanced.state;
    ledger = applied.ledger;
    if (applied.stopReason) break;
  }

  const baseline = comparison.arms.baseline;
  assert.deepEqual(fillSummary(baseline.fills), fillSummary(ledger.fills));
  assert.equal(baseline.finalCashCents, ledger.cashCents);
  assert.equal(baseline.realizedPnlCents, ledger.realizedPnlCents);
  assert.equal(baseline.feesCents, ledger.feesCents);
  assert.equal(baseline.finalNetEquityCents,
    ledger.cashCents + ledger.lastMark.netExitCents);
  assert.equal(baseline.positionStatus, "OPEN_UNRESOLVED_AT_HORIZON");
});

test("confirmation can miss trend gains while cash control stays unchanged", () => {
  const comparison = compareSpotPaperStrategies(
    stream([...Array(21).fill(100), 120, 130, 140, 150]));
  const { baseline, challenger, cash } = comparison.arms;
  assert.equal(baseline.fills[0].side, "BUY");
  assert.equal(challenger.fills[0].side, "BUY");
  assert.equal(challenger.fills[0].strategyId, SPOT_PAPER_ENTRY_CONFIRMATION_ID);
  assert.equal(challenger.fills[0].reason,
    "TWO_CONSECUTIVE_STRICT_FAST_ABOVE_SLOW");
  assert.equal(challenger.fills[0].ledgerReason, "SMA5_UP_CROSS");
  assert.equal(challenger.fills[0].signalAt, BASE + 22 * MINUTE);
  assert.ok(baseline.finalNetEquityCents > challenger.finalNetEquityCents);
  assert.equal(challenger.positionStatus, "OPEN_UNRESOLVED_AT_HORIZON");
  assert.equal(challenger.unresolvedTerminalInventory.markAgeAtEvaluationMs, 80);

  assert.equal(cash.finalCashCents, 100_000);
  assert.equal(cash.finalNetEquityCents, 100_000);
  assert.equal(cash.realizedPnlCents, 0);
  assert.equal(cash.feesCents, 0);
  assert.deepEqual(cash.fills, []);
});

test("whipsaw stop exits are immediate and terminate each affected arm", () => {
  const closes = [...Array(21).fill(100), 120, 120, 97, 120, 130];
  const comparison = compareSpotPaperStrategies(stream(closes));
  for (const name of ["baseline", "challenger"]) {
    const arm = comparison.arms[name];
    assert.equal(arm.stopReason, "SAMPLED_2PCT_BID_STOP");
    assert.equal(arm.fills.at(-1).side, "SELL");
    assert.equal(arm.fills.at(-1)[name === "baseline" ? "reason" : "ledgerReason"],
      "SAMPLED_2PCT_BID_STOP");
    assert.equal(arm.observationCount, 4);
    assert.equal(arm.positionStatus, "FLAT");
  }
  assert.equal(comparison.arms.baseline.fills[0].executionAt,
    stream(closes)[1].at);
  assert.equal(comparison.arms.challenger.fills[0].executionAt,
    stream(closes)[2].at);
});

test("stopped open inventory is marked at common horizon without later fills or liquidation", () => {
  const closes = [...Array(21).fill(100),
    ...Array(10).fill([102, 102, 100, 98.8, 98.8, 100]).flat()];
  const quoteMids = {};
  for (let index = 20; index < closes.length; index++) quoteMids[index] = 100;
  for (const index of [26, 32, 38, 44, 50, 56, 62]) quoteMids[index] = 98.2;
  quoteMids[60] = 99;
  quoteMids[61] = 99;
  for (let index = 62; index < closes.length; index++) quoteMids[index] = 80;
  const observations = stream(closes, quoteMids);
  const comparison = compareSpotPaperStrategies(observations);
  assert.equal(comparison.status, "COMPARISON_AVAILABLE");

  const stopped = comparison.arms.baseline;
  assert.equal(stopped.stopReason, "SESSION_LOSS_LIMIT");
  assert.ok(stopped.tradingStoppedAt < comparison.commonHorizonAt);
  assert.equal(stopped.positionStatus, "OPEN_UNRESOLVED_AT_HORIZON");
  assert.ok(stopped.unresolvedTerminalInventory.quantitySat > 0);
  assert.equal(stopped.valuationAt, comparison.commonHorizonAt);
  assert.equal(stopped.valuationStatus, "MARKED_AT_COMMON_HORIZON");
  assert.equal(stopped.unresolvedTerminalInventory.lastMark.receivedAt,
    observations.at(-1).ticker.receivedAt);
  assert.equal(stopped.unresolvedTerminalInventory.markAgeAtEvaluationMs,
    comparison.commonHorizonAt - observations.at(-1).ticker.receivedAt);
  assert.equal(stopped.valuationObservationCount, observations.length);
  assert.equal(stopped.fills.at(-1).side, "BUY");
  assert.ok(stopped.fills.every(fill => fill.executionAt <= stopped.tradingStoppedAt));
  assert.equal(stopped.finalNetEquityCents,
    stopped.initialCashCents + stopped.realizedPnlCents + stopped.unrealizedPnlCents);
});

test("all ledger costs and turnover reconcile once and sampled drawdown includes initial capital", () => {
  const comparison = compareSpotPaperStrategies(
    stream([...Array(21).fill(100), 120, 130, 140, 150]));
  for (const arm of Object.values(comparison.arms)) {
    assert.equal(arm.grossTurnoverCents,
      arm.fills.reduce((sum, fill) => sum + fill.grossCents, 0));
    assert.equal(arm.feesCents,
      arm.fills.reduce((sum, fill) => sum + fill.feeCents, 0));
    assert.equal(arm.finalNetEquityCents,
      arm.initialCashCents + arm.realizedPnlCents + arm.unrealizedPnlCents);
    assert.equal(arm.equityIncludesInitialCapitalSample, true);
    assert.ok(arm.timeExposure.exposureMs >= 0);
    assert.match(arm.timeExposure.convention, /\[observationAt, nextObservationAt\)/);
    assert.equal(arm.valuationAt, comparison.commonHorizonAt);
    assert.equal(arm.valuationStatus, "MARKED_AT_COMMON_HORIZON");
  }
  assert.ok(comparison.arms.baseline.feesCents > 0);
  assert.ok(comparison.arms.baseline.grossTurnoverCents > 0);
});

test("OHLC snapshots longer than strategy state are fully admitted and replayed", () => {
  const first = Array(30).fill(100);
  const comparison = compareSpotPaperStrategies(snapshots([
    first, [...first, 120], [...first, 120, 130]
  ]));
  assert.equal(comparison.status, "COMPARISON_AVAILABLE");
  assert.equal(comparison.arms.baseline.observationCount, 3);
  assert.equal(comparison.arms.challenger.observationCount, 3);
  assert.equal(comparison.arms.baseline.fills[0].side, "BUY");
  assert.equal(comparison.arms.challenger.fills[0].side, "BUY");
  assert.equal(comparison.arms.challenger.fills[0].signalAt, BASE + 31 * MINUTE);
  assert.equal(comparison.input.workUnits, (30 * 2 + 1) + (31 * 2 + 1) + (32 * 2 + 1));

  const conflicting = snapshots([first, [...first, 120]]);
  const conflictData = structuredClone(conflicting[1].ohlc.data);
  const row = conflictData.result.XXBTZEUR[29];
  conflictData.result.XXBTZEUR[29] =
    [row[0], "101.00000000", "101.00000000", "101.00000000",
      "101.00000000", "101.00000000", row[6], row[7]];
  conflicting[1].ohlc = acquisition(conflictData,
    conflicting[1].ohlc.requestStartedAt, conflicting[1].ohlc.receivedAt);
  assert.equal(compareSpotPaperStrategies(conflicting).status, "UNAVAILABLE");
  assert.equal(compareSpotPaperStrategies(conflicting).reason,
    "CONFLICTING_CLOSED_CANDLE");

  const tooMany = Array(721).fill(100);
  const rejected = compareSpotPaperStrategies(snapshots([tooMany]));
  assert.equal(rejected.status, "UNAVAILABLE");
  assert.equal(rejected.reason, "CANDLE_SNAPSHOT_LIMIT");
});

test("cooldown eligibility uses decision time before the quote, not fill effect time", () => {
  const warm = Array(21).fill(100);
  const warmState = advanceEntryConfirmation(createEntryConfirmationState(),
    closedCandles(warm), { decisionAt: BASE + 22 * MINUTE }).state;
  const cooldownUntil = BASE + 25 * MINUTE;
  const stateDuringCooldown = recordEntryConfirmationSell(
    warmState, cooldownUntil - 600_000);
  const decisionAt = cooldownUntil - 1;
  const tickerRequestStartedAt = cooldownUntil + 1;
  const cross = advanceEntryConfirmation(stateDuringCooldown,
    closedCandles([...Array(20).fill(100), 120], 1), {
      decisionAt
    });
  assert.equal(decisionAt < cooldownUntil, true);
  assert.equal(tickerRequestStartedAt > cooldownUntil, true);
  assert.deepEqual(cross.signals, []);
  assert.equal(cross.discarded, "COOLDOWN_ACTIVE");
  assert.equal(cross.state.pending, null);
});

test("maximum absolute and relative drawdown are calculated independently", () => {
  assert.deepEqual(maximumSampledEquityDrawdown([10_000, 7_000, 20_000, 16_000]), {
    maxDrawdownCents: 4_000,
    maxRelativeDrawdownBps: 3_000
  });
});

test("missing causal or fresh quote evidence makes the comparison unavailable", () => {
  const observations = stream([...Array(21).fill(100)]);
  const preSignal = structuredClone(observations);
  preSignal[0].ticker.requestStartedAt = preSignal[0].ohlc.receivedAt - 1;
  assert.equal(compareSpotPaperStrategies(preSignal).status, "UNAVAILABLE");
  assert.equal(compareSpotPaperStrategies(preSignal).reason, "MISSING_CAUSAL_QUOTE");

  const postQuoteDecision = structuredClone(observations);
  postQuoteDecision[0].decisionAt = postQuoteDecision[0].ticker.requestStartedAt + 1;
  assert.equal(compareSpotPaperStrategies(postQuoteDecision).status, "UNAVAILABLE");
  assert.equal(compareSpotPaperStrategies(postQuoteDecision).reason, "MISSING_CAUSAL_QUOTE");

  const stale = structuredClone(observations);
  stale[0].at = stale[0].ohlc.receivedAt + 10_003;
  stale[0].ticker.requestStartedAt = stale[0].ohlc.receivedAt + 1;
  stale[0].ticker.receivedAt = stale[0].ohlc.receivedAt + 2;
  const unavailable = compareSpotPaperStrategies(stale);
  assert.equal(unavailable.status, "UNAVAILABLE");
  assert.equal(unavailable.reason, "STALE_TICKER");
  assert.equal(unavailable.arms, null);
});

test("response byte and cycle bounds are enforced without market-data access", () => {
  const oversized = stream([...Array(21).fill(100)]);
  const data = JSON.parse(oversized[0].ticker.raw);
  data.padding = "x".repeat(256 * 1024);
  oversized[0].ticker = acquisition(data,
    oversized[0].ohlc.receivedAt + 1, oversized[0].ticker.receivedAt);
  assert.equal(compareSpotPaperStrategies(oversized).status, "UNAVAILABLE");

  assert.throws(() => compareSpotPaperStrategies(Array(481).fill({})),
    /OBSERVATION_COUNT_LIMIT/);
});
