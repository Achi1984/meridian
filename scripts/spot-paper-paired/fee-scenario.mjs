import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readRunJournal } from "../spot-paper-pilot/journal.mjs";
import {
  advanceStrategy, createStrategyState, parseKrakenOhlc, parseKrakenTicker, sha256,
  SPOT_PAPER_PILOT_LIMITS, SPOT_PAPER_PILOT_VERSION
} from "../spot-paper-pilot/core.mjs";
import {
  pairedResearchSourceDigest, SPOT_PAPER_PAIRED,
  SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256
} from "./forward.mjs";
import {
  evaluatePairedPaperEvidence, SPOT_PAPER_PAIRED_MAX_HOST_EXPORT_BYTES
} from "../spot-paper-paired-report/evaluate.mjs";
import {
  SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_SCHEMA
} from "../spot-paper-paired-report/contract.mjs";
import {
  advanceEntryConfirmation, createEntryConfirmationState,
  recordEntryConfirmationSell
} from "../spot-paper-research/entry-confirmation.mjs";

export const SPOT_PAPER_PAIRED_FEE_SCENARIO_SCHEMA =
  "SPOT_PAPER_PAIRED_FEE_SCENARIO_REPLAY_V1";
export const SPOT_PAPER_PAIRED_FEE_SCENARIO_TYPE =
  "COUNTERFACTUAL_KRAKEN_FEED_OKX_FEE_SCENARIO";
export const SPOT_PAPER_PAIRED_FEE_RATES_BPS = Object.freeze([50, 20, 10]);
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const NOTIONAL_DIVISOR = 100_000_000_000_000n;
const CASH_CENTS = SPOT_PAPER_PILOT_LIMITS.initialCashCents;
const MAX_EXPOSURE_CENTS = SPOT_PAPER_PILOT_LIMITS.maxExposureCents;
const SESSION_LOSS_CENTS = SPOT_PAPER_PILOT_LIMITS.maxSessionLossCents;
const STOP_LOSS_BPS = SPOT_PAPER_PILOT_LIMITS.stopLossBps;
const MAX_ENTRY_SPREAD_BPS = SPOT_PAPER_PILOT_LIMITS.maxEntrySpreadBps;
const SLIPPAGE_BPS = SPOT_PAPER_PILOT_LIMITS.slippageBpsPerSide;
const HASH = /^[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const roles = ["baseline", "challenger", "cash"];
const isRecord = value => value !== null && typeof value === "object" &&
  !Array.isArray(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

async function readBoundedHandle(handle, maxBytes) {
  const chunks = [];
  let position = 0;
  while (position <= maxBytes) {
    const length = Math.min(64 * 1024, maxBytes + 1 - position);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (!bytesRead) break;
    chunks.push(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  assert(position <= maxBytes, "INPUT_FILE_LIMIT");
  return Buffer.concat(chunks, position);
}

function roundHalfUp(numerator, denominator) {
  return (numerator * 2n + denominator) / (2n * denominator);
}

function safeInteger(value, name) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) ||
      value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error(`${name}_OVERFLOW`);
  return Number(value);
}

function safeAdd(left, right, name) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    throw new Error(`${name}_OVERFLOW`);
  }
  return safeInteger(BigInt(left) + BigInt(right), name);
}

function notionalCents(quantitySat, priceNano) {
  return safeInteger(roundHalfUp(BigInt(quantitySat) * BigInt(priceNano),
    NOTIONAL_DIVISOR), "NOTIONAL");
}

function feeCents(notional, feeBpsPerSide) {
  return safeInteger(roundHalfUp(BigInt(notional) * BigInt(feeBpsPerSide),
    10_000n), "FEE");
}

function adjustedPrice(priceNano, bps) {
  return String(roundHalfUp(BigInt(priceNano) * BigInt(10_000 + bps), 10_000n));
}

function quantityForBudget(maxSpendCents, priceNano, feeBpsPerSide) {
  let low = 0n;
  const maximum = BigInt(maxSpendCents) * NOTIONAL_DIVISOR / BigInt(priceNano);
  let high = maximum > BigInt(Number.MAX_SAFE_INTEGER) ?
    BigInt(Number.MAX_SAFE_INTEGER) : maximum;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    const gross = notionalCents(middle, priceNano);
    if (safeAdd(gross, feeCents(gross, feeBpsPerSide), "ENTRY_COST") <= maxSpendCents) {
      low = middle;
    } else {
      high = middle - 1n;
    }
  }
  return safeInteger(low, "QUANTITY");
}

function markPosition(position, quote, feeBpsPerSide) {
  const exitPriceNano = adjustedPrice(quote.bidNano, -SLIPPAGE_BPS);
  const grossCents = notionalCents(position.quantitySat, exitPriceNano);
  const exitFeeCents = feeCents(grossCents, feeBpsPerSide);
  return {
    exitPriceNano, grossCents, exitFeeCents,
    unrealizedPnlCents: safeInteger(
      BigInt(grossCents) - BigInt(exitFeeCents) -
        BigInt(position.entryCostCents), "PNL")
  };
}

