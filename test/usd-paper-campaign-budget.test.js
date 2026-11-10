import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectUsdCampaignBudget, MAX_USD_CAMPAIGN_BUDGET_BYTES, UsdCampaignBudget
} from "../scripts/usd-paper-feed/campaign-budget.mjs";
import {
  createKrakenUsdPublicFeed, USD_PAPER_FEED_LIMITS as LIMITS
} from "../scripts/usd-paper-feed/kraken-public.mjs";
import { canonicalCheckpointBytes } from "../scripts/memecoin-paper/checkpoint-store.mjs";
import { createUsdSmaCandidateConfiguration } from "../scripts/usd-paper-composition/sma-candidate.mjs";
import { UsdAccountJournalStore } from "../scripts/paper-capital-challenge/account-store.mjs";
import { createProposedUsdSmaCandidate } from "../scripts/usd-paper-composition/sma-candidate.mjs";
import {
  runProposedUsdSmaCandidateSample, USD_BTC_LIVES_HOST_CONFIGURATION as HOST, startUsdLivesHost
} from
  "../scripts/usd-paper-composition/host.mjs";

const exec = promisify(execFile);
const CHILD = fileURLToPath(new URL("./usd-paper-campaign-budget-child.mjs", import.meta.url));
const CONFIG = createUsdSmaCandidateConfiguration(1000);
const TIME = 125_000;
let networkCalls = 0;
const originalFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = () => {
    networkCalls++;
    throw new Error("NETWORK_FORBIDDEN");
  };
});
test.after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(networkCalls, 0);
});

async function setup(t, options = {}) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "usd-budget-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = path.join(parent, "budget");
  const store = await UsdCampaignBudget.createNew(directory, { configuration: CONFIG, ...options });
  t.after(() => store.close().catch(() => {}));
  return { store, directory, parent };
}

function provider(store, options = {}) {
  return createKrakenUsdPublicFeed({
    now: () => TIME, monotonicNow: () => 1,
    campaignBudget: { store, configuration: CONFIG, retainRestartTip() {} },
    ...options
  });
}

