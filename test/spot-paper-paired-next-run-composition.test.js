import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {
  advanceFiveMinuteTrendEntry, createFiveMinuteTrendState,
  recordFiveMinuteTrendSell, SPOT_PAPER_5M_TREND_FILTER_ID,
  diagnoseFiveMinuteTrendActivity
} from "../scripts/spot-paper-research/five-minute-trend.mjs";
import {
  advanceEntryConfirmation, createEntryConfirmationState,
  recordEntryConfirmationSell, SPOT_PAPER_ENTRY_CONFIRMATION_ID
} from "../scripts/spot-paper-research/entry-confirmation.mjs";
import {
  createSpotPaperPairedNextRunConfig, nextRunResearchSourceDigest
} from "../scripts/spot-paper-paired/next-run-composition.mjs";
import {
  pairedConfigDigest, runSpotPaperPairedSynthetic,
  SPOT_PAPER_PAIRED_INTEGRATION,
  SPOT_PAPER_PAIRED_NEXT_RUN_ACCEPTED_RESEARCH_SOURCE_SHA256,
  SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT,
  SPOT_PAPER_PAIRED_TREND_MODEL
} from "../scripts/spot-paper-paired/forward.mjs";
import {SPOT_PAPER_PAIRED_SYNTHETIC_SOURCE_ID} from
  "../scripts/spot-paper-paired/forward.mjs";
import {sha256} from "../scripts/spot-paper-pilot/core.mjs";
import {readRunJournal} from "../scripts/spot-paper-pilot/journal.mjs";
import {evaluatePairedPaperEvidence} from "../scripts/spot-paper-paired-report/evaluate.mjs";
import {main as pairedHostMain} from "../scripts/spot-paper-paired/host.mjs";
import {main as pairedIngestMain} from
  "../scripts/spot-paper-paired-report/ingest.mjs";

const MINUTE = 60_000;
const BASE = Date.UTC(2025, 0, 1);
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const EVALUATOR_CLI = fileURLToPath(new URL(
  "../scripts/spot-paper-paired-report/cli.mjs", import.meta.url
));
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

function candleValue(index, allowTrendEntries) {
  if (index < 85) return allowTrendEntries ? 70 + Math.floor(index / 5) : 100;
  if (index < 105) return 100;
  if (index === 105) return 120;
  if (index === 106) return 130;
  return 80;
}