function createScenarioLedger() {
  return {
    initialCashCents: CASH_CENTS, cashCents: CASH_CENTS,
    realizedPnlCents: 0, feesCents: 0, position: null, lastMark: null, fills: []
  };
}

function applyScenarioObservation(previous, {
  signal = null, quote, nowMs, stopped = false, feeBpsPerSide
}) {
  const ledger = structuredClone(previous);
  const fills = [];
  let stopReason = null;
  const mark = ledger.position ? markPosition(ledger.position, quote, feeBpsPerSide) : null;
  if (mark) {
    ledger.lastMark = {
      bidNano: quote.bidNano, exitPriceNano: mark.exitPriceNano,
      receivedAt: quote.receivedAt, ageMs: nowMs - quote.receivedAt,
      unrealizedPnlCents: mark.unrealizedPnlCents,
      netExitCents: mark.grossCents - mark.exitFeeCents
    };
  }
  const sessionPnl = safeAdd(
    ledger.realizedPnlCents, mark?.unrealizedPnlCents ?? 0, "SESSION_PNL");
  const lossLimitReached = sessionPnl <= -SESSION_LOSS_CENTS;
  if (ledger.position && mark &&
      BigInt(quote.bidNano) <= BigInt(ledger.position.stopPriceNano)) {
    stopReason = "SAMPLED_2PCT_BID_STOP";
    const fill = {
      id: `exit:${ledger.position.entrySignalId}:stop`, side: "SELL",
      quantitySat: ledger.position.quantitySat, priceNano: mark.exitPriceNano,
      grossCents: mark.grossCents, feeCents: mark.exitFeeCents,
      reason: stopReason, signalAt: nowMs, quoteReceivedAt: quote.receivedAt
    };
    ledger.cashCents = safeAdd(ledger.cashCents,
      safeInteger(BigInt(mark.grossCents) - BigInt(mark.exitFeeCents),
        "EXIT_PROCEEDS"), "CASH");
    ledger.realizedPnlCents = safeAdd(ledger.realizedPnlCents,
      mark.unrealizedPnlCents, "REALIZED_PNL");
    ledger.feesCents = safeAdd(ledger.feesCents, mark.exitFeeCents, "FEES");
    ledger.position = null;
    ledger.lastMark = null;
    ledger.fills.push(fill);
    fills.push(fill);
  } else if (ledger.position && signal?.direction === "EXIT") {
    const fill = {
      id: `exit:${signal.id}`, side: "SELL",
      quantitySat: ledger.position.quantitySat, priceNano: mark.exitPriceNano,
      grossCents: mark.grossCents, feeCents: mark.exitFeeCents,
      reason: "SMA20_DOWN_CROSS", signalAt: signal.candleAt,
      quoteReceivedAt: quote.receivedAt
    };
    ledger.cashCents = safeAdd(ledger.cashCents,
      safeInteger(BigInt(mark.grossCents) - BigInt(mark.exitFeeCents),
        "EXIT_PROCEEDS"), "CASH");
    ledger.realizedPnlCents = safeAdd(ledger.realizedPnlCents,
      mark.unrealizedPnlCents, "REALIZED_PNL");
    ledger.feesCents = safeAdd(ledger.feesCents, mark.exitFeeCents, "FEES");
    ledger.position = null;
    ledger.lastMark = null;
    ledger.fills.push(fill);
    fills.push(fill);
  } else if (!ledger.position && !stopped && !lossLimitReached &&
      signal?.direction === "ENTRY" &&
      quote.spreadBps <= MAX_ENTRY_SPREAD_BPS) {
    const entryPriceNano = adjustedPrice(quote.askNano, SLIPPAGE_BPS);
    const quantitySat = quantityForBudget(
      Math.min(ledger.cashCents, MAX_EXPOSURE_CENTS),
      entryPriceNano, feeBpsPerSide);
    const grossCents = notionalCents(quantitySat, entryPriceNano);
    const entryFeeCents = feeCents(grossCents, feeBpsPerSide);
    const entryCostCents = safeAdd(grossCents, entryFeeCents, "ENTRY_COST");
    if (quantitySat > 0 && entryCostCents <= ledger.cashCents &&
        entryCostCents <= MAX_EXPOSURE_CENTS) {
      const fill = {
        id: `entry:${signal.id}`, side: "BUY", quantitySat,
        priceNano: entryPriceNano, grossCents, feeCents: entryFeeCents,
        reason: "SMA5_UP_CROSS", signalAt: signal.candleAt,
        quoteReceivedAt: quote.receivedAt
      };
      ledger.cashCents = safeInteger(
        BigInt(ledger.cashCents) - BigInt(entryCostCents), "CASH");
      ledger.feesCents = safeAdd(ledger.feesCents, entryFeeCents, "FEES");
      ledger.position = {
        quantitySat, entryPriceNano, entryGrossCents: grossCents,
        entryFeeCents, entryCostCents, entrySignalId: signal.id,
        stopPriceNano: String(roundHalfUp(BigInt(entryPriceNano) *
          BigInt(10_000 - STOP_LOSS_BPS), 10_000n))
      };
      const entryMark = markPosition(ledger.position, quote, feeBpsPerSide);
      ledger.lastMark = {
        bidNano: quote.bidNano, exitPriceNano: entryMark.exitPriceNano,
        receivedAt: quote.receivedAt, ageMs: nowMs - quote.receivedAt,
        unrealizedPnlCents: entryMark.unrealizedPnlCents,
        netExitCents: entryMark.grossCents - entryMark.exitFeeCents
      };
      ledger.fills.push(fill);
      fills.push(fill);
    }
  }
  if (lossLimitReached && !stopReason) stopReason = "SESSION_LOSS_LIMIT";
  return { ledger, fills, stopReason, lossLimitReached };
}