function fixture(url, atMs = TIME) {
  const minute = Math.floor(atMs / 60_000) * 60;
  const value = url.pathname.endsWith("/Ticker") ?
    { error: [], result: { XXBTZUSD: {
      a: ["43000", "1", "1"], b: ["42999", "1", "1"], c: ["43000", "1"]
    } } } :
    { error: [], result: { XXBTZUSD: [
      [minute - 60, "42000", "44000", "41000", "43000", "43000", "1", 1],
      [minute, "42000", "44000", "41000", "43000", "43000", "1", 1]
    ], last: minute } };
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

async function complete(store, atMs, bytes = 10) {
  const sample = await store.beginSample(atMs);
  for (const endpoint of ["Ticker", "OHLC"]) {
    const reservation = await store.reserveRequest(sample, endpoint, atMs);
    await store.finalizeRequest(reservation, bytes, "SUCCESS");
  }
  await store.completeSample(sample);
}

test("durable reservation and independent tip handoff precede each causal transport", async t => {
  const { store, directory } = await setup(t);
  let retained;
  let calls = 0;
  let expectedUsed = 0;
  const events = [];
  const feed = provider(store, {
    campaignBudget: {
      store, configuration: CONFIG,
      retainRestartTip(tip) { retained = structuredClone(tip); }
    },
    fetchImpl: async url => {
      calls++;
      const inspected = await inspectUsdCampaignBudget(directory, { configuration: CONFIG });
      assert.equal(inspected.requests, calls);
      assert.equal(inspected.pendingSample.activeRequest, calls);
      assert.deepEqual(inspected.tip, retained);
      assert.equal(store.snapshot().chargedBytes, calls * LIMITS.maxResponseBytes);
      events.push(url.pathname.split("/").at(-1));
      const response = fixture(url);
      expectedUsed += (await response.clone().arrayBuffer()).byteLength;
      return response;
    }
  });
  const result = await feed.fetchCausalSample({ decide() { events.push("decide"); return "HOLD"; } });
  assert.equal(result.observation.quote.quoteCurrency, "USD");
  assert.deepEqual(events, ["OHLC", "decide", "Ticker"]);
  const state = store.snapshot();
  assert.equal(state.samples, 1);
  assert.equal(state.requests, 2);
  assert.equal(state.usedBytes, expectedUsed);
  assert.equal(state.reservedBytes, 2 * LIMITS.maxResponseBytes - expectedUsed);
  assert.equal(state.chargedBytes, state.usedBytes + state.reservedBytes);
  assert.equal(state.pendingSample, null);
  assert.deepEqual(state.tip, retained);
});

test("process-style reopen is inspection-only without external tip and retains allowance with it", async t => {
  const { store, directory } = await setup(t);
  const initialTip = structuredClone(store.tip);
  await store.close();
  const { stdout } = await exec(process.execPath, [
    CHILD, directory, JSON.stringify(CONFIG), JSON.stringify(initialTip), "continue"
  ]);
  const child = JSON.parse(stdout);
  assert.equal(child.requests, 2);
  assert.equal(child.usedBytes, 16);
  const inspection = await UsdCampaignBudget.reopenExisting(directory, { configuration: CONFIG });
  assert.equal(inspection.snapshot().writable, false);
  await assert.rejects(inspection.beginSample(TIME + 60_000), /INSPECTION_ONLY/);
  await inspection.close();
  await assert.rejects(UsdCampaignBudget.reopenExisting(directory, {
    configuration: CONFIG, expectedTip: initialTip
  }), /MISMATCHED.*TIP/);
  const reopened = await UsdCampaignBudget.reopenExisting(directory, {
    configuration: CONFIG, expectedTip: child.tip
  });
  t.after(() => reopened.close().catch(() => {}));
  await provider(reopened, { now: () => TIME + 60_000,
    fetchImpl: async url => fixture(url, TIME + 60_000) }).fetchObservation();
  assert.equal(reopened.snapshot().requests, 4);
  assert.equal(reopened.snapshot().chargedBytes, 4 * LIMITS.maxResponseBytes);
});

test("rollback, mismatched configuration/tip/limits, corruption, and symlinks are rejected", async t => {
  const { store, directory } = await setup(t);
  const file = path.join(directory, "checkpoint.json");
  const oldBytes = await readFile(file);
  await complete(store, TIME);
  const expectedTip = structuredClone(store.tip);
  await store.close();
  const goodBytes = await readFile(file);
  await writeFile(file, oldBytes);
  await assert.rejects(UsdCampaignBudget.reopenExisting(directory, {
    configuration: CONFIG, expectedTip
  }), /MISMATCHED.*TIP/);
  await writeFile(file, goodBytes);
  for (const key of ["campaignId", "currency", "strategyVersion", "sourceVersion", "costVersion",
    "candidateNotionalCents"]) {
    const changed = { ...CONFIG, [key]: key === "candidateNotionalCents" ? 999 : "wrong" };
    await assert.rejects(UsdCampaignBudget.reopenExisting(directory, {
      configuration: changed, expectedTip
    }), /CONFIGURATION|NOTIONAL/);
  }
  await assert.rejects(UsdCampaignBudget.reopenExisting(directory, {
    configuration: CONFIG, expectedTip: { ...expectedTip, configurationDigest: "0".repeat(64) }
  }), /MISMATCHED.*TIP/);
  const changed = JSON.parse(goodBytes);
  changed.limits.maxRequests++;
  await writeFile(file, canonicalCheckpointBytes(changed));
  await assert.rejects(UsdCampaignBudget.reopenExisting(directory, {
    configuration: CONFIG, expectedTip
  }), /SCHEMA_MISMATCH/);
  await writeFile(file, "{");
  assert.equal((await inspectUsdCampaignBudget(directory, { configuration: CONFIG })).status, "CORRUPT");
  await assert.rejects(UsdCampaignBudget.reopenExisting(directory, {
    configuration: CONFIG, expectedTip
  }), /CORRUPT/);
  await assert.rejects(UsdCampaignBudget.createNew(directory, { configuration: CONFIG }), /EEXIST/);
  await writeFile(file, goodBytes);
  const { symlink } = await import("node:fs/promises");
  const link = path.join(path.dirname(directory), "link");
  await symlink(directory, link);
  await assert.rejects(UsdCampaignBudget.reopenExisting(link, {
    configuration: CONFIG, expectedTip
  }), /UNSAFE/);
});

test("single writer and simultaneous reservations cannot overdraw or replace pending samples", async t => {
  const { store, directory } = await setup(t);
  await assert.rejects(UsdCampaignBudget.reopenExisting(directory, {
    configuration: CONFIG, expectedTip: store.tip
  }), /already has an owner/);
  const sample = await store.beginSample(TIME);
  const results = await Promise.allSettled([
    store.reserveRequest(sample, "Ticker", TIME),
    store.reserveRequest(sample, "OHLC", TIME)
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.match(results.find(result => result.status === "rejected").reason.message, /BUSY/);
  assert.equal(store.snapshot().requests, 1);
  await assert.rejects(store.beginSample(TIME + 60_000), /PENDING/);
  const tip = structuredClone(store.tip);
  await store.close();
  const reopened = await UsdCampaignBudget.reopenExisting(directory, {
    configuration: CONFIG, expectedTip: tip
  });
  assert.equal(reopened.snapshot().requests, 1);
  assert.equal(reopened.snapshot().reservedBytes, LIMITS.maxResponseBytes);
  await assert.rejects(reopened.reserveRequest(sample, "OHLC", TIME), /INSPECTION_ONLY/);
  await reopened.close();
});

test("durable cadence and span survive adapter replacement without transport", async t => {
  const { store } = await setup(t);
  await provider(store, { fetchImpl: async url => fixture(url) }).fetchObservation();
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("UNEXPECTED_TRANSPORT"); };
  await assert.rejects(provider(store, { fetchImpl }).fetchObservation(), /INTERVAL/);
  await assert.rejects(provider(store, {
    now: () => TIME + LIMITS.maxSpanMs + 1, fetchImpl
  }).fetchObservation(), /WINDOW_LIMIT/);
  assert.equal(calls, 0);
  assert.equal(store.snapshot().requests, 2);
});

test("conservative 32MiB exhaustion survives a new adapter and verified reopen", async t => {
  const { store, directory } = await setup(t);
  for (let index = 0; index < 128; index++) await complete(store, TIME + index * 60_000);
  const state = store.snapshot();
  assert.equal(state.requests, 256);
  assert.equal(state.samples, 128);
  assert.equal(state.usedBytes, 2560);
  assert.equal(state.chargedBytes, LIMITS.maxBytes);
  assert.equal(state.reservedBytes, LIMITS.maxBytes - state.usedBytes);
  assert.ok((await stat(path.join(directory, "checkpoint.json"))).size < MAX_USD_CAMPAIGN_BUDGET_BYTES);
  const expectedTip = structuredClone(store.tip);
  await store.close();
  const reopened = await UsdCampaignBudget.reopenExisting(directory, {
    configuration: CONFIG, expectedTip
  });
  t.after(() => reopened.close().catch(() => {}));
  let calls = 0;
  for (let index = 0; index < 2; index++) {
    await assert.rejects(provider(reopened, {
      now: () => TIME + 128 * 60_000,
      fetchImpl: async () => { calls++; throw new Error("UNEXPECTED_TRANSPORT"); }
    }).fetchObservation(), /BYTE_BUDGET_EXHAUSTED/);
  }
  assert.equal(calls, 0);
  assert.equal(reopened.snapshot().chargedBytes, LIMITS.maxBytes);
  assert.deepEqual(reopened.tip, expectedTip);
});

test("failed, non-2xx, partial, malformed, wrong-type and overflow attempts never refund", async t => {
  const cases = [
    { name: "transport", fetchImpl: async () => { throw new Error("FIXTURE_FAILURE"); }, bytes: 0 },
    { name: "non-2xx", fetchImpl: async () => new Response("denied", { status: 503 }), bytes: 6 },
    { name: "wrong-type", fetchImpl: async () => new Response("bad"), bytes: 3 },
    { name: "malformed", fetchImpl: async () => new Response("{", {
      headers: { "content-type": "application/json" }
    }), bytes: 1 },
    { name: "partial", fetchImpl: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from("partial")); },
      pull() { throw new Error("PARTIAL_FIXTURE"); }
    }), { headers: { "content-type": "application/json" } }), bytes: 7 },
    { name: "truncated", fetchImpl: async () => new Response("{}", {
      headers: { "content-type": "application/json", "content-length": "3" }
    }), bytes: 2 },
    { name: "overflow", fetchImpl: async () => new Response("x".repeat(LIMITS.maxResponseBytes + 1), {
      headers: { "content-type": "application/json" }
    }), bytes: LIMITS.maxResponseBytes + 1 }
  ];
  for (const item of cases) await t.test(item.name, async st => {
    const { store, directory } = await setup(st);
    let calls = 0;
    const feed = provider(store, { fetchImpl: async (...args) => { calls++; return item.fetchImpl(...args); } });
    await assert.rejects(feed.fetchObservation());
    const state = store.snapshot();
    assert.equal(state.requests, 1);
    assert.equal(state.usedBytes, item.bytes);
    assert.equal(state.reservedBytes, Math.max(0, LIMITS.maxResponseBytes - item.bytes));
    assert.equal(state.chargedBytes, LIMITS.maxResponseBytes);
    assert.equal(state.terminal, true);
    await assert.rejects(feed.fetchObservation(), /TERMINAL/);
    await assert.rejects(provider(store, { fetchImpl: item.fetchImpl }).fetchObservation(), /TERMINAL/);
    assert.equal(calls, 1);
    const expectedTip = structuredClone(store.tip);
    await store.close();
    const reopened = await UsdCampaignBudget.reopenExisting(directory, {
      configuration: CONFIG, expectedTip
    });
    assert.equal(reopened.snapshot().writable, false);
    assert.equal(reopened.snapshot().usedBytes, item.bytes);
    await reopened.close();
  });
});

