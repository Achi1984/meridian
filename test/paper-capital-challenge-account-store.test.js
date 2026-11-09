import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {performance} from "node:perf_hooks";
import test from "node:test";
import {canonicalCheckpointBytes} from
  "../scripts/memecoin-paper/checkpoint-store.mjs";
import {
  inspectUsdAccountJournal, MAX_USD_ACCOUNT_JOURNAL_BYTES,
  MAX_USD_ACCOUNT_JOURNAL_EVENTS, MAX_USD_ACCOUNT_WINDOW_MS, UsdAccountJournalStore
} from "../scripts/paper-capital-challenge/account-store.mjs";
import {USD_MODELED_COSTS} from
  "../scripts/paper-capital-challenge/account-contract.mjs";
import {runUsdOfflineStream} from
  "../scripts/paper-capital-challenge/offline-runner.mjs";
import {PAPER_CAPITAL_CHALLENGE_POLICY as POLICY} from
  "../scripts/paper-capital-challenge/policy.mjs";

const BASE = Date.UTC(2025, 0, 1);
const BINDING = Object.freeze({
  campaignId: POLICY.campaignId,
  currency: "USD",
  strategyVersion: "synthetic-store-test-v1",
  costVersion: USD_MODELED_COSTS.version
});
const CHILD_FIXTURE = fileURLToPath(new URL(
  "./paper-capital-challenge-account-store-child.mjs", import.meta.url));

async function tempDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "usd-account-journal-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

function quote(index, bid = "10000", ask = bid, atMs = BASE + index * 1000) {
  return {
    schemaVersion: "NATIVE_BTC_USD_QUOTE_V1",
    id: `quote-${index}`,
    marketPair: "BTC/USD",
    baseCurrency: "BTC",
    quoteCurrency: "USD",
    sourceId: "synthetic-usd-book",
    nativeInstrument: "BTC/USD",
    evidenceKind: "SYNTHETIC_FIXTURE",
    bid,
    ask,
    quotedAtMs: atMs,
    receivedAtMs: atMs,
    maxAgeMs: 10_000
  };
}

function event(index, action = "HOLD", options = {}) {
  const observedAtMs = options.observedAtMs ?? BASE + index * 1000;
  return {
    id: `event-${index}`,
    ...BINDING,
    observedAtMs,
    action,
    quote: options.quote ?? quote(index, "10000", "10000", observedAtMs),
    quantityBtc: ["BUY", "SELL"].includes(action) ? "0.009" : null,
    feeCents: 0,
    reason: null,
    ...options
  };
}

function observation(index, bid = "10000", ask = bid) {
  const observedAtMs = BASE + index * 1000;
  return {
    id: `event-${index}`,
    observedAtMs,
    quote: quote(index, bid, ask, observedAtMs)
  };
}

function decision(action, quantityBtc = null, reason = null) {
  return {action, quantityBtc, reason};
}

async function runChild(directory, mode, tip, nextEvent, crashPhase = "") {
  const child = spawn(process.execPath, [
    CHILD_FIXTURE,
    directory,
    mode,
    JSON.stringify(BINDING),
    JSON.stringify(tip),
    JSON.stringify(nextEvent),
    crashPhase
  ], {stdio: ["ignore", "pipe", "pipe"]});
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  const [code, signal] = await once(child, "exit");
  return {code, signal, stdout, stderr};
}

test("full account journal survives child-process restart through a latched pause and exits", async t => {
  const root = await tempDirectory(t);
  const directory = path.join(root, "account");
  const store = await UsdAccountJournalStore.createNew(directory, {binding: BINDING});
  await store.append(event(0, "BUY"));
  await store.append(event(1, "HOLD", {quote: quote(1, "20000")}));
  await store.append(event(2, "HOLD", {quote: quote(2, "5000")}));
  assert.equal(store.replay.guardState.paused, true);
  const externallyRetainedTip = store.tip;
  await store.close();

  const blockedEntry = await runChild(directory, "append", externallyRetainedTip,
    event(3, "BUY", {quote: quote(3, "5000")}));
  assert.equal(blockedEntry.code, 0, blockedEntry.stderr);
  const blockedReplay = JSON.parse(blockedEntry.stdout).replay;
  assert.equal(blockedReplay.entries.at(-1).skipReason, "DRAWDOWN_PAUSED");
  assert.equal(blockedReplay.guardState.pauseObservationId, "event-2");

  const pausedTip = JSON.parse(blockedEntry.stdout).tip;
  const partialExit = await runChild(directory, "append", pausedTip,
    event(4, "SELL", {quantityBtc: "0.004", quote: quote(4, "5000")}));
  assert.equal(partialExit.code, 0, partialExit.stderr);
  assert.equal(JSON.parse(partialExit.stdout).replay.account.inventorySatoshis, "500000");

  const fullExit = await runChild(directory, "append", JSON.parse(partialExit.stdout).tip,
    event(5, "SELL", {quantityBtc: "0.005", quote: quote(5, "5000")}));
  assert.equal(fullExit.code, 0, fullExit.stderr);
  const resumed = JSON.parse(fullExit.stdout).replay;
  assert.equal(resumed.account.inventorySatoshis, "0");
  assert.equal(resumed.guardState.paused, true);
  assert.equal(resumed.guardState.pauseObservationId, "event-2");
  assert.equal(resumed.entries.at(-1).fill.side, "SELL");
  assert.equal(resumed.activity.completedRoundTrips, 1);
});

