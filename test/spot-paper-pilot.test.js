import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, open as openFile, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createKrakenProvider } from "../scripts/spot-paper-pilot/provider.mjs";
import { assessObservationEvidence } from "../scripts/spot-paper-pilot/evidence-assessment.mjs";
import { assessPaperEvidence, ACCEPTED_PAPER_SOURCE_SHA } from
  "../scripts/spot-paper-pilot/paper-evidence-assessment.mjs";
import { createRunJournal, readRunJournal } from "../scripts/spot-paper-pilot/journal.mjs";
import { runSpotPaperPilot } from "../scripts/spot-paper-pilot/runner.mjs";
import { main as pilotCli } from "../scripts/spot-paper-pilot/cli.mjs";
import { advanceStrategy, applyPaperObservation, createLedger, createStrategyState,
  parseKrakenOhlc, parseKrakenTicker, sha256, SPOT_PAPER_PILOT_LIMITS } from
  "../scripts/spot-paper-pilot/core.mjs";

const BASE = Date.UTC(2025, 0, 1);
const MINUTE = 60_000;
const INITIAL_NOW = BASE + 21 * MINUTE + 1_000;
const PRICE_100 = "100.00000000";
const PRICE_120 = "120.00000000";
const CLI_PATH = fileURLToPath(new URL("../scripts/spot-paper-pilot/cli.mjs", import.meta.url));
const PAPER_ASSESSMENT_PATH = fileURLToPath(new URL(
  "../scripts/spot-paper-pilot/paper-evidence-assessment.mjs", import.meta.url));
const OBSERVE_WORKFLOW = readFileSync(new URL(
  "../.github/workflows/spot-paper-pilot-observe-only.yml", import.meta.url), "utf8");
const PAPER_WORKFLOW = readFileSync(new URL(
  "../.github/workflows/spot-paper-pilot-paper-once.yml", import.meta.url), "utf8");

