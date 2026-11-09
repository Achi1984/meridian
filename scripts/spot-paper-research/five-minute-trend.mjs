import {
  advanceEntryConfirmation, createEntryConfirmationState,
  recordEntryConfirmationSell
} from "./entry-confirmation.mjs";

export const SPOT_PAPER_5M_TREND_FILTER_ID =
  "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1";
export const FIVE_MINUTE_MS = 5 * 60_000;
export const ONE_MINUTE_MS = 60_000;
export const FIVE_MINUTE_SMA_WARMUP_BARS = 21;
export const MAX_ONE_MINUTE_CANDLES = 720;
export const ACTIVITY_DIAGNOSTIC_WINDOW_MS = 24 * 60 * 60_000;
export const MIN_COMPLETED_ROUND_TRIPS = 5;

const isTime = value => Number.isSafeInteger(value) && value >= 0;
const MAX_CLOSE_NANO = String(Number.MAX_SAFE_INTEGER);

function validatedCandles(candles) {
  if (!Array.isArray(candles)) {
    throw new Error("INVALID_ONE_MINUTE_CANDLES");
  }
  if (candles.length > MAX_ONE_MINUTE_CANDLES) {
    throw new Error("ONE_MINUTE_CANDLE_LIMIT");
  }
  const normalized = candles.map(candle => {
    if (!candle || typeof candle !== "object" || Array.isArray(candle) ||
        !isTime(candle.timestamp) || candle.timestamp % ONE_MINUTE_MS !== 0 ||
        candle.timestamp > Number.MAX_SAFE_INTEGER - FIVE_MINUTE_MS ||
        typeof candle.closeNano !== "string" ||
        candle.closeNano.length > MAX_CLOSE_NANO.length ||
        !/^[1-9]\d*$/.test(candle.closeNano) ||
        (candle.closeNano.length === MAX_CLOSE_NANO.length &&
         candle.closeNano > MAX_CLOSE_NANO)) {
      throw new Error("INVALID_ONE_MINUTE_CANDLE");
    }
    return { timestamp: candle.timestamp, closeNano: candle.closeNano };
  });
  for (let index = 1; index < normalized.length; index++) {
    const previousAt = normalized[index - 1].timestamp;
    const currentAt = normalized[index].timestamp;
    if (currentAt === previousAt) {
      throw new Error("DUPLICATE_ONE_MINUTE_CANDLE");
    }
    if (currentAt < previousAt) {
      throw new Error("OUT_OF_ORDER_ONE_MINUTE_CANDLES");
    }
  }
  for (let index = 1; index < normalized.length; index++) {
    const previousAt = normalized[index - 1].timestamp;
    const currentAt = normalized[index].timestamp;
    if (currentAt !== previousAt + ONE_MINUTE_MS) {
      throw new Error("GAP_IN_ONE_MINUTE_CANDLES");
    }
  }
  return normalized;
}

export function aggregateClosedFiveMinuteCandles(candles, { decisionAt } = {}) {
  if (!isTime(decisionAt)) throw new Error("INVALID_DECISION_TIME");
  const oneMinute = validatedCandles(candles);
  const closed = oneMinute.filter(candle =>
    candle.timestamp + ONE_MINUTE_MS <= decisionAt);
  const result = [];
  let bucketStart = null;
  let bucket = [];

  const appendCompleteBucket = () => {
    if (bucket.length === 5 && bucket[0].timestamp === bucketStart &&
        bucket[4].timestamp === bucketStart + 4 * ONE_MINUTE_MS) {
      result.push({
        timestamp: bucketStart,
        closedAt: bucketStart + FIVE_MINUTE_MS,
        closeNano: bucket[4].closeNano
      });
    }
  };

  for (const candle of closed) {
    const currentBucketStart =
      Math.floor(candle.timestamp / FIVE_MINUTE_MS) * FIVE_MINUTE_MS;
    if (currentBucketStart !== bucketStart) {
      appendCompleteBucket();
      bucketStart = currentBucketStart;
      bucket = [];
    }
    bucket.push(candle);
  }
  appendCompleteBucket();
  return result;
}