test("exact retries preserve the tip while conflicting IDs and stale external tips fail", async t => {
  const root = await tempDirectory(t);
  const directory = path.join(root, "account");
  const store = await UsdAccountJournalStore.createNew(directory, {binding: BINDING});
  const initialTip = store.tip;
  await assert.rejects(UsdAccountJournalStore.reopenExisting(directory, {
    binding: BINDING, expectedTip: initialTip
  }), {code: "CHECKPOINT_BUSY"});
  const first = event(0, "BUY");
  const committed = await store.append(first);
  const retry = await store.append(structuredClone(first));
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.tip, committed.tip);
  await assert.rejects(store.append(event(0, "BUY", {
    quote: quote(0, "9999", "9999")
  })), /CONTRADICTORY_DUPLICATE_EVENT/);
  await store.close();

  await assert.rejects(UsdAccountJournalStore.reopenExisting(directory, {
    binding: BINDING, expectedTip: initialTip
  }), /STALE_EXPECTED_TIP/);
  const reopened = await UsdAccountJournalStore.reopenExisting(directory, {
    binding: BINDING, expectedTip: committed.tip
  });
  assert.equal(reopened.replay.entries.length, 1);
  await reopened.close();
});

test("ambiguous acknowledgement blocks the writer and forbids blind retries", async t => {
  const root = await tempDirectory(t);
  const directory = path.join(root, "account");
  let inject = false;
  const store = await UsdAccountJournalStore.createNew(directory, {
    binding: BINDING,
    onPhase(phase) {
      if (inject && phase === "after-rename") throw new Error("ambiguous publication");
    }
  });
  inject = true;
  await assert.rejects(store.append(event(0)), {code: "ACCOUNT_COMMIT_UNKNOWN"});
  assert.throws(() => store.tip, /ACCOUNT_RECOVERY_REQUIRED/);
  await assert.rejects(store.append(event(0)), /ACCOUNT_RECOVERY_REQUIRED/);
  await assert.rejects(store.close(), /ACCOUNT_RECOVERY_REQUIRED/);
  assert.equal((await inspectUsdAccountJournal(directory)).status, "UNKNOWN");
});

test("confirmed pre-publication failure removes the incomplete create-only journal", async t => {
  const root = await tempDirectory(t);
  const directory = path.join(root, "account");
  await assert.rejects(UsdAccountJournalStore.createNew(directory, {
    binding: BINDING,
    onPhase(phase) {
      if (phase === "before-rename") throw new Error("confirmed pre-publication failure");
    }
  }), {code: "ACCOUNT_COMMIT_FAILED"});
  await assert.rejects(stat(directory), {code: "ENOENT"});
  const created = await UsdAccountJournalStore.createNew(directory, {binding: BINDING});
  await created.close();
});

test("a restart without the exact account strategy/cost tip is rejected", async t => {
  const root = await tempDirectory(t);
  const directory = path.join(root, "account");
  const store = await UsdAccountJournalStore.createNew(directory, {binding: BINDING});
  const tip = store.tip;
  await store.close();
  await assert.rejects(UsdAccountJournalStore.reopenExisting(directory, {
    binding: {...BINDING, strategyVersion: "other-strategy"}, expectedTip: tip
  }), /INVALID_EXPECTED_TIP/);
  await assert.rejects(UsdAccountJournalStore.reopenExisting(directory, {
    binding: BINDING, expectedTip: {...tip, costVersion: "other-cost"}
  }), /INVALID_EXPECTED_TIP/);
});

test("process crashes before and after checkpoint publication remain unknown and locked", async t => {
  for (const [phase, published] of [
    ["before-rename", false],
    ["after-rename", true]
  ]) {
    const root = await tempDirectory(t);
    const directory = path.join(root, "account");
    const store = await UsdAccountJournalStore.createNew(directory, {binding: BINDING});
    const tip = store.tip;
    await store.close();
    const child = await runChild(directory, "crash", tip, event(0), phase);
    assert.equal(child.code, 74, child.stderr);

    const checkpoint = JSON.parse(await readFile(path.join(directory, "checkpoint.json"), "utf8"));
    assert.equal(checkpoint.sequence, published ? 1 : 0);
    assert.equal((await inspectUsdAccountJournal(directory)).status, "UNKNOWN");
    await assert.rejects(UsdAccountJournalStore.reopenExisting(directory, {
      binding: BINDING, expectedTip: tip
    }), {code: "CHECKPOINT_BUSY"});
  }
});