test("manual observation assessment separates bounded completion from data acceptance", () => {
  const report = {
    schemaVersion: "SPOT_PAPER_PILOT_REPORT_V1",
    runId: "spot-observe-123-1", mode: "observe", pair: "BTC/EUR",
    operationalStatus: "COMPLETED_BOUNDED", stopReason: "CYCLE_LIMIT",
    observations: 0, dataGaps: 2, requests: 2, deliveredBytes: 0,
    executionImpact: false, liveTrading: false, autoPromotion: false, fills: []
  };
  const readback = {
    reconciliation: "TERMINAL_REPORT_AVAILABLE", runId: report.runId,
    eventCount: 4, checkpoint: { stopReason: report.stopReason },
    resumed: false, executionImpact: false, report
  };
  const observeReport = {
    schemaVersion: "SPOT_PAPER_PILOT_REPORT_V1", runId: report.runId,
    mode: "observe", observations: report.observations,
    dataGaps: report.dataGaps, requests: report.requests,
    deliveredBytes: report.deliveredBytes
  };
  const empty = assessObservationEvidence({
    observeExitCode: 0, observeReport, readback
  });
  assert.equal(empty.cleanBoundedTermination, true);
  assert.equal(empty.terminalVerified, true);
  assert.equal(empty.accepted, false);
  assert.equal(empty.outcome, "FAILED_DATA_ACCEPTANCE");

  const accepted = assessObservationEvidence({
    observeExitCode: 0, observeReport: { ...observeReport, observations: 1 },
    readback: { ...readback, report: { ...report, observations: 1 } }
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.outcome, "DATA_ACCEPTED");

  const unverified = assessObservationEvidence({
    observeExitCode: 0, observeReport,
    readback: { ...readback, reconciliation: "INCOMPLETE_READ_ONLY" }
  });
  assert.equal(unverified.cleanBoundedTermination, false);
  assert.equal(unverified.accepted, false);
});

test("manual observation workflow is fixed, owner-dispatched, and retains failed evidence", () => {
  const trigger = OBSERVE_WORKFLOW.match(/^on:\n([\s\S]*?)(?=^permissions:)/m)?.[1];
  assert.equal(trigger.trim(), "workflow_dispatch:");
  assert.doesNotMatch(trigger, /schedule:|pull_request:|push:|inputs:/);
  for (const required of [
    "github.actor == 'Achi1984'",
    "github.triggering_actor == 'Achi1984'",
    "github.ref == 'refs/heads/main'",
    "github.run_number == 1",
    "github.run_attempt == 1",
    "timeout-minutes: 5",
    "contents: read",
    "ref: 81edf0b5dc3d455c2c1e1906791d56c731bea0c9",
    "--mode observe --network",
    "--max-cycles 2",
    "--max-duration-ms 120000",
    "--poll-interval-ms 60000",
    "retention-days: 14"
  ]) assert.ok(OBSERVE_WORKFLOW.includes(required), required);
  assert.equal((OBSERVE_WORKFLOW.match(/actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/g) || []).length, 2);
  assert.match(OBSERVE_WORKFLOW, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(OBSERVE_WORKFLOW, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(OBSERVE_WORKFLOW, /if: always\(\)[\s\S]*?Retain evidence, including failed attempts/);
  assert.doesNotMatch(OBSERVE_WORKFLOW, /secrets\.|--mode paper|schedule:|pull_request:/);
});

function priceRow(timestamp, price) {
  return [timestamp, price, price, price, price, price, "1.00000000", 1];
}

function ohlcData(closes) {
  const rows = closes.map((close, index) =>
    priceRow((BASE + index * MINUTE) / 1000, close));
  rows.push(priceRow((BASE + closes.length * MINUTE) / 1000, closes.at(-1)));
  return { error: [], result: { XXBTZEUR: rows, last: rows.at(-1)[0] } };
}

function tickerData({ bid = "29999.00000000", ask = "30000.00000000" } = {}) {
  return { error: [], result: { XXBTZEUR: {
    a: [ask, "1", "1.00000000"], b: [bid, "1", "1.00000000"],
    c: [bid, "1.00000000"], v: ["1.00000000", "1.00000000"],
    p: [bid, bid], t: [1, 1], l: [bid, bid], h: [ask, ask], o: bid
  } } };
}

function acquisition(data, nowMs, requestStartedAt = nowMs - 20) {
  const raw = JSON.stringify(data);
  return { data, raw, sha256: sha256(Buffer.from(raw, "utf8")),
    bytes: Buffer.byteLength(raw), requestStartedAt, receivedAt: nowMs };
}

function paperEvidenceFixture({ withFill = false, fillInGap = false } = {}) {
  const startedAt = BASE + 21 * MINUTE + 1_000;
  const receivedAt = startedAt + 30;
  const endedAt = startedAt + 3_600_000;
  const signalId = `ENTRY:${BASE + 20 * MINUTE}`;
  const signal = {
    id: signalId, direction: "ENTRY", candleAt: BASE + 20 * MINUTE,
    closeNano: "6800000000000", signalKnownAt: startedAt + 10
  };
  const ohlcRaw = JSON.stringify(ohlcData(Array(21).fill("68000.00000000")));
  const tickerRaw = JSON.stringify(tickerData({
    bid: "67999.00000000", ask: "68000.00000000"
  }));
  const ohlcHash = sha256(Buffer.from(ohlcRaw, "utf8"));
  const tickerHash = sha256(Buffer.from(tickerRaw, "utf8"));
  const responseBodies = { [ohlcHash]: ohlcRaw, [tickerHash]: tickerRaw };
  const event = {
    id: `observation:1:${BASE + 20 * MINUTE}:${tickerHash}`,
    type: "observation", cycle: 1, signalKnownAt: signal.signalKnownAt,
    ohlc: {
      path: `responses/${ohlcHash}.json`, sha256: ohlcHash,
      bytes: Buffer.byteLength(ohlcRaw), requestStartedAt: startedAt,
      receivedAt: startedAt + 5, latestClosedAt: BASE + 20 * MINUTE, ageMs: 1_000
    },
    ticker: {
      path: `responses/${tickerHash}.json`, sha256: tickerHash,
      bytes: Buffer.byteLength(tickerRaw), requestStartedAt: startedAt + 15,
      receivedAt, acquisitionAgeMs: 0
    },
    signals: withFill ? [signal] : [], fills: []
  };
  let ledger = {
    initialCashCents: 100_000, cashCents: 100_000, realizedPnlCents: 0,
    feesCents: 0, position: null, lastMark: null, fills: []
  };
  if (withFill) {
    const adjustedPrice = (BigInt("6800000000000") * 10_010n + 5_000n) / 10_000n;
    const grossCents = Number((100_000n * adjustedPrice * 2n +
      100_000_000_000_000n) / (2n * 100_000_000_000_000n));
    const feeCents = Number((BigInt(grossCents) * 50n * 2n + 10_000n) / 20_000n);
    const entryCostCents = grossCents + feeCents;
    const fill = {
      id: `entry:${signalId}`, side: "BUY", quantitySat: 100_000,
      priceNano: String(adjustedPrice), grossCents, feeCents,
      reason: "SMA5_UP_CROSS", signalAt: signal.candleAt, quoteReceivedAt: receivedAt
    };
    const stopPriceNano = String((adjustedPrice * 9_800n + 5_000n) / 10_000n);
    const exitPriceNano = String((BigInt("6799900000000") * 9_990n + 5_000n) / 10_000n);
    const exitGrossCents = Number((100_000n * BigInt(exitPriceNano) * 2n +
      100_000_000_000_000n) / (2n * 100_000_000_000_000n));
    const exitFeeCents = Number((BigInt(exitGrossCents) * 50n * 2n + 10_000n) / 20_000n);
    const netExitCents = exitGrossCents - exitFeeCents;
    const unrealizedPnlCents = netExitCents - entryCostCents;
    event.signals = [signal];
    event.fills = [fill];
    ledger = {
      initialCashCents: 100_000, cashCents: 100_000 - entryCostCents,
      realizedPnlCents: 0, feesCents: feeCents,
      position: {
        quantitySat: 100_000, entryPriceNano: String(adjustedPrice),
        entryGrossCents: grossCents, entryFeeCents: feeCents, entryCostCents,
        entrySignalId: signalId, stopPriceNano
      },
      lastMark: {
        bidNano: "6799900000000", exitPriceNano, receivedAt, ageMs: endedAt - receivedAt,
        unrealizedPnlCents, netExitCents
      },
      fills: [fill]
    };
  }
  const report = {
    schemaVersion: "SPOT_PAPER_PILOT_REPORT_V1",
    model: "BTC_EUR_SMA5_SMA20_V1", runId: "spot-paper-12345-1",
    mode: "paper", pair: "BTC/EUR", operationalStatus: "COMPLETED_BOUNDED",
    profitability: "NOT_ASSESSED", executionImpact: false, liveTrading: false,
    autoPromotion: false, startedAt, endedAt, stopReason: "DURATION_LIMIT",
    observations: 1, dataGaps: 0, signals: event.signals, fills: ledger.fills,
    feesCents: ledger.feesCents, cashCents: ledger.cashCents,
    position: ledger.position,
    positionStatus: ledger.position ? "OPEN_UNRESOLVED_AT_TERMINAL" : "FLAT",
    realizedPnlCents: ledger.realizedPnlCents,
    unrealizedPnlCents: ledger.lastMark?.unrealizedPnlCents ?? 0,
    equityCents: ledger.cashCents + (ledger.lastMark?.netExitCents ?? 0),
    lastMark: ledger.lastMark, requests: 2,
    deliveredBytes: Buffer.byteLength(ohlcRaw) + Buffer.byteLength(tickerRaw)
  };
  const events = [{ id: "run-start", type: "start" }];
  if (fillInGap) {
    events.push({ ...event, id: "observation:1", signals: [], fills: [] });
    events.push({
      ...event, id: "gap:2", type: "data_gap", cycle: 2,
      dataGap: "MISSED_DECISION_WINDOW"
    });
    report.observations = 1;
    report.dataGaps = 1;
    report.requests = 4;
    report.deliveredBytes *= 2;
  } else {
    events.push(event);
  }
  events.push({ id: "run-terminal", type: "terminal", report });
  const readback = {
    reconciliation: "TERMINAL_REPORT_AVAILABLE", runId: report.runId,
    eventCount: events.length, resumed: false, executionImpact: false,
    manifest: {
      schemaVersion: "SPOT_PAPER_PILOT_MANIFEST_V1",
      model: "BTC_EUR_SMA5_SMA20_V1", mode: "paper", pair: "BTC/EUR",
      startedAt,
      limits: {
        maxCycles: 60, maxRequests: 120, maxBytes: 67_108_864,
        maxResponseBytes: 262_144, requestTimeoutMs: 5_000,
        maxDurationMs: 3_600_000, pollIntervalMs: 60_000
      }
    },
    checkpoint: {
      ledger, counters: { requests: report.requests, bytes: report.deliveredBytes },
      cycle: fillInGap ? 2 : 1, stopReason: "DURATION_LIMIT"
    },
    events, report
  };
  const provenance = {
    schemaVersion: "SPOT_PAPER_PILOT_DISPATCH_MANIFEST_V1",
    acceptedSourceSha: ACCEPTED_PAPER_SOURCE_SHA,
    workflowSha: "a".repeat(40), workflowRunId: "12345",
    workflowRunNumber: 1, workflowRunAttempt: 1, runId: report.runId,
    model: "BTC_EUR_SMA5_SMA20_V1", mode: "paper", pair: "BTC/EUR",
    maxCycles: 60, maxRequests: 120, maxDurationMs: 3_600_000,
    pollIntervalMs: 60_000, requestTimeoutMs: 5_000,
    maxBytes: 67_108_864, maxResponseBytes: 262_144,
    maxOpenPositions: 1,
    maxQuoteAgeMs: 10_000, maxCandleAgeMs: 120_000,
    initialCashCents: 100_000, maxExposureCents: 10_000,
    maxSessionLossCents: 2_000, stopLossBps: 200, maxEntrySpreadBps: 50,
    feeBpsPerSide: 50, slippageBpsPerSide: 10, smaFast: 5, smaSlow: 20,
    warmupCandles: 21
  };
  return { report, readback, provenance, responseBodies };
}

test("paper evidence accepts zero fills without validating a fill path or profitability", () => {
  const fixture = paperEvidenceFixture();
  const assessment = assessPaperEvidence({
    paperExitCode: 0, paperReport: fixture.report, readback: fixture.readback,
    provenance: fixture.provenance, responseBodies: fixture.responseBodies
  });
  assert.equal(assessment.outcome, "COMPLETED");
  assert.equal(assessment.durationStatus, "FULL_DURATION");
  assert.equal(assessment.dataAcceptance, "DATA_ACCEPTED");
  assert.equal(assessment.quoteAccountingReconciliation, true);
  assert.equal(assessment.signalReplay, "NOT_PERFORMED");
  assert.equal(assessment.profitability, "NOT_ASSESSED");
  assert.equal(assessment.elapsedMs, 3_600_000);
  assert.equal(assessment.durationCoverage, 1);
  assert.equal(assessment.cycles, 1);
  assert.equal(assessment.acceptedObservations, 1);
  assert.equal(assessment.observations, 1);
  assert.deepEqual(assessment.fills, []);
  assert.equal(assessment.positionStatus, "FLAT");
});

test("paper evidence reconciles recorded quotes, integer fills, and explicit stale open marks without strategy claims", () => {
  const fixture = paperEvidenceFixture({ withFill: true });
  const assessment = assessPaperEvidence({
    paperExitCode: 0, paperReport: fixture.report, readback: fixture.readback,
    provenance: fixture.provenance, responseBodies: fixture.responseBodies
  });
  assert.equal(assessment.outcome, "COMPLETED");
  assert.equal(assessment.quoteAccountingReconciliation, true);
  assert.equal(assessment.signalReplay, "NOT_PERFORMED");
  assert.equal(assessment.profitability, "NOT_ASSESSED");
  assert.equal(assessment.openPositionAssessment, "OPEN_MARK_STALE");
  assert.equal(assessment.markAgeMs, fixture.report.endedAt - fixture.report.lastMark.receivedAt);

  const altered = structuredClone(fixture);
  altered.readback.events[1].ticker.requestStartedAt = fixture.report.startedAt;
  const rejected = assessPaperEvidence({
    paperExitCode: 0, paperReport: altered.report, readback: altered.readback,
    provenance: altered.provenance, responseBodies: altered.responseBodies
  });
  assert.equal(rejected.outcome, "FAILED");
  assert.equal(rejected.quoteAccountingReconciliation, false);
});

test("paper evidence requires raw market receipts for observations and missed-window gaps", () => {
  const fixture = paperEvidenceFixture();
  for (const fields of [["ohlc"], ["ticker"], ["ohlc", "ticker"]]) {
    const altered = structuredClone(fixture);
    for (const field of fields) delete altered.readback.events[1][field];
    const assessment = assessPaperEvidence({
      paperExitCode: 0, paperReport: altered.report, readback: altered.readback,
      provenance: altered.provenance, responseBodies: altered.responseBodies
    });
    assert.equal(assessment.outcome, "FAILED", fields.join("+"));
    assert.equal(assessment.dataAcceptance, "FAILED_DATA_ACCEPTANCE", fields.join("+"));
    assert.equal(assessment.quoteAccountingReconciliation, false, fields.join("+"));
  }

  const missedWindow = paperEvidenceFixture({ withFill: true, fillInGap: true });
  const assessment = assessPaperEvidence({
    paperExitCode: 0, paperReport: missedWindow.report,
    readback: missedWindow.readback, provenance: missedWindow.provenance,
    responseBodies: missedWindow.responseBodies
  });
  assert.equal(assessment.outcome, "COMPLETED");
  assert.equal(assessment.dataGaps, 1);
  assert.equal(assessment.quoteAccountingReconciliation, true);
  assert.equal(assessment.signalReplay, "NOT_PERFORMED");
});

test("paper evidence reports partial runtime and accepted-observation coverage honestly", () => {
  const fixture = paperEvidenceFixture();
  fixture.report.endedAt -= 60_000;
  const mark = fixture.readback.checkpoint.ledger.lastMark;
  if (mark) mark.ageMs = fixture.report.endedAt - mark.receivedAt;
  const assessment = assessPaperEvidence({
    paperExitCode: 0, paperReport: fixture.report, readback: fixture.readback,
    provenance: fixture.provenance, responseBodies: fixture.responseBodies
  });
  assert.equal(assessment.outcome, "PARTIAL");
  assert.equal(assessment.durationStatus, "PARTIAL_DURATION");
  assert.equal(assessment.elapsedMs, 3_540_000);
  assert.equal(assessment.durationCoverage, 3_540_000 / 3_600_000);
  assert.equal(assessment.observationCoverage, 1);

  const cycleLimit = paperEvidenceFixture();
  const firstObservation = cycleLimit.readback.events[1];
  const startEvent = cycleLimit.readback.events[0];
  const cycleEvents = [startEvent];
  for (let cycle = 1; cycle <= 60; cycle++) {
    cycleEvents.push({
      ...firstObservation,
      id: `observation:${cycle}`,
      cycle
    });
  }
  cycleLimit.report.stopReason = "CYCLE_LIMIT";
  cycleLimit.report.observations = 60;
  cycleLimit.report.requests = 120;
  cycleLimit.report.deliveredBytes *= 60;
  cycleLimit.report.endedAt = cycleLimit.report.startedAt + 59 * MINUTE;
  cycleEvents.push({ id: "run-terminal", type: "terminal", report: cycleLimit.report });
  cycleLimit.readback.events = cycleEvents;
  cycleLimit.readback.eventCount = cycleEvents.length;
  cycleLimit.readback.report = cycleLimit.report;
  cycleLimit.readback.checkpoint = {
    ...cycleLimit.readback.checkpoint,
    counters: { requests: 120, bytes: cycleLimit.report.deliveredBytes },
    cycle: 60,
    stopReason: "CYCLE_LIMIT"
  };
  const cycleAssessment = assessPaperEvidence({
    paperExitCode: 0, paperReport: cycleLimit.report,
    readback: cycleLimit.readback, provenance: cycleLimit.provenance,
    responseBodies: cycleLimit.responseBodies
  });
  assert.equal(cycleAssessment.outcome, "PARTIAL");
  assert.equal(cycleAssessment.durationStatus, "PARTIAL_CYCLE_LIMIT");
  assert.equal(cycleAssessment.elapsedMs, 59 * MINUTE);
  assert.equal(cycleAssessment.cycleCoverage, 1);
  assert.equal(cycleAssessment.observationCoverage, 1);

  const riskStop = paperEvidenceFixture();
  riskStop.report.operationalStatus = "STOPPED_WITH_LIMITATION";
  riskStop.report.stopReason = "SESSION_LOSS_LIMIT";
  riskStop.readback.checkpoint.stopReason = "SESSION_LOSS_LIMIT";
  const riskAssessment = assessPaperEvidence({
    paperExitCode: 0, paperReport: riskStop.report, readback: riskStop.readback,
    provenance: riskStop.provenance, responseBodies: riskStop.responseBodies
  });
  assert.equal(riskAssessment.outcome, "PARTIAL");
  assert.equal(riskAssessment.durationStatus, "PARTIAL_RISK_STOP");
});

test("paper evidence leaves request-error gaps reference-optional", () => {
  const fixture = paperEvidenceFixture();
  const events = [
    fixture.readback.events[0],
    { id: "gap:1:1:HTTP_429", type: "data_gap", reason: "HTTP_429", at: BASE },
    fixture.readback.events.at(-1)
  ];
  fixture.report.operationalStatus = "STOPPED_WITH_LIMITATION";
  fixture.report.stopReason = "INVALID_DATA";
  fixture.report.observations = 0;
  fixture.report.dataGaps = 1;
  fixture.report.requests = 1;
  fixture.report.deliveredBytes = 0;
  fixture.report.signals = [];
  fixture.readback.events = events;
  fixture.readback.eventCount = events.length;
  fixture.readback.checkpoint = {
    ...fixture.readback.checkpoint,
    counters: { requests: 1, bytes: 0 },
    cycle: 1,
    stopReason: "INVALID_DATA"
  };
  const assessment = assessPaperEvidence({
    paperExitCode: 0, paperReport: fixture.report, readback: fixture.readback,
    provenance: fixture.provenance, responseBodies: fixture.responseBodies
  });
  assert.equal(assessment.outcome, "FAILED");
  assert.equal(assessment.dataAcceptance, "FAILED_DATA_ACCEPTANCE");
  assert.equal(assessment.observations, 0);
  assert.equal(assessment.dataGaps, 1);
  assert.ok(assessment.reasons.includes("HTTP_429"));
  assert.ok(!assessment.reasons.includes("INTEGER_LEDGER_OR_CAUSAL_FILL_RECONCILIATION_FAILED"));
});

test("paper evidence keeps failed and unknown outcomes distinct and binds the accepted source", () => {
  const fixture = paperEvidenceFixture();
  const unknown = assessPaperEvidence({
    paperExitCode: 1, paperReport: fixture.report,
    readback: { ...fixture.readback, reconciliation: "INCOMPLETE_READ_ONLY" },
    provenance: fixture.provenance, responseBodies: fixture.responseBodies
  });
  assert.equal(unknown.outcome, "UNKNOWN");
  assert.equal(unknown.terminalVerified, false);

  const wrongSource = {
    ...fixture.provenance, acceptedSourceSha: "b".repeat(40)
  };
  const failed = assessPaperEvidence({
    paperExitCode: 0, paperReport: fixture.report, readback: fixture.readback,
    provenance: wrongSource, responseBodies: fixture.responseBodies
  });
  assert.equal(failed.outcome, "FAILED");
  assert.ok(failed.reasons.includes("SOURCE_OR_FRESH_RUN_BINDING_FAILED"));
});

test("paper evidence CLI verifies local response bodies without provider requests", async t => {
  const root = await temporaryRoot(t);
  const fixture = paperEvidenceFixture({ withFill: true });
  const runDirectory = join(root, fixture.report.runId);
  const responseDirectory = join(runDirectory, "responses");
  await mkdir(responseDirectory, { recursive: true });
  for (const [hash, raw] of Object.entries(fixture.responseBodies)) {
    await writeFile(join(responseDirectory, `${hash}.json`), raw);
  }
  const paperPath = join(root, "paper.json");
  const readbackPath = join(root, "readback.json");
  const provenancePath = join(root, "manifest.json");
  const assessmentPath = join(root, "assessment.json");
  await writeFile(paperPath, JSON.stringify(fixture.report));
  await writeFile(readbackPath, JSON.stringify(fixture.readback));
  await writeFile(provenancePath, JSON.stringify(fixture.provenance));
  const output = execFileSync(process.execPath, [
    PAPER_ASSESSMENT_PATH, paperPath, readbackPath, "0",
    provenancePath, runDirectory, assessmentPath
  ], { encoding: "utf8" });
  assert.equal(JSON.parse(output).outcome, "COMPLETED");
  const assessment = JSON.parse(await readFile(assessmentPath, "utf8"));
  assert.equal(assessment.quoteAccountingReconciliation, true);
  assert.equal(assessment.signalReplay, "NOT_PERFORMED");
});

test("one-hour paper workflow is owner-only, manual, one-shot, pinned, and bounded", () => {
  const trigger = PAPER_WORKFLOW.match(/^on:\n([\s\S]*?)(?=^permissions:)/m)?.[1];
  assert.equal(trigger.trim(), "workflow_dispatch:");
  assert.doesNotMatch(trigger, /schedule:|pull_request:|push:|inputs:/);
  for (const required of [
    "github.actor == 'Achi1984'",
    "github.triggering_actor == 'Achi1984'",
    "github.ref == 'refs/heads/main'",
    "github.run_number == 1",
    "github.run_attempt == 1",
    "timeout-minutes: 65",
    "contents: read",
    "ref: 81edf0b5dc3d455c2c1e1906791d56c731bea0c9",
    "--mode paper --network",
    "--max-cycles 60",
    "--max-duration-ms 3600000",
    "--poll-interval-ms 60000",
    "node scripts/spot-paper-pilot/cli.mjs",
    "retention-days: 14"
  ]) assert.ok(PAPER_WORKFLOW.includes(required), required);
  assert.equal((PAPER_WORKFLOW.match(/actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/g) || []).length, 2);
  assert.match(PAPER_WORKFLOW, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(PAPER_WORKFLOW, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(PAPER_WORKFLOW, /if: always\(\)[\s\S]*?Retain evidence, including failed attempts/);
  assert.doesNotMatch(PAPER_WORKFLOW, /secrets\.|--mode observe|schedule:|pull_request:/);
});

function providerFor(clock, ohlcValues, tickerValues) {
  let ohlcIndex = 0;
  let tickerIndex = 0;
  return {
    async fetchOhlc() {
      const value = ohlcValues[Math.min(ohlcIndex++, ohlcValues.length - 1)];
      if (value instanceof Error) throw value;
      return acquisition(typeof value === "function" ? value() : value, clock.value);
    },
    async fetchTicker() {
      const value = tickerValues[Math.min(tickerIndex++, tickerValues.length - 1)];
      if (value instanceof Error) throw value;
      return acquisition(typeof value === "function" ? value() : value,
        clock.value, clock.value);
    },
    counters: () => ({ requests: ohlcIndex + tickerIndex, bytes: 0 })
  };
}

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "spot-paper-pilot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function runnerConfig({ dataRoot, runId, provider, mode = "paper", cycles = 1,
  now = INITIAL_NOW, signal, sleep, durationMs, requestTimeoutMs,
  terminalReportGraceMs, journalOptions, clock: suppliedClock } = {}) {
  const clock = suppliedClock ?? { value: now, monotonic: 0 };
  return {
    dataRoot, runId, provider, mode, maxCycles: cycles,
    maxDurationMs: durationMs ?? Math.min(8 * 60 * 60 * 1000, cycles * 60_000 + 1),
    requestTimeoutMs,
    terminalReportGraceMs,
    journalOptions,
    pollIntervalMs: 60_000,
    now: () => clock.value,
    monotonicNow: () => clock.monotonic,
    sleep: sleep ?? (async ms => {
      clock.value += ms;
      clock.monotonic += ms;
    }),
    signal,
    clock
  };
}

test("import-safe Kraken provider makes only fixed public GETs when explicitly called", async () => {
  let calls = 0;
  let clock = 100;
  const provider = createKrakenProvider({
    now: () => clock++,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url.origin, "https://api.kraken.com");
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.accept, "application/json");
      if (url.pathname.endsWith("/OHLC")) {
        assert.deepEqual([...url.searchParams], [["pair", "XBTEUR"], ["interval", "1"]]);
        return new Response(JSON.stringify({ error: [], result: {
          XXBTZEUR: [priceRow(BASE / 1000, PRICE_100), priceRow((BASE + MINUTE) / 1000, PRICE_100)],
          last: (BASE + MINUTE) / 1000
        } }), { headers: { "content-type": "application/json" } });
      }
      assert.equal(url.pathname, "/0/public/Ticker");
      assert.deepEqual([...url.searchParams], [["pair", "XBTEUR"]]);
      return new Response(JSON.stringify(tickerData()), {
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.equal(calls, 0);
  assert.equal(provider.counters().requests, 0);
  await provider.fetchOhlc();
  await provider.fetchTicker();
  assert.equal(calls, 2);
  assert.equal(provider.counters().requests, 2);
});

test("transport stops at 429, rejects truncation and enforces byte ceilings without retries", async () => {
  let calls = 0;
  const limited = createKrakenProvider({
    now: () => 1_000,
    maxBytes: 16,
    fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ error: [], result: {} }), {
        headers: { "content-type": "application/json" }
      });
    }
  });
  await assert.rejects(limited.fetchOhlc(), /RUN_BYTE_LIMIT/);
  assert.equal(calls, 1);
  assert.ok(limited.counters().bytes > 16);

  const truncated = createKrakenProvider({
    now: () => 1_000,
    fetchImpl: async () => new Response("{}", { headers: {
      "content-type": "application/json", "content-length": "9"
    } })
  });
  await assert.rejects(truncated.fetchOhlc(), /TRUNCATED_HTTP_BODY/);

  calls = 0;
  const rateLimited = createKrakenProvider({
    now: () => 1_000,
    fetchImpl: async () => {
      calls++;
      return new Response("{}", { status: 429 });
    }
  });
  await assert.rejects(rateLimited.fetchOhlc(), /HTTP_429/);
  assert.equal(calls, 1);

  const large = createKrakenProvider({
    now: () => 1_000,
    fetchImpl: async () => new Response("x".repeat(256 * 1024 + 1), {
      headers: { "content-type": "application/json" }
    })
  });
  await assert.rejects(large.fetchOhlc(), /RESPONSE_BYTE_LIMIT/);

  calls = 0;
  const requestLimited = createKrakenProvider({
    now: () => 1_000,
    maxRequests: 1,
    fetchImpl: async () => {
      calls++;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }
  });
  await requestLimited.fetchOhlc();
  await assert.rejects(requestLimited.fetchTicker(), /REQUEST_BUDGET_EXHAUSTED/);
  assert.equal(calls, 1);
});

test("compressed body receipt uses decoded body bytes, while its wire Content-Length is not trusted", async () => {
  // The fake fetch returns the already-decoded body that standard fetch exposes.
  const raw = JSON.stringify({ error: [], result: {} });
  const provider = createKrakenProvider({
    now: () => 1_000,
    fetchImpl: async () => new Response(raw, { headers: {
      "content-type": "application/json", "content-encoding": "gzip",
      "content-length": "5"
    } })
  });
  const result = await provider.fetchOhlc();
  assert.deepEqual(result.data, { error: [], result: {} });
  assert.equal(result.bytes, Buffer.byteLength(raw));
});

test("provider bounds fetch and body reads that ignore abort, and cleans late responses", async () => {
  let resolveFetch;
  const provider = createKrakenProvider({
    fetchImpl: () => new Promise(resolve => { resolveFetch = resolve; })
  });
  const deadlineAt = performance.now() + 30;
  await assert.rejects(provider.fetchOhlc({
    deadlineAt, monotonicNow: () => performance.now()
  }), /REQUEST_TIMEOUT/);
  const late = new Response("{}", { headers: { "content-type": "application/json" } });
  resolveFetch(late);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.bodyUsed, true);

  let cancelCalled = false;
  const readerResponse = {
    ok: true, status: 200,
    headers: { get: name => name === "content-type" ? "application/json" : null },
    body: {
      getReader: () => ({
        read: () => new Promise(() => {}),
        cancel: () => {
          cancelCalled = true;
          return new Promise(() => {});
        }
      }),
      cancel: () => Promise.resolve()
    }
  };
  const readerProvider = createKrakenProvider({ fetchImpl: async () => readerResponse });
  await assert.rejects(readerProvider.fetchOhlc({
    deadlineAt: performance.now() + 30, monotonicNow: () => performance.now()
  }), /REQUEST_TIMEOUT/);
  assert.equal(cancelCalled, true);
});

