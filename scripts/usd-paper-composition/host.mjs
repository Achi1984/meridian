import {runUsdOfflineStream} from "../paper-capital-challenge/offline-runner.mjs";
import {
  MAX_USD_ACCOUNT_JOURNAL_BYTES,
  MAX_USD_ACCOUNT_JOURNAL_EVENTS,
  MAX_USD_ACCOUNT_WINDOW_MS
} from "../paper-capital-challenge/account-store.mjs";
import {
  decimalAtoms, modeledExecution, NOTIONAL_DIVISOR, USD_MODELED_COSTS
} from "../paper-capital-challenge/account-contract.mjs";
import {PAPER_CAPITAL_CHALLENGE_POLICY as POLICY} from
  "../paper-capital-challenge/policy.mjs";
import {USD_SMA_CANDIDATE} from "./sma-candidate.mjs";

const STORE_SESSIONS = new WeakMap();

export const USD_BTC_LIVES_HOST_CONFIGURATION = Object.freeze({
  schemaVersion: "USD_BTC_LIVES_HOST_CANDIDATE_V1",
  enabled: false,
  executionEnabled: false,
  campaignId: POLICY.campaignId,
  currency: POLICY.currency,
  marketPair: POLICY.marketPair,
  initialCapitalCents: POLICY.initialCapitalCents,
  maxDrawdownCents: POLICY.maxDrawdownCents,
  maxEvents: MAX_USD_ACCOUNT_JOURNAL_EVENTS,
  maxJournalBytes: MAX_USD_ACCOUNT_JOURNAL_BYTES,
  maxWindowMs: MAX_USD_ACCOUNT_WINDOW_MS,
  costVersion: USD_MODELED_COSTS.version,
  strategyStatus: "UNAPPROVED",
  strategyIdentity: null
});

export const USD_BTC_SMA_CANDIDATE_CONFIGURATION = Object.freeze({
  schemaVersion: "USD_BTC_SMA_CANDIDATE_COMPOSITION_V1",
  enabled: false,
  executionEnabled: false,
  strategyStatus: USD_SMA_CANDIDATE.status,
  strategyVersion: USD_SMA_CANDIDATE.strategyVersion,
  sourceVersion: USD_SMA_CANDIDATE.sourceVersion,
  warmupClosedCandles: USD_SMA_CANDIDATE.warmupClosedCandles,
  maxEntryNotionalCents: USD_MODELED_COSTS.maxEntryCents,
  requiresExplicitEntryNotional: true
});

export function startUsdLivesHost() {
  throw new Error("USD_LIVES_HOST_DISABLED");
}

