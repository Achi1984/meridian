import { PAPER_CAPITAL_CHALLENGE_POLICY as POLICY } from "./policy.mjs";

const STATE_SCHEMA = "PAPER_CAPITAL_CHALLENGE_STATE_V1";
const STATE_KEYS = [
  "schemaVersion", "campaignId", "currency", "policyVersion",
  "highWaterEquityCents", "paused", "pauseObservationId",
  "lastObservationAtMs", "observations"
];
const OBSERVATION_KEYS = [
  "id", "campaignId", "currency", "strategyVersion", "observedAtMs",
  "netEquityCents", "valuation"
];
const VALUATION_KEYS = [
  "status", "currency", "monetaryUnit", "marketPair", "method",
  "asOfMs", "bidQuoteAtMs", "maxAgeMs",
  "quoteSourceId", "cashCents", "inventoryAtAdverseBidCents",
  "unbookedAccruedFeesCents", "modeledExitCostsCents"
];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TRUSTED_STATES = new WeakSet();

function assertRecord(value, expectedKeys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
       Object.getPrototypeOf(value) !== null)) {
    throw new Error(`INVALID_${name}`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== "string") ||
      keys.length !== expectedKeys.length ||
      expectedKeys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`INVALID_${name}`);
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new Error(`INVALID_${name}`);
    }
  }
  return value;
}

function safeInteger(value, name, { min = Number.MIN_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`INVALID_${name}`);
  return value;
}

function identifier(value, name, pattern = ID_PATTERN) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`INVALID_${name}`);
  return value;
}

function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}