test("provider cancels and releases readers on parent abort and invalid response", async () => {
  let markRead;
  const readStarted = new Promise(resolve => { markRead = resolve; });
  let cancelCalls = 0;
  let releaseCalls = 0;
  const response = {
    ok: true, status: 200,
    headers: { get: name => name === "content-type" ? "application/json" : null },
    body: { getReader: () => ({
      read: () => {
        markRead();
        return new Promise(() => {});
      },
      cancel: () => {
        cancelCalls++;
        return new Promise(() => {});
      },
      releaseLock: () => { releaseCalls++; }
    }) }
  };
  const controller = new AbortController();
  const provider = createKrakenProvider({
    signal: controller.signal, fetchImpl: async () => response
  });
  const request = provider.fetchOhlc();
  await readStarted;
  controller.abort();
  await assert.rejects(request, /REQUEST_ABORTED|This operation was aborted/);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(cancelCalls >= 1);
  assert.ok(releaseCalls >= 1);

  let bodyCancelCalls = 0;
  const invalidType = {
    ok: true, status: 200, headers: { get: () => "text/plain" },
    body: { cancel: () => {
      bodyCancelCalls++;
      return new Promise(() => {});
    } }
  };
  const invalidProvider = createKrakenProvider({ fetchImpl: async () => invalidType });
  await assert.rejects(invalidProvider.fetchOhlc(), /INVALID_CONTENT_TYPE/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bodyCancelCalls, 1);
});

