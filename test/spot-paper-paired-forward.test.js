import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  SPOT_PAPER_PAIRED_INTEGRATION, SPOT_PAPER_RESEARCH_COMPARISON_ID,
  SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT,
  SPOT_PAPER_PAIRED_NEXT_RUN_ACCEPTED_RESEARCH_SOURCE_SHA256,
  SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR,
  SPOT_PAPER_PAIRED_ACCOUNT_CONTRACT
} from "../scripts/spot-paper-paired/forward.mjs";
import {
  applySpotPaperPairedFeeObservation,
  compareSpotPaperFeeScenarioObservations,
  replaySpotPaperFeeScenarioObservations,
  replayVerifiedSpotPaperFeeScenarios
} from "../scripts/spot-paper-paired/fee-scenario.mjs";
import { sha256 } from "../scripts/spot-paper-pilot/core.mjs";
import { readRunJournal } from "../scripts/spot-paper-pilot/journal.mjs";
import { createSpotPaperPairedKrakenProvider } from
  "../scripts/spot-paper-paired/feed.mjs";
import { main as pairedHostMain } from "../scripts/spot-paper-paired/host.mjs";
import { evaluatePairedPaperEvidence } from
  "../scripts/spot-paper-paired-report/evaluate.mjs";

const MINUTE = 60_000;
const BASE = Date.UTC(2025, 0, 1);
const PRICE = "30000.00000000";
const researchExportsAvailable =
  existsSync(new URL("../scripts/spot-paper-research/comparison.mjs", import.meta.url)) &&
  existsSync(new URL("../scripts/spot-paper-research/entry-confirmation.mjs", import.meta.url));

function row(timestamp, price = PRICE) {
  return [timestamp, price, price, price, price, price, "1.00000000", 1];
}

