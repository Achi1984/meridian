import {
  canonical, decimalAtoms, freezeDeep, identifier, integer, record, validateUsdQuote
} from "./account-contract.mjs";
import {
  MAX_USD_ACCOUNT_JOURNAL_EVENTS, MAX_USD_ACCOUNT_WINDOW_MS
} from "./account-store.mjs";
import {PAPER_CAPITAL_CHALLENGE_POLICY as POLICY} from "./policy.mjs";

const OBSERVATION_KEYS = ["id", "observedAtMs", "quote"];
const DECISION_KEYS = ["action", "quantityBtc", "reason"];
const STRATEGY_ACTIONS = ["BUY", "SELL", "HOLD", "SKIP_ENTRY"];

function normalizeObservation(input) {
  record(input, OBSERVATION_KEYS, "OFFLINE_OBSERVATION");
  identifier(input.id, "OBSERVATION_ID");
  integer(input.observedAtMs, "OBSERVATION_TIME");
  return freezeDeep({
    id: input.id,
    observedAtMs: input.observedAtMs,
    quote: Object.freeze(validateUsdQuote(input.quote, input.observedAtMs))
  });
}

function normalizeDecision(input) {
  record(input, DECISION_KEYS, "STRATEGY_DECISION");
  if (!STRATEGY_ACTIONS.includes(input.action)) throw new Error("INVALID_STRATEGY_ACTION");
  const trading = input.action === "BUY" || input.action === "SELL";
  if (trading) decimalAtoms(input.quantityBtc, "QUANTITY");
  else if (input.quantityBtc !== null) throw new Error("UNEXPECTED_QUANTITY");
  if (input.action === "SKIP_ENTRY") identifier(input.reason, "SKIP_REASON");
  else if (input.reason !== null) throw new Error("UNEXPECTED_REASON");
  return input;
}

function makeReport(replay) {
  const lastTrade = [...replay.entries].reverse().find(entry => entry.fill)?.fill ?? null;
  const rejectedEntries = replay.entries.filter(entry => entry.skipReason).map(entry => ({
    eventId: entry.event.id,
    reason: entry.skipReason
  }));
  const netEquityCents = replay.activity.netEquityCents;
  const drawdownUsedCents = replay.guardState.highWaterEquityCents - netEquityCents;
  const entryGate = replay.authorization.productionExposureGate;
  return freezeDeep({
    schemaVersion: "USD_PAPER_OFFLINE_REPORT_V1",
    activity: replay.activity,
    rejectedEntries,
    lastTrade,
    costs: Object.freeze({
      modeledFeesCents: replay.activity.modeledFeesCents,
      additionalAccruedFeesCents: replay.activity.additionalAccruedFeesCents,
      modeledSlippageCents: replay.activity.modeledSlippageCents,
      modeledExitCostsCents: replay.activity.modeledExitCostsCents
    }),
    netEquityCents,
    drawdownUsedCents,
    remainingDrawdownAllowanceCents: Math.min(POLICY.maxDrawdownCents,
      Math.max(0, POLICY.maxDrawdownCents - drawdownUsedCents)),
    paused: replay.guardState.paused,
    entryAdmission: {
      allowed: entryGate.allowed,
      reason: entryGate.reason
    }
  });
}

