import { isDeepStrictEqual } from "node:util";
import {
  advanceStrategy, applyPaperObservation, createLedger, createStrategyState,
  parseKrakenOhlc, parseKrakenTicker, sha256, SPOT_PAPER_PILOT_LIMITS
} from "../spot-paper-pilot/core.mjs";
import {
  advanceEntryConfirmation, createEntryConfirmationState,
  recordEntryConfirmationSell, SPOT_PAPER_ENTRY_CONFIRMATION_ID
} from "./entry-confirmation.mjs";

export const SPOT_PAPER_RESEARCH_LIMITS = Object.freeze({
  maxCycles: Math.min(480, SPOT_PAPER_PILOT_LIMITS.maxCycles),
  maxInputBytes: SPOT_PAPER_PILOT_LIMITS.maxBytes,
  maxResponseBytes: SPOT_PAPER_PILOT_LIMITS.maxResponseBytes,
  maxCandlesPerSnapshot: 720,
  maxWorkUnits: 480 * (720 * 2 + 1)
});

const BASELINE_ID = "BTC_EUR_SMA5_SMA20_V1";
const CASH_ID = "CASH_NO_TRADE";
const isInteger = Number.isSafeInteger;

function unavailable(code, cycle = null) {
  return {
    schemaVersion: "SPOT_PAPER_SMA_COMPARISON_V1",
    status: "UNAVAILABLE",
    reason: code,
    cycle,
    arms: null
  };
}

function checkAcquisition(acquisition, name, byteCounter) {
  if (!acquisition || typeof acquisition !== "object" ||
      typeof acquisition.raw !== "string" ||
      !/^[a-f0-9]{64}$/.test(acquisition.sha256 ?? "") ||
      !isInteger(acquisition.requestStartedAt) ||
      !isInteger(acquisition.receivedAt) ||
      acquisition.requestStartedAt < 0 ||
      acquisition.receivedAt < acquisition.requestStartedAt) {
    throw new Error(`INVALID_${name}_ACQUISITION`);
  }
  const raw = Buffer.from(acquisition.raw, "utf8");
  if (raw.byteLength < 1 ||
      raw.byteLength > SPOT_PAPER_RESEARCH_LIMITS.maxResponseBytes ||
      sha256(raw) !== acquisition.sha256) {
    throw new Error(`INVALID_${name}_RESPONSE_BYTES`);
  }
  let decoded;
  try {
    decoded = JSON.parse(acquisition.raw);
  } catch {
    throw new Error(`INVALID_${name}_RESPONSE_JSON`);
  }
  if (!isDeepStrictEqual(decoded, acquisition.data)) {
    throw new Error(`${name}_RESPONSE_DATA_MISMATCH`);
  }
  byteCounter.value += raw.byteLength;
  if (byteCounter.value > SPOT_PAPER_RESEARCH_LIMITS.maxInputBytes) {
    throw new Error("INPUT_BYTE_LIMIT");
  }
  return acquisition;
}

function equityCents(ledger) {
  const marked = ledger.position ? ledger.lastMark?.netExitCents : 0;
  if (!isInteger(ledger.cashCents) || !isInteger(marked)) return null;
  const total = BigInt(ledger.cashCents) + BigInt(marked);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) ||
      total < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(total);
}

