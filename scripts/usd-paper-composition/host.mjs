import {runUsdOfflineStream} from "../paper-capital-challenge/offline-runner.mjs";
import {
  MAX_USD_ACCOUNT_JOURNAL_BYTES,
  MAX_USD_ACCOUNT_JOURNAL_EVENTS,
  MAX_USD_ACCOUNT_WINDOW_MS
} from "../paper-capital-challenge/account-store.mjs";
import {USD_MODELED_COSTS} from "../paper-capital-challenge/account-contract.mjs";
import {PAPER_CAPITAL_CHALLENGE_POLICY as POLICY} from
  "../paper-capital-challenge/policy.mjs";

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

export function startUsdLivesHost() {
  throw new Error("USD_LIVES_HOST_DISABLED");
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
