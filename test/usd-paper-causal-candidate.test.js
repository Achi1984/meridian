import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  UsdAccountJournalStore
} from "../scripts/paper-capital-challenge/account-store.mjs";
import {USD_MODELED_COSTS} from
  "../scripts/paper-capital-challenge/account-contract.mjs";
import {PAPER_CAPITAL_CHALLENGE_POLICY as POLICY} from
  "../scripts/paper-capital-challenge/policy.mjs";
import {
  runProposedUsdSmaCandidateSample,
  USD_BTC_SMA_CANDIDATE_CONFIGURATION
} from "../scripts/usd-paper-composition/host.mjs";
import {
  createProposedUsdSmaCandidate,
  requireRestartableUsdSmaCandidate,
  USD_SMA_CANDIDATE,
  verifyProposedUsdSmaEvidence
} from "../scripts/usd-paper-composition/sma-candidate.mjs";
import {
  createKrakenUsdPublicFeed
} from "../scripts/usd-paper-feed/kraken-public.mjs";

const BASE = Date.UTC(2025, 0, 1);
const BINDING = Object.freeze({
  campaignId: POLICY.campaignId,
  currency: "USD",
  strategyVersion: USD_SMA_CANDIDATE.strategyVersion,
  costVersion: USD_MODELED_COSTS.version
});
const STORE_DIRECTORIES = new WeakMap();

async function newStore(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "usd-sma-candidate-test-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const directory = path.join(root, "account");
  const store = await UsdAccountJournalStore.createNew(directory, {
    binding: BINDING
  });
  STORE_DIRECTORIES.set(store, directory);
  return store;
}