function ohlc(wall, candleCount = 22, priceAtIndex = () => PRICE) {
  const endMinute = Math.floor(wall / MINUTE) * MINUTE;
  const start = endMinute - (candleCount - 1) * MINUTE;
  const candles = Array.from({ length: candleCount }, (_, index) => {
    const timestamp = start + index * MINUTE;
    const price = priceAtIndex(Math.floor((timestamp - (BASE + MINUTE)) / MINUTE));
    return row(timestamp / 1000, price);
  });
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
  let ohlcRequests = 0;
  const providerCounts = { requests: 0, bytes: 0 };
  const order = [];
  let challengerApplyCount = 0;
  let sleepCount = 0;
  let replayObservations = null;
  let resolveOhlcPending;
  const pendingOhlc = new Promise(resolve => {
    resolveOhlcPending = resolve;
  });
  const challengerStatesSeen = [];
  const challengerSellStates = [];
  const provider = {
    sourceId: SPOT_PAPER_PAIRED_SYNTHETIC_SOURCE_ID,
    async fetchOhlc(runtime = {}) {
      order.push("ohlc");
      providerCounts.requests++;
      ohlcRequests++;
      if (options.hangOhlcPhase) {
        runtime.onTransportState?.(options.hangOhlcPhase, 0);
        resolveOhlcPending();
        return new Promise(() => {});
      }
      const started = wall;
      const received = started + 5;
      wall = received;
      if (options.advanceMonotonic) mono += received - started;
      const response = receipt(ohlc(wall, options.candleCount ?? 22,
        options.priceAtIndex), started, received);
      providerCounts.bytes += response.bytes;
      return response;
    },
    async fetchTicker(runtime = {}) {
      order.push("ticker");
      providerCounts.requests++;
      tickerRequests++;
      if (options.failTickerAt === tickerRequests) {
        const partialBytes = options.failTickerBytes ?? 0;
        runtime.onTransportState?.(options.failTickerPhase ?? "BODY", partialBytes);
        providerCounts.bytes += partialBytes;
        throw new Error(options.failTickerMessage ?? "SYNTHETIC_PROVIDER_FAILURE");
      }
      const started = wall + (options.predatingTicker ? -1 : 1);
      const tickerDelay = typeof options.tickerDelayMs === "function" ?
        options.tickerDelayMs(tickerRequests) :
        options.tickerDelayMs ?? (options.futureTicker ? 2_000 : 1);
      const received = options.futureTicker ? started + 2_000 : started + tickerDelay;
      if (options.advanceMonotonic) mono += received - started;
      const marketPrice = options.quotePriceAtCycle?.(tickerRequests) ??
        (options.sessionLossOnSecondCycle ?
        ticker(tickerRequests === 2 ? "29700.00000000" : "29000.00000000",
          tickerRequests === 2 ? "29701.00000000" : "29001.00000000") :
        options.stopLossSecondCycle && tickerRequests === 2 ?
          ticker("29000.00000000", "29001.00000000") : null);
      const tickerData = marketPrice ?? ticker();
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
      if (options.preserveChallengeState) challengerStatesSeen.push(structuredClone(state));
      const advancedState = options.preserveChallengeState ?
        {...state, advancedCycle: challengerDecisions} :
        options.mutateChallengeState ? {...state, challengerOnly: true} : state;
      return {
        state: advancedState,
        signals: options.enterOnCycleOne && challengerDecisions === 1 ? [{
          id: "synthetic-entry", direction: "ENTRY", candleAt: candles.at(-1).timestamp,
          closeNano: candles.at(-1).closeNano, strategyReason: "SYNTHETIC_TEST_ENTRY"
        }] : options.exitOnCycleTwo && challengerDecisions === 2 ? [{
          id: "synthetic-exit", direction: "EXIT", candleAt: candles.at(-1).timestamp,
          closeNano: candles.at(-1).closeNano, strategyReason: "SYNTHETIC_TEST_EXIT"
        }] : [],
        newCandleCount: 1, nowMs
      };
    },
    recordEntryConfirmationSell(state, executedAt) {
      const updated = { ...state, pending: null, cooldownUntil: executedAt + 600_000 };
      if (options.preserveChallengeState) {
        challengerSellStates.push({before: structuredClone(state),
          after: structuredClone(updated)});
      }
      return updated;
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
    const result = originalBaselineDecide(context);
    if (options.processingDelayCycle === context.cycle) {
      wall += options.processingDelayMs;
      mono += options.processingDelayMs;
    }
    return result;
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
    monotonicNow: options.realMonotonic ? () => performance.now() : () => mono,
    sleep: async ms => {
      const wallAdvance = typeof options.wallSleepAdvanceMs === "function" ?
        options.wallSleepAdvanceMs(ms, sleepCount++) :
        options.wallSleepAdvanceMs ?? (ms - (options.wallSleepLagMs ?? 0));
      wall += wallAdvance;
      mono += ms;
    },
    provider,
    arms: [baseline, challengerArm, cash],
    challengerExports: challenge,
    comparisonExports,
    comparisonEngine,
    signal: options.signal,
    journalOptions: options.journalOptions
  };
  config.configSha256 = pairedConfigDigest(config);
  return { config, order, provider, get wall() { return wall; },
    get mono() { return mono; },
    get challengerApplyCount() { return challengerApplyCount; },
    challengerStatesSeen, challengerSellStates,
    get replayObservations() { return replayObservations; },
    pendingOhlc,
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

test("live runner rejects missing or mismatched research identity before feed access", async t => {
  const setup = await fixture(t);
  for (const researchSourceSha256 of [undefined, "0".repeat(64)]) {
    const config = { ...setup.config, researchSourceSha256 };
    await assert.rejects(runSpotPaperPairedLive(config),
      /RESEARCH_INTEGRATION_NOT_ACCEPTED/);
  }
  await assert.rejects(runSpotPaperPairedLive({
    ...setup.config,
    researchSourceSha256: SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256
  }), /PROVIDER_INJECTION_FORBIDDEN/);
  assert.deepEqual(setup.order, []);
});

test("next-run live entrypoint rejects a wrong source pin and injected provider before feed access", async t => {
  const setup = await fixture(t);
  const input = {
    runId: "next-run-live-gate",
    dataRoot: setup.dataRoot,
    modelPairId: SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR,
    accountContract: SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT,
    researchSourceSha256: "0".repeat(64),
    accountIds: {
      baseline: "next-baseline",
      challenger: "next-challenger",
      cash: "next-cash"
    }
  };
  await assert.rejects(runSpotPaperPairedLive(input),
    /NEXT_RUN_IDENTITY_REQUIRED/);
  await assert.rejects(runSpotPaperPairedLive({
    ...input,
    researchSourceSha256: SPOT_PAPER_PAIRED_NEXT_RUN_ACCEPTED_RESEARCH_SOURCE_SHA256,
    provider: setup.config.provider
  }), /PROVIDER_INJECTION_FORBIDDEN/);
  assert.deepEqual(setup.order, []);
});

test("a stale pre-signal or future quote stops the shared run without accepting an observation", async t => {
  for (const options of [{ predatingTicker: true }, { staleTickerAt: 1 }, { futureTicker: true }]) {
    const setup = await fixture(t, options);
    const report = await runSpotPaperPairedSynthetic(setup.config);
    assert.equal(report.stopReason, "SHARED_FEED_FAILURE");
    assert.equal(report.cycles, 1);
    assert.equal(report.commonHorizon.available, false);
    assert.equal(report.commonHorizon.reason, "NO_VALID_COMMON_OBSERVATION");
    assert.equal(report.commonHorizon.quoteAgeAtEffectMs, null);
    assert.equal(report.commonHorizon.quoteFreshAtShutdown, false);
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

test("paired transport failures are bounded, sanitized, and leave the failed cycle unapplied", async t => {
  const setup = await fixture(t, {
    enterOnCycleOne: true,
    failTickerAt: 1,
    failTickerBytes: 7,
    failTickerPhase: "BODY",
    failTickerMessage: "https://example.test/?token=do-not-persist"
  });
  const report = await runSpotPaperPairedSynthetic(setup.config);
  const diagnostic = report.transportDiagnostic;
  assert.deepEqual(diagnostic, {
    schemaVersion: "SPOT_PAPER_PAIRED_TRANSPORT_DIAGNOSTIC_V1",
    requestKind: "TICKER",
    phase: "BODY",
    termination: "TRANSPORT_ERROR",
    attemptedCycle: 1,
    requestCount: 2,
    byteCount: report.deliveredBytes,
    requestBytes: 7,
    elapsedMs: 0
  });
  assert.equal(report.stopReason, "SHARED_FEED_FAILURE");
  assert.equal(report.failureReason, "UNKNOWN_FAILURE");
  assert.equal(report.arms.every(arm =>
    arm.decisions.length === 0 && arm.fills.length === 0), true);
  assert.equal(setup.challengerApplyCount, 0);
  const journal = await readRunJournal({
    dataRoot: setup.dataRoot, runId: setup.config.runId
  });
  const failure = journal.events.find(event =>
    event.type === "shared_feed_failure");
  assert.deepEqual(failure.transportDiagnostic, diagnostic);
  assert.equal(failure.reason, "UNKNOWN_FAILURE");
  assert.equal(JSON.stringify({report, failure}).includes("do-not-persist"), false);
  assert.equal(JSON.stringify({report, failure}).includes("example.test"), false);
});

test("outer deadlines and explicit aborts retain the stalled request phase", async t => {
  for (const phase of ["HEADERS", "BODY"]) {
    const setup = await fixture(t, {
      maxCycles: 1, maxRequests: 2, maxDurationMs: 80,
      realMonotonic: true, hangOhlcPhase: phase
    });
    const pending = runSpotPaperPairedSynthetic(setup.config);
    await setup.pendingOhlc;
    const report = await pending;
    assert.equal(report.stopReason, "DURATION_LIMIT");
    assert.equal(report.requests, 1);
    assert.equal(report.transportDiagnostic.requestKind, "OHLC");
    assert.equal(report.transportDiagnostic.phase, phase);
    assert.equal(report.transportDiagnostic.termination, "OUTER_TIMEOUT");
    assert.equal(report.transportDiagnostic.attemptedCycle, 1);
    assert.equal(report.arms.every(arm => arm.fills.length === 0), true);
  }

  const controller = new AbortController();
  const aborted = await fixture(t, {
    maxCycles: 1, maxRequests: 2, signal: controller.signal,
    hangOhlcPhase: "BODY"
  });
  const pending = runSpotPaperPairedSynthetic(aborted.config);
  await aborted.pendingOhlc;
  controller.abort(new Error("unrestricted caller detail"));
  const report = await pending;
  assert.equal(report.stopReason, "OPERATOR_STOP");
  assert.equal(report.transportDiagnostic.termination, "CANCELLATION");
  assert.equal(report.transportDiagnostic.phase, "BODY");
  assert.equal(JSON.stringify(report).includes("unrestricted caller detail"), false);
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
  assert.ok(Number.isSafeInteger(challenger.valuation.netEquityCents));
  assert.equal(challenger.valuation.unresolvedObservations, 0);
  assert.equal(challenger.decisions[2].skippedReason, "ARM_STOPPED");
  assert.equal(challenger.riskStates[2].stopReason, "SESSION_LOSS_LIMIT");
  assert.equal(report.cycles, 3);
  assert.equal(report.commonHorizon.available, true);
  assert.equal(report.comparison.status, "UNAVAILABLE");
  assert.equal(report.comparison.reason, "REPLAY_FORWARD_ACCOUNT_MISMATCH");
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

test("runner preserves challenger decision advancement through sell cooldown", async t => {
  const setup = await fixture(t, {
    maxCycles: 3, maxRequests: 6, enterOnCycleOne: true,
    exitOnCycleTwo: true, preserveChallengeState: true
  });
  const report = await runSpotPaperPairedSynthetic(setup.config);

  assert.equal(report.cycles, 3);
  assert.equal(setup.challengerSellStates.length, 1);
  assert.equal(setup.challengerSellStates[0].before.advancedCycle, 2);
  assert.equal(setup.challengerStatesSeen[2].advancedCycle, 2);
  assert.equal(setup.challengerStatesSeen[2].cooldownUntil,
    setup.challengerSellStates[0].after.cooldownUntil);
  assert.ok(report.arms.find(arm => arm.role === "challenger").fills.some(fill =>
    fill.side === "SELL" && fill.reason === "SYNTHETIC_TEST_EXIT"));
});

test("stopped account gets mark-only common-horizon valuation while stale replay is withheld", async t => {
  const setup = await fixture(t, {
    stopArm: true, enterOnCycleOne: true, staleComparisonMark: true
  });
  const report = await runSpotPaperPairedSynthetic(setup.config);
  assert.equal(report.commonHorizon.available, true);
  const challenger = report.arms.find(arm => arm.role === "challenger");
  assert.equal(challenger.valuation.openPositions.length, 1);
  assert.equal(challenger.valuation.markAgeMs, 0);
  assert.ok(Number.isSafeInteger(challenger.valuation.netEquityCents));
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

test("deadline during normal poll sleep preserves historical horizon but reports terminal quote age",
  async t => {
  const setup = await fixture(t, {
    maxCycles: 3, maxRequests: 6, maxDurationMs: 2 * MINUTE,
    candleCount: 22,
    wallSleepAdvanceMs: (ms, index) => index === 0 ? ms : 32_712,
    priceAtIndex: index => index >= 21 ? "31000.00000000" : PRICE
  });
  const [comparisonExports, challengerExports] = await Promise.all([
    import("../scripts/spot-paper-research/comparison.mjs"),
    import("../scripts/spot-paper-research/entry-confirmation.mjs")
  ]);
  const captureObservations =
    setup.config.comparisonExports.compareSpotPaperStrategies;
  setup.config.comparisonExports.compareSpotPaperStrategies = observations => {
    captureObservations(observations);
    return comparisonExports.compareSpotPaperStrategies(observations);
  };
  setup.config.challengerExports = challengerExports;
  setup.config.arms[1] = createChallengerArm(challengerExports, "challenger-eur");
  setup.config.comparisonEngine = {
    id: SPOT_PAPER_RESEARCH_COMPARISON_ID,
    compare: setup.config.comparisonExports.compareSpotPaperStrategies
  };
  setup.config.configSha256 = pairedConfigDigest(setup.config);

  const report = await runSpotPaperPairedSynthetic(setup.config);
  assert.equal(report.stopReason, "DURATION_LIMIT");
  assert.equal(report.cycles, 2);
  assert.equal(report.requests, 4);
  assert.equal(setup.order.filter(item => item === "ohlc").length, 2);
  assert.equal(report.commonHorizon.available, true);
  assert.equal(report.commonHorizon.quoteAgeAtEffectMs, 0);
  assert.equal(report.commonHorizon.terminalQuoteAgeMs, 32_712);
  assert.equal(report.commonHorizon.quoteFreshAtShutdown, false);
  assert.equal(report.comparison.status, "COMPARISON_AVAILABLE");
  const baseline = report.arms.find(arm => arm.role === "baseline");
  assert.equal(baseline.valuation.openPositions.length, 1);
  assert.ok(Number.isSafeInteger(baseline.valuation.netEquityCents));
  assert.equal(report.comparison.arms.baseline.finalNetEquityCents,
    baseline.valuation.netEquityCents);

  const originalAssumption = replaySpotPaperFeeScenarioObservations(
    setup.replayObservations, { feeBpsPerSide: 50 });
  originalAssumption.arms.forEach((replay, index) => {
    const original = report.arms[index];
    assert.deepEqual(replay.decisions, original.decisions);
    assert.deepEqual(replay.fills, original.fills);
    assert.deepEqual(replay.riskStates, original.riskStates);
    assert.equal(replay.valuation.feesCents, original.valuation.feesCents);
    assert.equal(replay.valuation.slippageCents, original.valuation.slippageCents);
    assert.equal(replay.valuation.netEquityCents,
      original.valuation.netEquityCents);
  });
  const regularEeaSpot = replaySpotPaperFeeScenarioObservations(
    setup.replayObservations, { feeBpsPerSide: 20 });
  const xPerpsSpot = replaySpotPaperFeeScenarioObservations(
    setup.replayObservations, { feeBpsPerSide: 10 });
  assert.equal(originalAssumption.slippageBpsPerSide, 10);
  assert.equal(regularEeaSpot.slippageBpsPerSide, 10);
  assert.equal(xPerpsSpot.slippageBpsPerSide, 10);
  assert.notEqual(originalAssumption.arms[0].fills[0].quantitySat,
    regularEeaSpot.arms[0].fills[0].quantitySat);
  assert.ok(regularEeaSpot.arms[0].valuation.feesCents <
    originalAssumption.arms[0].valuation.feesCents);
  assert.ok(xPerpsSpot.arms[0].valuation.feesCents <
    regularEeaSpot.arms[0].valuation.feesCents);
  const staggered = [structuredClone(setup.replayObservations[0])];
  const firstDecisionAt = staggered[0].ohlc.receivedAt + 1;
  staggered[0].decisions = [
    {role: "baseline", decidedAt: firstDecisionAt},
    {role: "challenger", decidedAt: firstDecisionAt + 2},
    {role: "cash", decidedAt: firstDecisionAt + 1}
  ];
  staggered[0].decisionAt = firstDecisionAt + 2;
  staggered[0].ticker.requestStartedAt = firstDecisionAt + 3;
  staggered[0].ticker.receivedAt = firstDecisionAt + 4;
  staggered[0].effectAt = firstDecisionAt + 4;
  const staggeredReplay = replaySpotPaperFeeScenarioObservations(staggered);
  assert.deepEqual(staggeredReplay.arms.map(arm =>
    arm.decisions[0].decidedAt), staggered[0].decisions.map(item => item.decidedAt));
});

test("versioned 20-bps contract drives paper fills and shared comparison", async t => {
  const setup = await fixture(t, {maxCycles: 2});
  const [comparison, confirmation] = await Promise.all([
    import("../scripts/spot-paper-research/comparison.mjs"),
    import("../scripts/spot-paper-research/entry-confirmation.mjs")
  ]);
  const accountContract = SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT;
  let feeReplayObservations;
  const compare = observations => {
    feeReplayObservations = structuredClone(observations);
    return compareSpotPaperFeeScenarioObservations(
      observations, {feeBpsPerSide: accountContract.feeBpsPerSide});
  };
  const feeProbe = createBaselineArm("fee-probe", accountContract,
    applySpotPaperPairedFeeObservation);
  const feeProbeState = feeProbe.initialize();
  const feeProbeResult = feeProbe.apply({
    state: feeProbeState,
    decision: {id: "fee-probe-entry", direction: "ENTRY", candleAt: 1},
    quote: {bidNano: "30000000000000", askNano: "30001000000000",
      spreadBps: 1, receivedAt: 1},
    at: 1
  });
  assert.equal(feeProbeResult.fills[0].feeCents,
    Math.round(feeProbeResult.fills[0].grossCents * 20 / 10_000));
  setup.config.accountContract = accountContract;
  setup.config.arms = [
    createBaselineArm("baseline-next-v2", accountContract,
      applySpotPaperPairedFeeObservation),
    createChallengerArm(confirmation, "challenger-next-v2", accountContract,
      applySpotPaperPairedFeeObservation),
    createCashControlArm("cash-next-v2", accountContract)
  ];
  setup.config.challengerExports = confirmation;
  setup.config.feeScenarioApply = applySpotPaperPairedFeeObservation;
  setup.config.comparisonExports = {
    ...comparison, compareSpotPaperStrategies: compare
  };
  setup.config.feeScenarioCompare = compare;
  setup.config.comparisonEngine = {
    id: SPOT_PAPER_RESEARCH_COMPARISON_ID, compare
  };
  setup.config.configSha256 = pairedConfigDigest(setup.config);
  setup.config.accountContract = SPOT_PAPER_PAIRED_ACCOUNT_CONTRACT;
  setup.config.arms.forEach(arm => {
    arm.accountContract = SPOT_PAPER_PAIRED_ACCOUNT_CONTRACT;
  });
  await assert.rejects(runSpotPaperPairedSynthetic(setup.config),
    /CONFIG_IDENTITY_MISMATCH/);
  assert.deepEqual(setup.order, []);
  setup.config.accountContract = accountContract;
  setup.config.arms.forEach(arm => { arm.accountContract = accountContract; });

  const report = await runSpotPaperPairedSynthetic(setup.config);
  assert.equal(report.assumptions.feeBpsPerSide, 20);
  assert.equal(report.assumptions.accountContractId,
    "BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2");
  assert.equal(report.assumptions.accountContractVersion, 2);
  assert.equal(report.assumptions.feeBasis,
    "EEA_SPOT_ONLY_TAKER_ASSUMPTION");
  assert.equal(report.assumptions.accountTier, "UNKNOWN");
  assert.equal(report.assumptions.accountingEngine,
    "PAIRED_FEE_SCENARIO_LEDGER_V1");
  assert.equal(report.assumptions.slippageBpsPerSide, 10);
  assert.equal(report.comparison.status, "COMPARISON_AVAILABLE");
  assert.equal(report.comparison.arms.baseline.feesCents,
    report.arms[0].valuation.feesCents);
  const output = {write() {}};
  const hostExport = await pairedHostMain([
    "export", "--data-root", setup.dataRoot, "--run-id", report.runId
  ], {output});
  const expectedIdentity = {
    schemaVersion: "SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_V1",
    runId: report.runId, pair: report.pair,
    sourceSha256: report.sourceSha256, configSha256: report.configSha256,
    researchSourceSha256: report.researchSourceSha256,
    feedSourceId: report.feedSourceId,
    comparisonEngineId: report.comparisonEngineId, models: report.models
  };
  const replay = replaySpotPaperFeeScenarioObservations(
    feeReplayObservations, {feeBpsPerSide: 20});
  for (const [index, replayArm] of replay.arms.entries()) {
    const reportArm = report.arms[index];
    assert.deepEqual(replayArm.decisions, reportArm.decisions);
    assert.deepEqual(replayArm.fills, reportArm.fills);
    assert.equal(replayArm.valuation.feesCents, reportArm.valuation.feesCents);
    assert.equal(replayArm.valuation.netEquityCents,
      reportArm.valuation.netEquityCents);
  }
  assert.equal(evaluatePairedPaperEvidence({
    expectedIdentity, report: hostExport
  }).evidenceStatus, "VERIFIED_COMPLETE");
  assert.notEqual(evaluatePairedPaperEvidence({
    expectedIdentity,
    report: {
      ...hostExport,
      report: {
        ...hostExport.report,
        assumptions: {
          ...hostExport.report.assumptions,
          accountContractId: "BTC_EUR_PAIRED_PAPER_V1"
        }
      }
    }
  }).evidenceStatus, "VERIFIED_COMPLETE");
});

test("offline fee replay rejects synthetic and unverified host evidence", async t => {
  const setup = await fixture(t, { maxCycles: 1 });
  const report = await runSpotPaperPairedSynthetic(setup.config);
  const journal = await readRunJournal({
    dataRoot: setup.dataRoot, runId: setup.config.runId
  });
  const expectedIdentity = {
    schemaVersion: "SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_V1",
    runId: report.runId, pair: report.pair,
    sourceSha256: report.sourceSha256,
    configSha256: report.configSha256,
    researchSourceSha256: report.researchSourceSha256,
    feedSourceId: report.feedSourceId,
    comparisonEngineId: report.comparisonEngineId,
    models: report.models
  };
  const hostExport = {
    schemaVersion: "SPOT_PAPER_PAIRED_HOST_EXPORT_V1",
    runId: report.runId, status: "TERMINAL_JOURNAL_VERIFIED",
    verifiedTerminal: true, reconciliationStatus: "READ_ONLY_VERIFIED",
    report,
    journal: {
      schemaVersion: journal.schemaVersion, runId: journal.runId,
      sequence: journal.sequence, checkpoint: journal.checkpoint,
      manifest: journal.manifest, events: journal.events,
      reconciliationStatus: journal.reconciliationStatus
    }
  };
  await assert.rejects(replayVerifiedSpotPaperFeeScenarios({
    expectedIdentity, hostExport, dataRoot: setup.dataRoot
  }), /LIVE_KRAKEN_EVIDENCE_REQUIRED/);

  const unverified = structuredClone(hostExport);
  unverified.verifiedTerminal = false;
  await assert.rejects(replayVerifiedSpotPaperFeeScenarios({
    expectedIdentity, hostExport: unverified, dataRoot: setup.dataRoot
  }), /VERIFIED_HOST_EXPORT_REQUIRED/);
});

async function verifiedFeeReplayFixture(t, versionedV2 = false) {
  const setup = await fixture(t, {maxCycles: 2});
  const [comparison, confirmation] = await Promise.all([
    import("../scripts/spot-paper-research/comparison.mjs"),
    import("../scripts/spot-paper-research/entry-confirmation.mjs")
  ]);
  const [comparisonBytes, entryConfirmationBytes] = await Promise.all([
    readFile(new URL("../scripts/spot-paper-research/comparison.mjs", import.meta.url)),
    readFile(new URL("../scripts/spot-paper-research/entry-confirmation.mjs", import.meta.url))
  ]);
  setup.config.researchSourceSha256 = pairedResearchSourceDigest({
    comparisonBytes, entryConfirmationBytes
  });
  let feeScenarioCompare;
  if (versionedV2) {
    const accountContract = SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT;
    feeScenarioCompare = observations =>
      compareSpotPaperFeeScenarioObservations(observations, {
        feeBpsPerSide: accountContract.feeBpsPerSide
      });
    setup.config.accountContract = accountContract;
    setup.config.arms = [
      createBaselineArm("baseline-disk-test", accountContract,
        applySpotPaperPairedFeeObservation),
      createChallengerArm(confirmation, "challenger-disk-test", accountContract,
        applySpotPaperPairedFeeObservation),
      createCashControlArm("cash-disk-test", accountContract)
    ];
    setup.config.feeScenarioApply = applySpotPaperPairedFeeObservation;
    setup.config.feeScenarioCompare = feeScenarioCompare;
  } else {
    setup.config.arms = [
      createBaselineArm("baseline-disk-test"),
      createChallengerArm(confirmation, "challenger-disk-test"),
      createCashControlArm("cash-disk-test")
    ];
  }
  setup.config.challengerExports = confirmation;
  setup.config.comparisonExports = comparison;
  setup.config.comparisonEngine = {
    id: SPOT_PAPER_RESEARCH_COMPARISON_ID,
    compare: feeScenarioCompare ?? comparison.compareSpotPaperStrategies
  };
  setup.config.configSha256 = pairedConfigDigest(setup.config);

  const report = await runSpotPaperPairedSynthetic(setup.config);
  const output = {write() {}};
  const hostExport = await pairedHostMain([
    "export", "--data-root", setup.dataRoot, "--run-id", report.runId
  ], {output});
  const runDirectory = join(setup.dataRoot, report.runId);
  const journalPath = join(runDirectory, "journal.json");
  const envelope = JSON.parse(await readFile(journalPath, "utf8"));
  const config = {...setup.config, provider: {
    ...setup.config.provider, sourceId: SPOT_PAPER_PAIRED_SOURCE_ID
  }};
  const configSha256 = pairedConfigDigest(config);
  const reportForReplay = structuredClone(hostExport.report);
  reportForReplay.feedSourceId = SPOT_PAPER_PAIRED_SOURCE_ID;
  reportForReplay.testOnly = false;
  reportForReplay.researchSourceSha256 = setup.config.researchSourceSha256;
  reportForReplay.configSha256 = configSha256;
  const payload = envelope.payload;
  payload.manifest.feedSourceId = SPOT_PAPER_PAIRED_SOURCE_ID;
  payload.manifest.configSha256 = configSha256;
  payload.manifest.researchSourceSha256 = setup.config.researchSourceSha256;
  payload.events.at(-1).report = reportForReplay;
  envelope.sha256 = sha256(Buffer.from(JSON.stringify(payload), "utf8"));
  await writeFile(journalPath, JSON.stringify(envelope));
  hostExport.report = reportForReplay;
  hostExport.journal = {
    ...hostExport.journal,
    manifest: payload.manifest,
    events: payload.events
  };
  const expectedIdentity = {
    schemaVersion: "SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_V1",
    runId: reportForReplay.runId, pair: reportForReplay.pair,
    sourceSha256: reportForReplay.sourceSha256,
    configSha256, researchSourceSha256: setup.config.researchSourceSha256,
    feedSourceId: SPOT_PAPER_PAIRED_SOURCE_ID,
    comparisonEngineId: reportForReplay.comparisonEngineId,
    models: reportForReplay.models
  };
  const result = await replayVerifiedSpotPaperFeeScenarios({
    expectedIdentity, hostExport, dataRoot: setup.dataRoot
  });
  return {result, hostExport, reportForReplay, configSha256};
}

test("verified fee replay labels original V1 and legacy V2 fee assumptions", async t => {
  const {result: v1} = await verifiedFeeReplayFixture(t);
  assert.equal(v1.evidenceStatus, "VERIFIED_COMPLETE");
  assert.equal(v1.replayAgreement,
    "ORIGINAL_50BPS_DECISIONS_FILLS_RISK_AND_ACCOUNTING_MATCHED");
  assert.equal(v1.scenarios.length, 3);

  const {result: v2, hostExport, configSha256} =
    await verifiedFeeReplayFixture(t, true);
  assert.equal(v2.evidenceStatus, "VERIFIED_COMPLETE");
  assert.equal(v2.replayAgreement,
    "ORIGINAL_20BPS_STRATEGIES_DECISIONS_FILLS_RISK_AND_ACCOUNTING_MATCHED");
  assert.equal(v2.scenarios[0].feeBpsPerSide, 20);
  assert.equal(v2.scenarios[0].scenario, "ORIGINAL_PAIRED_RUN_ASSUMPTION");
  assert.equal(v2.scenarios[1].feeBpsPerSide, 50);
  assert.equal(v2.originalReport.configSha256, configSha256);
  assert.ok(hostExport.journal.events.some(event =>
    event.type === "shared_observation" && event.ticker.bytes > 0));
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
  const output = { write() {} };
  const inspected = await pairedHostMain([
    "report", "--data-root", setup.dataRoot, "--run-id", setup.config.runId
  ], { output });
  const exported = await pairedHostMain([
    "export", "--data-root", setup.dataRoot, "--run-id", setup.config.runId
  ], { output });
  assert.equal(inspected.status, "TERMINAL_JOURNAL_VERIFIED");
  assert.equal(inspected.report.outcome, "INTERRUPTED_OR_STOPPED");
  assert.equal(exported.journal.reconciliationStatus, "READ_ONLY_VERIFIED");
  assert.equal(exported.report.fullEightHourCompletion, false);
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
  assert.equal(provider.transportAdapterVersion,
    "SPOT_PAPER_PAIRED_KRAKEN_TRANSPORT_ADAPTER_V1");
  assert.deepEqual(provider.counters(), { requests: 0, bytes: 0 });
});

test("paired transport adapter reports response stages without changing legacy provider", async () => {
  const raw = JSON.stringify({error: [], result: {}});
  const phases = [];
  let fetchCalls = 0;
  const provider = createSpotPaperPairedKrakenProvider({
    now: () => BASE,
    fetchImpl: async (url, options) => {
      fetchCalls++;
      assert.equal(url.origin, "https://api.kraken.com");
      assert.equal(url.pathname, "/0/public/OHLC");
      assert.equal(options.method, "GET");
      return new Response(raw, {
        headers: {"content-type": "application/json"}
      });
    }
  });
  const response = await provider.fetchOhlc({
    deadlineAt: performance.now() + 5_000,
    monotonicNow: () => performance.now(),
    onTransportState: (phase, bytes) => phases.push([phase, bytes])
  });
  assert.equal(fetchCalls, 1);
  assert.equal(response.raw, raw);
  assert.deepEqual(phases, [
    ["HEADERS", 0],
    ["BODY", 0],
    ["BODY", Buffer.byteLength(raw)],
    ["RESPONSE", Buffer.byteLength(raw)]
  ]);
  assert.deepEqual(provider.counters(), {
    requests: 1, bytes: Buffer.byteLength(raw)
  });
});

test("paired transport adapter fences late headers and reports a stalled body", async () => {
  const headerController = new AbortController();
  const headerPhases = [];
  let resolveHeaders;
  const headerProvider = createSpotPaperPairedKrakenProvider({
    fetchImpl: () => new Promise(resolve => {
      resolveHeaders = resolve;
    })
  });
  const headerRequest = headerProvider.fetchOhlc({
    signal: headerController.signal,
    deadlineAt: performance.now() + 5_000,
    monotonicNow: () => performance.now(),
    onTransportState: (phase, bytes) => headerPhases.push([phase, bytes])
  });
  while (!resolveHeaders) await new Promise(resolve => setImmediate(resolve));
  headerController.abort();
  await assert.rejects(headerRequest, {name: "AbortError"});
  assert.deepEqual(headerPhases, [["HEADERS", 0]]);
  const lateResponse = new Response("late");
  resolveHeaders(lateResponse);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lateResponse.bodyUsed, true);
  assert.deepEqual(headerPhases, [["HEADERS", 0]]);

  const bodyController = new AbortController();
  const bodyPhases = [];
  let beginBodyRead;
  let cancelBodyRead;
  const stalledResponse = {
    ok: true,
    status: 200,
    headers: new Headers({"content-type": "application/json"}),
    body: {
      getReader() {
        return {
          read() {
            beginBodyRead();
            return new Promise(() => {});
          },
          cancel() {
            cancelBodyRead();
            return Promise.resolve();
          },
          releaseLock() {}
        };
      }
    }
  };
  const bodyStarted = new Promise(resolve => {
    beginBodyRead = resolve;
  });
  let bodyCancelled = false;
  cancelBodyRead = () => {
    bodyCancelled = true;
  };
  const bodyProvider = createSpotPaperPairedKrakenProvider({
    fetchImpl: async () => stalledResponse
  });
  const bodyRequest = bodyProvider.fetchOhlc({
    signal: bodyController.signal,
    deadlineAt: performance.now() + 5_000,
    monotonicNow: () => performance.now(),
    onTransportState: (phase, bytes) => bodyPhases.push([phase, bytes])
  });
  await bodyStarted;
  bodyController.abort();
  await assert.rejects(bodyRequest, {name: "AbortError"});
  assert.equal(bodyCancelled, true);
  assert.deepEqual(bodyPhases, [["HEADERS", 0], ["BODY", 0]]);
});

test("research source pin matches the exact merged #1299 bytes and rejects changed bytes", async () => {
  const [comparisonBytes, entryConfirmationBytes] = await Promise.all([
    readFile(new URL("../scripts/spot-paper-research/comparison.mjs", import.meta.url)),
    readFile(new URL("../scripts/spot-paper-research/entry-confirmation.mjs", import.meta.url))
  ]);
  const accepted = pairedResearchSourceDigest({ comparisonBytes, entryConfirmationBytes });
  assert.equal(accepted, SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256);
  assert.notEqual(pairedResearchSourceDigest({
    comparisonBytes: Buffer.concat([comparisonBytes, Buffer.from("\n")]),
    entryConfirmationBytes
  }), SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256);

  const sampleComparisonBytes = Buffer.from("comparison source");
  const sampleEntryConfirmationBytes = Buffer.from("confirmation source");
  const actual = pairedResearchSourceDigest({
    comparisonBytes: sampleComparisonBytes,
    entryConfirmationBytes: sampleEntryConfirmationBytes
  });
  const expected = sha256(Buffer.concat([
    Buffer.from("scripts/spot-paper-research/comparison.mjs\0"),
    sampleComparisonBytes,
    Buffer.from("\0scripts/spot-paper-research/entry-confirmation.mjs\0"),
    sampleEntryConfirmationBytes, Buffer.from("\0")
  ]));
  assert.equal(actual, expected);
});

test("actual #1299 exports integrate multi-cycle buys, exits, cooldown, stopped valuation, and replay",
  async t => {
    assert.ok(researchExportsAvailable, "RESEARCH_INTEGRATION_SOURCE_MISSING");
    const [comparison, confirmation] = await Promise.all([
      import("../scripts/spot-paper-research/comparison.mjs"),
      import("../scripts/spot-paper-research/entry-confirmation.mjs")
    ]);
    const [comparisonBytes, entryConfirmationBytes] = await Promise.all([
      readFile(new URL("../scripts/spot-paper-research/comparison.mjs", import.meta.url)),
      readFile(new URL("../scripts/spot-paper-research/entry-confirmation.mjs", import.meta.url))
    ]);
    const priceAtIndex = index => {
      const period = 19;
      const phase = ((index % period) + period) % period;
      const triangle = phase <= period / 2 ?
        -1 + phase * 4 / period : 3 - phase * 4 / period;
      return (30_000 + triangle * 145 - index * 1.2).toFixed(8);
    };
    const runWave = async overrides => {
      const setup = await fixture(t, {
        candleCount: 32, maxCycles: 480, maxRequests: 960,
        maxDurationMs: SPOT_PAPER_PAIRED.maxDurationMs,
        priceAtIndex,
        quotePriceAtCycle(cycle) {
          const mid = Number(priceAtIndex(20 + cycle));
          return ticker((mid - 0.1).toFixed(8), (mid + 0.1).toFixed(8));
        },
        advanceMonotonic: true,
        tickerDelayMs: cycle => cycle === overrides.quoteDelayCycle ? 4_500 : 1,
        wallSleepLagMs: 400,
        ...overrides
      });
      setup.config.arms[1] = createChallengerArm(confirmation, "challenger-eur");
      setup.config.challengerExports = confirmation;
      setup.config.comparisonExports = comparison;
      setup.config.comparisonEngine = {
        id: SPOT_PAPER_RESEARCH_COMPARISON_ID,
        compare: comparison.compareSpotPaperStrategies
      };
      setup.config.researchSourceSha256 = pairedResearchSourceDigest({
        comparisonBytes, entryConfirmationBytes
      });
      setup.config.configSha256 = pairedConfigDigest(setup.config);
      const report = await runSpotPaperPairedSynthetic(setup.config);
      const journal = await readRunJournal({
        dataRoot: setup.dataRoot, runId: setup.config.runId
      });
      return { setup, report, journal,
        observations: journal.events.filter(event => event.type === "shared_observation") };
    };
    const discovery = await runWave({});
    const discoveryChallenger = discovery.report.arms.find(arm => arm.role === "challenger");
    const cooldownCycle = discoveryChallenger.decisions.findIndex(decision =>
      decision.metadata?.discarded === "COOLDOWN_ACTIVE");
    assert.ok(cooldownCycle >= 0, "COOLDOWN_ENTRY_NOT_EXERCISED");
    const priorSell = discoveryChallenger.fills.filter(fill => fill.side === "SELL" &&
      fill.executionAt < discoveryChallenger.decisions[cooldownCycle].decidedAt).at(-1);
    assert.ok(priorSell);
    const cooldownUntil = priorSell.executionAt + 600_000;
    const processingDelayMs = cooldownUntil -
      discoveryChallenger.decisions[cooldownCycle].decidedAt + 500;
    const { setup, report, journal, observations } = await runWave({
      processingDelayCycle: cooldownCycle + 1, processingDelayMs,
      quoteDelayCycle: cooldownCycle + 1
    });
    const journalPath = join(setup.dataRoot, setup.config.runId, "journal.json");
    const journalFileBytes = (await stat(journalPath)).size;
    const journalExportBytes = Buffer.byteLength(JSON.stringify(journal), "utf8");
    const reportBytes = Buffer.byteLength(JSON.stringify(report), "utf8");
    const reportArrayBytes = Object.fromEntries(report.arms.map(arm => [arm.role, {
      decisions: Buffer.byteLength(JSON.stringify(arm.decisions), "utf8"),
      fills: Buffer.byteLength(JSON.stringify(arm.fills), "utf8"),
      riskStates: Buffer.byteLength(JSON.stringify(arm.riskStates), "utf8"),
      valuation: Buffer.byteLength(JSON.stringify(arm.valuation), "utf8")
    }]));
    const output = { write() {} };
    const hostReport = await pairedHostMain([
      "report", "--data-root", setup.dataRoot, "--run-id", setup.config.runId
    ], { output });
    const hostExport = await pairedHostMain([
      "export", "--data-root", setup.dataRoot, "--run-id", setup.config.runId
    ], { output });
    const reportWrapperBytes = Buffer.byteLength(JSON.stringify(hostReport), "utf8");
    const hostExportBytes = Buffer.byteLength(JSON.stringify(hostExport), "utf8");
    const archivePath = join(setup.dataRoot, `${setup.config.runId}.tar`);
    const manifestPath = join(setup.dataRoot, `${setup.config.runId}.manifest.json`);
    const packaged = await pairedHostMain([
      "package", "--data-root", setup.dataRoot, "--run-id", setup.config.runId,
      "--archive", archivePath, "--manifest", manifestPath
    ], { output });
    t.diagnostic(JSON.stringify({
      runId: report.runId, cycles: report.cycles,
      journalFileBytes, journalExportBytes, reportBytes,
      reportArrayBytes,
      reportWrapperBytes, hostExportBytes, archiveBytes: packaged.archiveBytes,
      packageStatus: packaged.status
    }));
    assert.equal(report.cycles, 480);
    assert.equal(hostReport.status, "TERMINAL_JOURNAL_VERIFIED");
    assert.equal(hostExport.verifiedTerminal, true);
    assert.equal(hostExport.journal.reconciliationStatus, "READ_ONLY_VERIFIED");
    assert.deepEqual(hostExport.report, report);
    assert.equal(packaged.status, "PACKAGED_BYTES_ONLY");
    assert.equal(packaged.roundTripVerified, true);
    assert.ok(journalFileBytes <= 8 * 1024 * 1024);
    assert.ok(reportBytes <= 8 * 1024 * 1024);
    assert.ok(reportWrapperBytes <= 8 * 1024 * 1024);
    assert.ok(hostExportBytes <= 16 * 1024 * 1024);
    assert.equal(journal.events.filter(event =>
      event.type === "shared_observation").length, 480);
    assert.ok(journal.checkpoint.states.every(Boolean));
    assert.ok(report.arms.every(arm =>
      arm.decisions.every(decision => !Object.hasOwn(decision, "state"))));
    assert.ok(observations.length > 10);
    assert.ok(observations.every(observation =>
      observation.decisionAt < observation.ticker.requestStartedAt &&
      observation.ticker.requestStartedAt < observation.ticker.receivedAt &&
      observation.ticker.receivedAt <= observation.effectAt));
    const firstOhlc = await readFile(join(setup.dataRoot, setup.config.runId,
      "responses", `${observations[0].ohlc.sha256}.json`), "utf8");
    assert.ok(JSON.parse(firstOhlc).result.XXBTZEUR.length > 21);
    assert.equal(report.comparison.status, "COMPARISON_AVAILABLE",
      JSON.stringify({ comparison: report.comparison, stopReason: report.stopReason,
        cycles: report.cycles, commonHorizon: report.commonHorizon,
        failure: journal.events.find(event => event.type === "shared_feed_failure")?.reason,
        endedAt: report.endedAt, last: observations.at(-1)?.ticker }));
    const challenger = report.arms.find(arm => arm.role === "challenger");
    assert.ok(challenger.fills.some(fill => fill.side === "BUY"));
    assert.ok(challenger.fills.some(fill => fill.side === "SELL"));
    const cooldownDecision = challenger.decisions.findIndex(decision =>
      decision.metadata?.discarded === "COOLDOWN_ACTIVE");
    assert.ok(cooldownDecision >= 0, `COOLDOWN_ENTRY_NOT_EXERCISED:${JSON.stringify({
      cycles: report.cycles, stopReason: report.stopReason,
      fills: challenger.fills.map(fill => [fill.side, fill.executionAt]),
      discards: challenger.decisions.map((decision, index) =>
        decision.metadata?.discarded ? [index + 1, decision.metadata.discarded] : null)
        .filter(Boolean)
    })}`);
    const cooldownSell = challenger.fills.filter(fill => fill.side === "SELL" &&
      fill.executionAt < challenger.decisions[cooldownDecision].decidedAt).at(-1);
    assert.ok(cooldownSell);
    const actualCooldownUntil = cooldownSell.executionAt + 600_000;
    assert.ok(challenger.decisions[cooldownDecision].decidedAt < actualCooldownUntil);
    assert.ok(actualCooldownUntil <= observations[cooldownDecision].ticker.receivedAt,
      JSON.stringify({
        cooldownUntil: actualCooldownUntil,
        decisionAt: challenger.decisions[cooldownDecision].decidedAt,
        tickerReceivedAt: observations[cooldownDecision].ticker.receivedAt,
        sellAt: cooldownSell.executionAt
      }));
    for (const arm of report.arms) {
      const replay = report.comparison.arms[arm.role];
      assert.equal(replay.tradingStoppedAt, arm.stoppedAt);
      assert.equal(replay.valuationAt, report.commonHorizon.effectAt);
      assert.equal(replay.finalNetEquityCents, arm.valuation.netEquityCents);
      assert.equal(replay.feesCents, arm.valuation.feesCents);
      assert.equal(replay.grossTurnoverCents, arm.valuation.turnoverCents);
      assert.equal(replay.fills.length, arm.fills.length);
      assert.deepEqual(replay.fills.map(fill => [
        fill.id, fill.side, fill.quantitySat, fill.priceNano, fill.grossCents, fill.feeCents
      ]), arm.fills.map(fill => [
        fill.id, fill.side, fill.quantitySat, fill.priceNano, fill.grossCents, fill.feeCents
      ]));
    }
    const sharedEvents = journal.events.filter(event =>
      event.type === "shared_observation");
    const feeReplayInputs = [];
    for (const event of sharedEvents) {
      const readAcquisition = async reference => {
        const raw = await readFile(join(setup.dataRoot, setup.config.runId,
          reference.path), "utf8");
        return {
          raw, data: JSON.parse(raw), sha256: reference.sha256,
          bytes: reference.bytes, requestStartedAt: reference.requestStartedAt,
          receivedAt: reference.receivedAt
        };
      };
      feeReplayInputs.push({
        decisionAt: event.decisionAt, decisions: event.decisions,
        effectAt: event.effectAt,
        ohlc: await readAcquisition(event.ohlc),
        ticker: await readAcquisition(event.ticker)
      });
    }
    const feeReplay = replaySpotPaperFeeScenarioObservations(
      feeReplayInputs, {feeBpsPerSide: 50});
    for (const [index, arm] of report.arms.entries()) {
      const replay = feeReplay.arms[index];
      assert.deepEqual(replay.decisions, arm.decisions);
      assert.deepEqual(replay.fills, arm.fills);
      assert.deepEqual(replay.riskStates, arm.riskStates);
      assert.equal(replay.valuation.feesCents, arm.valuation.feesCents);
      assert.equal(replay.valuation.slippageCents, arm.valuation.slippageCents);
      assert.equal(replay.valuation.netEquityCents, arm.valuation.netEquityCents);
    }
    const feeTwentyReplay = replaySpotPaperFeeScenarioObservations(
      feeReplayInputs, {feeBpsPerSide: 20});
    const baselineFifty = feeReplay.arms.find(arm => arm.role === "baseline");
    const baselineTwenty = feeTwentyReplay.arms.find(arm => arm.role === "baseline");
    const challengerFifty = feeReplay.arms.find(arm => arm.role === "challenger");
    const challengerTwenty = feeTwentyReplay.arms.find(arm => arm.role === "challenger");
    assert.notEqual(baselineTwenty.stoppedAt, baselineFifty.stoppedAt);
    assert.equal(challengerFifty.tradingStatus, "STOPPED");
    assert.equal(challengerTwenty.tradingStatus, "ACTIVE");
    assert.ok(challengerTwenty.decisions.some((decision, index) =>
      index > challengerFifty.decisions.findIndex(item =>
        item.skippedReason === "ARM_STOPPED") &&
      decision.metadata?.discarded === "COOLDOWN_ACTIVE"));
    assert.notDeepEqual(challengerTwenty.decisions, challengerFifty.decisions);
    assert.ok(report.arms.some(arm => arm.tradingStatus === "STOPPED" &&
      arm.valuation.openPositions.length > 0),
    `STOPPED_OPEN_INVENTORY_NOT_EXERCISED:${JSON.stringify(report.arms.map(arm => ({
      role: arm.role, status: arm.tradingStatus, stopReason: arm.stopReason,
      equity: arm.valuation.netEquityCents,
      realized: arm.fills.reduce((sum, fill) =>
        sum + (fill.side === "BUY" ? -fill.grossCents - fill.feeCents :
          fill.grossCents - fill.feeCents), 0),
      openPositions: arm.valuation.openPositions.length, fills: arm.fills.length
    })))}`);
    assert.ok(feeReplay.arms.some(arm => arm.tradingStatus === "STOPPED" &&
      arm.valuation.openPositions.length > 0));
  });