async function setup(t, {allowTrendEntries = false, stopOnCycleFour = false,
  staleTicker = false, missingOhlc = false, interruptAfterFirstQuote = false,
  maxCycles = 4} = {}) {
  const dataRoot = await mkdtemp(join(tmpdir(), "paired-next-run-"));
  t.after(() => rm(dataRoot, {recursive: true, force: true}));
  let wall = BASE + 105 * MINUTE + 1_000;
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
      const closedCount = 104 + cycle;
      const rows = Array.from({length: closedCount}, (_, index) =>
        row(BASE + index * MINUTE, candleValue(index, allowTrendEntries)));
      rows.push(row(BASE + closedCount * MINUTE,
        candleValue(closedCount, allowTrendEntries)));
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
  const researchSourceSha256 = nextRunResearchSourceDigest({
    comparisonBytes: await readFile(new URL(
      "../scripts/spot-paper-research/comparison.mjs", import.meta.url
    )),
    entryConfirmationBytes: await readFile(new URL(
      "../scripts/spot-paper-research/entry-confirmation.mjs", import.meta.url
    )),
    fiveMinuteTrendBytes: await readFile(new URL(
      "../scripts/spot-paper-research/five-minute-trend.mjs", import.meta.url
    ))
  });
  assert.equal(researchSourceSha256,
    SPOT_PAPER_PAIRED_NEXT_RUN_ACCEPTED_RESEARCH_SOURCE_SHA256);
  const config = createSpotPaperPairedNextRunConfig({
    runId: "next-run-synthetic",
    dataRoot,
    sourceSha256: "a".repeat(64),
    researchSourceSha256,
    provider,
    confirmationExports: {
      SPOT_PAPER_ENTRY_CONFIRMATION_ID,
      createEntryConfirmationState, advanceEntryConfirmation,
      recordEntryConfirmationSell
    },
    trendExports: {
      SPOT_PAPER_5M_TREND_FILTER_ID,
      createFiveMinuteTrendState, advanceFiveMinuteTrendEntry,
      recordFiveMinuteTrendSell, diagnoseFiveMinuteTrendActivity
    },
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
  assert.equal(config.modelPair.id, "BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1");
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
  const journal = await readRunJournal({
    dataRoot: config.dataRoot, runId: config.runId,
    deadlineAt: performance.now() + 5_000,
    monotonicNow: () => performance.now()
  });
  const expectedIdentity = {
    schemaVersion: "SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_V1",
    runId: config.runId, pair: "BTC/EUR",
    sourceSha256: config.sourceSha256,
    configSha256: config.configSha256,
    researchSourceSha256: config.researchSourceSha256,
    feedSourceId: SPOT_PAPER_PAIRED_SYNTHETIC_SOURCE_ID,
    comparisonEngineId: "SPOT_PAPER_SMA_COMPARISON_V1",
    modelPairId: config.modelPair.id,
    models: report.models
  };
  const evidence = evaluatePairedPaperEvidence({expectedIdentity, report, journal});
  assert.equal(evidence.evidenceStatus, "VERIFIED_COMPLETE", evidence.reasonCode);
  assert.equal(evidence.identity.modelPairId, config.modelPair.id);
  assert.deepEqual(evidence.identity.models.map(model => model.modelId), [
    "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1",
    SPOT_PAPER_PAIRED_TREND_MODEL,
    "CASH_CONTROL_V1"
  ]);
  assert.equal(evidence.assumptions.feeBpsPerSide, 20);
  assert.equal(evidence.trendActivityDiagnostic.status, "PARTIAL_COVERAGE");
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
  assert.ok(challenger.decisions.some(decision =>
    decision.metadata.discarded === "FIVE_MINUTE_SMA20_TREND_NOT_CONFIRMED"));
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
  assert.ok(baseline.fills.some(fill => fill.side === "SELL"));
  assert.equal(report.cycles, 12);
  assert.equal(report.comparison.status, "COMPARISON_AVAILABLE");
  assert.equal(report.comparison.commonHorizonAt, report.commonHorizon.effectAt);
  assert.equal(report.comparison.arms.baseline.strategyId, baseline.modelId);
  assert.equal(report.comparison.arms.challenger.strategyId, challenger.modelId);
  assert.deepEqual(report.comparison.arms.baseline.fills, baseline.fills);
  assert.deepEqual(report.comparison.arms.challenger.fills, challenger.fills);
  assert.equal(report.comparison.arms.challenger.feesCents,
    challenger.valuation.feesCents);
  assert.ok(challenger.fills.every(fill =>
    fill.strategyId === SPOT_PAPER_PAIRED_TREND_MODEL));
  assert.ok(challenger.fills.some(fill =>
    fill.side === "SELL" && fill.strategyId === SPOT_PAPER_PAIRED_TREND_MODEL));
  assert.ok(challenger.valuation.feesCents > 0);
  assert.ok(challenger.valuation.slippageCents > 0);
});

test("the trend arm remains subject to the existing sampled stop", async t => {
  const {config} = await setup(t, {
    allowTrendEntries: true, stopOnCycleFour: true, maxCycles: 4
  });
  const report = await runSpotPaperPairedSynthetic(config);
  const challenger = report.arms.find(arm => arm.role === "challenger");
  assert.ok(challenger.fills.some(fill =>
    fill.side === "SELL" && fill.ledgerReason === "SAMPLED_2PCT_BID_STOP"));
  assert.equal(challenger.tradingStatus, "STOPPED");
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
  assert.equal(report.trendActivityDiagnostic.status, "PARTIAL_COVERAGE");
  assert.equal(report.trendActivityDiagnostic.requiredCoverageMs, 24 * 60 * MINUTE);
  assert.ok(report.trendActivityDiagnostic.observedCoverageMs < 8 * 60 * MINUTE);
});

test("actual 480-cycle next-run producer exports through evaluation to no-write ingestion", async t => {
  const {config} = await setup(t, {allowTrendEntries: true, maxCycles: 480});
  const report = await runSpotPaperPairedSynthetic(config);
  const expectedIdentity = {
    schemaVersion: "SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_V1",
    runId: config.runId,
    pair: "BTC/EUR",
    sourceSha256: config.sourceSha256,
    configSha256: config.configSha256,
    researchSourceSha256: config.researchSourceSha256,
    feedSourceId: config.provider.sourceId,
    comparisonEngineId: config.comparisonEngine.id,
    modelPairId: config.modelPair.id,
    models: report.models
  };
  const identityPath = join(config.dataRoot, "synthetic-expected-identity.json");
  const exportPath = join(config.dataRoot, "synthetic-host-export.json");
  const dashboardPath = join(config.dataRoot, "synthetic-paired-dashboard.json");
  await writeFile(identityPath, JSON.stringify(expectedIdentity));

  const hostOutput = {value: "", write(value) { this.value += value; }};
  const hostExport = await pairedHostMain([
    "export", "--data-root", config.dataRoot, "--run-id", config.runId
  ], {output: hostOutput});
  assert.equal(hostExport.status, "TERMINAL_JOURNAL_VERIFIED");
  assert.equal(hostExport.verifiedTerminal, true);
  assert.equal(hostExport.reconciliationStatus, "READ_ONLY_VERIFIED");
  assert.equal(hostExport.journal.events.filter(event =>
    event.type === "shared_observation").length, 480);
  assert.deepEqual(JSON.parse(hostOutput.value), hostExport);
  await writeFile(exportPath, hostOutput.value);

  const evaluated = spawnSync(process.execPath, [
    EVALUATOR_CLI, identityPath, exportPath
  ], {cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000});
  assert.equal(evaluated.status, 0, evaluated.stderr || evaluated.stdout);
  const dashboard = JSON.parse(evaluated.stdout);
  assert.equal(dashboard.evidenceStatus, "VERIFIED_COMPLETE");
  assert.equal(dashboard.syntheticFixture, true);
  assert.equal(dashboard.identity.runId, config.runId);
  assert.equal(dashboard.identity.modelPairId, config.modelPair.id);
  assert.equal(config.provider.sourceId, "SYNTHETIC_TEST_ONLY");
  assert.equal(hostExport.report.testOnly, true);
  assert.equal(hostExport.report.integrationStatus, SPOT_PAPER_PAIRED_INTEGRATION);
  assert.equal(hostExport.report.feedSourceId, "SYNTHETIC_TEST_ONLY");
  assert.deepEqual(dashboard.identity.models.map(model => model.modelId),
    config.modelPair.models.map(model => model.modelId));
  assert.equal(dashboard.timing.completedCycles, 480);
  assert.equal(dashboard.timing.attemptedCycles, 480);
  assert.equal(report.outcome, "COMPLETED_BOUNDED");
  assert.equal(report.testOnly, true);
  assert.equal(dashboard.assumptions.feeBpsPerSide, 20);
  assert.equal(dashboard.assumptions.slippageBpsPerSide, 10);
  assert.equal(dashboard.decision, "NO_WINNER_OR_PROMOTION");

  for (const role of ["baseline", "challenger", "cash"]) {
    const producedArm = report.arms.find(arm => arm.role === role);
    const projectedArm = dashboard.arms[role];
    assert.equal(projectedArm.fillCount, producedArm.fills.length);
    assert.equal(projectedArm.bookedFeesCents, producedArm.valuation.feesCents);
    assert.equal(projectedArm.modeledSlippageCents,
      producedArm.valuation.slippageCents);
    assert.equal(projectedArm.turnoverCents, producedArm.valuation.turnoverCents);
    assert.equal(projectedArm.sampledDrawdownCents,
      producedArm.valuation.sampledDrawdownCents);
    assert.equal(projectedArm.unresolvedObservations,
      producedArm.valuation.unresolvedObservations);
    assert.equal(projectedArm.netPnlCents,
      producedArm.valuation.netEquityCents -
        producedArm.valuation.startingCapitalCents);
    assert.equal(producedArm.fills.reduce((sum, fill) => sum + fill.feeCents, 0),
      producedArm.valuation.feesCents);
  }
  assert.equal(dashboard.arms.baseline.fillCount, report.arms[0].fills.length);
  assert.equal(dashboard.trendActivityDiagnostic.status, "PARTIAL_COVERAGE");
  assert.equal(dashboard.trendActivityDiagnostic.completedRoundTripCount,
    report.trendActivityDiagnostic.completedRoundTripCount);
  await writeFile(dashboardPath, evaluated.stdout);

  let storeCalls = 0;
  let ingestOutput = "";
  const ingestExitCode = await pairedIngestMain([
    identityPath, dashboardPath
  ], {
    stdout: {write(value) { ingestOutput += value; }},
    stderr: {write(value) { assert.fail(value); }},
    getStore() { storeCalls++; }
  });
  assert.equal(ingestExitCode, 0);
  assert.equal(JSON.parse(ingestOutput).status, "DRY_RUN");
  assert.equal(storeCalls, 0);
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