export function applySpotPaperPairedFeeObservation(previous, options) {
  return applyScenarioObservation(previous, options);
}

function markLedgerWithoutTrading(ledger, quote, at, feeBpsPerSide) {
  if (!ledger.position) return structuredClone(ledger);
  const input = structuredClone(ledger);
  input.position.stopPriceNano = "0";
  const result = applyScenarioObservation(input, {
    quote, nowMs: at, stopped: true, feeBpsPerSide
  });
  assert(result.fills.length === 0 &&
    result.ledger.position?.quantitySat === ledger.position.quantitySat &&
    result.ledger.position.entrySignalId === ledger.position.entrySignalId,
  "MARK_ONLY_CHANGED_ACCOUNT");
  return result.ledger;
}

function summarizeScenarioLedger(state, valuationAvailable, terminalAt) {
  const ledger = state.ledger;
  const open = ledger.position;
  const markAgeMs = ledger.lastMark ? terminalAt - ledger.lastMark.receivedAt : null;
  const marked = !open || Boolean(ledger.lastMark && valuationAvailable &&
    markAgeMs >= 0 && markAgeMs <= SPOT_PAPER_PILOT_LIMITS.maxQuoteAgeMs);
  return {
    feesCents: ledger.feesCents,
    startingCapitalCents: ledger.initialCashCents,
    netEquityCents: marked ?
      ledger.cashCents + (open ? ledger.lastMark.netExitCents : 0) : null,
    markedEquityCents: marked ?
      ledger.cashCents + (open ? ledger.lastMark.netExitCents : 0) : null,
    sampledDrawdownCents: state.sampledDrawdownCents ?? 0,
    exposureCents: open ? open.entryGrossCents : 0,
    turnoverCents: ledger.fills.reduce((sum, fill) => sum + fill.grossCents, 0),
    openPositions: open ? [{
      quantitySat: open.quantitySat, entrySignalId: open.entrySignalId
    }] : [],
    unresolvedObservations: marked ? 0 : (open ? 1 : 0),
    markAgeMs: marked && open ? markAgeMs : null
  };
}

function referencePrice(fill, quote) {
  return BigInt(fill.side === "BUY" ? quote.askNano : quote.bidNano);
}

function slippageForFillCents(fill, quote) {
  const reference = referencePrice(fill, quote);
  const execution = BigInt(fill.priceNano);
  const adverse = fill.side === "BUY" ? execution - reference : reference - execution;
  assert(adverse >= 0n && fill.quantitySat > 0, "INVALID_FILL_SLIPPAGE");
  return Number((BigInt(fill.quantitySat) * adverse * 2n +
    100_000_000_000_000n) / 200_000_000_000_000n);
}

function cleanDecision(result) {
  const decision = { ...result };
  delete decision.state;
  return decision;
}