test("timeout with partial body and late completion keeps the full charge and frozen known bytes", async t => {
  for (const partial of [false, true]) await t.test(String(partial), async st => {
    const { store } = await setup(st);
    let resolveFetch;
    let resolveRead;
    let cancelled = 0;
    const lateResponse = { ok: true, headers: new Headers({ "content-type": "application/json" }),
      body: { cancel() { cancelled++; }, getReader() {
        let reads = 0;
        return {
          read() {
            if (reads++ === 0) return Promise.resolve({ done: false, value: Buffer.from("abc") });
            return new Promise(resolve => { resolveRead = resolve; });
          },
          cancel() { cancelled++; }, releaseLock() {}
        };
      } } };
    const feed = provider(store, {
      requestTimeoutMs: 10,
      fetchImpl: async () => partial ? lateResponse : new Promise(resolve => { resolveFetch = resolve; })
    });
    await assert.rejects(feed.fetchObservation(), /TIMEOUT/);
    const before = store.snapshot();
    assert.equal(before.usedBytes, partial ? 3 : 0);
    assert.equal(before.chargedBytes, LIMITS.maxResponseBytes);
    if (partial) resolveRead({ done: false, value: Buffer.from("late") });
    else resolveFetch(lateResponse);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(store.snapshot(), before);
    assert.ok(cancelled > 0);
    await assert.rejects(provider(store).fetchObservation(), /TERMINAL/);
  });
});