export async function runProposedUsdSmaCandidateSample({
  feed,
  store,
  candidate,
  candidateNotionalCents,
  retainStrategyEvidence,
  retainRestartTip
} = {}) {
  if (!feed || typeof feed.fetchCausalSample !== "function" ||
      !store || typeof store.append !== "function" ||
      !candidate || typeof candidate.decide !== "function" ||
      typeof candidate.recordSample !== "function" ||
      !Number.isSafeInteger(candidateNotionalCents) || candidateNotionalCents < 1 ||
      candidateNotionalCents > USD_MODELED_COSTS.maxEntryCents ||
      typeof retainStrategyEvidence !== "function" ||
      typeof retainRestartTip !== "function") {
    throw new TypeError("proposed USD SMA composition requires a causal feed, candidate, explicit notional, and evidence/tip sinks");
  }
  return withStoreSession(store, async session => {
    if (!Array.isArray(store.replay?.entries)) {
      throw new TypeError("proposed USD SMA composition requires a replayable account store");
    }
    if (store.replay.entries.length >= MAX_USD_ACCOUNT_JOURNAL_EVENTS) {
      throw new Error("ACCOUNT_JOURNAL_LIMIT_REACHED");
    }
    if (session.feedBudgetRequiresReview) {
      throw new Error("USD_CAMPAIGN_FEED_BUDGET_REVIEW_REQUIRED");
    }
    if (session.feedInstance && session.feedInstance !== feed) {
      throw new Error("USD_CAMPAIGN_FEED_INSTANCE_CHANGED");
    }
    if (session.strategyInstance && session.strategyInstance !== candidate) {
      throw new Error("USD_CAMPAIGN_STRATEGY_INSTANCE_CHANGED");
    }
    session.feedInstance ??= feed;
    session.strategyInstance ??= candidate;
    const sample = await feed.fetchCausalSample({
      decide: candleEvidence => candidate.decide(candleEvidence)
    });
    const strategyEvidence = candidate.recordSample(sample);
    await retainStrategyEvidence(structuredClone(strategyEvidence));
    const prefix = store.replay.entries.map(({event}) => ({
      id: event.id,
      observedAtMs: event.observedAtMs,
      quote: event.quote
    }));
    const result = await runUsdOfflineStream({
      store,
      observations: [...prefix, sample.observation],
      decide: context => decisionForCandidateSample(
        sample.decision, context, candidateNotionalCents)
    });
    await retainRestartTip(structuredClone(result.tip));
    return Object.freeze({
      ...result,
      sample,
      strategyEvidence,
      acceptance: Object.freeze({
        kind: "PROPOSED_UNAPPROVED_CANDIDATE",
        hostEnabled: USD_BTC_SMA_CANDIDATE_CONFIGURATION.enabled,
        strategyStatus: USD_BTC_SMA_CANDIDATE_CONFIGURATION.strategyStatus,
        productionReadiness: "NOT_ASSESSED"
      })
    });
  });
}

function decisionForCandidateSample(candidateDecision, context, candidateNotionalCents) {
  if (candidateDecision.action === "EXIT") {
    const inventory = BigInt(context.account.inventorySatoshis);
    return inventory > 0n ? {
      action: "SELL",
      quantityBtc: formatBtc(inventory),
      reason: null
    } : {action: "HOLD", quantityBtc: null, reason: null};
  }
  if (candidateDecision.action !== "ENTRY" ||
      context.account.inventorySatoshis !== "0") {
    return {action: "HOLD", quantityBtc: null, reason: null};
  }
  const quantity = quantityForCandidateNotional(
    candidateNotionalCents,
    context.account.cashCents,
    context.account.unbookedAccruedFeesCents,
    context.observation.quote.ask
  );
  if (quantity === 0n) {
    return {
      action: "SKIP_ENTRY",
      quantityBtc: null,
      reason: "CANDIDATE_NOTIONAL_UNEXECUTABLE"
    };
  }
  return {action: "BUY", quantityBtc: formatBtc(quantity), reason: null};
}

function quantityForCandidateNotional(notionalLimitCents, cashCents, accruedFeesCents, ask) {
  const price = decimalAtoms(ask, "ASK");
  const cashLimit = BigInt(cashCents) - BigInt(accruedFeesCents);
  const limit = BigInt(notionalLimitCents);
  if (cashLimit <= 0n) return 0n;
  let low = 0n;
  const maximumQuantity = BigInt(Number.MAX_SAFE_INTEGER);
  let high = limit * NOTIONAL_DIVISOR / price;
  if (high > maximumQuantity) high = maximumQuantity;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    const execution = modeledExecution(middle, {ask}, "BUY");
    const debit = BigInt(execution.notionalCents) + BigInt(execution.feeCents);
    if (BigInt(execution.notionalCents) <= limit && debit <= cashLimit) low = middle;
    else high = middle - 1n;
  }
  return low;
}