test("corrupt transaction evidence is rejected rather than resumed from a snapshot", async t => {
  const root = await tempDirectory(t);
  const directory = path.join(root, "account");
  const store = await UsdAccountJournalStore.createNew(directory, {binding: BINDING});
  const tip = (await store.append(event(0, "BUY"))).tip;
  await store.close();
  const file = path.join(directory, "checkpoint.json");
  const checkpoint = JSON.parse(await readFile(file, "utf8"));
  checkpoint.records[1].transaction.observation.netEquityCents += 1;
  await writeFile(file, canonicalCheckpointBytes(checkpoint));
  assert.equal((await inspectUsdAccountJournal(directory)).status, "CORRUPT");
  await assert.rejects(UsdAccountJournalStore.reopenExisting(directory, {
    binding: BINDING, expectedTip: tip
  }), {code: "ACCOUNT_JOURNAL_CORRUPT"});
});

test("offline fixture replay matches uninterrupted and restart-split executions", async t => {
  const root = await tempDirectory(t);
  const fullStore = await UsdAccountJournalStore.createNew(path.join(root, "full"), {
    binding: BINDING
  });
  const splitDirectory = path.join(root, "split");
  const splitStore = await UsdAccountJournalStore.createNew(splitDirectory, {
    binding: BINDING
  });
  const fixture = [
    observation(0),
    observation(1, "20000"),
    observation(2, "5000"),
    observation(3, "5000"),
    observation(4, "5000"),
    observation(5, "5000")
  ];
  const decide = ({history}) => ({
    0: decision("BUY", "0.009"),
    1: decision("HOLD"),
    2: decision("HOLD"),
    3: decision("BUY", "0.009"),
    4: decision("SELL", "0.004"),
    5: decision("SELL", "0.005")
  })[history.length];

  const uninterrupted = await runUsdOfflineStream({
    store: fullStore, observations: fixture, decide
  });
  const firstHalf = await runUsdOfflineStream({
    store: splitStore, observations: fixture.slice(0, 3), decide
  });
  await splitStore.close();
  const resumedStore = await UsdAccountJournalStore.reopenExisting(splitDirectory, {
    binding: BINDING, expectedTip: firstHalf.tip
  });
  let suffixDecisions = 0;
  const contradictoryPrefix = structuredClone(fixture);
  contradictoryPrefix[1].quote.bid = "20001";
  contradictoryPrefix[1].quote.ask = "20001";
  await assert.rejects(runUsdOfflineStream({
    store: resumedStore,
    observations: contradictoryPrefix,
    decide() {
      suffixDecisions += 1;
      return decision("HOLD");
    }
  }), /CONTRADICTORY_DUPLICATE_EVENT/);
  assert.equal(suffixDecisions, 0);
  const secondHalf = await runUsdOfflineStream({
    store: resumedStore, observations: fixture, decide(context) {
      suffixDecisions += 1;
      return decide(context);
    }
  });
  assert.equal(suffixDecisions, 3);

  assert.deepEqual(secondHalf.replay, uninterrupted.replay);
  assert.deepEqual(secondHalf.report, uninterrupted.report);
  assert.equal(secondHalf.report.rejectedEntries.length, 1);
  assert.equal(secondHalf.report.rejectedEntries[0].reason, "DRAWDOWN_PAUSED");
  assert.equal(secondHalf.report.lastTrade.side, "SELL");
  assert.equal(secondHalf.report.netEquityCents, secondHalf.replay.activity.netEquityCents);
  assert.equal(secondHalf.report.remainingDrawdownAllowanceCents, 0);
  assert.equal(secondHalf.report.paused, true);
  const retainedTip = secondHalf.tip;
  const retainedCash = secondHalf.replay.account.cashCents;
  const retainedInventory = secondHalf.replay.account.inventorySatoshis;
  await resumedStore.close();
  const retried = await runChild(splitDirectory, "runner-retry", retainedTip, fixture);
  assert.equal(retried.code, 0, retried.stderr);
  const retriedResult = JSON.parse(retried.stdout);
  assert.deepEqual(retriedResult.tip, retainedTip);
  assert.deepEqual(retriedResult.replay, JSON.parse(JSON.stringify(secondHalf.replay)));
  assert.deepEqual(retriedResult.report, JSON.parse(JSON.stringify(secondHalf.report)));
  assert.equal(retriedResult.replay.account.cashCents, retainedCash);
  assert.equal(retriedResult.replay.account.inventorySatoshis, retainedInventory);
  await fullStore.close();
});