export function evaluateFiveMinuteTrend(candles, { decisionAt } = {}) {
  const bars = aggregateClosedFiveMinuteCandles(candles, { decisionAt });
  if (bars.length < FIVE_MINUTE_SMA_WARMUP_BARS) {
    return {
      status: "FIVE_MINUTE_SMA20_WARMUP_INSUFFICIENT",
      eligible: false,
      availableBars: bars.length,
      latestClosedAt: bars.at(-1)?.closedAt ?? null
    };
  }

  const recent = bars.slice(-FIVE_MINUTE_SMA_WARMUP_BARS);
  const currentSum = recent.slice(1).reduce(
    (sum, bar) => sum + BigInt(bar.closeNano), 0n);
  const previousSum = recent.slice(0, -1).reduce(
    (sum, bar) => sum + BigInt(bar.closeNano), 0n);
  const latestClose = BigInt(recent.at(-1).closeNano);
  const eligible = latestClose * 20n > currentSum &&
    currentSum > previousSum;
  return {
    status: eligible ? "FIVE_MINUTE_SMA20_TREND_CONFIRMED" :
      "FIVE_MINUTE_SMA20_TREND_NOT_CONFIRMED",
    eligible,
    availableBars: bars.length,
    latestClosedAt: recent.at(-1).closedAt
  };
}

export function createFiveMinuteTrendState() {
  return createEntryConfirmationState();
}

export function advanceFiveMinuteTrendEntry(previous, candles, {
  decisionAt, held = false
} = {}) {
  if (!isTime(decisionAt) || typeof held !== "boolean") {
    throw new Error("INVALID_FIVE_MINUTE_TREND_DECISION");
  }
  const normalized = validatedCandles(candles);
  const closed = normalized.filter(candle =>
    candle.timestamp + ONE_MINUTE_MS <= decisionAt);
  if (!closed.length) {
    return {
      state: structuredClone(previous),
      signals: [],
      newCandleCount: 0
    };
  }

  const advanced = advanceEntryConfirmation(previous, closed, { decisionAt, held });
  const signal = advanced.signals.at(-1) ?? null;
  if (signal?.direction !== "ENTRY") return advanced;

  const trend = evaluateFiveMinuteTrend(closed, { decisionAt });
  if (!trend.eligible) {
    return {
      ...advanced,
      signals: [],
      discarded: trend.status,
      blockedEntryReason: trend.status,
      trendFilter: trend
    };
  }

  return {
    ...advanced,
    signals: [{
      ...signal,
      id: `${SPOT_PAPER_5M_TREND_FILTER_ID}:ENTRY:${signal.candleAt}`,
      strategyReason: "CONFIRM2_COOLDOWN10_AND_5M_SMA20_UPTREND"
    }],
    trendFilter: trend
  };
}

export function recordFiveMinuteTrendSell(state, executedAt) {
  return recordEntryConfirmationSell(state, executedAt);
}

export function diagnoseFiveMinuteTrendActivity({
  completedRoundTripCount, observedCoverageMs
} = {}) {
  if (!Number.isSafeInteger(completedRoundTripCount) ||
      completedRoundTripCount < 0 ||
      !Number.isSafeInteger(observedCoverageMs) ||
      observedCoverageMs < 0 ||
      observedCoverageMs > ACTIVITY_DIAGNOSTIC_WINDOW_MS) {
    throw new Error("INVALID_ACTIVITY_DIAGNOSTIC_INPUT");
  }
  const completeWindow = observedCoverageMs === ACTIVITY_DIAGNOSTIC_WINDOW_MS;
  const status = !completeWindow ? "PARTIAL_COVERAGE" :
    completedRoundTripCount < MIN_COMPLETED_ROUND_TRIPS ?
      "ACTIVITY_INSUFFICIENT" : "ACTIVITY_THRESHOLD_MET_DIAGNOSTIC_ONLY";
  return {
    schemaVersion: "BTC_EUR_5M_TREND_ACTIVITY_DIAGNOSTIC_V1",
    status,
    completedRoundTripCount,
    requiredCompletedRoundTrips: MIN_COMPLETED_ROUND_TRIPS,
    observedCoverageMs,
    requiredCoverageMs: ACTIVITY_DIAGNOSTIC_WINDOW_MS,
    completeWindow,
    forcedTrades: false,
    deadlineExtensionAllowed: false,
    profitability: "NOT_ASSESSED"
  };
}