test("provider rejects response resolution after its monotonic deadline", async () => {
  let monotonic = 1;
  let bodyCancelCalls = 0;
  let fetchCalls = 0;
  const provider = createKrakenProvider({
    monotonicNow: () => monotonic,
    fetchImpl: async () => {
      fetchCalls++;
      monotonic = 11;
      return {
        ok: true, status: 200,
        headers: { get: name => name === "content-type" ? "application/json" : null },
        body: { cancel: () => {
          bodyCancelCalls++;
          return Promise.resolve();
        } }
      };
    }
  });
  await assert.rejects(provider.fetchOhlc({
    deadlineAt: 10, monotonicNow: () => monotonic
  }), /REQUEST_TIMEOUT/);
  assert.equal(bodyCancelCalls, 1);
  assert.equal(fetchCalls, 1);

  let preflightCalls = 0;
  const preflight = createKrakenProvider({
    monotonicNow: () => monotonic,
    fetchImpl: async () => {
      preflightCalls++;
      return new Response("{}");
    }
  });
  await assert.rejects(preflight.fetchOhlc({
    deadlineAt: monotonic, monotonicNow: () => monotonic
  }), /REQUEST_TIMEOUT/);
  assert.equal(preflightCalls, 0);

  let readerCancelCalls = 0;
  monotonic = 1;
  const lateReader = createKrakenProvider({
    monotonicNow: () => monotonic,
    fetchImpl: async () => ({
      ok: true, status: 200,
      headers: { get: name => name === "content-type" ? "application/json" : null },
      body: { getReader: () => ({
        read: () => {
          monotonic = 11;
          return Promise.resolve({ done: true });
        },
        cancel: () => {
          readerCancelCalls++;
          return Promise.resolve();
        },
        releaseLock() {}
      }) }
    })
  });
  await assert.rejects(lateReader.fetchOhlc({
    deadlineAt: 10, monotonicNow: () => monotonic
  }), /REQUEST_TIMEOUT/);
  assert.equal(readerCancelCalls, 1);
});