test("abort or deadline expiry during awaited reservation cannot dispatch transport", async t => {
  for (const abort of [true, false]) await t.test(String(abort), async st => {
    const { store } = await setup(st);
    const controller = new AbortController();
    let monotonic = 1;
    let calls = 0;
    const feed = provider(store, {
      signal: controller.signal, monotonicNow: () => monotonic,
      campaignBudget: { store, configuration: CONFIG, retainRestartTip(tip) {
        if (tip.revision === 2) {
          if (abort) controller.abort();
          else monotonic += LIMITS.requestTimeoutMs;
        }
      } },
      fetchImpl: async url => { calls++; return fixture(url); }
    });
    await assert.rejects(feed.fetchObservation(), abort ? /ABORTED/ : /TIMEOUT/);
    assert.equal(calls, 0);
    assert.equal(store.snapshot().requests, 1);
    assert.equal(store.snapshot().chargedBytes, LIMITS.maxResponseBytes);
    assert.equal(store.snapshot().usedBytes, 0);
  });
});

test("post-response validation or decision failure stops the campaign without refund", async t => {
  for (const causal of [false, true]) await t.test(String(causal), async st => {
    const { store, directory } = await setup(st);
    let calls = 0;
    const feed = provider(store, { fetchImpl: async url => {
      calls++;
      const response = fixture(url);
      if (!causal && url.pathname.endsWith("/Ticker")) {
        const data = await response.json();
        data.result.XXBTZEUR = data.result.XXBTZUSD;
        delete data.result.XXBTZUSD;
        return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
      }
      return response;
    } });
    await assert.rejects(causal ?
      feed.fetchCausalSample({ decide() { throw new Error("FIXTURE_DECISION_FAILURE"); } }) :
      feed.fetchObservation(), causal ? /DECISION_FAILURE/ : /UNEXPECTED_TICKER_PAIR/);
    const state = store.snapshot();
    assert.equal(calls, causal ? 1 : 2);
    assert.equal(state.requests, calls);
    assert.equal(state.pendingSample.requests, calls);
    assert.equal(state.pendingSample.activeRequest, null);
    assert.equal(state.terminal, true);
    assert.equal(state.usedBytes + state.reservedBytes, calls * LIMITS.maxResponseBytes);
    assert.equal(state.chargedBytes, calls * LIMITS.maxResponseBytes);
    const expectedTip = structuredClone(store.tip);
    await store.close();
    const reopened = await UsdCampaignBudget.reopenExisting(directory, {
      configuration: CONFIG, expectedTip
    });
    assert.equal(reopened.snapshot().writable, false);
    assert.throws(() => provider(reopened), /INSPECTION_ONLY/);
    await reopened.close();
  });
});

