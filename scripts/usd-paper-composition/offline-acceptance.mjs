import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {USD_MODELED_COSTS} from "../paper-capital-challenge/account-contract.mjs";
import {UsdAccountJournalStore} from "../paper-capital-challenge/account-store.mjs";
import {PAPER_CAPITAL_CHALLENGE_POLICY as POLICY} from
  "../paper-capital-challenge/policy.mjs";
import {
  runSyntheticUsdLivesFeedSample,
  USD_BTC_LIVES_HOST_CONFIGURATION as HOST
} from "./host.mjs";

const BASE = Date.UTC(2026, 0, 1);
const BINDING = Object.freeze({
  campaignId: POLICY.campaignId,
  currency: POLICY.currency,
  strategyVersion: "synthetic-unapproved-acceptance-v1",
  costVersion: USD_MODELED_COSTS.version
});

function fixtureObservation(index, bid, ask) {
  const observedAtMs = BASE + index * 60_000;
  return {
    id: `synthetic-observation-${index}`,
    observedAtMs,
    quote: {
      schemaVersion: "NATIVE_BTC_USD_QUOTE_V1",
      id: `synthetic-quote-${index}`,
      marketPair: "BTC/USD",
      baseCurrency: "BTC",
      quoteCurrency: "USD",
      sourceId: "synthetic-usd-composition-acceptance",
      nativeInstrument: "BTC/USD",
      evidenceKind: "SYNTHETIC_FIXTURE",
      bid,
      ask,
      quotedAtMs: observedAtMs,
      receivedAtMs: observedAtMs,
      maxAgeMs: POLICY.maxValuationAgeMs
    }
  };
}

export async function runOfflineAcceptance() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "usd-lives-acceptance-"));
  let store;
  try {
    store = await UsdAccountJournalStore.createNew(path.join(parent, "account"), {
      binding: BINDING
    });
    const retainedTips = [];
    const decisions = [
      {action: "BUY", quantityBtc: "0.009", reason: null},
      {action: "SELL", quantityBtc: "0.009", reason: null}
    ];
    const observations = [
      fixtureObservation(1, "9990", "9990"),
      fixtureObservation(2, "10010", "10010")
    ];
    let decisionIndex = 0;
    let feedIndex = 0;
    const feed = Object.freeze({
      async fetchObservation() {
        const next = observations[feedIndex++];
        if (!next) throw new Error("SYNTHETIC_FEED_EXHAUSTED");
        return next;
      }
    });
    for (let index = 0; index < observations.length; index++) {
      await runSyntheticUsdLivesFeedSample({
        feed,
        store,
        decide() {
          return decisions[decisionIndex++];
        },
        retainRestartTip(tip) {
          retainedTips.push(tip);
        }
      });
    }

    const replay = store.replay;
    const fillFeesCents = replay.entries.reduce(
      (total, entry) => total + (entry.fill?.feeCents ?? 0), 0);
    if (replay.entries.length !== 2 || decisionIndex !== 2 ||
        replay.activity.completedRoundTrips !== 1 ||
        replay.activity.modeledFeesCents !== fillFeesCents ||
        retainedTips.length !== 2 ||
        replay.authorization.executionAuthorized !== false ||
        replay.activity.profitableCandidateEstablished !== false) {
      throw new Error("SYNTHETIC_ACCEPTANCE_ASSERTION_FAILED");
    }

    return Object.freeze({
      schemaVersion: "USD_BTC_LIVES_OFFLINE_ACCEPTANCE_V1",
      status: "PASS",
      evidenceKind: "SYNTHETIC_FIXTURE_ONLY",
      strategyStatus: "UNAPPROVED",
      hostEnabled: HOST.enabled,
      executionEnabled: HOST.executionEnabled,
      networkRequests: 0,
      observations: replay.entries.length,
      completedRoundTrips: replay.activity.completedRoundTrips,
      modeledFeesCentsCountedOnce: fillFeesCents,
      restartTipsRetainedInMemoryForAcceptanceOnly: retainedTips.length,
      profitability: "NOT_ASSESSED",
      productionReadiness: "NOT_ASSESSED"
    });
  } finally {
    if (store) await store.close().catch(() => {});
    await rm(parent, {recursive: true, force: true});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = await runOfflineAcceptance();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