export function replaySpotPaperFeeScenarioObservations(observations, {
  feeBpsPerSide = SPOT_PAPER_PAIRED.feeBpsPerSide
} = {}) {
  assert(SPOT_PAPER_PAIRED_FEE_RATES_BPS.includes(feeBpsPerSide),
    "UNSUPPORTED_FEE_SCENARIO");
  assert(Array.isArray(observations) && observations.length > 0 &&
    observations.length <= SPOT_PAPER_PAIRED.maxCycles,
  "OBSERVATION_COUNT_LIMIT");
  let serialized;
  try {
    serialized = JSON.stringify(observations);
  } catch {
    throw new Error("INVALID_OBSERVATION_STREAM");
  }
  assert(Buffer.byteLength(serialized, "utf8") <= MAX_EVIDENCE_BYTES,
    "EVIDENCE_BYTE_LIMIT");

  const states = [
    { strategy: createStrategyState(), ledger: createScenarioLedger(),
      valuationLedger: createScenarioLedger(), stopped: false },
    { strategy: createEntryConfirmationState(), ledger: createScenarioLedger(),
      valuationLedger: createScenarioLedger(), stopped: false },
    { cashCents: CASH_CENTS, fills: [] }
  ];
  const decisions = roles.map(() => []);
  const fills = roles.map(() => []);
  const riskStates = roles.map(() => []);
  const slippageTotals = roles.map(() => 0);
  const highWater = roles.map(() => CASH_CENTS);
  const maxDrawdown = roles.map(() => 0);
  let totalResponseBytes = 0;
  let finalSummaries = [];

  for (let cycle = 0; cycle < observations.length; cycle++) {
    const observation = observations[cycle];
    const previousEffectAt = cycle ? observations[cycle - 1].effectAt : null;
    assert(isRecord(observation) && Number.isSafeInteger(observation.decisionAt) &&
      Number.isSafeInteger(observation.effectAt) &&
      observation.decisionAt <= observation.effectAt &&
      (previousEffectAt === null || observation.effectAt > previousEffectAt),
    "INVALID_OBSERVATION_TIME");
    if (observation.decisions !== undefined) {
      assert(Array.isArray(observation.decisions) &&
        observation.decisions.length === roles.length, "INVALID_ARM_DECISION_TIME");
    }
    const decisionTimes = observation.decisions === undefined ?
      roles.map(() => observation.decisionAt) :
      observation.decisions.map((item, index) => {
        assert(item?.role === roles[index] &&
          Number.isSafeInteger(item.decidedAt), "INVALID_ARM_DECISION_TIME");
        return item.decidedAt;
      });
    assert(decisionTimes.length === roles.length &&
      Math.max(...decisionTimes) === observation.decisionAt,
    "INVALID_ARM_DECISION_TIME");
    for (const response of [observation.ohlc, observation.ticker]) {
      assert(isRecord(response) && typeof response.raw === "string" &&
        HASH.test(response.sha256 ?? "") &&
        sha256(Buffer.from(response.raw, "utf8")) === response.sha256 &&
        Buffer.byteLength(response.raw, "utf8") <= MAX_RESPONSE_BYTES &&
        Number.isSafeInteger(response.requestStartedAt) &&
        Number.isSafeInteger(response.receivedAt) &&
        response.receivedAt >= response.requestStartedAt &&
        stableJson(JSON.parse(response.raw)) === stableJson(response.data),
      "INVALID_RESPONSE_BYTES");
      totalResponseBytes += Buffer.byteLength(response.raw, "utf8");
    }
    assert(totalResponseBytes <= MAX_EVIDENCE_BYTES, "EVIDENCE_BYTE_LIMIT");
    assert(previousEffectAt === null ||
      observation.ohlc.requestStartedAt >= previousEffectAt,
    "NON_CHRONOLOGICAL_ACQUISITION");
    assert(decisionTimes.every(at => observation.ohlc.receivedAt <= at),
      "DECISION_PRECEDES_OHLC");
    assert(decisionTimes.every(at => at <= observation.ticker.requestStartedAt),
      "DECISION_AFTER_TICKER_START");
    assert(decisionTimes.every(at => at <= observation.effectAt),
      "DECISION_AFTER_EFFECT");
    assert(observation.ticker.requestStartedAt <= observation.ticker.receivedAt &&
      observation.ticker.receivedAt <= observation.effectAt,
    "MISSING_CAUSAL_QUOTE");

    const quote = parseKrakenTicker(observation.ticker, observation.effectAt);
    const effectResults = roles.map((role, index) => {
      const armDecisionAt = decisionTimes[index];
      const before = structuredClone(states[index]);
      if (before.stopped) {
        return {
          state: before, decision: {
            state: before, decision: null, decidedAt: armDecisionAt,
            skippedReason: "ARM_STOPPED",
            metadata: { stoppedAt: before.stoppedAt ?? null,
              stopReason: before.stopReason ?? null }
          },
          effect: { state: before, fills: [], stopReason: before.stopReason ?? null,
            riskState: { stopped: true, reason: before.stopReason ?? null,
                stopReason: before.stopReason ?? null,
                stoppedAt: before.stoppedAt ?? null } }
        };
      }
      const parsed = parseKrakenOhlc(observation.ohlc, armDecisionAt);
      assert(parsed.candles.length <= 720, "CANDLE_SNAPSHOT_LIMIT");
      let decision;
      if (role === "cash") {
        decision = {
          state: null, decision: null, decidedAt: armDecisionAt,
          metadata: { control: "NO_TRADE" }
        };
      } else if (role === "baseline") {
        const advanced = advanceStrategy(before.strategy, parsed.candles);
        decision = {
          state: { ...before, strategy: advanced.state },
          decision: advanced.signals.at(-1) ?? null,
          decidedAt: armDecisionAt,
          metadata: { newCandleCount: advanced.newCandleCount,
            missedDecisionWindow: Boolean(advanced.missedDecisionWindow) }
        };
      } else {
        const advanced = advanceEntryConfirmation(before.strategy, parsed.candles, {
          decisionAt: armDecisionAt,
          held: Boolean(before.ledger.position)
        });
        decision = {
          state: { ...before, strategy: advanced.state },
          decision: advanced.signals.at(-1) ?? null,
          decidedAt: armDecisionAt,
          metadata: { newCandleCount: advanced.newCandleCount,
            missedDecisionWindow: Boolean(advanced.missedDecisionWindow),
            discarded: advanced.discarded ?? null }
        };
      }
      assert(isRecord(decision) && Object.hasOwn(decision, "decision"),
        "INVALID_ARM_DECISION");
      let effect;
      if (role === "cash") {
        effect = {
          state: before, fills: [], stopReason: null,
          riskState: { noTrade: true }
        };
      } else {
        const result = applyScenarioObservation(before.ledger, {
          signal: decision.decision, quote, nowMs: observation.effectAt,
          feeBpsPerSide
        });
        const candidateFills = role === "challenger" ?
          result.fills.map(fill => {
            const strategyReason = fill.side === "BUY" ?
              decision.decision?.strategyReason :
              fill.reason === "SAMPLED_2PCT_BID_STOP" ?
                "BASELINE_SAMPLED_2PCT_BID_STOP" :
                decision.decision?.strategyReason;
            return {
              ...fill, ledgerReason: fill.reason,
              strategyId: SPOT_PAPER_PAIRED.challengerModel,
              ...(strategyReason ? { reason: strategyReason, strategyReason } : {})
            };
          }) : result.fills;
        if (role === "challenger" && candidateFills.length) {
          result.ledger.fills.splice(result.ledger.fills.length - candidateFills.length,
            candidateFills.length, ...candidateFills);
        }
        const strategy = role === "challenger" &&
          candidateFills.some(fill => fill.side === "SELL") ?
          recordEntryConfirmationSell(decision.state.strategy, observation.effectAt) :
          decision.state.strategy;
        effect = {
          state: { ...before, strategy, ledger: result.ledger,
            stopped: before.stopped || Boolean(result.stopReason) },
          fills: candidateFills, stopReason: result.stopReason,
          stoppedAt: result.stopReason ? observation.effectAt : null,
          riskState: { lossLimitReached: result.lossLimitReached }
        };
      }
      assert(isRecord(effect) && Array.isArray(effect.fills) &&
        isRecord(effect.riskState), "INVALID_ARM_EFFECT");
      return { state: before, decision, effect };
    });

    const nextStates = effectResults.map(({ effect }, index) => {
      const next = structuredClone(effect.state);
      if (index === 2) return next;
      next.valuationLedger = states[index].stopped ?
        markLedgerWithoutTrading(states[index].ledger, quote,
          observation.effectAt, feeBpsPerSide) :
        structuredClone(next.ledger ?? next.valuationLedger);
      if (states[index].stopped || effect.stopReason) {
        next.stopped = true;
        next.stopReason ??= states[index].stopReason ?? effect.stopReason;
        next.stoppedAt ??= states[index].stoppedAt ??
          effect.stoppedAt ?? observation.effectAt;
      }
      return next;
    });

    const summaries = roles.map((role, index) => {
      const result = role === "cash" ? {
        startingCapitalCents: CASH_CENTS,
        feesCents: 0, netEquityCents: nextStates[index].cashCents,
        markedEquityCents: nextStates[index].cashCents,
        sampledDrawdownCents: 0, exposureCents: 0, turnoverCents: 0,
        openPositions: [], unresolvedObservations: 0, markAgeMs: null
      } : summarizeScenarioLedger({
        ...nextStates[index], ledger: nextStates[index].valuationLedger
      }, true, observation.effectAt);
      const equity = result.netEquityCents;
      if (Number.isSafeInteger(equity)) {
        highWater[index] = Math.max(highWater[index], equity);
        maxDrawdown[index] = Math.max(maxDrawdown[index],
          highWater[index] - equity);
      }
      result.sampledDrawdownCents = maxDrawdown[index];
      return result;
    });

    effectResults.forEach(({ decision, effect }, index) => {
      decisions[index].push(cleanDecision(decision));
      fills[index].push(...effect.fills.map(fill => ({
        ...fill, executionAt: observation.effectAt
      })));
      riskStates[index].push({
        ...effect.riskState,
        ...(nextStates[index].stopped ? {
          stopReason: nextStates[index].stopReason,
          stoppedAt: nextStates[index].stoppedAt
        } : {})
      });
      slippageTotals[index] += effect.fills.reduce((sum, fill) =>
        sum + slippageForFillCents(fill, quote), 0);
    });
    states.splice(0, states.length, ...nextStates);
    summaries.forEach((summary, index) => {
      summary.slippageCents = slippageTotals[index];
      summary.modeledCostsCents = summary.feesCents + slippageTotals[index];
    });
    finalSummaries = summaries;
  }

  return {
    feeBpsPerSide,
    slippageBpsPerSide: SPOT_PAPER_PAIRED.slippageBpsPerSide,
    commonHorizonAt: observations.at(-1).effectAt,
    arms: roles.map((role, index) => ({
      role,
      modelId: role === "baseline" ? SPOT_PAPER_PILOT_VERSION :
        role === "challenger" ? SPOT_PAPER_PAIRED.challengerModel :
          SPOT_PAPER_PAIRED.controlModel,
      tradingStatus: states[index].stopped ? "STOPPED" : "ACTIVE",
      stopReason: states[index].stopReason ?? null,
      stoppedAt: states[index].stoppedAt ?? null,
      decisions: decisions[index], fills: fills[index],
      riskStates: riskStates[index],
      valuation: {
        ...finalSummaries[index],
        openPositions: finalSummaries[index].openPositions
      },
      finalCashCents: index === 2 ? states[index].cashCents :
        states[index].ledger.cashCents,
      terminalPosition: index === 2 ? null :
        states[index].valuationLedger?.position ??
          states[index].ledger.position ?? null,
      lastMark: index === 2 ? null :
        states[index].valuationLedger?.lastMark ??
          states[index].ledger.lastMark ?? null
    }))
  };
}

