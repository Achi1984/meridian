import {runUsdOfflineStream} from "../paper-capital-challenge/offline-runner.mjs";
import {
  MAX_USD_ACCOUNT_JOURNAL_BYTES,
  MAX_USD_ACCOUNT_JOURNAL_EVENTS,
  MAX_USD_ACCOUNT_WINDOW_MS
} from "../paper-capital-challenge/account-store.mjs";
import {USD_MODELED_COSTS} from "../paper-capital-challenge/account-contract.mjs";
import {PAPER_CAPITAL_CHALLENGE_POLICY as POLICY} from
  "../paper-capital-challenge/policy.mjs";

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
      !Array.isArray(store.replay?.entries) ||
      typeof decide !== "function" || typeof retainRestartTip !== "function") {
    throw new TypeError("synthetic USD acceptance requires a feed fixture, account store, decision, and tip sink");
  }
  if (store.replay.entries.length >= MAX_USD_ACCOUNT_JOURNAL_EVENTS) {
    throw new Error("ACCOUNT_JOURNAL_LIMIT_REACHED");
  }
  const observation = await feed.fetchObservation();
  return runSyntheticUsdLivesObservation({
    store,
    observation,
    decide,
    retainRestartTip
  });
}

export async function runSyntheticUsdLivesObservation({
  store,
  observation,
  decide,
  retainRestartTip
} = {}) {
  if (!store || typeof store.append !== "function" ||
      !Array.isArray(store.replay?.entries) || !observation ||
      typeof decide !== "function" || typeof retainRestartTip !== "function") {
    throw new TypeError("synthetic USD acceptance requires a store, one observation, decision, and independent tip sink");
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