test("OHLC parser excludes Kraken's unfinished row and rejects stale, gapped, out-of-order, and wrong-pair data", () => {
  const data = ohlcData(Array(21).fill(PRICE_100));
  data.result.last = data.result.last + 17;
  const parsed = parseKrakenOhlc(acquisition(data, INITIAL_NOW), INITIAL_NOW);
  assert.equal(parsed.candles.length, 21);
  assert.equal(parsed.latestClosedAt, BASE + 20 * MINUTE);
  assert.equal(parsed.candles.at(-1).timestamp, BASE + 20 * MINUTE);

  const staleAt = BASE + 23 * MINUTE + 1_000;
  assert.throws(() => parseKrakenOhlc(acquisition(data, staleAt), staleAt), /STALE_OHLC/);
  const gap = structuredClone(data);
  gap.result.XXBTZEUR[8][0] += 60;
  assert.throws(() => parseKrakenOhlc(acquisition(gap, INITIAL_NOW), INITIAL_NOW), /OHLC_GAP/);
  const outOfOrder = structuredClone(data);
  outOfOrder.result.XXBTZEUR[4][0] = outOfOrder.result.XXBTZEUR[3][0];
  assert.throws(() => parseKrakenOhlc(acquisition(outOfOrder, INITIAL_NOW), INITIAL_NOW),
    /OHLC_OUT_OF_ORDER/);
  const otherPair = structuredClone(data);
  otherPair.result = { XXBTZUSD: otherPair.result.XXBTZEUR, last: otherPair.result.last };
  assert.throws(() => parseKrakenOhlc(acquisition(otherPair, INITIAL_NOW), INITIAL_NOW),
    /UNEXPECTED_OHLC_PAIR/);
  const missing = { error: [], result: { XXBTZEUR: [], last: 0 } };
  assert.throws(() => parseKrakenOhlc(acquisition(missing, INITIAL_NOW), INITIAL_NOW),
    /INSUFFICIENT_OHLC_ROWS/);
  const future = structuredClone(data);
  future.result.XXBTZEUR.at(-1)[0] += 60;
  future.result.last = future.result.XXBTZEUR.at(-1)[0];
  assert.throws(() => parseKrakenOhlc(acquisition(future, INITIAL_NOW), INITIAL_NOW),
    /INVALID_OHLC_TIMESTAMP/);
});

test("ticker validates bid/ask identity, crossing and acquisition age without inventing event time", () => {
  const data = tickerData();
  const parsed = parseKrakenTicker(acquisition(data, INITIAL_NOW, INITIAL_NOW - 500), INITIAL_NOW);
  assert.equal(parsed.ageMs, 0);
  assert.equal(parsed.requestStartedAt, INITIAL_NOW - 500);
  assert.equal(parsed.spreadBps, 1);
  assert.equal("exchangeTimestamp" in parsed, false);
  assert.throws(() => parseKrakenTicker(
    acquisition(tickerData({ bid: "30001.00000000", ask: "30000.00000000" }), INITIAL_NOW),
    INITIAL_NOW), /INVALID_TICKER_BOOK/);
  assert.throws(() => parseKrakenTicker(acquisition(data, INITIAL_NOW - 10_001), INITIAL_NOW),
    /STALE_TICKER/);
  const bad = structuredClone(data);
  bad.error = ["EGeneral:Unknown asset pair"];
  assert.throws(() => parseKrakenTicker(acquisition(bad, INITIAL_NOW), INITIAL_NOW),
    /TICKER_API_ERROR/);
});

test("warmup fixes the cutoff, produces no retroactive signal, and deduplicates closed bars", () => {
  const historicalCross = [PRICE_120, ...Array(20).fill(PRICE_100)];
  const first = advanceStrategy(createStrategyState(),
    parseKrakenOhlc(acquisition(ohlcData(historicalCross), INITIAL_NOW), INITIAL_NOW).candles);
  assert.equal(first.state.warmupComplete, true);
  assert.equal(first.state.cutoffAt, BASE + 20 * MINUTE);
  assert.deepEqual(first.signals, []);
  const duplicate = advanceStrategy(first.state,
    parseKrakenOhlc(acquisition(ohlcData(historicalCross), INITIAL_NOW), INITIAL_NOW).candles);
  assert.equal(duplicate.newCandleCount, 0);
  assert.deepEqual(duplicate.signals, []);

  const conflicting = ohlcData(historicalCross);
  conflicting.result.XXBTZEUR[20] = priceRow((BASE + 20 * MINUTE) / 1000, PRICE_120);
  assert.throws(() => advanceStrategy(first.state,
    parseKrakenOhlc(acquisition(conflicting, INITIAL_NOW), INITIAL_NOW).candles),
  /CONFLICTING_CLOSED_CANDLE/);

  const flatWarmup = advanceStrategy(createStrategyState(),
    parseKrakenOhlc(acquisition(ohlcData(Array(21).fill(PRICE_100)), INITIAL_NOW),
      INITIAL_NOW).candles);
  const nextAt = BASE + 21 * MINUTE;
  const newBar = [...Array(21).fill(PRICE_100), PRICE_120];
  const next = advanceStrategy(flatWarmup.state,
    parseKrakenOhlc(acquisition(ohlcData(newBar), BASE + 22 * MINUTE + 1_000),
      BASE + 22 * MINUTE + 1_000).candles);
  assert.equal(next.signals[0]?.direction, "ENTRY");
  assert.equal(next.signals[0]?.candleAt, nextAt);
});

test("integer EUR/BTC paper ledger reconciles costs and exits even when the entry spread filter would reject", () => {
  const quote = parseKrakenTicker(acquisition(tickerData(), INITIAL_NOW), INITIAL_NOW);
  const entry = applyPaperObservation(createLedger(), {
    signal: { id: "ENTRY:1", direction: "ENTRY", candleAt: 1 },
    quote, nowMs: INITIAL_NOW
  });
  assert.equal(entry.fills.length, 1);
  assert.ok(Number.isInteger(entry.fills[0].quantitySat));
  assert.ok(entry.ledger.cashCents >= 0);
  assert.ok(entry.ledger.position.entryGrossCents + entry.ledger.position.entryFeeCents <=
    SPOT_PAPER_PILOT_LIMITS.maxExposureCents);
  assert.equal(100_000 - entry.ledger.cashCents,
    entry.ledger.position.entryGrossCents + entry.ledger.position.entryFeeCents);

  const wideSpread = parseKrakenTicker(acquisition(
    tickerData({ bid: "29999.00000000", ask: "36000.00000000" }), INITIAL_NOW),
  INITIAL_NOW);
  const exit = applyPaperObservation(entry.ledger, {
    signal: { id: "EXIT:2", direction: "EXIT", candleAt: 2 },
    quote: wideSpread, nowMs: INITIAL_NOW + 1_000
  });
  assert.equal(exit.fills[0].reason, "SMA20_DOWN_CROSS");
  assert.equal(exit.ledger.position, null);
  assert.equal(exit.ledger.cashCents - exit.ledger.realizedPnlCents, 100_000);
  assert.equal(exit.ledger.feesCents,
    entry.ledger.feesCents + exit.fills[0].feeCents);

  const noEntry = applyPaperObservation(createLedger(), {
    signal: { id: "ENTRY:3", direction: "ENTRY", candleAt: 3 },
    quote: { ...quote, spreadBps: 51 }, nowMs: INITIAL_NOW
  });
  assert.deepEqual(noEntry.fills, []);
});

test("extreme quotes overflow safely without mutating an open paper position", () => {
  const entryQuote = parseKrakenTicker(acquisition(tickerData({
    bid: "0.00000001", ask: "0.00000001"
  }), INITIAL_NOW), INITIAL_NOW);
  const entry = applyPaperObservation(createLedger(), {
    signal: { id: "ENTRY:overflow", direction: "ENTRY", candleAt: 1 },
    quote: entryQuote, nowMs: INITIAL_NOW
  });
  const before = structuredClone(entry.ledger);
  const extreme = "999999999999999999999999999999.00000000";
  assert.throws(() => parseKrakenTicker(acquisition(
    tickerData({ bid: extreme, ask: extreme }), INITIAL_NOW), INITIAL_NOW),
  /INVALID_TICKER_(BID|ASK)/);
  const boundedExtreme = parseKrakenTicker(acquisition(tickerData({
    bid: "90000000.00000000", ask: "90000000.00000000"
  }), INITIAL_NOW + 1), INITIAL_NOW + 1);
  assert.throws(() => applyPaperObservation(entry.ledger, {
    quote: boundedExtreme,
    nowMs: INITIAL_NOW + 1
  }), /NOTIONAL_OVERFLOW/);
  assert.deepEqual(entry.ledger, before);
});

test("sampled stop exits at modeled bid less slippage and leaves no claimed live execution", () => {
  const initialQuote = parseKrakenTicker(acquisition(tickerData(), INITIAL_NOW), INITIAL_NOW);
  const entry = applyPaperObservation(createLedger(), {
    signal: { id: "ENTRY:stop", direction: "ENTRY", candleAt: 1 },
    quote: initialQuote, nowMs: INITIAL_NOW
  });
  const stopQuote = parseKrakenTicker(acquisition(
    tickerData({ bid: "29000.00000000", ask: "29001.00000000" }), INITIAL_NOW + 1_000),
  INITIAL_NOW + 1_000);
  const stopped = applyPaperObservation(entry.ledger, {
    quote: stopQuote, nowMs: INITIAL_NOW + 1_000
  });
  assert.equal(stopped.stopReason, "SAMPLED_2PCT_BID_STOP");
  assert.equal(stopped.ledger.position, null);
  assert.equal(stopped.fills[0].priceNano,
    String((BigInt(stopQuote.bidNano) * 9_990n + 5_000n) / 10_000n));
});

