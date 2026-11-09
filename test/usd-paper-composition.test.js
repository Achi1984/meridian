import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {
  inspectUsdAccountJournal,
  MAX_USD_ACCOUNT_JOURNAL_EVENTS,
  UsdAccountJournalStore
} from "../scripts/paper-capital-challenge/account-store.mjs";
import {USD_MODELED_COSTS} from
  "../scripts/paper-capital-challenge/account-contract.mjs";
import {PAPER_CAPITAL_CHALLENGE_POLICY as POLICY} from
  "../scripts/paper-capital-challenge/policy.mjs";
import {
  runSyntheticUsdLivesFeedSample,
  runSyntheticUsdLivesObservation,
  startUsdLivesHost,
  USD_BTC_LIVES_HOST_CONFIGURATION as HOST
} from "../scripts/usd-paper-composition/host.mjs";

const BASE = Date.UTC(2026, 0, 1);
const BINDING = Object.freeze({
  campaignId: POLICY.campaignId,
  currency: "USD",
  strategyVersion: "synthetic-unapproved-composition-test-v1",
  costVersion: USD_MODELED_COSTS.version
});
const ACCEPTANCE_CLI = fileURLToPath(new URL(
  "../scripts/usd-paper-composition/offline-acceptance.mjs", import.meta.url));
const STORE_DIRECTORIES = new WeakMap();

async function rootDirectory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "usd-lives-composition-test-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}

async function newStore(t, options = {}) {
  const root = await rootDirectory(t);
  const directory = path.join(root, "account");
  const store = await UsdAccountJournalStore.createNew(directory, {
    binding: BINDING,
    ...options
  });
  STORE_DIRECTORIES.set(store, directory);
  return store;
}

function storeDirectory(store) {
  return STORE_DIRECTORIES.get(store);
}