test("latched pause remains an entry denial after mark recovery restores allowance", async t => {
  const root = await tempDirectory(t);
  const store = await UsdAccountJournalStore.createNew(path.join(root, "recovery"), {
    binding: BINDING
  });
  const observations = [
    observation(0),
    observation(1, "20000"),
    observation(2, "5000"),
    observation(3, "20000")
  ];
  const actions = [
    decision("BUY", "0.009"),
    decision("HOLD"),
    decision("HOLD"),
    decision("HOLD")
  ];
  const result = await runUsdOfflineStream({
    store, observations, decide: ({history}) => actions[history.length]
  });

  assert.equal(result.report.paused, true);
  assert.equal(result.report.remainingDrawdownAllowanceCents, POLICY.maxDrawdownCents);
  assert.deepEqual(result.report.entryAdmission, {
    allowed: false, reason: "DRAWDOWN_PAUSED"
  });
  await store.close();
});

test("24-hour full-window storage and replay stay within declared resource limits", {
  timeout: 120_000
}, async t => {
  const root = await tempDirectory(t);
  const directory = path.join(root, "account");
  let collecting = false;
  let committedBytes = 0;
  const store = await UsdAccountJournalStore.createNew(directory, {
    binding: BINDING,
    async onPhase(phase) {
      if (collecting && phase === "after-rename") {
        committedBytes += (await stat(path.join(directory, "checkpoint.json"))).size;
      }
    }
  });
  const started = performance.now();
  collecting = true;
  for (let index = 0; index < MAX_USD_ACCOUNT_JOURNAL_EVENTS; index += 1) {
    const observedAtMs = BASE + Math.floor(index * MAX_USD_ACCOUNT_WINDOW_MS /
      MAX_USD_ACCOUNT_JOURNAL_EVENTS);
    await store.append(event(index, "HOLD", {
      observedAtMs,
      quote: quote(index, "10000", "10000", observedAtMs)
    }));
  }
  collecting = false;
  const elapsedMs = performance.now() - started;
  const tip = store.tip;
  const checkpointBytes = (await stat(path.join(directory, "checkpoint.json"))).size;
  assert.equal(store.replay.entries.length, MAX_USD_ACCOUNT_JOURNAL_EVENTS);
  assert.ok(store.replay.entries.at(-1).event.observedAtMs -
    store.replay.entries[0].event.observedAtMs <= MAX_USD_ACCOUNT_WINDOW_MS);
  assert.ok(checkpointBytes < MAX_USD_ACCOUNT_JOURNAL_BYTES);
  assert.ok(committedBytes < 64 * 1024 * 1024);
  assert.ok(elapsedMs < 120_000);
  let decisions = 0;
  const persistedPrefix = store.replay.entries.map(entry => ({
    id: entry.event.id,
    observedAtMs: entry.event.observedAtMs,
    quote: entry.event.quote
  }));
  const retriedPrefix = await runUsdOfflineStream({
    store,
    observations: persistedPrefix,
    decide() {
      decisions += 1;
      throw new Error("persisted retry must not call strategy");
    }
  });
  assert.equal(decisions, 0);
  assert.deepEqual(retriedPrefix.tip, tip);
  assert.equal(retriedPrefix.replay.entries.length, MAX_USD_ACCOUNT_JOURNAL_EVENTS);
  await assert.rejects(store.append(event(MAX_USD_ACCOUNT_JOURNAL_EVENTS, "HOLD", {
    observedAtMs: BASE + MAX_USD_ACCOUNT_WINDOW_MS
  })), /ACCOUNT_JOURNAL_LIMIT_REACHED/);
  await store.close();

  const reopened = await UsdAccountJournalStore.reopenExisting(directory, {
    binding: BINDING, expectedTip: tip
  });
  assert.equal(reopened.replay.entries.length, MAX_USD_ACCOUNT_JOURNAL_EVENTS);
  assert.equal((await stat(path.join(directory, "checkpoint.json"))).size, checkpointBytes);
  await reopened.close();
});

test("events beyond the declared 24-hour horizon fail without changing the tip", async t => {
  const root = await tempDirectory(t);
  const store = await UsdAccountJournalStore.createNew(path.join(root, "account"), {
    binding: BINDING
  });
  await store.append(event(0));
  const tip = store.tip;
  await assert.rejects(store.append(event(1, "HOLD", {
    observedAtMs: BASE + MAX_USD_ACCOUNT_WINDOW_MS + 1,
    quote: quote(1, "10000", "10000", BASE + MAX_USD_ACCOUNT_WINDOW_MS + 1)
  })), /ACCOUNT_WINDOW_LIMIT_REACHED/);
  assert.deepEqual(store.tip, tip);
  await store.close();
});