test("runner integrates injected data, SMA, paper ledger, raw-response journal and read-only report", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW, monotonic: 0 };
  const candles = [Array(21).fill(PRICE_100), [...Array(21).fill(PRICE_100), PRICE_120]];
  const provider = providerFor(clock, candles.map(ohlcData), [tickerData(), tickerData()]);
  const config = runnerConfig({ dataRoot, runId: "e2e-paper", provider, cycles: 2 });
  config.now = () => clock.value;
  config.sleep = async ms => { clock.value += ms; clock.monotonic += ms; };
  const report = await runSpotPaperPilot(config);
  assert.equal(report.mode, "paper");
  assert.equal(report.stopReason, "CYCLE_LIMIT", JSON.stringify(report));
  assert.equal(report.profitability, "NOT_ASSESSED");
  assert.equal(report.executionImpact, false);
  assert.equal(report.fills.length, 1);
  assert.equal(report.positionStatus, "OPEN_UNRESOLVED_AT_TERMINAL");
  assert.ok(report.lastMark.ageMs >= 0);
  const journal = await readRunJournal({ dataRoot, runId: "e2e-paper" });
  const observations = journal.events.filter(event => event.type === "observation");
  assert.equal(observations.length, 2);
  for (const response of [observations[0].ohlc, observations[0].ticker]) {
    const raw = await readFile(join(dataRoot, "e2e-paper", response.path));
    assert.equal(sha256(raw), response.sha256);
    assert.equal(raw.length, response.bytes);
    assert.ok(response.receivedAt >= response.requestStartedAt);
  }
  assert.equal(journal.checkpoint.ledger.cashCents, report.cashCents);
  assert.equal(journal.events.at(-1).report.stopReason, "CYCLE_LIMIT");
  assert.notEqual(report.fills[0].priceNano, report.signals[0].closeNano);
  const signaled = observations[1];
  assert.equal(signaled.signals[0].signalKnownAt, signaled.signalKnownAt);
  assert.ok(signaled.acquiredAt.ticker[0] >= signaled.signalKnownAt);
  await assert.rejects(runSpotPaperPilot(config), /EEXIST/);

  const readOnly = JSON.parse(execFileSync(process.execPath, [CLI_PATH,
    "--mode", "report", "--data-root", dataRoot, "--run-id", "e2e-paper"], {
    encoding: "utf8"
  }));
  assert.equal(readOnly.reconciliation, "TERMINAL_REPORT_AVAILABLE");
  assert.equal(readOnly.resumed, false);
  assert.equal(readOnly.report.stopReason, "CYCLE_LIMIT");
  assert.equal(readOnly.manifest.mode, "paper");
  assert.equal(readOnly.events.at(-1).id, "run-terminal");
});

test("runner reports a valid zero-entry observe run without promoting warmup bars", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW };
  const provider = providerFor(clock,
    [ohlcData([PRICE_120, ...Array(20).fill(PRICE_100)])], [tickerData()]);
  const config = runnerConfig({
    dataRoot, runId: "observe-zero-entry", provider, mode: "observe", cycles: 1
  });
  config.now = () => clock.value;
  const report = await runSpotPaperPilot(config);
  assert.equal(report.stopReason, "CYCLE_LIMIT");
  assert.equal(report.observations, 1);
  assert.deepEqual(report.signals, []);
  assert.deepEqual(report.fills, []);
  assert.equal(report.cashCents, SPOT_PAPER_PILOT_LIMITS.initialCashCents);
  assert.equal(report.profitability, "NOT_ASSESSED");
});

test("observe records a causal signal without creating paper fills", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW };
  const provider = providerFor(clock, [
    ohlcData(Array(21).fill(PRICE_100)),
    ohlcData([...Array(21).fill(PRICE_100), PRICE_120])
  ], [tickerData(), tickerData()]);
  const config = runnerConfig({
    dataRoot, runId: "observe-no-fills", provider, mode: "observe", cycles: 2
  });
  config.now = () => clock.value;
  config.sleep = async ms => { clock.value += ms; clock.monotonic += ms; };
  const report = await runSpotPaperPilot(config);
  assert.equal(report.signals.length, 1);
  assert.ok(Number.isSafeInteger(report.signals[0].signalKnownAt));
  assert.deepEqual(report.fills, []);
  assert.equal(report.cashCents, SPOT_PAPER_PILOT_LIMITS.initialCashCents);
});

test("runner rejects a mark overflow before persisting its quote or changing the open ledger", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW };
  let ohlcCalls = 0;
  let tickerCalls = 0;
  let overflowTicker;
  const warmup = ohlcData(Array(21).fill(PRICE_100));
  const crossover = ohlcData([...Array(21).fill(PRICE_100), PRICE_120]);
  const provider = {
    async fetchOhlc() {
      const data = ohlcCalls++ === 0 ? warmup : crossover;
      return acquisition(data, clock.value, clock.value);
    },
    async fetchTicker() {
      const call = tickerCalls++;
      const data = call === 1 ? tickerData({
        bid: "0.00000001", ask: "0.00000001"
      }) : call === 2 ? tickerData({
        bid: "90000000.00000000", ask: "90000000.00000000"
      }) : tickerData();
      const response = acquisition(data, clock.value, clock.value);
      if (call === 2) overflowTicker = response;
      return response;
    }
  };
  const config = runnerConfig({
    dataRoot, runId: "mark-overflow", provider, cycles: 3
  });
  config.now = () => clock.value;
  config.sleep = async ms => { clock.value += ms; clock.monotonic += ms; };
  const report = await runSpotPaperPilot(config);
  assert.equal(report.stopReason, "INVALID_DATA");
  assert.equal(report.fills.length, 1);
  assert.ok(report.position);
  assert.equal(report.dataGaps, 1);
  const journal = await readRunJournal({ dataRoot, runId: "mark-overflow" });
  const overflow = journal.events.find(event => event.reason === "NOTIONAL_OVERFLOW");
  assert.ok(overflow);
  assert.equal(overflow.acceptedTicker, null);
  assert.equal(journal.checkpoint.ledger.fills.length, 1);
  await assert.rejects(readFile(join(dataRoot, "mark-overflow", "responses",
    `${overflowTicker.sha256}.json`)), /ENOENT/);
});

test("429 creates a gap and waits for the bounded next poll instead of retrying immediately", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW };
  const starts = [];
  const provider = {
    async fetchOhlc() {
      starts.push(clock.value);
      if (starts.length === 1) {
        throw new Error("HTTP_429");
      }
      return acquisition(ohlcData(Array(21).fill(PRICE_100)), clock.value);
    },
    async fetchTicker() {
      return acquisition(tickerData(), clock.value, clock.value);
    }
  };
  const config = runnerConfig({ dataRoot, runId: "rate-limited", provider, cycles: 2 });
  config.now = () => clock.value;
  config.sleep = async ms => { clock.value += ms; clock.monotonic += ms; };
  const report = await runSpotPaperPilot(config);
  assert.equal(report.dataGaps, 1);
  assert.equal(report.requests, 3, JSON.stringify(report));
  assert.equal(starts[1] - starts[0], 60_000);
});

test("fresh but pre-signal quote after a new-bar signal cannot create a fill", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW };
  let ohlcCalls = 0;
  let tickerCalls = 0;
  const provider = {
    async fetchOhlc() {
      const closes = ohlcCalls++ === 0 ? Array(21).fill(PRICE_100) :
        [...Array(21).fill(PRICE_100), PRICE_120];
      return acquisition(ohlcData(closes), clock.value);
    },
    async fetchTicker() {
      tickerCalls++;
      return tickerCalls === 1 ?
        acquisition(tickerData(), clock.value, clock.value) :
        acquisition(tickerData(), clock.value, clock.value - 100);
    }
  };
  const config = runnerConfig({ dataRoot, runId: "stale-quote", provider, cycles: 2 });
  config.now = () => clock.value;
  config.sleep = async ms => { clock.value += ms; clock.monotonic += ms; };
  const report = await runSpotPaperPilot(config);
  assert.equal(report.stopReason, "INVALID_DATA");
  assert.equal(report.fills.length, 0);
  assert.equal(report.cashCents, SPOT_PAPER_PILOT_LIMITS.initialCashCents);
  assert.equal(report.dataGaps, 1);
  const journal = await readRunJournal({ dataRoot, runId: "stale-quote" });
  const refusal = journal.events.find(event => event.reason === "TICKER_PREDATES_SIGNAL");
  assert.ok(refusal);
  assert.ok(Number.isSafeInteger(refusal.signalKnownAt));
  assert.ok(refusal.signals[0].signalKnownAt >= refusal.signalKnownAt);
});