export async function runUsdOfflineStream({store, observations, decide} = {}) {
  if (!store || typeof store.append !== "function" ||
      typeof store.replay !== "object" || typeof decide !== "function" ||
      !Array.isArray(observations)) {
    throw new TypeError("offline runner requires an account journal store, observations, and decision function");
  }
  let replay = store.replay;
  if (observations.length > MAX_USD_ACCOUNT_JOURNAL_EVENTS) {
    throw new Error("ACCOUNT_INPUT_LIMIT_REACHED");
  }
  const existingById = new Map(replay.entries.map((entry, index) => [
    entry.event.id, {entry, index}
  ]));
  const quoteIds = new Map(replay.entries.map(entry => [
    JSON.stringify([entry.event.quote.sourceId, entry.event.quote.id]), entry.event.quote
  ]));
  const validatedObservations = observations.map(normalizeObservation);
  const seenInputIds = new Set();
  const newObservations = [];
  let nextExistingIndex = null;
  let sawNewObservation = false;
  let previousInputAtMs = null;
  let previousInputQuote = null;
  let previousNewAtMs = replay.entries.at(-1)?.event.observedAtMs ?? null;
  let previousNewQuote = replay.entries.at(-1)?.event.quote ?? null;
  let newEventCount = 0;
  for (const observation of validatedObservations) {
    if (seenInputIds.has(observation.id)) throw new Error("DUPLICATE_OFFLINE_OBSERVATION");
    seenInputIds.add(observation.id);
    if (previousInputAtMs !== null && observation.observedAtMs <= previousInputAtMs) {
      throw new Error("OFFLINE_OBSERVATION_OUT_OF_ORDER");
    }
    if (previousInputQuote &&
        (observation.quote.quotedAtMs < previousInputQuote.quotedAtMs ||
         observation.quote.receivedAtMs < previousInputQuote.receivedAtMs)) {
      throw new Error("QUOTE_OUT_OF_ORDER");
    }
    previousInputAtMs = observation.observedAtMs;
    previousInputQuote = observation.quote;

    const existing = existingById.get(observation.id);
    if (existing) {
      if (sawNewObservation ||
          (nextExistingIndex !== null && existing.index !== nextExistingIndex)) {
        throw new Error("OFFLINE_RETRY_PREFIX_MISMATCH");
      }
      if (existing.entry.event.observedAtMs !== observation.observedAtMs ||
          canonical(existing.entry.event.quote) !== canonical(observation.quote)) {
        throw new Error("CONTRADICTORY_DUPLICATE_EVENT");
      }
      nextExistingIndex = existing.index + 1;
      continue;
    }

    sawNewObservation = true;
    newEventCount += 1;
    if (previousNewAtMs !== null && observation.observedAtMs <= previousNewAtMs) {
      throw new Error("OFFLINE_OBSERVATION_OUT_OF_ORDER");
    }
    if (previousNewQuote &&
        (observation.quote.quotedAtMs < previousNewQuote.quotedAtMs ||
         observation.quote.receivedAtMs < previousNewQuote.receivedAtMs)) {
      throw new Error("QUOTE_OUT_OF_ORDER");
    }
    const quoteKey = JSON.stringify([observation.quote.sourceId, observation.quote.id]);
    const oldQuote = quoteIds.get(quoteKey);
    if (oldQuote && canonical(oldQuote) !== canonical(observation.quote)) {
      throw new Error("CONTRADICTORY_DUPLICATE_QUOTE");
    }
    quoteIds.set(quoteKey, observation.quote);
    newObservations.push(observation);
    previousNewAtMs = observation.observedAtMs;
    previousNewQuote = observation.quote;
  }
  if (replay.entries.length + newEventCount > MAX_USD_ACCOUNT_JOURNAL_EVENTS) {
    throw new Error("ACCOUNT_JOURNAL_LIMIT_REACHED");
  }
  const firstAtMs = replay.entries[0]?.event.observedAtMs ??
    newObservations[0]?.observedAtMs;
  const lastAtMs = newObservations.at(-1)?.observedAtMs ??
    replay.entries.at(-1)?.event.observedAtMs;
  if (firstAtMs !== undefined && lastAtMs !== undefined &&
      lastAtMs - firstAtMs > MAX_USD_ACCOUNT_WINDOW_MS) {
    throw new Error("ACCOUNT_WINDOW_LIMIT_REACHED");
  }
  for (const observation of newObservations) {
    const context = Object.freeze({
      observation,
      account: replay.account,
      guardState: replay.guardState,
      lastObservation: replay.entries.at(-1)?.observation ?? null,
      history: replay.entries
    });
    const decision = normalizeDecision(await decide(context));
    const event = {
      id: observation.id,
      ...store.binding,
      observedAtMs: observation.observedAtMs,
      action: decision.action,
      quote: observation.quote,
      quantityBtc: decision.quantityBtc,
      feeCents: 0,
      reason: decision.reason
    };
    replay = (await store.append(event)).replay;
  }
  return Object.freeze({
    replay,
    tip: store.tip,
    report: makeReport(replay)
  });
}