test("failed durable writes or tip handoff cause zero subsequent transport, including new adapters", async t => {
  for (const sequence of [1, 2, 3, 4, 5, 6]) for (const phase of ["before-pending", "after-rename"]) {
    await t.test(`${sequence}:${phase}`, async st => {
      const { store, directory } = await setup(st, { onPhase(name, details) {
        if (details.sequence === sequence && name === phase) throw new Error("INJECTED_WRITE_FAILURE");
      } });
      let calls = 0;
      const feed = provider(store, { fetchImpl: async url => { calls++; return fixture(url); } });
      await assert.rejects(feed.fetchObservation(), /BLOCKED|WRITE_/);
      const expectedCalls = Math.floor((sequence - 1) / 2);
      assert.equal(calls, expectedCalls);
      await assert.rejects(feed.fetchObservation(), /TERMINAL/);
      assert.throws(() => provider(store), /BLOCKED/);
      assert.equal(calls, expectedCalls);
      if (phase === "after-rename") {
        assert.equal((await inspectUsdCampaignBudget(directory, { configuration: CONFIG })).status, "UNKNOWN");
      }
    });
  }
  for (let sequence = 1; sequence <= 6; sequence++) await t.test(`tip-handoff:${sequence}`, async st => {
    const { store, directory } = await setup(st);
    let calls = 0;
    const feed = provider(store, {
      campaignBudget: { store, configuration: CONFIG,
        retainRestartTip(tip) {
          if (tip.revision === sequence) throw new Error("TIP_HANDOFF_FAILED");
        } },
      fetchImpl: async url => { calls++; return fixture(url); }
    });
    await assert.rejects(feed.fetchObservation(), /BLOCKED|TIP_HANDOFF/);
    assert.equal(calls, Math.floor((sequence - 1) / 2));
    const state = store.snapshot();
    assert.equal(state.requests, Math.min(2, Math.floor(sequence / 2)));
    assert.equal(state.usedBytes + state.reservedBytes, state.chargedBytes);
    assert.equal(state.writable, false);
    assert.equal(state.tip.revision, sequence);
    if (sequence === 2 || sequence === 4) {
      assert.equal(state.pendingSample.activeRequest, sequence / 2);
    }
    if (sequence === 6) assert.equal(state.pendingSample, null);
    else assert.notEqual(state.pendingSample, null);
    const inspected = await inspectUsdCampaignBudget(directory, { configuration: CONFIG });
    assert.equal(inspected.status, "OK");
    assert.equal(inspected.reservedBytes, state.reservedBytes);
    assert.deepEqual(inspected.tip, state.tip);
    await assert.rejects(feed.fetchObservation(), /TERMINAL/);
    assert.throws(() => provider(store), /BLOCKED/);
  });
});