function freezeState(value) {
  const state = freezeDeep(value);
  TRUSTED_STATES.add(state);
  return state;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateIdentity({ campaignId, currency, policyVersion = POLICY.version } = {}) {
  if (campaignId !== POLICY.campaignId) throw new Error("CAMPAIGN_ID_MISMATCH");
  if (currency !== POLICY.currency) throw new Error("CURRENCY_MISMATCH");
  if (policyVersion !== POLICY.version) throw new Error("POLICY_VERSION_MISMATCH");
  return { campaignId, currency, policyVersion };
}

function initialState(identity) {
  return {
    schemaVersion: STATE_SCHEMA,
    ...identity,
    highWaterEquityCents: POLICY.initialCapitalCents,
    paused: false,
    pauseObservationId: null,
    lastObservationAtMs: null,
    observations: []
  };
}

function normalizeObservation(input, identity) {
  const observation = assertRecord(input, OBSERVATION_KEYS, "OBSERVATION");
  if (observation.campaignId !== identity.campaignId) {
    throw new Error("CAMPAIGN_ID_MISMATCH");
  }
  if (observation.currency !== POLICY.currency) throw new Error("CURRENCY_MISMATCH");
  const id = identifier(observation.id, "OBSERVATION_ID");
  const strategyVersion = identifier(observation.strategyVersion, "STRATEGY_VERSION", VERSION_PATTERN);
  const observedAtMs = safeInteger(observation.observedAtMs, "OBSERVATION_TIME", { min: 0 });
  const netEquityCents = safeInteger(observation.netEquityCents, "NET_EQUITY");
  const valuation = assertRecord(observation.valuation, VALUATION_KEYS, "VALUATION");
  if (valuation.currency !== POLICY.currency) throw new Error("CURRENCY_MISMATCH");
  if (valuation.marketPair !== POLICY.marketPair) throw new Error("MARKET_PAIR_MISMATCH");
  if (valuation.status !== "FRESH" ||
      valuation.monetaryUnit !== POLICY.monetaryUnit ||
      valuation.method !== "CASH_PLUS_EXECUTABLE_ADVERSE_BID") {
    throw new Error("MISSING_OR_UNSUPPORTED_VALUATION");
  }
  const asOfMs = safeInteger(valuation.asOfMs, "VALUATION_TIME", { min: 0 });
  const bidQuoteAtMs = safeInteger(valuation.bidQuoteAtMs, "BID_QUOTE_TIME", { min: 0 });
  const maxAgeMs = safeInteger(valuation.maxAgeMs, "MAX_VALUATION_AGE", { min: 1 });
  const quoteSourceId = identifier(valuation.quoteSourceId, "QUOTE_SOURCE_ID");
  const cashCents = safeInteger(valuation.cashCents, "CASH", { min: 0 });
  const inventoryAtAdverseBidCents = safeInteger(
    valuation.inventoryAtAdverseBidCents, "ADVERSE_BID_INVENTORY", { min: 0 });
  const unbookedAccruedFeesCents = safeInteger(
    valuation.unbookedAccruedFeesCents, "UNBOOKED_ACCRUED_FEES", { min: 0 });
  const modeledExitCostsCents = safeInteger(
    valuation.modeledExitCostsCents, "MODELED_EXIT_COSTS", { min: 0 });
  if (maxAgeMs > POLICY.maxValuationAgeMs ||
      asOfMs > observedAtMs || bidQuoteAtMs > asOfMs ||
      observedAtMs - asOfMs > maxAgeMs ||
      observedAtMs - bidQuoteAtMs > maxAgeMs) {
    throw new Error("STALE_OR_MISSING_VALUATION");
  }
  const calculatedEquity = BigInt(cashCents) + BigInt(inventoryAtAdverseBidCents) -
    BigInt(unbookedAccruedFeesCents) - BigInt(modeledExitCostsCents);
  if (calculatedEquity > BigInt(Number.MAX_SAFE_INTEGER) ||
      calculatedEquity < BigInt(Number.MIN_SAFE_INTEGER) ||
      Number(calculatedEquity) !== netEquityCents) {
    throw new Error("NET_EQUITY_MISMATCH");
  }
  return {
    id, campaignId: identity.campaignId, currency: POLICY.currency, strategyVersion,
    observedAtMs, netEquityCents,
    valuation: {
      status: "FRESH", currency: POLICY.currency, monetaryUnit: POLICY.monetaryUnit,
      marketPair: POLICY.marketPair,
      method: "CASH_PLUS_EXECUTABLE_ADVERSE_BID",
      asOfMs, bidQuoteAtMs, maxAgeMs, quoteSourceId, cashCents,
      inventoryAtAdverseBidCents, unbookedAccruedFeesCents, modeledExitCostsCents
    }
  };
}

function advanceValidated(previous, observation, { duplicateChecked = false } = {}) {
  if (duplicateChecked) {
    return advanceNewObservation(previous, observation);
  }
  const duplicate = previous.observations.find(item => item.id === observation.id);
  if (duplicate) {
    if (stableJson(duplicate) !== stableJson(observation)) {
      throw new Error("CONTRADICTORY_DUPLICATE_OBSERVATION");
    }
    return previous;
  }
  return advanceNewObservation(previous, observation);
}

function advanceNewObservation(previous, observation) {
  if (previous.lastObservationAtMs !== null &&
      observation.observedAtMs <= previous.lastObservationAtMs) {
    throw new Error("OBSERVATION_OUT_OF_ORDER");
  }
  const previousObservation = previous.observations.at(-1);
  if (previousObservation &&
      (observation.valuation.asOfMs < previousObservation.valuation.asOfMs ||
       observation.valuation.bidQuoteAtMs < previousObservation.valuation.bidQuoteAtMs)) {
    throw new Error("VALUATION_OUT_OF_ORDER");
  }
  const highWaterEquityCents = Math.max(
    previous.highWaterEquityCents, observation.netEquityCents);
  const breached = BigInt(highWaterEquityCents) -
    BigInt(observation.netEquityCents) >= BigInt(POLICY.maxDrawdownCents);
  return {
    ...previous,
    highWaterEquityCents,
    paused: previous.paused || breached,
    pauseObservationId: previous.pauseObservationId ??
      (breached ? observation.id : null),
    lastObservationAtMs: observation.observedAtMs,
    observations: [...previous.observations, observation]
  };
}

function replayNormalized(identity, observations) {
  let state = initialState(identity);
  for (const input of observations) {
    state = advanceValidated(state, normalizeObservation(input, identity));
  }
  return state;
}

function validateJournalLength(observations, { requireCapacity = false } = {}) {
  if (!Array.isArray(observations)) throw new Error("INVALID_OBSERVATION_JOURNAL");
  if (observations.length > POLICY.maxJournalObservations ||
      (requireCapacity && observations.length >= POLICY.maxJournalObservations)) {
    throw new Error("OBSERVATION_JOURNAL_LIMIT_REACHED");
  }
}

export function createChallengeState(identity) {
  return freezeState(initialState(validateIdentity(identity)));
}

export function replayChallengeState({ campaignId, currency, policyVersion, observations } = {}) {
  const identity = validateIdentity({ campaignId, currency, policyVersion });
  validateJournalLength(observations);
  return freezeState(replayNormalized(identity, observations));
}

function validateState(state) {
  assertRecord(state, STATE_KEYS, "STATE");
  if (state.schemaVersion !== STATE_SCHEMA) throw new Error("INVALID_STATE");
  const identity = validateIdentity(state);
  validateJournalLength(state.observations);
  const replayed = replayNormalized(identity, state.observations);
  if (stableJson(replayed) !== stableJson(state)) throw new Error("STATE_REPLAY_MISMATCH");
  return replayed;
}

export function advanceChallengeState(previousState, inputObservation) {
  const previous = TRUSTED_STATES.has(previousState)
    ? previousState
    : validateState(previousState);
  const observation = normalizeObservation(inputObservation, previous);
  const duplicate = previous.observations.find(item => item.id === observation.id);
  if (duplicate) {
    if (stableJson(duplicate) !== stableJson(observation)) {
      throw new Error("CONTRADICTORY_DUPLICATE_OBSERVATION");
    }
    return freezeState(previous);
  }
  validateJournalLength(previous.observations, { requireCapacity: true });
  return freezeState(advanceValidated(previous, observation, { duplicateChecked: true }));
}

export function getExposureGate(state, nowMs) {
  let validated;
  try {
    validated = validateState(state);
  } catch {
    return { allowed: false, reason: "INVALID_STATE" };
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    return { allowed: false, reason: "INVALID_CLOCK" };
  }
  if (validated.lastObservationAtMs !== null && nowMs < validated.lastObservationAtMs) {
    return { allowed: false, reason: "CLOCK_BEFORE_LAST_OBSERVATION" };
  }
  if (validated.paused) return { allowed: false, reason: "DRAWDOWN_PAUSED" };
  const latest = validated.observations.at(-1);
  if (!latest) return { allowed: false, reason: "NO_FRESH_VALUATION" };
  const ageMs = nowMs - latest.valuation.asOfMs;
  const bidAgeMs = nowMs - latest.valuation.bidQuoteAtMs;
  if (ageMs < 0 || bidAgeMs < 0 ||
      ageMs > latest.valuation.maxAgeMs ||
      bidAgeMs > latest.valuation.maxAgeMs) {
    return { allowed: false, reason: "STALE_OR_MISSING_VALUATION" };
  }
  if (!POLICY.enabled || !POLICY.executionEnabled) {
    return { allowed: false, reason: "POLICY_DISABLED" };
  }
  return { allowed: true, reason: null };
}