function formatBtc(satoshis) {
  const whole = satoshis / 100_000_000n;
  const fraction = (satoshis % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export async function runSyntheticUsdLivesFeedSample({
  feed,
  store,
  decide,
  retainRestartTip
} = {}) {
  if (!feed || typeof feed.fetchObservation !== "function" ||
      !store || typeof store.append !== "function" ||
      typeof decide !== "function" || typeof retainRestartTip !== "function") {
    throw new TypeError("synthetic USD acceptance requires a feed fixture, account store, decision, and tip sink");
  }
  return withStoreSession(store, async session => {
    if (!Array.isArray(store.replay?.entries)) {
      throw new TypeError("synthetic USD acceptance requires a replayable account store");
    }
    if (store.replay.entries.length >= MAX_USD_ACCOUNT_JOURNAL_EVENTS) {
      throw new Error("ACCOUNT_JOURNAL_LIMIT_REACHED");
    }
    if (session.feedBudgetRequiresReview) {
      throw new Error("USD_CAMPAIGN_FEED_BUDGET_REVIEW_REQUIRED");
    }
    if (session.feedInstance && session.feedInstance !== feed) {
      throw new Error("USD_CAMPAIGN_FEED_INSTANCE_CHANGED");
    }
    session.feedInstance ??= feed;
    const observation = await feed.fetchObservation();
    return processObservation({
      store,
      observation,
      decide,
      retainRestartTip,
      session
    });
  });
}

export async function runSyntheticUsdLivesObservation({
  store,
  observation,
  decide,
  retainRestartTip
} = {}) {
  if (!store || typeof store.append !== "function" ||
      !observation ||
      typeof decide !== "function" || typeof retainRestartTip !== "function") {
    throw new TypeError("synthetic USD acceptance requires a store, one observation, decision, and independent tip sink");
  }
  if (observation.quote?.evidenceKind !== "SYNTHETIC_FIXTURE") {
    throw new Error("SYNTHETIC_FIXTURE_REQUIRED");
  }
  return withStoreSession(store, session => processObservation({
    store,
    observation,
    decide,
    retainRestartTip,
    session
  }));
}

function getStoreSession(store) {
  let session = STORE_SESSIONS.get(store);
  if (!session) {
    session = {
      busy: false,
      failed: false,
      failure: null,
      feedInstance: null,
      strategyInstance: null,
      feedBudgetRequiresReview: store.createdNew !== true ||
        (store.replay?.entries?.length ?? 0) > 0
    };
    STORE_SESSIONS.set(store, session);
  }
  if (session.failed) {
    throw new Error("USD_COMPOSITION_SESSION_FAILED", {cause: session.failure});
  }
  if (session.busy) throw new Error("USD_COMPOSITION_SESSION_BUSY");
  session.busy = true;
  return session;
}

async function withStoreSession(store, operation) {
  const session = getStoreSession(store);
  try {
    return await operation(session);
  } catch (error) {
    session.failed = true;
    session.failure = error;
    throw error;
  } finally {
    session.busy = false;
  }
}

async function processObservation({
  store,
  observation,
  decide,
  retainRestartTip,
  session
}) {
  if (!Array.isArray(store.replay?.entries)) {
    throw new TypeError("synthetic USD acceptance requires a replayable account store");
  }
  if (observation.quote?.evidenceKind !== "SYNTHETIC_FIXTURE") {
    throw new Error("SYNTHETIC_FIXTURE_REQUIRED");
  }
  if (store.replay.entries.length >= MAX_USD_ACCOUNT_JOURNAL_EVENTS) {
    throw new Error("ACCOUNT_JOURNAL_LIMIT_REACHED");
  }
  const prefix = store.replay.entries.map(({event}) => ({
    id: event.id,
    observedAtMs: event.observedAtMs,
    quote: event.quote
  }));
  const result = await runUsdOfflineStream({
    store,
    observations: [...prefix, observation],
    decide
  });
  const tipForRetention = structuredClone(result.tip);
  await retainRestartTip(tipForRetention);
  return Object.freeze({
    ...result,
    acceptance: Object.freeze({
      kind: "SYNTHETIC_FIXTURE_INPUT",
      hostEnabled: USD_BTC_LIVES_HOST_CONFIGURATION.enabled,
      strategyStatus: USD_BTC_LIVES_HOST_CONFIGURATION.strategyStatus,
      productionReadiness: "NOT_ASSESSED"
    })
  });
}