function addSafe(left, right) {
  const result = BigInt(left) + BigInt(right);
  if (result > BigInt(Number.MAX_SAFE_INTEGER) ||
      result < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(result);
}

function annotateFills(result, strategyId, candidate, executionAt) {
  const fills = result.fills.map(fill => {
    if (!candidate) return { ...fill, strategyId, executionAt };
    const strategyReason = fill.side === "BUY" ?
      "TWO_CONSECUTIVE_STRICT_FAST_ABOVE_SLOW" :
      fill.reason === "SAMPLED_2PCT_BID_STOP" ?
        "BASELINE_SAMPLED_2PCT_BID_STOP" : "BASELINE_IMMEDIATE_DOWN_CROSS";
    return {
      ...fill,
      ledgerReason: fill.reason,
      reason: strategyReason,
      strategyId,
      strategyReason,
      executionAt
    };
  });
  if (fills.length) {
    result.ledger.fills.splice(result.ledger.fills.length - fills.length, fills.length, ...fills);
  }
  return fills;
}

function makeArm(strategyId, candidate = false) {
  return {
    strategyId, candidate, strategy: candidate ?
      createEntryConfirmationState() : createStrategyState(),
    ledger: createLedger(), stopped: false, stopReason: null, terminalAt: null,
    previousAt: null, commonValuationAt: null,
    commonValuationStatus: "NOT_VALUED",
    exposureMs: 0, equitySamples: [SPOT_PAPER_PILOT_LIMITS.initialCashCents],
    grossTurnoverCents: 0, rejectedEntries: {}, discardedOpportunities: {},
    dataGaps: 0, fills: [], observationCount: 0, valuationCount: 0
  };
}

function increment(counts, reason) {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function entryRejectionReason(signal, before, result, quote) {
  if (signal?.direction !== "ENTRY" || result.fills.length) return null;
  if (before.position) return "POSITION_ALREADY_OPEN";
  if (result.lossLimitReached) return "SESSION_LOSS_LIMIT";
  if (quote.spreadBps > SPOT_PAPER_PILOT_LIMITS.maxEntrySpreadBps) {
    return "ENTRY_SPREAD_LIMIT";
  }
  return "LEDGER_ENTRY_NOT_FILLED";
}

function roundTrips(fills, terminalAt) {
  const trips = [];
  let open = null;
  for (const fill of fills) {
    if (fill.side === "BUY") {
      if (open) continue;
      open = fill;
    } else if (fill.side === "SELL" && open) {
      trips.push({
        entryFillId: open.id, exitFillId: fill.id,
        entryAt: open.executionAt, exitAt: fill.executionAt,
        holdingDurationMs: fill.executionAt - open.executionAt,
        exitReason: fill.reason,
        ...(fill.strategyReason ? { strategyReason: fill.strategyReason } : {})
      });
      open = null;
    }
  }
  return {
    completed: trips,
    open: open ? {
      entryFillId: open.id, entryAt: open.executionAt,
      holdingDurationMs: terminalAt === null ? null : terminalAt - open.executionAt
    } : null
  };
}

export function maximumSampledEquityDrawdown(samples) {
  if (!Array.isArray(samples) || !samples.length ||
      samples.some(equity => !isInteger(equity))) {
    throw new Error("INVALID_EQUITY_SAMPLES");
  }
  let peak = samples[0];
  let maxDrawdownCents = 0;
  let maxRelativeNumerator = 0n;
  let maxRelativeDenominator = 1n;
  for (const equity of samples.slice(1)) {
    if (!isInteger(equity)) continue;
    peak = Math.max(peak, equity);
    const drawdown = peak - equity;
    if (drawdown > maxDrawdownCents) maxDrawdownCents = drawdown;
    if (peak > 0 && BigInt(drawdown) * maxRelativeDenominator >
        maxRelativeNumerator * BigInt(peak)) {
      maxRelativeNumerator = BigInt(drawdown);
      maxRelativeDenominator = BigInt(peak);
    }
  }
  const maxRelativeDrawdownBps = Number(
    (maxRelativeNumerator * 10_000n * 2n + maxRelativeDenominator) /
      (maxRelativeDenominator * 2n));
  return { maxDrawdownCents, maxRelativeDrawdownBps };
}

function reportArm(arm) {
  const netEquityCents = equityCents(arm.ledger);
  const horizon = arm.commonValuationAt;
  const feesCents = arm.ledger.feesCents;
  const realizedPnlCents = arm.ledger.realizedPnlCents;
  const unrealizedPnlCents = arm.ledger.position ?
    arm.ledger.lastMark?.unrealizedPnlCents ?? null : 0;
  const trips = roundTrips(arm.fills, horizon);
  let drawdown = null;
  try {
    drawdown = maximumSampledEquityDrawdown(arm.equitySamples);
  } catch {
    drawdown = null;
  }
  const inventory = arm.ledger.position ? {
    quantitySat: arm.ledger.position.quantitySat,
    entryPriceNano: arm.ledger.position.entryPriceNano,
    entrySignalId: arm.ledger.position.entrySignalId,
    lastMark: arm.ledger.lastMark,
    markAgeAtEvaluationMs: arm.ledger.lastMark && horizon !== null ?
      horizon - arm.ledger.lastMark.receivedAt : null
  } : null;
  return {
    strategyId: arm.strategyId,
    stopped: arm.stopped,
    stopReason: arm.stopReason,
    tradingStoppedAt: arm.terminalAt,
    valuationAt: arm.commonValuationAt,
    valuationStatus: arm.commonValuationStatus,
    positionStatus: inventory ? "OPEN_UNRESOLVED_AT_HORIZON" : "FLAT",
    unresolvedTerminalInventory: inventory,
    initialCashCents: arm.ledger.initialCashCents,
    finalCashCents: arm.ledger.cashCents,
    finalNetEquityCents: netEquityCents,
    realizedPnlCents,
    unrealizedPnlCents,
    feesCents,
    grossTurnoverCents: arm.grossTurnoverCents,
    fills: arm.fills,
    fillCount: arm.fills.length,
    completedRoundTripCount: trips.completed.length,
    roundTrips: trips.completed,
    openRoundTrip: trips.open,
    rejectedEntries: arm.rejectedEntries,
    rejectedEntryCount: Object.values(arm.rejectedEntries).reduce((sum, count) => sum + count, 0),
    discardedOpportunities: arm.discardedOpportunities,
    discardedOpportunityCount: Object.values(arm.discardedOpportunities)
      .reduce((sum, count) => sum + count, 0),
    dataGaps: arm.dataGaps,
    timeExposure: {
      convention: "Sum of [observationAt, nextObservationAt) intervals while the position was open at the left endpoint; no pre-first or post-terminal extrapolation.",
      exposureMs: arm.exposureMs,
      sampledElapsedMs: arm.previousAt === null ? 0 :
        arm.previousAt - (arm.equitySamples.length > 1 ? arm.firstAt : arm.previousAt),
      exposureFraction: arm.previousAt === arm.firstAt ? 0 :
        arm.exposureMs / (arm.previousAt - arm.firstAt)
    },
    maxSampledEquityDrawdownCents: drawdown?.maxDrawdownCents ?? null,
    maxSampledEquityRelativeDrawdownBps: drawdown?.maxRelativeDrawdownBps ?? null,
    equityIncludesInitialCapitalSample: true,
    observationCount: arm.observationCount,
    valuationObservationCount: arm.valuationCount
  };
}

function applyArmObservation(arm, observation, quote, advanced) {
  if (arm.stopped) return;
  const { at } = observation;
  if (arm.previousAt !== null && arm.ledger.position) {
    arm.exposureMs += at - arm.previousAt;
  }
  if (advanced.missedDecisionWindow) arm.dataGaps++;
  arm.strategy = advanced.state;
  const signal = advanced.signals.at(-1) ?? null;
  const before = arm.ledger;
  const result = applyPaperObservation(before, { signal, quote, nowMs: at });
  const fills = annotateFills(result, arm.strategyId, arm.candidate, at);
  for (const fill of fills) {
    arm.fills.push(fill);
    arm.grossTurnoverCents += fill.grossCents;
  }
  const rejected = entryRejectionReason(signal, before, result, quote);
  if (rejected) increment(arm.rejectedEntries, rejected);
  arm.ledger = result.ledger;
  if (result.stopReason) {
    arm.stopped = true;
    arm.stopReason = result.stopReason;
    arm.terminalAt = at;
  }
  arm.previousAt = at;
  arm.commonValuationAt = at;
  arm.commonValuationStatus = "MARKED_AT_COMMON_HORIZON";
  if (arm.firstAt === undefined) arm.firstAt = at;
  arm.observationCount++;
  arm.valuationCount++;
  const equity = equityCents(arm.ledger);
  arm.equitySamples.push(equity);
}

function applyCandidateObservation(arm, observation, parsed, quote) {
  if (arm.stopped) return;
  const { at } = observation;
  if (arm.previousAt !== null && arm.ledger.position) {
    arm.exposureMs += at - arm.previousAt;
  }
  const advanced = advanceEntryConfirmation(arm.strategy, parsed.candles, {
    decisionAt: observation.decisionAt, held: Boolean(arm.ledger.position)
  });
  arm.strategy = advanced.state;
  if (advanced.missedDecisionWindow) arm.dataGaps++;
  if (advanced.discarded) increment(arm.discardedOpportunities, advanced.discarded);
  const signal = advanced.signals.at(-1) ?? null;
  const before = arm.ledger;
  const result = applyPaperObservation(before, { signal, quote, nowMs: at });
  const fills = annotateFills(result, arm.strategyId, true, at);
  for (const fill of fills) {
    arm.fills.push(fill);
    arm.grossTurnoverCents += fill.grossCents;
  }
  const rejected = entryRejectionReason(signal, before, result, quote);
  if (rejected) increment(arm.rejectedEntries, rejected);
  arm.ledger = result.ledger;
  if (fills.some(fill => fill.side === "SELL")) {
    arm.strategy = recordEntryConfirmationSell(arm.strategy, at);
  }
  if (result.stopReason) {
    arm.stopped = true;
    arm.stopReason = result.stopReason;
    arm.terminalAt = at;
  }
  arm.previousAt = at;
  arm.commonValuationAt = at;
  arm.commonValuationStatus = "MARKED_AT_COMMON_HORIZON";
  if (arm.firstAt === undefined) arm.firstAt = at;
  arm.observationCount++;
  arm.valuationCount++;
  arm.equitySamples.push(equityCents(arm.ledger));
}

function applyCashObservation(arm, at) {
  if (arm.previousAt !== null && arm.previousAt === at) return;
  if (arm.firstAt === undefined) arm.firstAt = at;
  arm.previousAt = at;
  arm.commonValuationAt = at;
  arm.commonValuationStatus = "MARKED_AT_COMMON_HORIZON";
  arm.observationCount++;
  arm.valuationCount++;
  arm.equitySamples.push(arm.ledger.cashCents);
}

function markStoppedArm(arm, observation, quote) {
  const { at } = observation;
  if (arm.previousAt !== null && arm.ledger.position) {
    arm.exposureMs += at - arm.previousAt;
    try {
      const valuationLedger = structuredClone(arm.ledger);
      valuationLedger.position.stopPriceNano = "0";
      const marked = applyPaperObservation(valuationLedger, {
        quote, nowMs: at, stopped: true
      });
      if (marked.ledger.position) {
        arm.ledger.lastMark = marked.ledger.lastMark;
        arm.commonValuationStatus = "MARKED_AT_COMMON_HORIZON";
      } else {
        arm.commonValuationStatus = "UNKNOWN_COMMON_HORIZON_MARK";
      }
    } catch {
      arm.commonValuationStatus = "UNKNOWN_COMMON_HORIZON_MARK";
    }
  } else if (arm.commonValuationStatus !== "UNKNOWN_COMMON_HORIZON_MARK") {
    arm.commonValuationStatus = "MARKED_AT_COMMON_HORIZON";
  }
  arm.previousAt = at;
  arm.commonValuationAt = at;
  arm.valuationCount++;
  arm.equitySamples.push(equityCents(arm.ledger));
}

export function compareSpotPaperStrategies(observations) {
  if (!Array.isArray(observations) || observations.length < 1 ||
      observations.length > SPOT_PAPER_RESEARCH_LIMITS.maxCycles) {
    throw new Error("OBSERVATION_COUNT_LIMIT");
  }
  let serialized;
  try {
    serialized = JSON.stringify(observations);
  } catch {
    throw new Error("INVALID_OBSERVATION_STREAM");
  }
  if (Buffer.byteLength(serialized, "utf8") >
      SPOT_PAPER_RESEARCH_LIMITS.maxInputBytes) {
    throw new Error("INPUT_BYTE_LIMIT");
  }

  const byteCounter = { value: 0 };
  const prepared = [];
  let workUnits = 0;
  let previousAt = null;
  for (let index = 0; index < observations.length; index++) {
    const observation = observations[index];
    if (!observation || typeof observation !== "object" ||
        !isInteger(observation.at) || observation.at < 0 ||
        !isInteger(observation.decisionAt) ||
        observation.decisionAt < 0 ||
        (previousAt !== null && observation.at <= previousAt)) {
      return unavailable("INVALID_OBSERVATION_TIME", index + 1);
    }
    previousAt = observation.at;
    let parsed;
    let quote;
    try {
      checkAcquisition(observation.ohlc, "OHLC", byteCounter);
      checkAcquisition(observation.ticker, "TICKER", byteCounter);
      if (observation.ohlc.receivedAt > observation.decisionAt ||
          observation.decisionAt > observation.ticker.requestStartedAt ||
          observation.ticker.requestStartedAt > observation.ticker.receivedAt ||
          observation.ticker.receivedAt > observation.at ||
          (index > 0 && observation.ohlc.requestStartedAt < observations[index - 1].at) ||
          observation.decisionAt > observation.at) {
        return unavailable(index > 0 &&
          observation.ohlc.requestStartedAt < observations[index - 1].at ?
          "NON_CHRONOLOGICAL_ACQUISITION" : "MISSING_CAUSAL_QUOTE", index + 1);
      }
      parsed = parseKrakenOhlc(observation.ohlc, observation.at);
      if (parsed.candles.length > SPOT_PAPER_RESEARCH_LIMITS.maxCandlesPerSnapshot) {
        return unavailable("CANDLE_SNAPSHOT_LIMIT", index + 1);
      }
      quote = parseKrakenTicker(observation.ticker, observation.at);
      workUnits += parsed.candles.length * 2 + 1;
      if (workUnits > SPOT_PAPER_RESEARCH_LIMITS.maxWorkUnits) {
        throw new Error("WORK_UNIT_LIMIT");
      }
    } catch (error) {
      return unavailable(error.message ?? "INVALID_MARKET_EVIDENCE", index + 1);
    }
    prepared.push({ cycle: index + 1, observation, parsed, quote });
  }

  const baseline = makeArm(BASELINE_ID);
  const challenger = makeArm(SPOT_PAPER_ENTRY_CONFIRMATION_ID, true);
  const cash = makeArm(CASH_ID);
  for (const { cycle, observation, parsed, quote } of prepared) {
    if (!baseline.stopped) {
      try {
        const baselineAdvanced = advanceStrategy(baseline.strategy, parsed.candles);
        applyArmObservation(baseline, observation, quote, baselineAdvanced);
      } catch (error) {
        return unavailable(error.message ?? "BASELINE_REPLAY_GAP", cycle);
      }
    } else {
      markStoppedArm(baseline, observation, quote);
    }
    if (!challenger.stopped) {
      try {
        applyCandidateObservation(challenger, observation, parsed, quote);
      } catch (error) {
        return unavailable(error.message ?? "CHALLENGER_REPLAY_GAP", cycle);
      }
    } else {
      markStoppedArm(challenger, observation, quote);
    }
    applyCashObservation(cash, observation.at);
  }

  const commonHorizonAt = observations.at(-1).at;
  const arms = {
    baseline: reportArm(baseline),
    challenger: reportArm(challenger),
    cash: reportArm(cash)
  };
  if (Object.values(arms).some(arm =>
    arm.valuationAt !== commonHorizonAt ||
    arm.valuationStatus !== "MARKED_AT_COMMON_HORIZON" ||
    (arm.unresolvedTerminalInventory &&
     (!arm.unresolvedTerminalInventory.lastMark ||
      arm.unresolvedTerminalInventory.markAgeAtEvaluationMs >
        SPOT_PAPER_PILOT_LIMITS.maxQuoteAgeMs)))) {
    return unavailable("COMMON_HORIZON_VALUATION_UNKNOWN");
  }
  for (const arm of Object.values(arms)) {
    const totalPnl = arm.unrealizedPnlCents === null ? null :
      addSafe(arm.realizedPnlCents, arm.unrealizedPnlCents);
    const expectedEquity = totalPnl === null ? null :
      addSafe(arm.initialCashCents, totalPnl);
    if (arm.finalNetEquityCents === null ||
        arm.maxSampledEquityDrawdownCents === null ||
        arm.maxSampledEquityRelativeDrawdownBps === null ||
        expectedEquity !== arm.finalNetEquityCents ||
        !isInteger(arm.feesCents) ||
        arm.grossTurnoverCents !== arm.fills.reduce((sum, fill) => sum + fill.grossCents, 0) ||
        arm.feesCents !== arm.fills.reduce((sum, fill) => sum + fill.feeCents, 0) ||
        addSafe(arm.finalCashCents,
          arm.unresolvedTerminalInventory ? arm.unresolvedTerminalInventory.lastMark?.netExitCents ?? 0 : 0) === null) {
      return unavailable("LEDGER_ACCOUNTING_UNKNOWN");
    }
  }
  return {
    schemaVersion: "SPOT_PAPER_SMA_COMPARISON_V1",
    status: "COMPARISON_AVAILABLE",
    commonHorizonAt,
    researchOnly: true,
    profitability: "NOT_ASSESSED",
    executionImpact: false,
    automaticPromotion: false,
    input: {
      observations: observations.length,
      maxCycles: SPOT_PAPER_RESEARCH_LIMITS.maxCycles,
      maxInputBytes: SPOT_PAPER_RESEARCH_LIMITS.maxInputBytes,
      responseBytes: byteCounter.value,
      workUnits,
      feeBpsPerSide: SPOT_PAPER_PILOT_LIMITS.feeBpsPerSide,
      slippageBpsPerSide: SPOT_PAPER_PILOT_LIMITS.slippageBpsPerSide,
      initialCashCents: SPOT_PAPER_PILOT_LIMITS.initialCashCents,
      maxEntryExposureCents: SPOT_PAPER_PILOT_LIMITS.maxExposureCents,
      maxEntrySpreadBps: SPOT_PAPER_PILOT_LIMITS.maxEntrySpreadBps
    },
    arms
  };
}
