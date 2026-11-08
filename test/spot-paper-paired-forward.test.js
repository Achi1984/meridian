import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBaselineArm, createCashControlArm, createChallengerArm,
  runSpotPaperPaired as runSpotPaperPairedLive,
  runSpotPaperPairedSynthetic,
  pairedConfigDigest, pairedResearchSourceDigest,
  SPOT_PAPER_PAIRED, SPOT_PAPER_PAIRED_SOURCE_ID,
  SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256,
  SPOT_PAPER_PAIRED_SYNTHETIC_SOURCE_ID,
  SPOT_PAPER_PAIRED_INTEGRATION, SPOT_PAPER_RESEARCH_COMPARISON_ID
} from "../scripts/spot-paper-paired/forward.mjs";
import { sha256 } from "../scripts/spot-paper-pilot/core.mjs";
import { readRunJournal } from "../scripts/spot-paper-pilot/journal.mjs";
import { createSpotPaperPairedKrakenProvider } from
  "../scripts/spot-paper-paired/feed.mjs";

const MINUTE = 60_000;
const BASE = Date.UTC(2025, 0, 1);
const PRICE = "30000.00000000";
const researchExportsAvailable =
  existsSync(new URL("../scripts/spot-paper-research/comparison.mjs", import.meta.url)) &&
  existsSync(new URL("../scripts/spot-paper-research/entry-confirmation.mjs", import.meta.url)) &&
  SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256 !== null;

function row(timestamp, price = PRICE) {
  return [timestamp, price, price, price, price, price, "1.00000000", 1];
}

function ohlc(wall, candleCount = 22) {
  const endMinute = Math.floor(wall / MINUTE) * MINUTE;
  const start = endMinute - (candleCount - 1) * MINUTE;
  const candles = Array.from({ length: candleCount }, (_, index) =>
    row((start + index * MINUTE) / 1000));
  return { error: [], result: { XXBTZEUR: candles, last: candles.at(-1)[0] } };
}

function ticker(bid = "29999.00000000", ask = "30001.00000000") {
  return { error: [], result: { XXBTZEUR: {
    a: [ask, "1", "1.00000000"],
    b: [bid, "1", "1.00000000"]
  } } };
}

function receipt(data, requestStartedAt, receivedAt) {
  const raw = JSON.stringify(data);
  return { data, raw, sha256: sha256(Buffer.from(raw, "utf8")),
    bytes: Buffer.byteLength(raw), requestStartedAt, receivedAt };
}