test("durable budget admission cannot unblock reopened accounts or redecide account events", async t => {
  const { store, parent } = await setup(t);
  const directory = path.join(parent, "account");
  const binding = {
    campaignId: CONFIG.campaignId, currency: CONFIG.currency,
    strategyVersion: CONFIG.strategyVersion, costVersion: CONFIG.costVersion
  };
  let account = await UsdAccountJournalStore.createNew(directory, { binding });
  t.after(() => account.close().catch(() => {}));
  let accountTip;
  await runProposedUsdSmaCandidateSample({
    feed: provider(store, { fetchImpl: async url => fixture(url) }),
    store: account, candidate: createProposedUsdSmaCandidate(),
    candidateNotionalCents: CONFIG.candidateNotionalCents,
    retainStrategyEvidence() {}, retainRestartTip(tip) { accountTip = structuredClone(tip); }
  });
  assert.equal(account.replay.entries.length, 1);
  const events = structuredClone(account.replay.entries);
  await account.close();
  account = await UsdAccountJournalStore.reopenExisting(directory, {
    binding, expectedTip: accountTip
  });
  const budgetBefore = store.snapshot();
  let calls = 0;
  let decisions = 0;
  await assert.rejects(runProposedUsdSmaCandidateSample({
    feed: provider(store, { now: () => TIME + 60_000,
      fetchImpl: async url => { calls++; return fixture(url, TIME + 60_000); } }),
    store: account, candidate: {
      decide() { decisions++; throw new Error("NO_REDECISION"); }, recordSample() {}
    },
    candidateNotionalCents: CONFIG.candidateNotionalCents,
    retainStrategyEvidence() {}, retainRestartTip() {}
  }), /FEED_BUDGET_REVIEW_REQUIRED/);
  assert.equal(calls, 0);
  assert.equal(decisions, 0);
  assert.deepEqual(account.replay.entries, events);
  assert.deepEqual(account.tip, accountTip);
  assert.deepEqual(store.snapshot(), budgetBefore);
});