export function compareSpotPaperFeeScenarioObservations(observations, {
  feeBpsPerSide = SPOT_PAPER_PAIRED.feeBpsPerSide
} = {}) {
  const replay = replaySpotPaperFeeScenarioObservations(observations, {
    feeBpsPerSide
  });
  return {
    schemaVersion: "SPOT_PAPER_SMA_COMPARISON_V1",
    status: "COMPARISON_AVAILABLE",
    commonHorizonAt: replay.commonHorizonAt,
    arms: Object.fromEntries(replay.arms.map(arm => {
      const position = arm.terminalPosition;
      return [arm.role, {
        strategyId: arm.role === "cash" ? "CASH_NO_TRADE" : arm.modelId,
        valuationAt: replay.commonHorizonAt,
        valuationStatus: arm.valuation.unresolvedObservations === 0 ?
          "MARKED_AT_COMMON_HORIZON" : "UNKNOWN_COMMON_HORIZON_MARK",
        positionStatus: position ? "OPEN_UNRESOLVED_AT_HORIZON" : "FLAT",
        unresolvedTerminalInventory: position ? {
          quantitySat: position.quantitySat,
          entrySignalId: position.entrySignalId,
          lastMark: arm.lastMark
        } : null,
        initialCashCents: CASH_CENTS,
        finalCashCents: arm.finalCashCents,
        finalNetEquityCents: arm.valuation.netEquityCents,
        feesCents: arm.valuation.feesCents,
        grossTurnoverCents: arm.valuation.turnoverCents,
        fills: arm.fills,
        fillCount: arm.fills.length,
        stopped: arm.tradingStatus === "STOPPED",
        stopReason: arm.stopReason,
        tradingStoppedAt: arm.stoppedAt
      }];
    }))
  };
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

async function readEvidenceResponse(runDirectory, reference) {
  assert(isRecord(reference) && typeof reference.path === "string" &&
    /^responses\/[a-f0-9]{64}\.json$/.test(reference.path) &&
    reference.path === `responses/${reference.sha256}.json` &&
    Number.isSafeInteger(reference.bytes) && reference.bytes > 0 &&
    reference.bytes <= MAX_RESPONSE_BYTES &&
    Number.isSafeInteger(reference.requestStartedAt) &&
    Number.isSafeInteger(reference.receivedAt) &&
    reference.receivedAt >= reference.requestStartedAt,
  "INVALID_RESPONSE_REFERENCE");
  const path = join(runDirectory, reference.path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    assert(info.isFile() && info.size === reference.bytes &&
      info.size <= MAX_RESPONSE_BYTES, "INVALID_RESPONSE_FILE");
    const bytes = await readBoundedHandle(handle, MAX_RESPONSE_BYTES);
    assert(bytes.length === reference.bytes &&
      sha256(bytes) === reference.sha256, "RESPONSE_CHECKSUM_MISMATCH");
    const raw = bytes.toString("utf8");
    const data = JSON.parse(raw);
    return {
      raw, data, sha256: reference.sha256, bytes: bytes.length,
      requestStartedAt: reference.requestStartedAt,
      receivedAt: reference.receivedAt
    };
  } finally {
    await handle.close();
  }
}

function assertOriginalReplayMatches(report, baselineReplay) {
  assert(report.arms.length === 3, "INVALID_ORIGINAL_REPORT");
  for (let index = 0; index < roles.length; index++) {
    const original = report.arms[index];
    const replay = baselineReplay.arms[index];
    const valuation = original.valuation;
    assert(original.role === roles[index] &&
      same(original.decisions, replay.decisions) &&
      same(original.fills, replay.fills) &&
      same(original.riskStates, replay.riskStates) &&
      valuation.feesCents === replay.valuation.feesCents &&
      valuation.slippageCents === replay.valuation.slippageCents &&
      valuation.turnoverCents === replay.valuation.turnoverCents &&
      valuation.exposureCents === replay.valuation.exposureCents &&
      valuation.sampledDrawdownCents === replay.valuation.sampledDrawdownCents &&
      same(valuation.openPositions, replay.valuation.openPositions) &&
      (valuation.netEquityCents === null ||
        valuation.netEquityCents === replay.valuation.netEquityCents),
    "ORIGINAL_50BPS_REPLAY_MISMATCH");
  }
}

async function verifiedJournalChecksum(runDirectory) {
  const handle = await open(join(runDirectory, "journal.json"),
    constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    assert(info.isFile() && info.size <= MAX_JOURNAL_BYTES, "JOURNAL_SIZE_LIMIT");
    const bytes = await readBoundedHandle(handle, MAX_JOURNAL_BYTES);
    const envelope = JSON.parse(bytes.toString("utf8"));
    assert(isRecord(envelope?.payload) && HASH.test(envelope.sha256 ?? "") &&
      sha256(Buffer.from(JSON.stringify(envelope.payload), "utf8")) === envelope.sha256,
    "JOURNAL_CHECKSUM_MISMATCH");
    return envelope.sha256;
  } finally {
    await handle.close();
  }
}

export async function replayVerifiedSpotPaperFeeScenarios({
  expectedIdentity, hostExport, dataRoot
} = {}) {
  assert(isRecord(expectedIdentity) &&
    expectedIdentity.schemaVersion === SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_SCHEMA &&
    isRecord(hostExport) &&
    hostExport.schemaVersion === "SPOT_PAPER_PAIRED_HOST_EXPORT_V1" &&
    hostExport.status === "TERMINAL_JOURNAL_VERIFIED" &&
    hostExport.verifiedTerminal === true &&
    hostExport.reconciliationStatus === "READ_ONLY_VERIFIED" &&
    typeof dataRoot === "string" && resolve(dataRoot) === dataRoot &&
    RUN_ID.test(expectedIdentity.runId ?? "") &&
    expectedIdentity.runId === hostExport.runId,
  "VERIFIED_HOST_EXPORT_REQUIRED");
  const evidenceAssessment = evaluatePairedPaperEvidence({
    expectedIdentity, report: hostExport
  });
  assert(evidenceAssessment.evidenceStatus === "VERIFIED_COMPLETE",
    "HOST_EVIDENCE_NOT_VERIFIED_COMPLETE");
  assert(hostExport.report?.feedSourceId === "KRAKEN_PUBLIC_SPOT_XBTEUR" &&
    hostExport.report.testOnly === false, "LIVE_KRAKEN_EVIDENCE_REQUIRED");
  const [comparisonBytes, entryConfirmationBytes] = await Promise.all([
    readFile(new URL("../spot-paper-research/comparison.mjs", import.meta.url)),
    readFile(new URL("../spot-paper-research/entry-confirmation.mjs", import.meta.url))
  ]);
  const researchSourceSha256 = pairedResearchSourceDigest({
    comparisonBytes, entryConfirmationBytes
  });
  assert(researchSourceSha256 === SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256 &&
    researchSourceSha256 === hostExport.report.researchSourceSha256,
  "RESEARCH_SOURCE_IDENTITY_MISMATCH");

  const context = {
    deadlineAt: performance.now() + 60_000,
    monotonicNow: () => performance.now()
  };
  const journalHandle = await open(join(dataRoot, expectedIdentity.runId, "journal.json"),
    constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await journalHandle.stat();
    assert(info.isFile() && info.size <= MAX_JOURNAL_BYTES, "JOURNAL_SIZE_LIMIT");
  } finally {
    await journalHandle.close();
  }
  const journal = await readRunJournal({
    dataRoot, runId: expectedIdentity.runId, ...context
  });
  assert(journal.reconciliationStatus === "READ_ONLY_VERIFIED" &&
    stableJson({
      schemaVersion: journal.schemaVersion, runId: journal.runId,
      sequence: journal.sequence, checkpoint: journal.checkpoint,
      manifest: journal.manifest, events: journal.events,
      reconciliationStatus: journal.reconciliationStatus
    }) === stableJson(hostExport.journal),
  "HOST_EXPORT_JOURNAL_MISMATCH");
  assert(journal.events.at(-1)?.type === "terminal" &&
    stableJson(journal.events.at(-1).report) === stableJson(hostExport.report),
  "HOST_EXPORT_REPORT_MISMATCH");
  const observations = journal.events.filter(event =>
    event?.type === "shared_observation");
  assert(observations.length > 0 && observations.length <= SPOT_PAPER_PAIRED.maxCycles,
    "OBSERVATION_COUNT_LIMIT");

  const runDirectory = join(dataRoot, expectedIdentity.runId);
  const originalReport = structuredClone(hostExport.report);
  const marketObservations = [];
  let responseBytes = 0;
  let priorEffectAt = originalReport.startedAt;
  for (let index = 0; index < observations.length; index++) {
    const event = observations[index];
    assert(event.cycle === index + 1 &&
      Number.isSafeInteger(event.decisionAt) &&
      Number.isSafeInteger(event.effectAt) &&
      event.observedAt === event.effectAt &&
      event.ohlc?.requestStartedAt >= priorEffectAt &&
      event.effectAt > priorEffectAt,
    "INVALID_JOURNAL_OBSERVATION");
    const [ohlc, ticker] = await Promise.all([
      readEvidenceResponse(runDirectory, event.ohlc),
      readEvidenceResponse(runDirectory, event.ticker)
    ]);
    responseBytes += ohlc.bytes + ticker.bytes;
    assert(responseBytes <= MAX_EVIDENCE_BYTES, "EVIDENCE_BYTE_LIMIT");
    marketObservations.push({
      decisionAt: event.decisionAt, decisions: event.decisions,
      effectAt: event.effectAt, ohlc, ticker
    });
    priorEffectAt = event.effectAt;
  }
  const lastObservation = marketObservations.at(-1);
  const quoteAgeAtEffectMs =
    lastObservation.effectAt - lastObservation.ticker.receivedAt;
  assert(quoteAgeAtEffectMs >= 0 &&
    quoteAgeAtEffectMs <= SPOT_PAPER_PAIRED.maxQuoteAgeMs,
  "NO_VALID_HISTORICAL_COMMON_HORIZON");

  const scenarios = SPOT_PAPER_PAIRED_FEE_RATES_BPS.map(feeBpsPerSide =>
    replaySpotPaperFeeScenarioObservations(marketObservations, { feeBpsPerSide }));
  assertOriginalReplayMatches(originalReport, scenarios[0]);
  const scenarioDescriptions = {
    50: "ORIGINAL_PAIRED_RUN_ASSUMPTION",
    20: "COUNTERFACTUAL_REGULAR_EEA_SPOT_TAKER",
    10: "COUNTERFACTUAL_X_PERPS_ACCOUNT_SPOT_TAKER"
  };
  scenarios.forEach(scenario => {
    scenario.scenario = scenarioDescriptions[scenario.feeBpsPerSide];
    scenario.actualOkxFills = false;
    scenario.actualAccountFees = false;
  });
  if (originalReport.comparison?.status === "COMPARISON_AVAILABLE") {
    assert(originalReport.comparison.commonHorizonAt ===
      scenarios[0].commonHorizonAt, "ORIGINAL_COMPARISON_HORIZON_MISMATCH");
    for (const arm of scenarios[0].arms) {
      const originalComparison = originalReport.comparison.arms[arm.role];
      assert(originalComparison &&
        originalComparison.finalNetEquityCents === arm.valuation.netEquityCents &&
        originalComparison.feesCents === arm.valuation.feesCents &&
        originalComparison.grossTurnoverCents === arm.valuation.turnoverCents,
      "ORIGINAL_COMPARISON_REPLAY_MISMATCH");
    }
  }
  const journalPayloadSha256 = await verifiedJournalChecksum(runDirectory);
  const originalReportCanonicalSha256 = createHash("sha256")
    .update(JSON.stringify(originalReport)).digest("hex");
  const hostExportCanonicalSha256 = createHash("sha256")
    .update(JSON.stringify(hostExport)).digest("hex");
  return {
    schemaVersion: SPOT_PAPER_PAIRED_FEE_SCENARIO_SCHEMA,
    scenarioType: SPOT_PAPER_PAIRED_FEE_SCENARIO_TYPE,
    evidenceStatus: "VERIFIED_COMPLETE",
    evidenceQualification: "STRUCTURALLY_RECONCILED_NOT_INDEPENDENTLY_AUTHENTICATED",
    executionImpact: false,
    autoPromotion: false,
    actualOkxFills: false,
    actualAccountFees: false,
    provenance: {
      sourceFeedId: originalReport.feedSourceId,
      sourceSha256: originalReport.sourceSha256,
      configSha256: originalReport.configSha256,
      researchSourceSha256: originalReport.researchSourceSha256,
      originalReportCanonicalSha256,
      hostExportCanonicalSha256,
      journalPayloadSha256,
      scenarioAsOf: "2026-11-09",
      effectiveAt: "2026-09-25",
      accountTier: "UNKNOWN",
      executionStyle: "TAKER_MARKET_STYLE",
      slippageBpsPerSide: SPOT_PAPER_PAIRED.slippageBpsPerSide
    },
    sources: {
      regularEeaSpot: {
        url: "https://www.okx.com/en-eu/help/important-notice-upcoming-spot-fee-adjustment-eea",
        makerBps: 10, takerBps: 20,
        note: "Regular EEA spot-only taker assumption; maker fills are not modeled."
      },
      xPerpsAccountSpot: {
        url: "https://www.okx.com/en-eu/help/what-are-the-new-trading-fees-for-eea-users",
        makerBps: 8, takerBps: 10,
        note: "Optional X-Perps-account spot taker assumption; account eligibility is unverified."
      }
    },
    originalReport,
    replayAgreement: "ORIGINAL_50BPS_DECISIONS_FILLS_RISK_AND_ACCOUNTING_MATCHED",
    scenarios
  };
}

async function readJsonFile(path, maxBytes) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    assert(info.isFile() && info.size <= maxBytes, "INPUT_FILE_LIMIT");
    const bytes = await readBoundedHandle(handle, maxBytes);
    assert(bytes.length <= maxBytes, "INPUT_FILE_LIMIT");
    return JSON.parse(bytes.toString("utf8"));
  } finally {
    await handle.close();
  }
}

export async function main(argv = process.argv.slice(2), { output = process.stdout } = {}) {
  const [expectedIdentityPath, hostExportPath, dataRoot] = argv;
  if (!expectedIdentityPath || !hostExportPath || !dataRoot || argv.length !== 3) {
    process.stderr.write(
      "Usage: node scripts/spot-paper-paired/fee-scenario.mjs <expected-identity.json> <host-export.json> <data-root>\n"
    );
    process.exitCode = 2;
    return null;
  }
  const [expectedIdentity, hostExport] = await Promise.all([
    readJsonFile(expectedIdentityPath, 16 * 1024),
    readJsonFile(hostExportPath, SPOT_PAPER_PAIRED_MAX_HOST_EXPORT_BYTES)
  ]);
  const result = await replayVerifiedSpotPaperFeeScenarios({
    expectedIdentity, hostExport, dataRoot: resolve(dataRoot)
  });
  output.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
