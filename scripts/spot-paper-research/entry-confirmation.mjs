import {
  advanceStrategy, createStrategyState
} from "../spot-paper-pilot/core.mjs";

export const SPOT_PAPER_ENTRY_CONFIRMATION_ID =
  "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1";
export const ENTRY_COOLDOWN_MS = 600_000;

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function relation(closes) {
  if (closes.length < 21) return null;
  const prices = closes.map(candle => BigInt(candle.closeNano));
  const fast = prices.slice(-5).reduce((sum, price) => sum + price, 0n) * 4n;
  const slow = prices.slice(-20).reduce((sum, price) => sum + price, 0n);
  return fast > slow ? 1 : fast < slow ? -1 : 0;
}

export function createEntryConfirmationState() {
  return {
    strategy: createStrategyState(),
    pending: null,
    cooldownUntil: 0
  };
}

export function advanceEntryConfirmation(previous, candles, {
  decisionAt, held = false
} = {}) {
  if (!previous || !Array.isArray(previous.strategy?.closes) ||
      previous.strategy.closes.length > 21 ||
      (previous.strategy.cutoffAt !== null && !validTime(previous.strategy.cutoffAt)) ||
      (previous.strategy.lastSeenAt !== null && !validTime(previous.strategy.lastSeenAt)) ||
      typeof previous.strategy.warmupComplete !== "boolean" ||
      !Array.isArray(candles) || typeof held !== "boolean" || !validTime(decisionAt) ||
      !validTime(previous.cooldownUntil) ||
      (previous.pending !== null &&
       (!validTime(previous.pending.crossCandleAt) ||
        !validTime(previous.pending.lastConfirmedAt) ||
        typeof previous.pending.crossSignalId !== "string" ||
        previous.pending.crossCandleAt > previous.pending.lastConfirmedAt ||
        previous.pending.lastConfirmedAt !== previous.strategy.lastSeenAt))) {
    throw new Error("INVALID_ENTRY_CONFIRMATION_STATE");
  }

  const advanced = advanceStrategy(previous.strategy, candles);
  const state = {
    strategy: advanced.state,
    pending: structuredClone(previous.pending),
    cooldownUntil: previous.cooldownUntil
  };
  if (!advanced.newCandleCount) {
    return { state, signals: [], newCandleCount: 0 };
  }
  if (advanced.missedDecisionWindow) {
    state.pending = null;
    return {
      state, signals: [], newCandleCount: advanced.newCandleCount,
      missedDecisionWindow: true
    };
  }

  const candle = state.strategy.closes.at(-1);
  const direction = advanced.signals.at(-1)?.direction;
  if (direction === "EXIT") {
    state.pending = null;
    return {
      state,
      signals: [{
        id: `${SPOT_PAPER_ENTRY_CONFIRMATION_ID}:EXIT:${candle.timestamp}`,
        direction: "EXIT", candleAt: candle.timestamp, closeNano: candle.closeNano,
        decisionAt, strategyReason: "BASELINE_IMMEDIATE_DOWN_CROSS"
      }],
      newCandleCount: 1
    };
  }

  const currentRelation = relation(state.strategy.closes);
  if (held || currentRelation !== 1) {
    state.pending = null;
    return { state, signals: [], newCandleCount: 1 };
  }

  if (decisionAt < state.cooldownUntil) {
    const discarded = direction === "ENTRY" ? "COOLDOWN_ACTIVE" : null;
    state.pending = null;
    return { state, signals: [], newCandleCount: 1, discarded };
  }

  if (direction === "ENTRY") {
    state.pending = {
      crossCandleAt: candle.timestamp,
      lastConfirmedAt: candle.timestamp,
      crossSignalId: advanced.signals.at(-1).id
    };
    return { state, signals: [], newCandleCount: 1 };
  }

  if (!state.pending) {
    return { state, signals: [], newCandleCount: 1 };
  }
  if (candle.timestamp !== state.pending.lastConfirmedAt + 60_000) {
    state.pending = null;
    return { state, signals: [], newCandleCount: 1, missedDecisionWindow: true };
  }

  const pending = state.pending;
  state.pending = null;
  return {
    state,
    signals: [{
      id: `${SPOT_PAPER_ENTRY_CONFIRMATION_ID}:ENTRY_CONFIRM2:${candle.timestamp}`,
      direction: "ENTRY", candleAt: candle.timestamp, closeNano: candle.closeNano,
      decisionAt,
      confirmationStartedAt: pending.crossCandleAt,
      confirmedAt: candle.timestamp,
      crossSignalId: pending.crossSignalId,
      strategyReason: "TWO_CONSECUTIVE_STRICT_FAST_ABOVE_SLOW"
    }],
    newCandleCount: 1
  };
}

export function recordEntryConfirmationSell(state, executedAt) {
  if (!state || !validTime(executedAt) ||
      executedAt > Number.MAX_SAFE_INTEGER - ENTRY_COOLDOWN_MS) {
    throw new Error("INVALID_ENTRY_COOLDOWN_TIME");
  }
  return {
    ...state,
    pending: null,
    cooldownUntil: executedAt + ENTRY_COOLDOWN_MS
  };
}
