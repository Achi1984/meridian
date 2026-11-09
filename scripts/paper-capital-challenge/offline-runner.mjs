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
    remainingDrawdownAllowanceCents: Math.max(
      0, POLICY.maxDrawdownCents - drawdownUsedCents),
    paused: replay.guardState.paused
  });
}

export async function runUsdOfflineStream({store, observations, decide} = {}) {
  if (!store || typeof store.append !== "function" ||
      typeof store.replay !== "object" || typeof decide !== "function" ||
      !Array.isArray(observations)) {
    throw new TypeError("offline runner requires an account journal store, observations, and decision function");
  }
  let replay = store.replay;
  if (replay.entries.length + observations.length > MAX_USD_ACCOUNT_JOURNAL_EVENTS) {
    throw new Error("ACCOUNT_JOURNAL_LIMIT_REACHED");
  }
  let previousAtMs = replay.entries.at(-1)?.event.observedAtMs ?? null;
  let previousQuote = replay.entries.at(-1)?.event.quote ?? null;
  const quoteIds = new Map(replay.entries.map(entry => [
    JSON.stringify([entry.event.quote.sourceId, entry.event.quote.id]), entry.event.quote
  ]));
  const eventIds = new Set(replay.entries.map(entry => entry.event.id));
  const validatedObservations = observations.map(normalizeObservation);
  const firstAtMs = replay.entries[0]?.event.observedAtMs ??
    validatedObservations[0]?.observedAtMs;
  const lastAtMs = validatedObservations.at(-1)?.observedAtMs ??
    replay.entries.at(-1)?.event.observedAtMs;
  if (firstAtMs !== undefined && lastAtMs !== undefined &&
      lastAtMs - firstAtMs > MAX_USD_ACCOUNT_WINDOW_MS) {
    throw new Error("ACCOUNT_WINDOW_LIMIT_REACHED");
  }
  for (const observation of validatedObservations) {
    if (eventIds.has(observation.id)) throw new Error("CONTRADICTORY_DUPLICATE_EVENT");
    if (previousAtMs !== null && observation.observedAtMs <= previousAtMs) {
      throw new Error("OFFLINE_OBSERVATION_OUT_OF_ORDER");
    }
    if (previousQuote && (observation.quote.quotedAtMs < previousQuote.quotedAtMs ||
        observation.quote.receivedAtMs < previousQuote.receivedAtMs)) {
      throw new Error("QUOTE_OUT_OF_ORDER");
    }
    const quoteKey = JSON.stringify([observation.quote.sourceId, observation.quote.id]);
    const oldQuote = quoteIds.get(quoteKey);
    if (oldQuote && canonical(oldQuote) !== canonical(observation.quote)) {
      throw new Error("CONTRADICTORY_DUPLICATE_QUOTE");
    }
    quoteIds.set(quoteKey, observation.quote);
    eventIds.add(observation.id);
    previousAtMs = observation.observedAtMs;
    previousQuote = observation.quote;
  }
  for (const observation of validatedObservations) {
    const context = Object.freeze({
      observation,
      account: replay.account,
      guardState: replay.guardState,
      lastObservation: replay.entries.at(-1)?.observation ?? null
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
