import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
  advanceEntryConfirmation, createEntryConfirmationState,
  recordEntryConfirmationSell
} from "../scripts/spot-paper-research/entry-confirmation.mjs";
import {
  createSpotPaperPairedNextRunConfig, nextRunResearchSourceDigest
} from "../scripts/spot-paper-paired/next-run-composition.mjs";
import {
  pairedConfigDigest, runSpotPaperPairedSynthetic,
  SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT,
  SPOT_PAPER_PAIRED_TREND_MODEL
} from "../scripts/spot-paper-paired/forward.mjs";
import {SPOT_PAPER_PAIRED_SYNTHETIC_SOURCE_ID} from
  "../scripts/spot-paper-paired/forward.mjs";
import {sha256} from "../scripts/spot-paper-pilot/core.mjs";

const MINUTE = 60_000;
const BASE = Date.UTC(2025, 0, 1);
const CANDLE_VALUES = [
  ...Array(21).fill(100), 120, 130, ...Array(20).fill(80)
];
const row = (timestamp, value) => {
  const close = `${value}.00000000`;
  return [timestamp / 1000, close, close, close, close, close, "1.00000000", 1];
};
const ticker = (bid, ask) => ({error: [], result: {XXBTZEUR: {
  a: [ask, "1", "1.00000000"], b: [bid, "1", "1.00000000"]
}}});
const receipt = (data, requestStartedAt, receivedAt) => {
  const raw = JSON.stringify(data);
  return {data, raw, bytes: Buffer.byteLength(raw),
    sha256: sha256(Buffer.from(raw)), requestStartedAt, receivedAt};
};

function trendExports({allowEntries}) {
  return {
    SPOT_PAPER_5M_TREND_FILTER_ID:
      "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1",
    createFiveMinuteTrendState: createEntryConfirmationState,
    advanceFiveMinuteTrendEntry(state, candles, options) {
      const advanced = advanceEntryConfirmation(state, candles, options);
      if (!allowEntries && advanced.signals.at(-1)?.direction === "ENTRY") {
        return {...advanced, signals: [], discarded:
          "FIVE_MINUTE_SMA20_TREND_NOT_CONFIRMED",
        blockedEntryReason: "FIVE_MINUTE_SMA20_TREND_NOT_CONFIRMED"};
      }
      if (advanced.signals.at(-1)?.direction === "ENTRY") {
        return {...advanced, signals: advanced.signals.map(signal => ({
          ...signal, id: `${SPOT_PAPER_PAIRED_TREND_MODEL}:ENTRY:${signal.candleAt}`,
          strategyReason: "CONFIRM2_COOLDOWN10_AND_5M_SMA20_UPTREND"
        }))};
      }
      return advanced;
    },
    recordFiveMinuteTrendSell: recordEntryConfirmationSell
  };
}