test("runner bounds an injected provider that ignores abort and discards its late response", async t => {
  const dataRoot = await temporaryRoot(t);
  let resolveOhlc;
  let observedSignal;
  let tickerCalls = 0;
  const provider = {
    fetchOhlc({ signal }) {
      observedSignal = signal;
      signal.addEventListener("abort", () => {}, { once: true });
      return new Promise(resolve => { resolveOhlc = resolve; });
    },
    fetchTicker() {
      tickerCalls++;
      assert.fail("ticker must not start after timed out OHLC");
    }
  };
  const config = runnerConfig({
    dataRoot, runId: "late-provider-response", provider,
    cycles: 1, durationMs: 500, requestTimeoutMs: 30
  });
  const report = await runSpotPaperPilot(config);
  assert.equal(observedSignal.aborted, true);
  assert.equal(tickerCalls, 0);
  assert.equal(report.fills.length, 0);
  assert.equal(report.cashCents, SPOT_PAPER_PILOT_LIMITS.initialCashCents);
  assert.equal(report.dataGaps, 1);
  resolveOhlc(acquisition(ohlcData(Array(21).fill(PRICE_100)), INITIAL_NOW));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(report.fills.length, 0);
});

test("runner rejects provider success resolved after its shared monotonic deadline", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW, monotonic: 0 };
  let ohlcCalls = 0;
  let tickerCalls = 0;
  const provider = {
    async fetchOhlc() {
      ohlcCalls++;
      clock.monotonic = 15_001;
      return acquisition(ohlcData(Array(21).fill(PRICE_100)), clock.value, clock.value);
    },
    async fetchTicker() {
      tickerCalls++;
      assert.fail("ticker must not start after run deadline");
    }
  };
  const config = runnerConfig({
    dataRoot, runId: "late-monotonic-result", provider, cycles: 1,
    durationMs: 15_000, requestTimeoutMs: 5_000, clock
  });
  const report = await runSpotPaperPilot(config);
  assert.equal(report.stopReason, "DURATION_LIMIT");
  assert.equal(ohlcCalls, 1);
  assert.equal(report.observations, 0);
  assert.equal(report.fills.length, 0);
  assert.equal(tickerCalls, 0);
});

test("CLI refuses observe and paper modes without explicit network opt-in", async t => {
  const dataRoot = await temporaryRoot(t);
  await assert.rejects(pilotCli([
    "--mode", "paper", "--data-root", dataRoot, "--run-id", "no-network",
    "--max-cycles", "1", "--max-duration-ms", "60000"
  ]), /Network access is disabled/);
});

test("abort cancels an outstanding provider request and writes a terminal report", async t => {
  const dataRoot = await temporaryRoot(t);
  const controller = new AbortController();
  let requests = 0;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const provider = {
    fetchOhlc() {
      requests++;
      markStarted();
      return new Promise((_, reject) => controller.signal.addEventListener("abort",
        () => reject(new Error("ABORTED")), { once: true }));
    },
    fetchTicker() { assert.fail("ticker must not start after cancelled OHLC"); }
  };
  const config = runnerConfig({
    dataRoot, runId: "cancelled", provider, cycles: 2, signal: controller.signal
  });
  const running = runSpotPaperPilot(config);
  await started;
  controller.abort();
  const report = await running;
  assert.equal(requests, 1);
  assert.equal(report.stopReason, "SIGNAL");
  const journal = await readRunJournal({ dataRoot, runId: "cancelled" });
  assert.equal(journal.events.at(-1).type, "terminal");
});

test("journal event IDs deduplicate identical records, reject conflicts, and detect partial corruption", async t => {
  const dataRoot = await temporaryRoot(t);
  const journal = await createRunJournal({
    dataRoot, runId: "dedupe", manifest: { startedAt: INITIAL_NOW }
  });
  const event = { id: "event-1", type: "observation", value: 1 };
  assert.equal((await journal.append(event, {})).duplicate, false);
  assert.equal((await journal.append(event, {})).duplicate, true);
  await assert.rejects(journal.append({ ...event, value: 2 }, {}), /CONFLICTING_EVENT_ID/);
  await journal.close();
  const loaded = await readRunJournal({ dataRoot, runId: "dedupe" });
  assert.equal(loaded.events.length, 1);
  const path = join(dataRoot, "dedupe", "journal.json");
  const contents = await readFile(path, "utf8");
  await (await import("node:fs/promises")).writeFile(path, contents.slice(0, -1));
  await assert.rejects(readRunJournal({ dataRoot, runId: "dedupe" }),
    /JOURNAL_CHECKSUM_MISMATCH|INVALID_JOURNAL_JSON/);
});

test("journal readback ACK loss fences writes and read-only reconciliation reports UNKNOWN", async t => {
  const dataRoot = await temporaryRoot(t);
  const journal = await createRunJournal({
    dataRoot, runId: "ack-lost", manifest: { startedAt: INITIAL_NOW },
    phase: async (name, marker) => {
      if (name === "after-readback" && marker.nextSequence === 1) {
        throw new Error("ack channel failed");
      }
    }
  });
  await assert.rejects(journal.append({ id: "commit-1", type: "observation" }, {}),
    /JOURNAL_UNKNOWN/);
  assert.equal(journal.poisoned, true);
  await assert.rejects(journal.append({ id: "commit-2", type: "observation" }, {}),
    /JOURNAL_UNKNOWN/);
  const reconciled = await readRunJournal({ dataRoot, runId: "ack-lost" });
  assert.equal(reconciled.sequence, 1);
  assert.equal(reconciled.events.length, 1);
  assert.equal(reconciled.reconciliationStatus,
    "UNKNOWN_CANDIDATE_VISIBLE_ACK_UNCONFIRMED");
});

test("runner reports ambiguous signal-ledger persistence as UNKNOWN without another effect", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW, monotonic: 0 };
  let ohlcCalls = 0;
  let tickerCalls = 0;
  const closes = [Array(21).fill(PRICE_100),
    [...Array(21).fill(PRICE_100), PRICE_120]];
  const committedSequences = [];
  const provider = {
    async fetchOhlc() {
      return acquisition(ohlcData(closes[Math.min(ohlcCalls++, 1)]), clock.value);
    },
    async fetchTicker() {
      tickerCalls++;
      return acquisition(tickerData(), clock.value, clock.value);
    }
  };
  const config = runnerConfig({
    dataRoot, runId: "unknown-fill-commit", provider, cycles: 2,
    durationMs: 120_000, requestTimeoutMs: 30,
    clock,
    journalOptions: {
      phase: async (name, marker) => {
        if (name === "after-readback") committedSequences.push(marker.nextSequence);
        if (name === "after-readback" && marker.nextSequence === 3) {
          throw new Error("simulated acknowledgement loss");
        }
      }
    }
  });
  config.sleep = async ms => { clock.value += ms; clock.monotonic += ms; };
  await assert.rejects(runSpotPaperPilot(config), /JOURNAL_UNKNOWN/);
  assert.deepEqual(committedSequences, [0, 1, 2, 3]);
  assert.equal(ohlcCalls, 2);
  assert.equal(tickerCalls, 2);
  const reconciled = await readRunJournal({ dataRoot, runId: "unknown-fill-commit" });
  assert.equal(reconciled.events.filter(event => event.type === "terminal").length, 0);
  assert.equal(reconciled.events.at(-1).fills.length, 1);
  assert.equal(reconciled.reconciliationStatus,
    "UNKNOWN_CANDIDATE_VISIBLE_ACK_UNCONFIRMED");
});

test("journal rejects concurrent append and fences the late ambiguous commit", async t => {
  const dataRoot = await temporaryRoot(t);
  let entered;
  const enteredPhase = new Promise(resolve => { entered = resolve; });
  const monotonicNow = () => performance.now();
  const journal = await createRunJournal({
    dataRoot, runId: "concurrent-append", manifest: { startedAt: INITIAL_NOW },
    phase: async (name, marker) => {
      if (name === "after-file-sync" && marker.nextSequence === 1) {
        entered();
        return new Promise(() => {});
      }
    }
  });
  const deadlineAt = monotonicNow() + 2_000;
  const first = journal.append({ id: "first", type: "observation" }, {},
    { deadlineAt, monotonicNow });
  const didEnterPhase = await Promise.race([
    enteredPhase.then(() => true),
    first.then(() => false, () => false)
  ]);
  assert.equal(didEnterPhase, true);
  await assert.rejects(journal.append({ id: "second", type: "observation" }, {}),
    /JOURNAL_BUSY/);
  await assert.rejects(first, /JOURNAL_UNKNOWN/);
  assert.equal(journal.poisoned, true);
  await assert.rejects(journal.append({ id: "third", type: "observation" }, {}),
    /JOURNAL_UNKNOWN/);
  const reconciled = await readRunJournal({ dataRoot, runId: "concurrent-append" });
  assert.equal(reconciled.reconciliationStatus, "UNKNOWN_CANDIDATE_NOT_VISIBLE");
});