test("finite durable-budget acceptance summary is fixture-only and not readiness", async t => {
  const { store, directory } = await setup(t);
  let retainedTip;
  let fixtureRequests = 0;
  let atMs = TIME;
  const options = budget => ({
    now: () => atMs,
    campaignBudget: { store: budget, configuration: CONFIG,
      retainRestartTip(tip) { retainedTip = structuredClone(tip); } },
    fetchImpl: async url => { fixtureRequests++; return fixture(url, atMs); }
  });
  await provider(store, options(store)).fetchObservation();
  await store.close();
  const reopened = await UsdCampaignBudget.reopenExisting(directory, {
    configuration: CONFIG, expectedTip: retainedTip
  });
  t.after(() => reopened.close().catch(() => {}));
  atMs += 60_000;
  await provider(reopened, options(reopened)).fetchObservation();
  const state = reopened.snapshot();
  assert.equal(state.samples, 2);
  assert.equal(state.requests, 4);
  assert.equal(state.chargedBytes, 524288);
  assert.equal(state.usedBytes + state.reservedBytes, state.chargedBytes);
  assert.deepEqual(state.tip, retainedTip);
  const summary = {
    schemaVersion: "USD_CAMPAIGN_BUDGET_OFFLINE_ACCEPTANCE_V1",
    status: "PASS", evidenceKind: "SYNTHETIC_FIXTURE_ONLY",
    strategyStatus: "PROPOSED_UNAPPROVED", hostEnabled: HOST.enabled,
    executionEnabled: HOST.executionEnabled, networkRequests: networkCalls,
    fixtureRequests, samplesAcrossVerifiedReopen: state.samples,
    chargedBytes: state.chargedBytes, usedBytes: state.usedBytes,
    reservedBytes: state.reservedBytes, refundedBytes: 0,
    maximumTwoRequestSamples: 128,
    restartTipsRetainedInMemoryForAcceptanceOnly: true,
    productionReadiness: "NOT_ASSESSED"
  };
  assert.equal(summary.networkRequests, 0);
  assert.equal(summary.fixtureRequests, 4);
  t.diagnostic(JSON.stringify(summary));
});

test("process crashes at reservation/request/body/finalize boundaries retain charge or UNKNOWN", async t => {
  const cases = [
    ["write-crash", "after-pending"], ["write-crash", "after-rename"],
    ["before-transport", ""], ["partial-body", ""],
    ["finalize-crash", "before-pending"], ["finalize-crash", "after-rename"]
  ];
  for (const [mode, phase] of cases) await t.test(`${mode}:${phase}`, async st => {
    const { store, directory } = await setup(st);
    const expectedTip = structuredClone(store.tip);
    await store.close();
    await assert.rejects(exec(process.execPath, [
      CHILD, directory, JSON.stringify(CONFIG), JSON.stringify(expectedTip), mode, phase
    ]), error => error.code === 74);
    await assert.rejects(UsdCampaignBudget.reopenExisting(directory, {
      configuration: CONFIG, expectedTip
    }), /already has an owner/);
    const inspected = await inspectUsdCampaignBudget(directory, { configuration: CONFIG });
    if (mode === "write-crash" || (mode === "finalize-crash" && phase === "after-rename")) {
      assert.equal(inspected.status, "UNKNOWN");
    } else {
      assert.equal(inspected.status, "OK");
      assert.equal(inspected.requests, 1);
      assert.equal(inspected.reservedBytes, LIMITS.maxResponseBytes);
      assert.notEqual(inspected.pendingSample, null);
    }
  });
});

test("budget seam rejects mismatched configuration and preserves disabled host and exact limits", async t => {
  const { store } = await setup(t);
  assert.throws(() => provider(store, { campaignBudget: {
    store, configuration: createUsdSmaCandidateConfiguration(999), retainRestartTip() {}
  } }), /CONFIGURATION_MISMATCH/);
  assert.throws(() => provider(store, { campaignBudget: {} }), /INVALID_DURABLE/);
  assert.equal(HOST.enabled, false);
  assert.equal(HOST.executionEnabled, false);
  assert.throws(() => startUsdLivesHost(), /HOST_DISABLED/);
  assert.equal(LIMITS.maxEvents, 256);
  assert.equal(LIMITS.maxRequests, 512);
  assert.equal(LIMITS.maxResponseBytes, 128 * 1024);
  assert.equal(LIMITS.maxBytes, 32 * 1024 * 1024);
  assert.equal(LIMITS.requestTimeoutMs, 5000);
  assert.equal(LIMITS.minSampleIntervalMs, 60_000);
});