async function setup(t, {allowTrendEntries = false, stopOnCycleFour = false,
  staleTicker = false, missingOhlc = false, interruptAfterFirstQuote = false,
  maxCycles = 4} = {}) {
  const dataRoot = await mkdtemp(join(tmpdir(), "paired-next-run-"));
  t.after(() => rm(dataRoot, {recursive: true, force: true}));
  let wall = BASE + 22 * MINUTE + 1_000;
  let monotonic = 100;
  let cycle = 0;
  const counters = {requests: 0, bytes: 0};
  const abort = new AbortController();
  const provider = {
    sourceId: SPOT_PAPER_PAIRED_SYNTHETIC_SOURCE_ID,
    async fetchOhlc() {
      cycle++;
      counters.requests++;
      const requestStartedAt = wall;
      const receivedAt = wall + 5;
      const closedCount = 20 + cycle;
      const rows = Array.from({length: closedCount}, (_, index) =>
        row(BASE + index * MINUTE, CANDLE_VALUES[index] ?? 80));
      rows.push(row(BASE + closedCount * MINUTE, CANDLE_VALUES[closedCount] ?? 80));
      const response = receipt(missingOhlc ? {error: [], result: {}} : {
        error: [], result: {XXBTZEUR: rows, last: rows.at(-1)[0]}
      }, requestStartedAt, receivedAt);
      counters.bytes += response.bytes;
      wall = receivedAt;
      return response;
    },
    async fetchTicker() {
      counters.requests++;
      const requestStartedAt = wall + 1;
      const receivedAt = staleTicker ? requestStartedAt + 11_000 :
        requestStartedAt + 1;
      const stopNow = stopOnCycleFour && cycle === 4;
      const response = receipt(ticker(
        stopNow ? "29000.00000000" : "29999.00000000",
        stopNow ? "29001.00000000" : "30001.00000000"
      ), requestStartedAt, receivedAt);
      counters.bytes += response.bytes;
      wall = receivedAt + (staleTicker ? 11_000 : 0);
      return response;
    },
    counters: () => ({...counters})
  };
  const config = createSpotPaperPairedNextRunConfig({
    runId: "next-run-synthetic",
    dataRoot,
    sourceSha256: "a".repeat(64),
    researchSourceSha256: "b".repeat(64),
    provider,
    confirmationExports: {
      SPOT_PAPER_ENTRY_CONFIRMATION_ID:
        "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1",
      createEntryConfirmationState, advanceEntryConfirmation,
      recordEntryConfirmationSell
    },
    trendExports: trendExports({allowEntries: allowTrendEntries}),
    accountIds: {
      baseline: "next-baseline-eur",
      challenger: "next-trend-eur",
      cash: "next-cash-eur"
    },
    maxCycles, maxRequests: maxCycles * 2,
    maxDurationMs: maxCycles * MINUTE,
    pollIntervalMs: MINUTE,
    now: () => wall,
    monotonicNow: () => monotonic,
    sleep: async duration => {
      wall += duration;
      monotonic += duration;
      if (interruptAfterFirstQuote && cycle === 1) abort.abort(new Error("OPERATOR_STOP"));
    },
    signal: abort.signal
  });
  const compare = config.feeScenarioCompare;
  config.feeScenarioCompare = observations => {
    config.testReplay = compare(observations);
    return config.testReplay;
  };
  config.comparisonEngine.compare = config.feeScenarioCompare;
  config.configSha256 = pairedConfigDigest(config);
  return {config};
}

test("next-run composition binds distinct CONFIRM2, trend, and cash identities and versioned costs", async t => {
  const {config} = await setup(t);
  assert.equal(config.accountContract.contractId,
    "BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2");
  assert.equal(config.accountContract.feeBpsPerSide, 20);
  assert.equal(config.accountContract.slippageBpsPerSide, 10);
  assert.deepEqual(config.modelPair.models.map(model => model.modelId), [
    "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1",
    SPOT_PAPER_PAIRED_TREND_MODEL,
    "CASH_CONTROL_V1"
  ]);
  const report = await runSpotPaperPairedSynthetic(config);
  assert.equal(report.assumptions.feeBpsPerSide, 20);
  assert.equal(report.assumptions.slippageBpsPerSide, 10);
  assert.deepEqual(report.models.map(model => model.modelId),
    config.modelPair.models.map(model => model.modelId));
});

test("shared synthetic feed diverges at the trend entry filter and keeps stop/cost accounting active", async t => {
  const {config} = await setup(t, {stopOnCycleFour: true});
  const report = await runSpotPaperPairedSynthetic(config);
  const baseline = report.arms.find(arm => arm.role === "baseline");
  const challenger = report.arms.find(arm => arm.role === "challenger");
  assert.equal(report.cycles, 4, JSON.stringify({
    stopReason: report.stopReason,
    failureReason: report.failureReason,
    outcome: report.outcome
  }));
  assert.ok(baseline.fills.some(fill => fill.side === "BUY"));
  assert.equal(challenger.fills.length, 0);
  assert.ok(baseline.fills.some(fill =>
    fill.reason === "BASELINE_SAMPLED_2PCT_BID_STOP"), JSON.stringify({
    decisions: baseline.decisions,
    fills: baseline.fills,
    comparison: report.comparison,
    replay: Object.values(config.testReplay?.arms ?? {}).map(arm => ({
      role: arm.role, fills: arm.fills, fees: arm.feesCents,
      equity: arm.finalNetEquityCents
    }))
  }));
  assert.ok(baseline.valuation.feesCents > 0);
  assert.ok(baseline.valuation.slippageCents > 0);
  assert.equal(report.comparison.status, "COMPARISON_AVAILABLE",
    JSON.stringify({
      comparison: report.comparison,
      reportArms: report.arms.map(arm => ({
        role: arm.role, fills: arm.fills, fees: arm.valuation.feesCents,
        equity: arm.valuation.netEquityCents
      })),
      replay: Object.values(config.testReplay?.arms ?? {}).map(arm => ({
        role: arm.role, fills: arm.fills, fees: arm.feesCents,
        equity: arm.finalNetEquityCents
      }))
    }));
  assert.equal(report.comparison.commonHorizonAt,
    report.commonHorizon.effectAt);
});