function observation(index, bid = "10000", ask = bid) {
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
      sourceId: "synthetic-usd-composition-test",
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

function decision(action, quantityBtc = null) {
  return {action, quantityBtc, reason: null};
}

function fixtureFeed(...observations) {
  let index = 0;
  return Object.freeze({
    async fetchObservation() {
      const next = observations[index++];
      if (!next) throw new Error("SYNTHETIC_FEED_EXHAUSTED");
      return next;
    }
  });
}

test("host start is permanently disabled without touching an injected feed", () => {
  let fetches = 0;
  assert.equal(HOST.enabled, false);
  assert.equal(HOST.executionEnabled, false);
  assert.equal(HOST.initialCapitalCents, 100_000);
  assert.equal(HOST.maxDrawdownCents, 10_000);
  assert.equal(HOST.strategyStatus, "UNAPPROVED");
  assert.equal(HOST.strategyIdentity, null);
  assert.throws(() => startUsdLivesHost({
    fetchObservation() {
      fetches++;
    }
  }), /USD_LIVES_HOST_DISABLED/);
  assert.equal(fetches, 0);
});

test("entry, exit, durable prefix replay, restart-tip admission, and continuation compose", async t => {
  let store = await newStore(t);
  const directory = storeDirectory(store);
  const retainedTips = [];
  let decisionCalls = 0;
  const entry = await runSyntheticUsdLivesFeedSample({
    feed: fixtureFeed(observation(1)),
    store,
    decide() {
      decisionCalls++;
      return decision("BUY", "0.009");
    },
    retainRestartTip(tip) {
      retainedTips.push(tip);
    }
  });
  assert.equal(entry.replay.entries.length, 1);
  assert.equal(decisionCalls, 1);
  const firstTip = structuredClone(retainedTips[0]);
  await store.close();

  await assert.rejects(UsdAccountJournalStore.reopenExisting(directory, {
    binding: BINDING,
    expectedTip: {...firstTip, digest: "0".repeat(64)}
  }), /STALE_EXPECTED_TIP/);
  store = await UsdAccountJournalStore.reopenExisting(directory, {
    binding: BINDING,
    expectedTip: firstTip
  });
  let resumedDecisionCalls = 0;
  const exit = await runSyntheticUsdLivesObservation({
    store,
    observation: observation(2),
    decide() {
      resumedDecisionCalls++;
      return decision("SELL", "0.009");
    },
    retainRestartTip(tip) {
      retainedTips.push(tip);
    }
  });
  assert.equal(resumedDecisionCalls, 1);
  assert.equal(decisionCalls, 1);
  assert.deepEqual(exit.replay.entries.map(item => item.event.id), [
    "synthetic-observation-1", "synthetic-observation-2"
  ]);
  assert.equal(exit.replay.activity.completedRoundTrips, 1);
  const fillFeesCents = exit.replay.entries.reduce(
    (total, item) => total + (item.fill?.feeCents ?? 0), 0);
  assert.equal(exit.replay.activity.modeledFeesCents, fillFeesCents);
  assert.equal(exit.report.costs.modeledFeesCents, fillFeesCents);
  assert.equal(fillFeesCents,
    exit.replay.entries[0].fill.feeCents + exit.replay.entries[1].fill.feeCents);
  const finalTip = structuredClone(retainedTips[1]);
  await store.close();

  store = await UsdAccountJournalStore.reopenExisting(directory, {
    binding: BINDING,
    expectedTip: finalTip
  });
  assert.equal(store.replay.entries.length, 2);
  assert.deepEqual(store.tip, finalTip);
  assert.equal(retainedTips.length, 2);
  await store.close();
});

test("reopened account blocks feed acquisition until campaign-wide budgets are reviewed", async t => {
  for (const withCommittedEvent of [false, true]) {
    let store = await newStore(t);
    const directory = storeDirectory(store);
    let expectedTip = store.tip;
    if (withCommittedEvent) {
      const first = await runSyntheticUsdLivesObservation({
        store,
        observation: observation(1),
        decide: () => decision("HOLD"),
        retainRestartTip() {}
      });
      expectedTip = structuredClone(first.tip);
    }
    await store.close();

    store = await UsdAccountJournalStore.reopenExisting(directory, {
      binding: BINDING,
      expectedTip
    });
    assert.equal(store.createdNew, false);
    let feedCalls = 0;
    await assert.rejects(runSyntheticUsdLivesFeedSample({
      feed: {
        async fetchObservation() {
          feedCalls++;
          return observation(2);
        }
      },
      store,
      decide: () => decision("HOLD"),
      retainRestartTip() {}
    }), /USD_CAMPAIGN_FEED_BUDGET_REVIEW_REQUIRED/);
    assert.equal(feedCalls, 0);
    assert.equal(store.replay.entries.length, withCommittedEvent ? 1 : 0);
    await store.close();
  }
});

test("zero-trade and stale or wrong-currency observations fail closed", async t => {
  const store = await newStore(t);
  const retainedTips = [];
  const noTrade = await runSyntheticUsdLivesObservation({
    store,
    observation: observation(1),
    decide: () => decision("HOLD"),
    retainRestartTip: tip => retainedTips.push(tip)
  });
  assert.equal(noTrade.replay.entries.length, 1);
  assert.equal(noTrade.replay.activity.completedRoundTrips, 0);
  assert.equal(noTrade.replay.activity.netPnlCents, 0);
  assert.equal(noTrade.acceptance.kind, "SYNTHETIC_FIXTURE_INPUT");
  assert.equal(Object.hasOwn(noTrade.acceptance, "networkRequests"), false);
  assert.equal(retainedTips.length, 1);

  const callerAssertion = observation(2);
  callerAssertion.quote.evidenceKind = "OFFLINE_CALLER_ASSERTION";
  let decisions = 0;
  await assert.rejects(runSyntheticUsdLivesObservation({
    store,
    observation: callerAssertion,
    decide() {
      decisions++;
      return decision("HOLD");
    },
    retainRestartTip() {}
  }), /SYNTHETIC_FIXTURE_REQUIRED/);

  const stale = observation(3);
  stale.quote.quotedAtMs -= POLICY.maxValuationAgeMs + 1;
  stale.quote.receivedAtMs = stale.quote.quotedAtMs;
  await assert.rejects(runSyntheticUsdLivesObservation({
    store,
    observation: stale,
    decide() {
      decisions++;
      return decision("HOLD");
    },
    retainRestartTip() {}
  }), /STALE_OR_FUTURE_QUOTE/);

  const wrongCurrencyStore = await newStore(t);
  const wrongCurrency = observation(1);
  wrongCurrency.quote.marketPair = "BTC/EUR";
  wrongCurrency.quote.quoteCurrency = "EUR";
  await assert.rejects(runSyntheticUsdLivesObservation({
    store: wrongCurrencyStore,
    observation: wrongCurrency,
    decide() {
      decisions++;
      return decision("HOLD");
    },
    retainRestartTip() {}
  }), /NATIVE_USD_INSTRUMENT_REQUIRED/);
  assert.equal(decisions, 0);
  assert.equal(wrongCurrencyStore.replay.entries.length, 0);
  await wrongCurrencyStore.close();
  await store.close();
});

test("drawdown latches with overshoot; paused entry is blocked and risk-reducing exit remains", async t => {
  const store = await newStore(t);
  const retainedTips = [];
  const inputs = [
    {input: observation(1, "9990"), action: decision("BUY", "0.01")},
    {input: observation(2, "0.01"), action: decision("HOLD")},
    {input: observation(3, "0.01"), action: decision("BUY", "0.001")},
    {input: observation(4, "0.01"), action: decision("SELL", "0.01")}
  ];
  let result;
  for (const {input, action} of inputs) {
    result = await runSyntheticUsdLivesObservation({
      store,
      observation: input,
      decide: () => action,
      retainRestartTip: tip => retainedTips.push(tip)
    });
  }
  assert.equal(result.replay.guardState.paused, true);
  assert.ok(result.report.drawdownUsedCents >= POLICY.maxDrawdownCents);
  assert.ok(result.report.drawdownUsedCents > POLICY.maxDrawdownCents);
  assert.equal(result.replay.entries[2].skipReason, "DRAWDOWN_PAUSED");
  assert.equal(result.replay.entries[3].fill.side, "SELL");
  assert.equal(result.replay.account.inventorySatoshis, "0");
  assert.equal(result.replay.guardState.paused, true);
  assert.equal(retainedTips.length, 4);
  await store.close();
});

test("journal exhaustion stops before decision or append", async () => {
  const entries = Array.from({length: MAX_USD_ACCOUNT_JOURNAL_EVENTS}, (_, index) => ({
    event: {
      id: `synthetic-prefix-${index}`,
      observedAtMs: BASE + index,
      quote: observation(index).quote
    }
  }));
  const store = {
    replay: {entries},
    append() {
      throw new Error("APPEND_MUST_NOT_RUN");
    }
  };
  await assert.rejects(runSyntheticUsdLivesObservation({
    store,
    observation: observation(300),
    decide() {
      throw new Error("DECISION_MUST_NOT_RUN");
    },
    retainRestartTip() {
      throw new Error("TIP_MUST_NOT_BE_RETAINED");
    }
  }), /ACCOUNT_JOURNAL_LIMIT_REACHED/);

  const feedStore = {
    ...store,
    replay: {entries},
    append() {
      throw new Error("APPEND_MUST_NOT_RUN");
    }
  };
  let feedCalls = 0;
  await assert.rejects(runSyntheticUsdLivesFeedSample({
    feed: {
      async fetchObservation() {
        feedCalls++;
        return observation(300);
      }
    },
    store: feedStore,
    decide: () => decision("HOLD"),
    retainRestartTip() {}
  }), /ACCOUNT_JOURNAL_LIMIT_REACHED/);
  assert.equal(feedCalls, 0);
});

test("feed exhaustion stops without decision, append, retry, or tip handoff", async t => {
  const store = await newStore(t);
  let feedCalls = 0;
  let decisions = 0;
  let retainedTips = 0;
  const feed = Object.freeze({
    async fetchObservation() {
      feedCalls++;
      throw new Error("EVENT_LIMIT_REACHED");
    }
  });
  await assert.rejects(runSyntheticUsdLivesFeedSample({
    feed,
    store,
    decide() {
      decisions++;
      return decision("HOLD");
    },
    retainRestartTip() {
      retainedTips++;
    }
  }), /EVENT_LIMIT_REACHED/);
  assert.equal(feedCalls, 1);
  assert.equal(decisions, 0);
  assert.equal(retainedTips, 0);
  assert.equal(store.replay.entries.length, 0);
  await store.close();
});

test("feed adapter replacement cannot renew instance-scoped campaign budgets", async t => {
  const store = await newStore(t);
  const originalFeed = fixtureFeed(observation(1), observation(2));
  let replacementFeedCalls = 0;
  await runSyntheticUsdLivesFeedSample({
    feed: originalFeed,
    store,
    decide: () => decision("HOLD"),
    retainRestartTip() {}
  });
  let decisions = 0;
  let tipCalls = 0;
  await assert.rejects(runSyntheticUsdLivesFeedSample({
    feed: {
      async fetchObservation() {
        replacementFeedCalls++;
        return observation(2);
      }
    },
    store,
    decide() {
      decisions++;
      return decision("HOLD");
    },
    retainRestartTip() {
      tipCalls++;
    }
  }), /USD_CAMPAIGN_FEED_INSTANCE_CHANGED/);
  assert.equal(replacementFeedCalls, 0);
  assert.equal(decisions, 0);
  assert.equal(tipCalls, 0);
  assert.equal(store.replay.entries.length, 1);
  await store.close();
});

for (const failedEntryPoint of ["observation", "feed"]) {
  test(`tip-retention failure latches the store session after ${failedEntryPoint} entry`, async t => {
    const store = await newStore(t);
    const append = store.append.bind(store);
    let appendCalls = 0;
    store.append = async event => {
      appendCalls++;
      return append(event);
    };
    let feedCalls = 0;
    let decisionCalls = 0;
    let tipCalls = 0;
    const feed = {
      async fetchObservation() {
        feedCalls++;
        return observation(1);
      }
    };
    const decide = () => {
      decisionCalls++;
      return decision("HOLD");
    };
    const retainRestartTip = async () => {
      tipCalls++;
      throw new Error("tip retention outcome unknown");
    };

    const initialCall = failedEntryPoint === "feed"
      ? runSyntheticUsdLivesFeedSample({feed, store, decide, retainRestartTip})
      : runSyntheticUsdLivesObservation({
        store, observation: observation(1), decide, retainRestartTip
      });
    await assert.rejects(initialCall, /tip retention outcome unknown/);
    assert.equal(store.replay.entries.length, 1);
    assert.equal(store.replay.entries[0].event.id, "synthetic-observation-1");
    assert.equal(appendCalls, 1);

    await assert.rejects(runSyntheticUsdLivesObservation({
      store,
      observation: observation(2),
      decide,
      retainRestartTip
    }), /USD_COMPOSITION_SESSION_FAILED/);
    await assert.rejects(runSyntheticUsdLivesFeedSample({
      feed,
      store,
      decide,
      retainRestartTip
    }), /USD_COMPOSITION_SESSION_FAILED/);

    assert.equal(store.replay.entries.length, 1);
    assert.equal(feedCalls, failedEntryPoint === "feed" ? 1 : 0);
    assert.equal(decisionCalls, 1);
    assert.equal(appendCalls, 1);
    assert.equal(tipCalls, 1);
    await store.close();
  });
}

test("ambiguous writer interruption remains unknown and receives no retry", async t => {
  let injectFailure = false;
  const store = await newStore(t, {
    onPhase(phase) {
      if (injectFailure && phase === "after-rename") {
        throw new Error("synthetic interrupted writer");
      }
    }
  });
  injectFailure = true;
  let retainedTips = 0;
  await assert.rejects(runSyntheticUsdLivesObservation({
    store,
    observation: observation(1),
    decide: () => decision("HOLD"),
    retainRestartTip() {
      retainedTips++;
    }
  }), {code: "ACCOUNT_COMMIT_UNKNOWN"});
  assert.equal(retainedTips, 0);
  assert.throws(() => store.tip, /ACCOUNT_RECOVERY_REQUIRED/);
  assert.equal((await inspectUsdAccountJournal(storeDirectory(store))).status, "UNKNOWN");
});

test("finite offline acceptance emits synthetic-only non-readiness summary", () => {
  const child = spawnSync(process.execPath, [ACCEPTANCE_CLI], {
    encoding: "utf8",
    timeout: 30_000
  });
  assert.equal(child.status, 0, child.stderr);
  const summary = JSON.parse(child.stdout);
  assert.equal(summary.schemaVersion, "USD_BTC_LIVES_OFFLINE_ACCEPTANCE_V1");
  assert.equal(summary.status, "PASS");
  assert.equal(summary.evidenceKind, "SYNTHETIC_FIXTURE_ONLY");
  assert.equal(summary.strategyStatus, "UNAPPROVED");
  assert.equal(summary.hostEnabled, false);
  assert.equal(summary.executionEnabled, false);
  assert.equal(summary.networkRequests, 0);
  assert.equal(summary.observations, 2);
  assert.equal(summary.completedRoundTrips, 1);
  assert.equal(summary.profitability, "NOT_ASSESSED");
  assert.equal(summary.productionReadiness, "NOT_ASSESSED");
});