async function fixture(t, options = {}) {
  const dataRoot = await mkdtemp(join(tmpdir(), "paired-forward-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  let wall = BASE + 22 * MINUTE + 1_000;
  let mono = 100;
  let tickerRequests = 0;
  const providerCounts = { requests: 0, bytes: 0 };
  const order = [];
  let challengerApplyCount = 0;
  let replayObservations = null;
  const provider = {
    sourceId: SPOT_PAPER_PAIRED_SYNTHETIC_SOURCE_ID,
    async fetchOhlc() {
      order.push("ohlc");
      providerCounts.requests++;
      const started = wall;
      const received = started + 5;
      wall = received;
      const response = receipt(ohlc(wall, options.candleCount ?? 22), started, received);
      providerCounts.bytes += response.bytes;
      return response;
    },
    async fetchTicker() {
      order.push("ticker");
      providerCounts.requests++;
      tickerRequests++;
      const started = wall + (options.predatingTicker ? -1 : 1);
      const received = options.futureTicker ? started + 2_000 : started + 1;
      const tickerData = options.sessionLossOnSecondCycle ?
        ticker(tickerRequests === 2 ? "29700.00000000" : "29000.00000000",
          tickerRequests === 2 ? "29701.00000000" : "29001.00000000") :
        options.stopLossSecondCycle && tickerRequests === 2 ?
          ticker("29000.00000000", "29001.00000000") : ticker();
      const response = receipt(tickerData, started, received);
      providerCounts.bytes += response.bytes;
      if (!options.futureTicker) {
        wall = received + (options.staleTickerAt === tickerRequests ? 11_000 : 0);
      }
      return response;
    },
    counters: () => ({ ...providerCounts })
  };
  let challengerDecisions = 0;
  const challenge = {
    SPOT_PAPER_ENTRY_CONFIRMATION_ID: SPOT_PAPER_PAIRED.challengerModel,
    createEntryConfirmationState: () => ({ strategy: {}, pending: null, cooldownUntil: 0 }),
    advanceEntryConfirmation(state, candles, { nowMs }) {
      challengerDecisions++;
      order.push("decide:challenger");
      return {
        state: options.mutateChallengeState ? { ...state, challengerOnly: true } : state,
        signals: options.enterOnCycleOne && challengerDecisions === 1 ? [{
          id: "synthetic-entry", direction: "ENTRY", candleAt: candles.at(-1).timestamp,
          closeNano: candles.at(-1).closeNano, strategyReason: "SYNTHETIC_TEST_ENTRY"
        }] : [],
        newCandleCount: 1, nowMs
      };
    },
    recordEntryConfirmationSell(state, executedAt) {
      return { ...state, pending: null, cooldownUntil: executedAt + 600_000 };
    }
  };
  const challengerArm = createChallengerArm(challenge, "challenger-eur");
  const applyChallenge = challengerArm.apply;
  challengerArm.apply = args => {
    challengerApplyCount++;
    const result = applyChallenge(args);
    if (options.sessionLossOnSecondCycle && args.cycle === 2) {
      result.stopReason = "SESSION_LOSS_LIMIT";
      result.state.stopped = true;
      result.riskState.lossLimitReached = true;
    }
    if (options.stopArm && args.cycle === 1) {
      result.stopReason = "SESSION_LOSS_LIMIT";
      result.state.stopped = true;
    }
    if (options.lossAfterCycleOne && args.cycle === 1) {
      result.state.ledger.cashCents -= 1_000;
    }
    return result;
  };
  const comparisonExports = {
    compareSpotPaperStrategies(observations) {
      replayObservations = structuredClone(observations);
      return { schemaVersion: "SPOT_PAPER_SMA_COMPARISON_V1",
        status: "COMPARISON_AVAILABLE", observationCount: observations.length,
        ...(options.staleComparisonMark ? { arms: {
          challenger: { unresolvedTerminalInventory: {
            lastMark: { receivedAt: BASE }
          } }
        } } : {}) };
    }
  };
  const baseline = createBaselineArm("baseline-eur");
  const cash = createCashControlArm("cash-eur");
  const originalBaselineDecide = baseline.decide;
  baseline.decide = context => {
    order.push("decide:baseline");
    return originalBaselineDecide(context);
  };
  const originalCashDecide = cash.decide;
  cash.decide = context => {
    order.push("decide:cash");
    return originalCashDecide(context);
  };
  const comparisonEngine = {
    id: SPOT_PAPER_RESEARCH_COMPARISON_ID,
    compare: comparisonExports.compareSpotPaperStrategies
  };
  const config = {
    runId: "paired-test-1",
    dataRoot,
    sourceSha256: "a".repeat(64),
    researchSourceSha256: "b".repeat(64),
    configSha256: "c".repeat(64),
    testOnly: true,
    maxCycles: options.maxCycles ?? 2,
    maxRequests: options.maxRequests ?? 4,
    maxBytes: options.maxBytes ?? SPOT_PAPER_PAIRED.maxBytes,
    maxDurationMs: options.maxDurationMs ?? 180_000,
    pollIntervalMs: SPOT_PAPER_PAIRED.pollIntervalMs,
    now: () => wall,
    monotonicNow: () => mono,
    sleep: async ms => {
      wall += ms;
      mono += ms;
    },
    provider,
    arms: [baseline, challengerArm, cash],
    challengerExports: challenge,
    comparisonExports,
    comparisonEngine,
    journalOptions: options.journalOptions
  };
  config.configSha256 = pairedConfigDigest(config);
  return { config, order, provider, get wall() { return wall; },
    get mono() { return mono; },
    get challengerApplyCount() { return challengerApplyCount; },
    get replayObservations() { return replayObservations; },
    dataRoot };
}

test("paired orchestration requests one shared ticker after all three decisions", async t => {
  const setup = await fixture(t);
  const report = await runSpotPaperPairedSynthetic(setup.config);

  assert.equal(report.requests, 4);
  assert.equal(report.cycles, 2);
  assert.equal(report.arms.length, 3);
  assert.deepEqual(report.arms.map(arm => arm.valuation.startingCapitalCents),
    [100_000, 100_000, 100_000]);
  assert.equal(report.assumptions.ratesVerified, false);
  assert.ok(report.arms.every(arm => Number.isSafeInteger(arm.valuation.modeledCostsCents)));
  assert.ok(report.arms.every(arm =>
    Number.isSafeInteger(arm.valuation.feesCents) &&
    Number.isSafeInteger(arm.valuation.slippageCents) &&
    Number.isSafeInteger(arm.valuation.exposureCents) &&
    Number.isSafeInteger(arm.valuation.turnoverCents) &&
    Array.isArray(arm.valuation.openPositions) &&
    Number.isSafeInteger(arm.valuation.unresolvedObservations)));
  assert.equal(report.fullEightHourCompletion, false);
  for (let index = 0; index < setup.order.length; index += 5) {
    assert.deepEqual(setup.order.slice(index, index + 5), [
      "ohlc", "decide:baseline", "decide:challenger", "decide:cash", "ticker"
    ]);
  }
  assert.ok(setup.replayObservations.every(observation =>
    observation.decisionAt < observation.effectAt &&
    observation.at === observation.effectAt));
});

test("missing research exports or comparison engine block integration before feed access", async t => {
  const setup = await fixture(t);
  delete setup.config.challengerExports;
  await assert.rejects(runSpotPaperPairedSynthetic(setup.config),
    /RESEARCH_CHALLENGER_EXPORTS_REQUIRED/);
  assert.deepEqual(setup.order, []);
  assert.equal(SPOT_PAPER_PAIRED_INTEGRATION, "BLOCKED_PENDING_MERIDIAN_1299_ACCEPTED_EXPORTS");

  const invalidFeed = await fixture(t);
  invalidFeed.config.provider.sourceId = "UNAPPROVED_FEED";
  invalidFeed.config.configSha256 = pairedConfigDigest(invalidFeed.config);
  await assert.rejects(runSpotPaperPairedSynthetic(invalidFeed.config),
    /SYNTHETIC_TEST_ADAPTER_REQUIRED/);
  assert.deepEqual(invalidFeed.order, []);
});

test("live runner stays disabled until an accepted #1299 source hash is pinned", async t => {
  const setup = await fixture(t);
  await assert.rejects(runSpotPaperPairedLive(setup.config),
    /RESEARCH_INTEGRATION_NOT_ACCEPTED/);
  assert.deepEqual(setup.order, []);
});

test("a stale pre-signal or future quote stops the shared run without accepting an observation", async t => {
  for (const options of [{ predatingTicker: true }, { staleTickerAt: 1 }, { futureTicker: true }]) {
    const setup = await fixture(t, options);
    const report = await runSpotPaperPairedSynthetic(setup.config);
    assert.equal(report.stopReason, "SHARED_FEED_FAILURE");
    assert.equal(report.cycles, 1);
    assert.equal(report.commonHorizon.available, false);
    const journal = await readRunJournal({ dataRoot: setup.dataRoot,
      runId: setup.config.runId });
    const failure = journal.events.find(event => event.type === "shared_feed_failure");
    assert.ok(failure.responses.ohlc.path);
    assert.ok(failure.responses.ticker.path);
    assert.equal(failure.decisions.length, 3);
  }
});

test("shared request, byte, and monotonic deadline bounds apply to the whole run", async t => {
  const capped = await fixture(t, { maxRequests: 2 });
  const requestReport = await runSpotPaperPairedSynthetic(capped.config);
  assert.equal(requestReport.requests, 2);
  assert.equal(requestReport.stopReason, "REQUEST_LIMIT");

  const byteCapped = await fixture(t, { maxBytes: 1 });
  const byteReport = await runSpotPaperPairedSynthetic(byteCapped.config);
  assert.equal(byteReport.stopReason, "SHARED_FEED_FAILURE");
  assert.ok(byteReport.deliveredBytes > 1);

  const deadline = await fixture(t, { maxCycles: 1, maxDurationMs: 100 });
  deadline.config.provider.fetchOhlc = () => new Promise(() => {});
  const deadlineReport = await runSpotPaperPairedSynthetic(deadline.config);
  assert.equal(deadlineReport.stopReason, "DURATION_LIMIT");
  assert.equal(deadlineReport.requests, 1);
});

test("per-arm loss termination preserves an open position and never trades again", async t => {
  const setup = await fixture(t, {
    sessionLossOnSecondCycle: true, enterOnCycleOne: true,
    maxCycles: 3, maxRequests: 6
  });
  const report = await runSpotPaperPairedSynthetic(setup.config);
  const challenger = report.arms.find(arm => arm.role === "challenger");
  assert.equal(challenger.tradingStatus, "STOPPED");
  assert.equal(challenger.stopReason, "SESSION_LOSS_LIMIT");
  assert.equal(challenger.stoppedAt, setup.replayObservations[1].effectAt);
  assert.equal(setup.challengerApplyCount, 2);
  assert.equal(challenger.fills.length, 1);
  assert.equal(challenger.valuation.openPositions.length, 1);
  assert.equal(challenger.valuation.netEquityCents, null);
  assert.equal(challenger.decisions[2].skippedReason, "ARM_STOPPED");
  assert.equal(challenger.riskStates[2].stopReason, "SESSION_LOSS_LIMIT");
  assert.equal(report.cycles, 3);
  assert.equal(report.commonHorizon.available, true);
  assert.equal(report.comparison.status, "UNAVAILABLE");
  assert.equal(report.comparison.reason, "STOPPED_ARM_MARK_NOT_AT_SHARED_HORIZON");
});

test("candidate quote-triggered stop fills remain causal after strategy annotation", async t => {
  const setup = await fixture(t, { enterOnCycleOne: true, stopLossSecondCycle: true });
  const report = await runSpotPaperPairedSynthetic(setup.config);
  const challenger = report.arms.find(arm => arm.role === "challenger");
  assert.equal(report.stopReason, "CYCLE_LIMIT");
  assert.equal(challenger.fills.length, 2);
  assert.equal(challenger.fills[1].reason, "BASELINE_SAMPLED_2PCT_BID_STOP");
  assert.ok(challenger.valuation.feesCents > 0);
  assert.ok(challenger.valuation.slippageCents > 0);
});

test("a stopped arm's older open-position mark makes the research comparison unavailable", async t => {
  const setup = await fixture(t, {
    stopArm: true, staleComparisonMark: true
  });
  const report = await runSpotPaperPairedSynthetic(setup.config);
  assert.equal(report.commonHorizon.available, true);
  assert.equal(report.comparison.status, "UNAVAILABLE");
  assert.equal(report.comparison.reason, "STOPPED_ARM_MARK_NOT_AT_SHARED_HORIZON");
});

test("per-arm state is isolated and a frozen config digest is enforced", async t => {
  const setup = await fixture(t, { mutateChallengeState: true, maxCycles: 1 });
  await runSpotPaperPairedSynthetic(setup.config);
  const journal = await readRunJournal({ dataRoot: setup.dataRoot, runId: setup.config.runId });
  assert.ok(journal.checkpoint.states[1].strategy.challengerOnly);
  assert.equal(journal.checkpoint.states[0].strategy.challengerOnly, undefined);
  assert.equal(journal.checkpoint.states[2].challengerOnly, undefined);

  const changed = await fixture(t, { maxCycles: 1 });
  changed.config.configSha256 = "c".repeat(64);
  await assert.rejects(runSpotPaperPairedSynthetic(changed.config), /CONFIG_IDENTITY_MISMATCH/);
  assert.deepEqual(changed.order, []);
});

test("sampled drawdown retains losses from the initial-capital high-water mark", async t => {
  const setup = await fixture(t, { lossAfterCycleOne: true });
  const report = await runSpotPaperPairedSynthetic(setup.config);
  const challenger = report.arms.find(arm => arm.role === "challenger");
  assert.equal(challenger.valuation.sampledDrawdownCents, 1_000);
});

test("a delayed common horizon is reported unknown, not as an equivalent final mark", async t => {
  const setup = await fixture(t, { maxCycles: 1, enterOnCycleOne: true });
  const originalNow = setup.config.now;
  let calls = 0;
  setup.config.now = () => {
    calls++;
    const value = originalNow();
    return calls > 7 ? value + 11_000 : value;
  };
  setup.config.arms[1].researchExports.advanceEntryConfirmation =
    setup.config.challengerExports.advanceEntryConfirmation;
  setup.config.challengerExports.advanceEntryConfirmation =
    (state, candles, context) => {
      return {
        state, signals: [{
          id: "synthetic-entry", direction: "ENTRY", candleAt: candles.at(-1).timestamp,
          closeNano: candles.at(-1).closeNano, strategyReason: "SYNTHETIC_TEST_ENTRY"
        }], newCandleCount: 1
      };
    };
  const report = await runSpotPaperPairedSynthetic(setup.config);
  assert.equal(report.commonHorizon.available, false);
  assert.equal(report.comparison.status, "UNAVAILABLE");
  assert.equal(report.arms[1].valuation.netEquityCents, null);
  assert.equal(report.arms[1].valuation.openPositions.length, 1);
});

test("operator interruption is not full-duration completion", async t => {
  const controller = new AbortController();
  const setup = await fixture(t, { maxCycles: 3 });
  setup.config.signal = controller.signal;
  setup.config.sleep = async () => controller.abort(new Error("SIGTERM"));
  const report = await runSpotPaperPairedSynthetic(setup.config);
  assert.equal(report.stopReason, "OPERATOR_STOP");
  assert.equal(report.outcome, "INTERRUPTED_OR_STOPPED");
  assert.equal(report.fullEightHourCompletion, false);
});

test("ambiguous persistence failure stops without a terminal success record", async t => {
  const setup = await fixture(t, {
    journalOptions: {
      phase(name) {
        if (name === "response-before-write") throw new Error("injected write fault");
      }
    }
  });
  await assert.rejects(runSpotPaperPairedSynthetic(setup.config), /JOURNAL_UNKNOWN/);
  assert.equal(setup.order.includes("ticker"), false);
});

test("existing evidence paths and conflicting account identities are rejected", async t => {
  const existing = await fixture(t);
  await mkdir(join(existing.dataRoot, existing.config.runId));
  await assert.rejects(runSpotPaperPairedSynthetic(existing.config), /EEXIST/);
  assert.deepEqual(existing.order, []);

  const conflict = await fixture(t);
  conflict.config.arms[2].accountId = conflict.config.arms[1].accountId;
  await assert.rejects(runSpotPaperPairedSynthetic(conflict.config), /CONFLICTING_ACCOUNTS/);
  assert.deepEqual(conflict.order, []);
});

test("offline test adapters make no network or order calls", async t => {
  const setup = await fixture(t, { maxCycles: 1 });
  let networkCalls = 0;
  let orderCalls = 0;
  let feedRequests = 0;
  const fetchOhlc = setup.provider.fetchOhlc.bind(setup.provider);
  const fetchTicker = setup.provider.fetchTicker.bind(setup.provider);
  setup.config.provider.fetchOhlc = async (...args) => {
    feedRequests++;
    return fetchOhlc(...args);
  };
  setup.config.provider.fetchTicker = async (...args) => {
    feedRequests++;
    return fetchTicker(...args);
  };
  const report = await runSpotPaperPairedSynthetic(setup.config);
  assert.equal(feedRequests, 2);
  assert.equal(networkCalls, 0);
  assert.equal(orderCalls, 0);
  assert.equal(report.executionImpact, false);
});

test("paired Kraken provider construction is inert and starts with an unused budget", () => {
  const provider = createSpotPaperPairedKrakenProvider();
  assert.equal(provider.sourceId, SPOT_PAPER_PAIRED_SOURCE_ID);
  assert.deepEqual(provider.counters(), { requests: 0, bytes: 0 });
});

test("research source pin hashes the exact sorted paths and file bytes", () => {
  const comparisonBytes = Buffer.from("comparison source");
  const entryConfirmationBytes = Buffer.from("confirmation source");
  const actual = pairedResearchSourceDigest({ comparisonBytes, entryConfirmationBytes });
  const expected = sha256(Buffer.concat([
    Buffer.from("scripts/spot-paper-research/comparison.mjs\0"),
    comparisonBytes, Buffer.from("\0scripts/spot-paper-research/entry-confirmation.mjs\0"),
    entryConfirmationBytes, Buffer.from("\0")
  ]));
  assert.equal(actual, expected);
});

test("actual #1299 exports preserve decision/effect time and accept long provider snapshots",
  { skip: !researchExportsAvailable }, async t => {
    const [comparison, confirmation] = await Promise.all([
      import("../scripts/spot-paper-research/comparison.mjs"),
      import("../scripts/spot-paper-research/entry-confirmation.mjs")
    ]);
    const [comparisonBytes, entryConfirmationBytes] = await Promise.all([
      readFile(new URL("../scripts/spot-paper-research/comparison.mjs", import.meta.url)),
      readFile(new URL("../scripts/spot-paper-research/entry-confirmation.mjs", import.meta.url))
    ]);
    assert.equal(pairedResearchSourceDigest({ comparisonBytes, entryConfirmationBytes }),
      SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256);
    const decisionAt = BASE + 32 * MINUTE;
    const effectAt = decisionAt + 2;
    const candles = Array.from({ length: 21 }, (_, index) => ({
      timestamp: BASE + index * MINUTE, closeNano: "30000000000000"
    }));
    const seeded = confirmation.advanceEntryConfirmation(
      confirmation.createEntryConfirmationState(), candles, {
        nowMs: decisionAt, held: false
      }).state;
    seeded.pending = {
      crossCandleAt: candles.at(-2).timestamp,
      lastConfirmedAt: candles.at(-1).timestamp,
      crossSignalId: "seeded-cross"
    };
    seeded.cooldownUntil = decisionAt + 1;
    const nextCandles = [...candles, {
      timestamp: candles.at(-1).timestamp + MINUTE,
      closeNano: "30000000000000"
    }];
    const beforeExpiry = confirmation.advanceEntryConfirmation(seeded, nextCandles, {
      nowMs: decisionAt, held: false
    });
    const afterExpiry = confirmation.advanceEntryConfirmation(seeded, nextCandles, {
      nowMs: effectAt, held: false
    });
    assert.equal(beforeExpiry.signals.length, 0);
    assert.equal(afterExpiry.signals.at(-1)?.direction, "ENTRY");

    const setup = await fixture(t, { candleCount: 32, maxCycles: 1, maxRequests: 2 });
    setup.config.arms[1] = createChallengerArm(confirmation, "challenger-eur");
    setup.config.challengerExports = confirmation;
    setup.config.comparisonExports = comparison;
    setup.config.comparisonEngine = {
      id: SPOT_PAPER_RESEARCH_COMPARISON_ID,
      compare: comparison.compareSpotPaperStrategies
    };
    setup.config.configSha256 = pairedConfigDigest(setup.config);
    const report = await runSpotPaperPairedSynthetic(setup.config);
    const journal = await readRunJournal({
      dataRoot: setup.dataRoot, runId: setup.config.runId
    });
    const observation = journal.events.find(event => event.type === "shared_observation");
    assert.ok(observation.decisionAt < observation.effectAt);
    assert.equal(report.comparison.status, "COMPARISON_AVAILABLE");
    const challenger = report.arms.find(arm => arm.role === "challenger");
    const replay = report.comparison.arms.challenger;
    assert.deepEqual(challenger.fills, replay.fills);
    assert.equal(challenger.valuation.netEquityCents, replay.finalNetEquityCents);
  });