test("trend entry, baseline exits, fee replay, and common terminal horizon use the same observations", async t => {
  const {config} = await setup(t, {allowTrendEntries: true, maxCycles: 12});
  const report = await runSpotPaperPairedSynthetic(config);
  const baseline = report.arms.find(arm => arm.role === "baseline");
  const challenger = report.arms.find(arm => arm.role === "challenger");
  assert.ok(baseline.fills.some(fill => fill.side === "BUY"));
  assert.ok(challenger.fills.some(fill => fill.side === "BUY"));
  assert.ok(challenger.fills.some(fill => fill.side === "SELL"));
  assert.equal(report.cycles, 12);
  assert.equal(report.comparison.status, "COMPARISON_AVAILABLE");
  assert.equal(report.comparison.commonHorizonAt, report.commonHorizon.effectAt);
  assert.ok(challenger.fills.every(fill =>
    fill.strategyId === SPOT_PAPER_PAIRED_TREND_MODEL));
  assert.ok(challenger.valuation.feesCents > 0);
  assert.ok(challenger.valuation.slippageCents > 0);
});

test("the selected composition completes only within the existing 480-cycle bound", async t => {
  const {config} = await setup(t, {allowTrendEntries: true, maxCycles: 480});
  const report = await runSpotPaperPairedSynthetic(config);
  assert.equal(report.cycles, 480);
  assert.equal(report.requests, 960);
  assert.equal(report.fullEightHourCompletion, false);
  assert.equal(report.assumptions.feeBpsPerSide, 20);
  assert.equal(report.models[1].modelId, SPOT_PAPER_PAIRED_TREND_MODEL);
  assert.equal(report.comparison.status, "COMPARISON_AVAILABLE");
  assert.equal(report.comparison.commonHorizonAt, report.commonHorizon.effectAt);
});

test("interruptions and missing or stale feed data remain fail-closed in the composed runner", async t => {
  const interrupted = await setup(t, {interruptAfterFirstQuote: true});
  const stopped = await runSpotPaperPairedSynthetic(interrupted.config);
  assert.equal(stopped.stopReason, "OPERATOR_STOP");
  assert.equal(stopped.outcome, "INTERRUPTED_OR_STOPPED");

  for (const options of [{staleTicker: true}, {missingOhlc: true}]) {
    const invalid = await setup(t, options);
    const rejected = await runSpotPaperPairedSynthetic(invalid.config);
    assert.equal(rejected.stopReason, "SHARED_FEED_FAILURE");
    assert.equal(rejected.cycles, 1);
    assert.equal(rejected.commonHorizon.available, false);
  }
});

test("next-run source identity includes the independently versioned trend source", () => {
  const digest = nextRunResearchSourceDigest({
    comparisonBytes: Buffer.from("comparison"),
    entryConfirmationBytes: Buffer.from("confirmation"),
    fiveMinuteTrendBytes: Buffer.from("trend-v1")
  });
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, nextRunResearchSourceDigest({
    comparisonBytes: Buffer.from("comparison"),
    entryConfirmationBytes: Buffer.from("confirmation"),
    fiveMinuteTrendBytes: Buffer.from("trend-v2")
  }));
  assert.equal(SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT.version, 2);
});