function closeNano(value) {
  const [whole, fraction = ""] = value.split(".");
  return String(BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0")));
}

function candleEvidence(values, {
  startAtMs = BASE,
  receivedAtMs = startAtMs + (values.length * 60_000)
} = {}) {
  return {
    schemaVersion: "NATIVE_BTC_USD_CLOSED_CANDLES_V1",
    nativeInstrument: "BTC/USD",
    intervalMinutes: 1,
    responseDigest: "a".repeat(64),
    receivedAtMs,
    candles: values.map((close, index) => ({
      timestamp: startAtMs + index * 60_000,
      open: close,
      high: "12000",
      low: "8000",
      close,
      closeNano: closeNano(close)
    }))
  };
}

function recordDecision(candidate, evidence, index) {
  const decision = candidate.decide(evidence);
  const receivedAtMs = evidence.receivedAtMs;
  return candidate.recordSample({
    schemaVersion: "BTC_USD_CLOSED_CANDLE_CAUSAL_SAMPLE_V1",
    candleEvidence: evidence,
    decision,
    decisionAtMs: receivedAtMs,
    tickerRequestStartedAtMs: receivedAtMs + 1,
    tickerReceivedAtMs: receivedAtMs + 2,
    observation: {
      id: `test-observation-${index}`,
      observedAtMs: receivedAtMs + 3,
      quote: {id: `test-quote-${index}`, nativeInstrument: "BTC/USD"}
    }
  });
}

function krakenTicker(price = "43000") {
  return {
    error: [],
    result: {
      XXBTZUSD: {
        a: [price, "1", "1.25"],
        b: [price, "1", "1.25"],
        c: [price, "0.1"]
      }
    }
  };
}

function krakenOhlc(closes, current) {
  const lastClosedIndex = Math.floor((current - BASE - 60_000) / 60_000);
  const rows = closes.slice(0, lastClosedIndex + 1).map((close, index) => [
    (BASE + index * 60_000) / 1000,
    "9000", "12000", "8000", close, "10000", "1", 1
  ]);
  return {
    error: [],
    result: {
      XXBTZUSD: rows,
      last: rows.at(-1)?.[0] ?? 0
    }
  };
}

function candleRow(index, close) {
  return [
    (BASE + index * 60_000) / 1000,
    "9000", "12000", "8000", close, "10000", "1", 1
  ];
}

function response(data) {
  return new Response(JSON.stringify(data), {
    headers: {"content-type": "application/json"}
  });
}

function candidateFeed({clock, closes, quotePrices, requests, decisionCount}) {
  return createKrakenUsdPublicFeed({
    now: () => clock.current,
    monotonicNow: () => 1,
    fetchImpl: async (url, options) => {
      requests.push(url.pathname.endsWith("/OHLC") ? "OHLC" : "Ticker");
      assert.equal(options.credentials, "omit");
      if (url.pathname.endsWith("/OHLC")) {
        return response(krakenOhlc(closes, clock.current));
      }
      assert.ok(decisionCount() > 0, "ticker is requested only after the candle decision");
      return response(krakenTicker(quotePrices[clock.sample] ?? "43000"));
    }
  });
}

test("candidate identity is proposed-only and requires explicit bounded notional", () => {
  assert.equal(USD_BTC_SMA_CANDIDATE_CONFIGURATION.enabled, false);
  assert.equal(USD_BTC_SMA_CANDIDATE_CONFIGURATION.executionEnabled, false);
  assert.equal(USD_BTC_SMA_CANDIDATE_CONFIGURATION.strategyStatus,
    "PROPOSED_UNAPPROVED");
  assert.equal(USD_BTC_SMA_CANDIDATE_CONFIGURATION.warmupClosedCandles, 21);
  assert.equal(USD_BTC_SMA_CANDIDATE_CONFIGURATION.requiresExplicitEntryNotional, true);
  assert.equal(USD_BTC_SMA_CANDIDATE_CONFIGURATION.maxEntryNotionalCents, 10_000);
});

test("warmup uses 21 closed candles, has no historical entry, and identical snapshots do not repeat signals", () => {
  const candidate = createProposedUsdSmaCandidate();
  const warmup = candleEvidence(Array(21).fill("10000"));
  const firstEvidence = recordDecision(candidate, warmup, 1);
  assert.equal(firstEvidence.decision.action, "HOLD");
  assert.equal(firstEvidence.decision.warmupComplete, true);
  assert.equal(firstEvidence.decision.lastSeenAt, BASE + 20 * 60_000);
  assert.equal(firstEvidence.decision.cutoffAt, BASE + 20 * 60_000);

  const crossover = candleEvidence([...Array(21).fill("10000"), "11000"]);
  const entry = recordDecision(candidate, crossover, 2);
  assert.equal(entry.decision.action, "ENTRY");
  assert.equal(entry.decision.signal.direction, "ENTRY");
  const duplicate = recordDecision(candidate, crossover, 3);
  assert.equal(duplicate.decision.action, "HOLD");
  assert.equal(duplicate.decision.newCandleCount, 0);
});

test("candidate rejects unclosed/future evidence and preserves conflict, gap, and missed-window semantics", () => {
  const unclosed = candleEvidence(Array(21).fill("10000"), {
    receivedAtMs: BASE + 20 * 60_000 + 59_999
  });
  assert.throws(() => createProposedUsdSmaCandidate().decide(unclosed),
    /INVALID_USD_CLOSED_CANDLE/);

  const noncausal = createProposedUsdSmaCandidate();
  const decisionEvidence = candleEvidence(Array(21).fill("10000"));
  const decision = noncausal.decide(decisionEvidence);
  assert.throws(() => noncausal.recordSample({
    schemaVersion: "BTC_USD_CLOSED_CANDLE_CAUSAL_SAMPLE_V1",
    candleEvidence: decisionEvidence,
    decision,
    decisionAtMs: decisionEvidence.receivedAtMs + 2,
    tickerRequestStartedAtMs: decisionEvidence.receivedAtMs + 1,
    tickerReceivedAtMs: decisionEvidence.receivedAtMs + 3,
    observation: {
      id: "predecision-quote",
      observedAtMs: decisionEvidence.receivedAtMs + 4,
      quote: {id: "predecision-quote", nativeInstrument: "BTC/USD"}
    }
  }), /NONCAUSAL_STRATEGY_EVIDENCE/);

  const conflict = createProposedUsdSmaCandidate();
  recordDecision(conflict, candleEvidence(Array(21).fill("10000")), 1);
  const changedClose = [...Array(20).fill("10000"), "10100", "11000"];
  assert.throws(() => conflict.decide(candleEvidence(changedClose)),
    /CONFLICTING_CLOSED_CANDLE/);

  const gap = createProposedUsdSmaCandidate();
  recordDecision(gap, candleEvidence(Array(21).fill("10000")), 1);
  const missingMinute = [...Array(21).fill("10000"), "11000"]
    .filter((_, index) => index !== 21);
  missingMinute.push("11000");
  const gapEvidence = candleEvidence(missingMinute);
  gapEvidence.candles[21].timestamp += 60_000;
  gapEvidence.receivedAtMs += 60_000;
  assert.throws(() => gap.decide(gapEvidence), /CLOSED_CANDLE_GAP/);

  const missed = createProposedUsdSmaCandidate();
  recordDecision(missed, candleEvidence(Array(21).fill("10000")), 1);
  const multipleBars = candleEvidence([...Array(21).fill("10000"), "11000", "12000"]);
  const missedEvidence = recordDecision(missed, multipleBars, 2);
  assert.equal(missedEvidence.decision.action, "HOLD");
  assert.equal(missedEvidence.decision.missedDecisionWindow, true);
});

test("staged feed excludes an unclosed candle and rejects future or non-USD instruments", async () => {
  const current = BASE + 125_000;
  const unclosedData = {
    error: [],
    result: {
      XXBTZUSD: [candleRow(0, "10000"), candleRow(1, "10000"),
        candleRow(2, "11000")],
      last: (BASE + 2 * 60_000) / 1000
    }
  };
  let admitted;
  const accepted = createKrakenUsdPublicFeed({
    now: () => current,
    monotonicNow: () => 1,
    fetchImpl: async url => response(url.pathname.endsWith("/OHLC") ?
      unclosedData : krakenTicker())
  });
  const sample = await accepted.fetchCausalSample({
    decide(evidence) {
      admitted = evidence;
      return {action: "HOLD"};
    }
  });
  assert.deepEqual(admitted.candles.map(item => item.timestamp), [
    BASE, BASE + 60_000
  ]);
  assert.equal(sample.observation.quote.nativeInstrument, "BTC/USD");

  const futureData = {
    error: [],
    result: {
      XXBTZUSD: [candleRow(3, "11000")],
      last: (BASE + 3 * 60_000) / 1000
    }
  };
  await assert.rejects(createKrakenUsdPublicFeed({
    now: () => current,
    monotonicNow: () => 1,
    fetchImpl: async () => response(futureData)
  }).fetchCausalSample({decide: () => ({action: "HOLD"})}),
  /INVALID_OHLC_TIMESTAMP/);

  for (const pair of ["XXBTZEUR", "XBTUSDT", "XBTUSDC"]) {
    const wrongCurrency = {
      error: [],
      result: {[pair]: [candleRow(0, "10000")], last: BASE / 1000}
    };
    await assert.rejects(createKrakenUsdPublicFeed({
      now: () => current,
      monotonicNow: () => 1,
      fetchImpl: async () => response(wrongCurrency)
    }).fetchCausalSample({decide: () => ({action: "HOLD"})}),
    /UNEXPECTED_OHLC_PAIR/);
  }
});

test("generated BTC/USD candles decide before ticker, then use the real USD journal for entry, pause, and full exit", async t => {
  const store = await newStore(t);
  const closes = [...Array(21).fill("10000"), "11000", "9000", "9000"];
  const prices = ["43000", "43000", "1", "1"];
  const clock = {current: BASE + 21 * 60_000 + 5_000, sample: 0};
  const requests = [];
  let decisionCount = 0;
  const feed = candidateFeed({
    clock,
    closes,
    quotePrices: prices,
    requests,
    decisionCount: () => decisionCount
  });
  const baseCandidate = createProposedUsdSmaCandidate();
  const candidate = {
    decide(evidence) {
      decisionCount++;
      return baseCandidate.decide(evidence);
    },
    recordSample: sample => baseCandidate.recordSample(sample),
    snapshot: () => baseCandidate.snapshot(),
    evidenceRecords: () => baseCandidate.evidenceRecords()
  };
  const evidence = [];
  const tips = [];
  let result;
  for (let index = 0; index < 4; index++) {
    result = await runProposedUsdSmaCandidateSample({
      feed,
      store,
      candidate,
      candidateNotionalCents: 10_000,
      retainStrategyEvidence(record) {
        evidence.push(record);
      },
      retainRestartTip(tip) {
        tips.push(tip);
      }
    });
    const sample = result.sample;
    assert.ok(sample.candleEvidence.receivedAtMs <= sample.decisionAtMs);
    assert.ok(sample.decisionAtMs <= sample.tickerRequestStartedAtMs);
    assert.ok(sample.tickerRequestStartedAtMs <= sample.tickerReceivedAtMs);
    assert.ok(sample.tickerReceivedAtMs <= sample.observation.observedAtMs);
    assert.equal(sample.candleEvidence.nativeInstrument, "BTC/USD");
    assert.match(sample.candleEvidence.responseDigest, /^[a-f0-9]{64}$/);
    assert.equal(sample.observation.quote.marketPair, "BTC/USD");
    assert.equal(sample.observation.quote.quoteCurrency, "USD");
    clock.sample++;
    clock.current += 60_000;
  }

  assert.deepEqual(requests, ["OHLC", "Ticker", "OHLC", "Ticker",
    "OHLC", "Ticker", "OHLC", "Ticker"]);
  assert.deepEqual(store.replay.entries.map(entry => entry.event.action),
    ["HOLD", "BUY", "HOLD", "SELL"]);
  assert.ok(store.replay.guardState.paused);
  assert.equal(store.replay.activity.completedRoundTrips, 1);
  assert.equal(store.replay.account.inventorySatoshis, "0");
  const fillFees = store.replay.entries.reduce(
    (sum, entry) => sum + (entry.fill?.feeCents ?? 0), 0);
  assert.equal(store.replay.activity.modeledFeesCents, fillFees);
  assert.equal(fillFees,
    store.replay.entries[1].fill.feeCents + store.replay.entries[3].fill.feeCents);
  assert.equal(evidence.length, 4);
  assert.equal(decisionCount, 4);
  assert.equal(tips.length, 4);
  assert.equal(result.acceptance.strategyStatus, "PROPOSED_UNAPPROVED");
  assert.equal(result.acceptance.productionReadiness, "NOT_ASSESSED");
  assert.equal(feed.counters().requests, 8);
  assert.equal(feed.counters().events, 4);
  await store.close();
});

test("missing or tampered strategy evidence cannot authorize a restart", () => {
  const candidate = createProposedUsdSmaCandidate();
  const evidence = recordDecision(candidate, candleEvidence(Array(21).fill("10000")), 1);
  assert.throws(() => requireRestartableUsdSmaCandidate(null), /USD_STRATEGY_EVIDENCE_REQUIRED/);
  assert.throws(() => requireRestartableUsdSmaCandidate(
    {...evidence, strategyState: {...evidence.strategyState, cutoffAt: 0}},
    evidence.digest
  ), /USD_STRATEGY_EVIDENCE_TAMPERED/);
  assert.deepEqual(verifyProposedUsdSmaEvidence(evidence, evidence.digest), evidence);
  assert.throws(() => requireRestartableUsdSmaCandidate(evidence, evidence.digest),
    /USD_CAMPAIGN_FEED_BUDGET_REVIEW_REQUIRED/);
});

test("reopened account blocks causal provider requests and evidence-retention failure latches all later effects", async t => {
  let store = await newStore(t);
  const directory = STORE_DIRECTORIES.get(store);
  const expectedTip = structuredClone(store.tip);
  await store.close();
  store = await UsdAccountJournalStore.reopenExisting(directory, {
    binding: BINDING,
    expectedTip
  });
  let reopenedRequests = 0;
  await assert.rejects(runProposedUsdSmaCandidateSample({
    feed: {
      async fetchCausalSample() {
        reopenedRequests++;
        throw new Error("REQUEST_MUST_NOT_RUN");
      }
    },
    store,
    candidate: createProposedUsdSmaCandidate(),
    candidateNotionalCents: 10_000,
    retainStrategyEvidence() {},
    retainRestartTip() {}
  }), /USD_CAMPAIGN_FEED_BUDGET_REVIEW_REQUIRED/);
  assert.equal(reopenedRequests, 0);
  await store.close();

  const fresh = await newStore(t);
  const closes = Array(21).fill("10000");
  const clock = {current: BASE + 21 * 60_000 + 5_000, sample: 0};
  let requests = 0;
  const feed = createKrakenUsdPublicFeed({
    now: () => clock.current,
    monotonicNow: () => 1,
    fetchImpl: async url => {
      requests++;
      return response(url.pathname.endsWith("/OHLC") ?
        krakenOhlc(closes, clock.current) : krakenTicker());
    }
  });
  const candidate = createProposedUsdSmaCandidate();
  let appendCalls = 0;
  const append = fresh.append.bind(fresh);
  fresh.append = async event => {
    appendCalls++;
    return append(event);
  };
  await assert.rejects(runProposedUsdSmaCandidateSample({
    feed,
    store: fresh,
    candidate,
    candidateNotionalCents: 10_000,
    retainStrategyEvidence() {
      throw new Error("STRATEGY_EVIDENCE_RETENTION_UNKNOWN");
    },
    retainRestartTip() {
      throw new Error("TIP_MUST_NOT_RUN");
    }
  }), /STRATEGY_EVIDENCE_RETENTION_UNKNOWN/);
  await assert.rejects(runProposedUsdSmaCandidateSample({
    feed,
    store: fresh,
    candidate,
    candidateNotionalCents: 10_000,
    retainStrategyEvidence() {},
    retainRestartTip() {}
  }), /USD_COMPOSITION_SESSION_FAILED/);
  assert.equal(requests, 2);
  assert.equal(appendCalls, 0);
  assert.equal(fresh.replay.entries.length, 0);
  await fresh.close();
});

test("generated causal sample latches after restart-tip retention failure", async t => {
  const store = await newStore(t);
  const closes = Array(21).fill("10000");
  const clock = {current: BASE + 21 * 60_000 + 5_000};
  let requests = 0;
  const feed = createKrakenUsdPublicFeed({
    now: () => clock.current,
    monotonicNow: () => 1,
    fetchImpl: async url => {
      requests++;
      return response(url.pathname.endsWith("/OHLC") ?
        krakenOhlc(closes, clock.current) : krakenTicker());
    }
  });
  let appendCalls = 0;
  const append = store.append.bind(store);
  store.append = async event => {
    appendCalls++;
    return append(event);
  };
  const input = {
    feed,
    store,
    candidate: createProposedUsdSmaCandidate(),
    candidateNotionalCents: 10_000,
    retainStrategyEvidence() {},
    retainRestartTip() {
      throw new Error("RESTART_TIP_RETENTION_UNKNOWN");
    }
  };
  await assert.rejects(runProposedUsdSmaCandidateSample(input),
    /RESTART_TIP_RETENTION_UNKNOWN/);
  assert.equal(store.replay.entries.length, 1);
  assert.equal(appendCalls, 1);
  await assert.rejects(runProposedUsdSmaCandidateSample({
    ...input,
    retainRestartTip() {}
  }), /USD_COMPOSITION_SESSION_FAILED/);
  assert.equal(requests, 2);
  assert.equal(appendCalls, 1);
  await store.close();
});

test("invalid candidate sizing fails before requesting feed data", async t => {
  const store = await newStore(t);
  let requests = 0;
  await assert.rejects(runProposedUsdSmaCandidateSample({
    feed: {
      async fetchCausalSample() {
        requests++;
        throw new Error("REQUEST_MUST_NOT_RUN");
      }
    },
    store,
    candidate: createProposedUsdSmaCandidate(),
    candidateNotionalCents: 10_001,
    retainStrategyEvidence() {},
    retainRestartTip() {}
  }), /explicit notional/);
  assert.equal(requests, 0);
  await store.close();
});