test("journal closes handles after abort during late open and write", async t => {
  const dataRoot = await temporaryRoot(t);
  const wrapHandle = (handle, onClose, onWrite = () => null) => new Proxy(handle, {
    get(target, property) {
      if (property === "close") return async (...args) => {
        onClose();
        return target.close(...args);
      };
      if (property === "writeFile") return async (...args) => {
        const intercepted = onWrite(...args);
        if (intercepted) return intercepted;
        return target.writeFile(...args);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  const openController = new AbortController();
  let delayPendingOpen = false;
  let openCloseAttempts = 0;
  let markOpenStarted;
  const openStarted = new Promise(resolve => { markOpenStarted = resolve; });
  const openJournal = await createRunJournal({
    dataRoot, runId: "abort-during-open", manifest: { startedAt: INITIAL_NOW },
    signal: openController.signal,
    io: {
      open: async (path, ...args) => {
        if (delayPendingOpen && path.endsWith("journal.pending")) {
          markOpenStarted();
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        return wrapHandle(await openFile(path, ...args), () => openCloseAttempts++);
      }
    }
  });
  delayPendingOpen = true;
  const openAppend = openJournal.append({ id: "late-open", type: "event" }, {});
  await openStarted;
  openController.abort(new Error("abort open"));
  await assert.rejects(openAppend, /JOURNAL_UNKNOWN/);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.ok(openCloseAttempts >= 1);
  assert.equal(openJournal.poisoned, true);

  const writeController = new AbortController();
  let blockPendingWrite = false;
  let writeCloseAttempts = 0;
  let markWriteStarted;
  const writeStarted = new Promise(resolve => { markWriteStarted = resolve; });
  const writeJournal = await createRunJournal({
    dataRoot, runId: "abort-during-write", manifest: { startedAt: INITIAL_NOW },
    signal: writeController.signal,
    io: {
      open: async (path, ...args) => wrapHandle(await openFile(path, ...args),
        () => writeCloseAttempts++, () => {
          if (blockPendingWrite && path.endsWith("journal.pending")) {
            markWriteStarted();
            return new Promise(() => {});
          }
          return null;
        })
    }
  });
  blockPendingWrite = true;
  const writeAppend = writeJournal.append({ id: "blocked-write", type: "event" }, {});
  await writeStarted;
  writeController.abort(new Error("abort write"));
  await assert.rejects(writeAppend, /JOURNAL_UNKNOWN/);
  assert.ok(writeCloseAttempts >= 1);
  assert.equal(writeJournal.poisoned, true);
});

test("journal bounds initialization, response persistence and close; unresolved writes remain read-only", async t => {
  const dataRoot = await temporaryRoot(t);
  const monotonicNow = () => performance.now();
  await assert.rejects(createRunJournal({
    dataRoot, runId: "hung-init", manifest: { startedAt: INITIAL_NOW },
    deadlineAt: monotonicNow() + 1_000, monotonicNow,
    phase: async name => {
      if (name === "before-pending") return new Promise(() => {});
    }
  }), /JOURNAL_UNKNOWN/);
  assert.equal((await readRunJournal({ dataRoot, runId: "hung-init" }))
    .reconciliationStatus, "UNKNOWN_WRITER_OR_INTERRUPTED");

  const response = acquisition(tickerData(), INITIAL_NOW);
  const responseJournal = await createRunJournal({
    dataRoot, runId: "hung-response", manifest: { startedAt: INITIAL_NOW },
    phase: async name => {
      if (name === "response-after-sync") return new Promise(() => {});
    }
  });
  await assert.rejects(responseJournal.persistResponse(response, {
    deadlineAt: monotonicNow() + 40, monotonicNow
  }), /JOURNAL_UNKNOWN/);
  await assert.rejects(responseJournal.append({ id: "must-not-commit" }, {}),
    /JOURNAL_UNKNOWN/);
  assert.equal((await readRunJournal({ dataRoot, runId: "hung-response" }))
    .reconciliationStatus, "UNKNOWN_WRITER_OR_INTERRUPTED");

  const closeJournal = await createRunJournal({
    dataRoot, runId: "hung-close", manifest: { startedAt: INITIAL_NOW },
    phase: async name => {
      if (name === "close-before-unlock") return new Promise(() => {});
    }
  });
  await assert.rejects(closeJournal.close({
    deadlineAt: monotonicNow() + 40, monotonicNow
  }), /JOURNAL_UNKNOWN/);
  assert.equal(closeJournal.poisoned, true);
  assert.equal((await readRunJournal({ dataRoot, runId: "hung-close" }))
    .reconciliationStatus, "UNKNOWN_WRITER_OR_INTERRUPTED");
});

test("journal closes handles returned by an open that resolves after abort", async t => {
  const temp = await temporaryRoot(t);
  const dataRoot = join(temp, "data");
  const controller = new AbortController();
  let markOpenStarted;
  const openStarted = new Promise(resolve => { markOpenStarted = resolve; });
  let releaseOpen;
  const openGate = new Promise(resolve => { releaseOpen = resolve; });
  let closeAttempts = 0;
  let markCloseFinished;
  const closeFinished = new Promise(resolve => { markCloseFinished = resolve; });
  const io = {
    async open(path, flags, mode) {
      if (path === temp) {
        markOpenStarted();
        await openGate;
      }
      const handle = await openFile(path, flags, mode);
      if (path !== temp) return handle;
      return {
        sync: (...args) => handle.sync(...args),
        close: async (...args) => {
          closeAttempts++;
          const result = await handle.close(...args);
          markCloseFinished();
          return result;
        }
      };
    }
  };
  const opening = createRunJournal({
    dataRoot, runId: "late-open-abort", manifest: { startedAt: INITIAL_NOW },
    signal: controller.signal, io
  });
  await openStarted;
  controller.abort();
  await assert.rejects(opening, /JOURNAL_UNKNOWN/);
  releaseOpen();
  let closeWatchdog;
  try {
    await Promise.race([
      closeFinished,
      new Promise((_, reject) => {
        closeWatchdog = setTimeout(() => reject(new Error("late-open handle was not closed")), 1_000);
      })
    ]);
  } finally {
    clearTimeout(closeWatchdog);
  }
  assert.equal(closeAttempts, 1);
  await assert.rejects(readFile(join(dataRoot, "late-open-abort", "writer.lock")),
    /ENOENT/);
});

test("journal attempts bounded handle close after abort interrupts a write", async t => {
  const dataRoot = await temporaryRoot(t);
  const controller = new AbortController();
  let markWriteStarted;
  const writeStarted = new Promise(resolve => { markWriteStarted = resolve; });
  let closeAttempts = 0;
  const io = {
    async open(path, flags, mode) {
      const handle = await openFile(path, flags, mode);
      if (!String(path).endsWith("writer.lock")) return handle;
      return {
        writeFile: () => {
          markWriteStarted();
          return new Promise(() => {});
        },
        sync: (...args) => handle.sync(...args),
        close: async (...args) => {
          closeAttempts++;
          return handle.close(...args);
        }
      };
    }
  };
  const opening = createRunJournal({
    dataRoot, runId: "write-abort", manifest: { startedAt: INITIAL_NOW },
    signal: controller.signal, io
  });
  await writeStarted;
  controller.abort();
  await assert.rejects(opening, /JOURNAL_UNKNOWN/);
  assert.equal(closeAttempts, 1);
  assert.equal((await readRunJournal({ dataRoot, runId: "write-abort" }))
    .reconciliationStatus, "UNKNOWN_WRITER_OR_INTERRUPTED");
});

test("journal rejects an I/O phase that resolves after deadline before acknowledging it", async t => {
  const dataRoot = await temporaryRoot(t);
  let monotonic = 0;
  const monotonicNow = () => monotonic;
  const journal = await createRunJournal({
    dataRoot, runId: "late-journal-success", manifest: { startedAt: INITIAL_NOW },
    deadlineAt: 1_000, monotonicNow,
    phase: async (name, marker) => {
      if (name === "after-readback" && marker.nextSequence === 1) monotonic = 1_000;
    }
  });
  await assert.rejects(journal.append({ id: "late", type: "observation" }, {}, {
    deadlineAt: 1_000, monotonicNow
  }), /JOURNAL_UNKNOWN/);
  assert.equal(journal.poisoned, true);
  assert.equal(journal.snapshot().events.length, 0);
  const reconciled = await readRunJournal({ dataRoot, runId: "late-journal-success" });
  assert.equal(reconciled.reconciliationStatus,
    "UNKNOWN_CANDIDATE_VISIBLE_ACK_UNCONFIRMED");
});

test("terminal report write is bounded by the separate stop grace and remains UNKNOWN if late", async t => {
  const dataRoot = await temporaryRoot(t);
  const clock = { value: INITIAL_NOW };
  const provider = providerFor(clock,
    [ohlcData(Array(21).fill(PRICE_100))], [tickerData()]);
  const config = runnerConfig({
    dataRoot, runId: "hung-terminal", provider, mode: "observe",
    cycles: 1, durationMs: 500, requestTimeoutMs: 30, terminalReportGraceMs: 40,
    journalOptions: {
      phase: async (name, marker) => {
        if (name === "after-readback" && marker.nextSequence === 3) {
          return new Promise(() => {});
        }
      }
    }
  });
  config.now = () => clock.value;
  await assert.rejects(runSpotPaperPilot(config), /JOURNAL_UNKNOWN/);
  const reconciled = await readRunJournal({ dataRoot, runId: "hung-terminal" });
  assert.equal(reconciled.events.at(-1).type, "terminal");
  assert.equal(reconciled.reconciliationStatus,
    "UNKNOWN_CANDIDATE_VISIBLE_ACK_UNCONFIRMED");
});
