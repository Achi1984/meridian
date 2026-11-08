import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir, mkdtemp, open as openFile, readFile, readdir, realpath as realpathFile, rm, writeFile
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createKrakenProvider } from "../scripts/spot-paper-pilot/provider.mjs";
import { assessObservationEvidence } from "../scripts/spot-paper-pilot/evidence-assessment.mjs";
import { assessPaperEvidence, ACCEPTED_PAPER_SOURCE_SHA } from
  "../scripts/spot-paper-pilot/paper-evidence-assessment.mjs";
import {
  DEFAULT_PAPER_EVIDENCE_PROFILE_ID, HOST_EIGHT_HOUR_PROFILE_ID,
  getPaperEvidenceProfile
} from "../scripts/spot-paper-pilot/evidence-profiles.mjs";
import {
  HOST_LAUNCH_MANIFEST, inspectHostRun, readLaunchManifest
} from "../scripts/spot-paper-pilot/host-entrypoint.mjs";
import {
  EXPECTED_HOST_CONTEXT_SCHEMA
} from "../scripts/spot-paper-pilot/host-context.mjs";
import {
  assessHostEvidence, main as hostEvidenceAssessmentMain
} from "../scripts/spot-paper-pilot/host-evidence-assessment.mjs";
import { replaySpotPaperSignals } from "../scripts/spot-paper-pilot/signal-replay.mjs";
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
const FOUR_HOUR_PAPER_WORKFLOW = readFileSync(new URL(
  "../.github/workflows/spot-paper-pilot-four-hour-once.yml", import.meta.url), "utf8");

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

function ohlcData(closes, startAt = BASE) {
  const rows = closes.map((close, index) =>
    priceRow((startAt + index * MINUTE) / 1000, close));
  rows.push(priceRow((startAt + closes.length * MINUTE) / 1000, closes.at(-1)));
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

function paperEvidenceFixture({ withFill = false } = {}) {
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
  const events = [
    { id: "run-start", type: "start", at: startedAt },
    event,
    { id: "run-terminal", type: "terminal", at: endedAt, report }
  ];
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
      },
    },
    checkpoint: {
      ledger, counters: { requests: 2, bytes: report.deliveredBytes },
      cycle: 1, stopReason: "DURATION_LIMIT"
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

function fourHourPaperFixture({ withFill = false } = {}) {
  const fixture = paperEvidenceFixture({ withFill });
  const profile = getPaperEvidenceProfile("BTC_EUR_PAPER_4H_V1");
  const runId = "spot-paper-987654321-1";
  const expectedDispatch = {
    repository: "Achi1984/meridian",
    workflowPath: ".github/workflows/spot-paper-pilot-four-hour-once.yml",
    ref: "refs/heads/main",
    workflowSha: "b".repeat(40),
    workflowRunId: "987654321",
    workflowRunNumber: 1,
    workflowRunAttempt: 1
  };
  fixture.report.runId = runId;
  fixture.readback.runId = runId;
  fixture.readback.manifest.limits = {
    maxCycles: profile.maxCycles,
    maxRequests: profile.maxRequests,
    maxBytes: profile.maxBytes,
    maxResponseBytes: profile.maxResponseBytes,
    requestTimeoutMs: profile.requestTimeoutMs,
    maxDurationMs: profile.maxDurationMs,
    pollIntervalMs: profile.pollIntervalMs
  };
  fixture.provenance = {
    ...fixture.provenance, ...profile, ...expectedDispatch, runId
  };
  fixture.expectedDispatch = expectedDispatch;
  return fixture;
}

async function hostAssessmentFixture(t, {
  elapsedMs, mutate, pending = false, profileLimits
} = {}) {
  const root = await temporaryRoot(t);
  const evidenceDir = join(root, "host-evidence");
  await mkdir(evidenceDir);
  const hostManifest = await readLaunchManifest();
  const profile = getPaperEvidenceProfile(HOST_EIGHT_HOUR_PROFILE_ID, { hostManifest });
  const fixture = structuredClone(paperEvidenceFixture());
  const report = fixture.report;
  report.runId = hostManifest.runId;
  report.endedAt = report.startedAt + (elapsedMs ?? hostManifest.maxDurationMs);
  fixture.readback.runId = hostManifest.runId;
  fixture.readback.manifest.startedAt = report.startedAt;
  fixture.readback.manifest.limits = {
    maxCycles: profile.maxCycles,
    maxRequests: profile.maxRequests,
    maxBytes: profile.maxBytes,
    maxResponseBytes: profile.maxResponseBytes,
    requestTimeoutMs: profile.requestTimeoutMs,
    maxDurationMs: profile.maxDurationMs,
    pollIntervalMs: profile.pollIntervalMs,
    ...profileLimits
  };
  const observation = fixture.readback.events[1];
  const ohlcRaw = fixture.responseBodies[observation.ohlc.sha256];
  const parsed = parseKrakenOhlc({
    raw: ohlcRaw,
    sha256: observation.ohlc.sha256,
    requestStartedAt: observation.ohlc.requestStartedAt,
    receivedAt: observation.ohlc.receivedAt,
    data: JSON.parse(ohlcRaw)
  }, observation.ohlc.receivedAt);
  fixture.readback.checkpoint.strategy =
    advanceStrategy(createStrategyState(), parsed.candles).state;
  fixture.readback.events[0].at = report.startedAt;
  fixture.readback.events.at(-1).at = report.endedAt;
  fixture.readback.events.at(-1).report = report;
  fixture.readback.report = report;
  fixture.readback.eventCount = fixture.readback.events.length;
  fixture.readback.checkpoint.stopReason = report.stopReason;
  fixture.readback.checkpoint.counters = {
    requests: report.requests, bytes: report.deliveredBytes
  };
  mutate?.({ fixture, hostManifest, profile });

  const journal = await createRunJournal({
    dataRoot: join(evidenceDir, "runtime"),
    runId: hostManifest.runId,
    manifest: fixture.readback.manifest
  });
  const initialCheckpoint = {
    strategy: createStrategyState(),
    ledger: createLedger(),
    counters: { requests: 0, bytes: 0 },
    cycle: 0
  };
  await journal.append(fixture.readback.events[0], initialCheckpoint);
  for (const [hash, raw] of Object.entries(fixture.responseBodies)) {
    const reference = [observation.ohlc, observation.ticker]
      .find(item => item.sha256 === hash);
    await journal.persistResponse({
      raw, sha256: hash, bytes: Buffer.byteLength(raw),
      requestStartedAt: reference.requestStartedAt,
      receivedAt: reference.receivedAt
    });
  }
  await journal.append(observation, fixture.readback.checkpoint);
  await journal.append(fixture.readback.events.at(-1), fixture.readback.checkpoint);
  await journal.close();
  const hostState = {
    schemaVersion: "SPOT_PAPER_HOST_STATE_V1",
    runId: hostManifest.runId,
    runtimeSourceSha256: hostManifest.runtimeSourceSha256,
    status: "CHILD_EXITED",
    childPid: null,
    childExitCode: 0,
    childSignal: null,
    interruptedBy: null,
    ...fixture.hostState
  };
  await writeFile(join(evidenceDir, "host-state.json"), JSON.stringify(hostState));
  if (pending) {
    await writeFile(join(evidenceDir, "runtime", hostManifest.runId, "journal.pending"), "{}");
  }
  const manifestBytes = await readFile(new URL(
    "../scripts/spot-paper-pilot/host-launch-manifest.json", import.meta.url));
  const expectedHostContext = {
    schemaVersion: EXPECTED_HOST_CONTEXT_SCHEMA,
    profileId: HOST_EIGHT_HOUR_PROFILE_ID,
    hostRunId: hostManifest.runId,
    launchManifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    runtimeSourceSha256: hostManifest.runtimeSourceSha256,
    imageDigest: null,
    hostIdentity: null
  };
  return {
    root, evidenceDir, hostManifest, fixture, hostState, expectedHostContext,
    assessmentPath: join(root, "assessment.json"),
    contextPath: join(root, "expected-host-context.json")
  };
}

test("paper evidence accepts zero fills without validating a fill path or profitability", () => {
  const fixture = paperEvidenceFixture();
  const assessment = assessPaperEvidence({
    paperExitCode: 0, paperReport: fixture.report, readback: fixture.readback,
    provenance: fixture.provenance, responseBodies: fixture.responseBodies
  });
  assert.equal(assessment.outcome, "COMPLETED", JSON.stringify(assessment));
  assert.equal(assessment.profileId, DEFAULT_PAPER_EVIDENCE_PROFILE_ID);
  assert.equal("expectedHostContext" in assessment, false);
  assert.equal(assessment.runClassification, "COMPLETED_HOUR");
  assert.deepEqual(Object.keys(assessment).sort(), [
    "acceptedObservationCoverage", "acceptedObservations", "boundedTermination",
    "cashCents", "cycleCount", "cycleCoverage", "dataAcceptance", "dataGaps",
    "deliveredBytes", "dispatchIdentity", "durationCoverage", "durationStatus",
    "elapsedMs", "endedAt", "equityCents", "executionImpact", "feesCents",
    "fillCostReport", "fills", "gapCoverage", "lastMark", "limitations",
    "markAgeMs", "observations", "openPositionAssessment", "outcome",
    "position", "positionStatus", "profitability", "profileId",
    "quoteAccountingReconciled", "realizedPnlCents", "reasons", "requests",
    "runClassification", "runId", "signals", "signalReplay", "sourceSha",
    "startedAt", "stopReason", "terminalVerified", "unrealizedPnlCents",
    "validationCriteria"
  ].sort());
  assert.equal(assessment.dataAcceptance, "DATA_ACCEPTED");
  assert.equal(assessment.quoteAccountingReconciled, true);
  assert.equal(assessment.signalReplay, "NOT_PERFORMED");
  assert.equal("fillPathValidated" in assessment, false);
  assert.equal(assessment.profitability, "NOT_ASSESSED");
  assert.equal(assessment.observations, 1);
  assert.equal(assessment.acceptedObservations, 1);
  assert.equal(assessment.elapsedMs, 3_600_000);
  assert.equal(assessment.cycleCoverage, 1 / 60);
  assert.equal(assessment.acceptedObservationCoverage, 1);
  assert.equal(assessment.gapCoverage, 0);
  assert.equal(assessment.durationCoverage, 1);
  assert.deepEqual(assessment.fills, []);
  assert.equal(assessment.positionStatus, "FLAT");
});

test("paper evidence reconciles recorded quotes and integer accounting without claiming strategy replay", () => {
  const fixture = paperEvidenceFixture({ withFill: true });
  const assessment = assessPaperEvidence({
    paperExitCode: 0, paperReport: fixture.report, readback: fixture.readback,
    provenance: fixture.provenance, responseBodies: fixture.responseBodies
  });

  assert.equal(assessment.outcome, "COMPLETED", JSON.stringify(assessment));
  assert.equal(assessment.quoteAccountingReconciled, true);
  assert.equal(assessment.signalReplay, "NOT_PERFORMED");
  assert.equal("fillPathValidated" in assessment, false);
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
  assert.equal(rejected.quoteAccountingReconciled, false);
});

test("four-hour allowlisted assessment reports partial duration, unresolved inventory, and per-fill costs", () => {
  const fixture = fourHourPaperFixture({ withFill: true });
  const assessment = assessPaperEvidence({
    paperExitCode: 0, paperReport: fixture.report, readback: fixture.readback,
    provenance: fixture.provenance, responseBodies: fixture.responseBodies,
    profileId: "BTC_EUR_PAPER_4H_V1",
    expectedDispatch: fixture.expectedDispatch
  });
  assert.equal(assessment.outcome, "COMPLETED", JSON.stringify(assessment));
  assert.equal(assessment.profileId, "BTC_EUR_PAPER_4H_V1");
  assert.deepEqual(Object.keys(assessment).sort(), [
    "acceptedObservationCoverage", "acceptedObservations", "boundedTermination",
    "cashCents", "cycleCount", "cycleCoverage", "dataAcceptance", "dataGaps",
    "deliveredBytes", "dispatchIdentity", "durationCoverage", "durationStatus",
    "elapsedMs", "endedAt", "equityCents", "executionImpact", "feesCents",
    "fillCostReport", "fills", "gapCoverage", "lastMark", "limitations",
    "markAgeMs", "observations", "openPositionAssessment", "outcome",
    "position", "positionStatus", "profitability", "profileId",
    "quoteAccountingReconciled", "realizedPnlCents", "reasons", "requests",
    "runClassification", "runId", "signals", "signalReplay", "sourceSha",
    "startedAt", "stopReason", "terminalVerified", "unrealizedPnlCents",
    "validationCriteria"
  ].sort());
  assert.equal("expectedHostContext" in assessment, false);
  assert.equal(assessment.runClassification, "PARTIAL_BOUNDED_RUN");
  assert.equal(assessment.elapsedMs, 3_600_000);
  assert.equal(assessment.durationCoverage, 0.25);
  assert.equal(assessment.durationStatus, "PARTIAL_BOUNDED_DURATION");
  assert.equal(assessment.validationCriteria.fullRequestedDuration, false);
  assert.equal(assessment.openPositionAssessment, "OPEN_MARK_STALE");
  assert.equal(assessment.fillCostReport.fills.length, 1);
  assert.equal(assessment.fillCostReport.grossTurnoverCents,
    fixture.report.fills[0].grossCents);
  assert.equal(assessment.fillCostReport.feesCents, fixture.report.fills[0].feeCents);
  assert.equal(assessment.profitability, "NOT_ASSESSED");

  const wrongRun = structuredClone(fixture);
  wrongRun.provenance.workflowRunId = "987654322";
  const rejectedRun = assessPaperEvidence({
    paperExitCode: 0, paperReport: wrongRun.report, readback: wrongRun.readback,
    provenance: wrongRun.provenance, responseBodies: wrongRun.responseBodies,
    profileId: "BTC_EUR_PAPER_4H_V1",
    expectedDispatch: wrongRun.expectedDispatch
  });
  assert.equal(rejectedRun.outcome, "FAILED");

  const wrongMode = structuredClone(fixture);
  wrongMode.provenance.mode = "observe";
  const rejectedMode = assessPaperEvidence({
    paperExitCode: 0, paperReport: wrongMode.report, readback: wrongMode.readback,
    provenance: wrongMode.provenance, responseBodies: wrongMode.responseBodies,
    profileId: "BTC_EUR_PAPER_4H_V1",
    expectedDispatch: wrongMode.expectedDispatch
  });
  assert.equal(rejectedMode.outcome, "FAILED");

  const exceeded = structuredClone(fixture);
  exceeded.readback.manifest.limits.maxCycles = 241;
  const rejectedBounds = assessPaperEvidence({
    paperExitCode: 0, paperReport: exceeded.report, readback: exceeded.readback,
    provenance: exceeded.provenance, responseBodies: exceeded.responseBodies,
    profileId: "BTC_EUR_PAPER_4H_V1",
    expectedDispatch: exceeded.expectedDispatch
  });
  assert.equal(rejectedBounds.outcome, "FAILED");
  const missingExpectation = assessPaperEvidence({
    paperExitCode: 0, paperReport: fixture.report, readback: fixture.readback,
    provenance: fixture.provenance, responseBodies: fixture.responseBodies,
    profileId: "BTC_EUR_PAPER_4H_V1"
  });
  assert.equal(missingExpectation.outcome, "UNKNOWN");
  assert.equal(missingExpectation.dispatchIdentity, "UNKNOWN");
  assert.equal(missingExpectation.dataAcceptance, "NOT_ASSESSED");

  const coordinatedTampering = structuredClone(fixture);
  const forgedDispatch = {
    ...coordinatedTampering.expectedDispatch,
    workflowSha: "c".repeat(40),
    workflowRunId: "987654322"
  };
  forgedDispatch.workflowRunNumber = 1;
  forgedDispatch.workflowRunAttempt = 1;
  coordinatedTampering.expectedDispatch = fixture.expectedDispatch;
  coordinatedTampering.provenance = {
    ...coordinatedTampering.provenance, ...forgedDispatch,
    runId: "spot-paper-987654322-1"
  };
  coordinatedTampering.report.runId = "spot-paper-987654322-1";
  coordinatedTampering.readback.runId = "spot-paper-987654322-1";
  const rejectedCoordinatedTampering = assessPaperEvidence({
    paperExitCode: 0, paperReport: coordinatedTampering.report,
    readback: coordinatedTampering.readback,
    provenance: coordinatedTampering.provenance,
    responseBodies: coordinatedTampering.responseBodies,
    profileId: "BTC_EUR_PAPER_4H_V1",
    expectedDispatch: coordinatedTampering.expectedDispatch
  });
  assert.equal(rejectedCoordinatedTampering.outcome, "FAILED");
  assert.equal(rejectedCoordinatedTampering.dispatchIdentity, "FAILED");
  assert.throws(() => assessPaperEvidence({
    paperExitCode: 0, paperReport: fixture.report, readback: fixture.readback,
    provenance: fixture.provenance, responseBodies: fixture.responseBodies,
    profileId: "constructor"
  }), /UNKNOWN_PAPER_EVIDENCE_PROFILE/);
});

test("host eight-hour assessment binds a clean terminal journal and reports only content evidence", async t => {
  const evidence = await hostAssessmentFixture(t);
  assert.equal(HOST_LAUNCH_MANIFEST.runId, evidence.hostManifest.runId);
  const profile = getPaperEvidenceProfile(HOST_EIGHT_HOUR_PROFILE_ID, {
    hostManifest: evidence.hostManifest
  });
  assert.deepEqual({
    runId: profile.runId,
    runtimeSourceSha256: profile.runtimeSourceSha256,
    maxCycles: profile.maxCycles,
    maxRequests: profile.maxRequests,
    maxDurationMs: profile.maxDurationMs
  }, {
    runId: HOST_LAUNCH_MANIFEST.runId,
    runtimeSourceSha256: HOST_LAUNCH_MANIFEST.runtimeSourceSha256,
    maxCycles: 480,
    maxRequests: 960,
    maxDurationMs: 28_800_000
  });
  const result = await assessHostEvidence({
    evidenceDir: evidence.evidenceDir,
    expectedHostContext: evidence.expectedHostContext
  });
  assert.equal(result.outcome, "COMPLETED", JSON.stringify(result));
  assert.equal(result.assessment.runClassification, "COMPLETED_EIGHT_HOURS");
  assert.equal(result.assessment.durationStatus, "FULL_REQUESTED_DURATION");
  assert.equal(result.assessment.elapsedMs, 28_800_000);
  assert.equal(result.assessment.sourceSha, evidence.hostManifest.runtimeSourceSha256);
  assert.equal(result.assessment.positionStatus, "FLAT");
  assert.equal(result.assessment.feesCents, 0);
  assert.equal(result.assessment.profitability, "NOT_ASSESSED");
  assert.equal(result.signalReplay.outcome, "PASS");
  assert.equal(result.hostContextBinding, "CONTENT_BOUND");
  assert.equal(result.imageIdentity, "NOT_AVAILABLE");
  assert.equal(result.hostIdentity, "NOT_AVAILABLE");
  assert.equal(result.sourceAuthenticity, "UNATTESTED");
  assert.equal(result.clockAuthenticity, "UNATTESTED");
  assert.equal(result.providerAuthenticity, "UNATTESTED");
  assert.equal(result.launchReadiness, "NOT_ASSESSED");
});

test("available image and host identity fields require matching context and remain unattested", async t => {
  const evidence = await hostAssessmentFixture(t);
  const statePath = join(evidence.evidenceDir, "host-state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.imageDigest = `sha256:${"a".repeat(64)}`;
  state.hostIdentity = "synthetic-host-01";
  await writeFile(statePath, JSON.stringify(state));
  const expectedHostContext = {
    ...evidence.expectedHostContext,
    imageDigest: state.imageDigest,
    hostIdentity: state.hostIdentity
  };
  const result = await assessHostEvidence({
    evidenceDir: evidence.evidenceDir, expectedHostContext
  });
  assert.equal(result.outcome, "COMPLETED", JSON.stringify(result));
  assert.equal(result.imageIdentity, "CONTENT_BOUND_UNATTESTED");
  assert.equal(result.hostIdentity, "CONTENT_BOUND_UNATTESTED");

  const mismatch = await assessHostEvidence({
    evidenceDir: evidence.evidenceDir,
    expectedHostContext: { ...expectedHostContext, imageDigest: `sha256:${"b".repeat(64)}` }
  });
  assert.equal(mismatch.outcome, "FAILED");
});

test("missing and forged host expectations fail closed without GitHub identity", async t => {
  const missing = await hostAssessmentFixture(t, {
    mutate: ({ fixture }) => {
      fixture.hostState = { expectedHostContext: { arbitrary: "artifact claim" } };
    }
  });
  assert.equal((await assessHostEvidence({ evidenceDir: missing.evidenceDir })).outcome,
    "UNKNOWN");

  for (const change of [
    context => { context.runtimeSourceSha256 = "f".repeat(64); },
    context => { context.launchManifestSha256 = "e".repeat(64); },
    context => { context.hostRunId = "spot-paper-12345-1"; },
    context => { context.workflowRunId = "12345"; }
  ]) {
    const evidence = await hostAssessmentFixture(t);
    const forged = structuredClone(evidence.expectedHostContext);
    change(forged);
    const result = await assessHostEvidence({
      evidenceDir: evidence.evidenceDir, expectedHostContext: forged
    });
    assert.equal(result.outcome, "FAILED", JSON.stringify(result));
  }
});

test("host assessment CLI requires external context and accepts a separately supplied file", async t => {
  const evidence = await hostAssessmentFixture(t, {
    mutate: ({ fixture }) => {
      fixture.hostState = { expectedHostContext: { arbitrary: "self-attested" } };
    }
  });
  await assert.rejects(hostEvidenceAssessmentMain([
    evidence.evidenceDir,
    join(evidence.evidenceDir, "expected-host-context.json"),
    evidence.assessmentPath
  ], { stdout: { write() {} } }), /EXPECTED_HOST_CONTEXT_MUST_BE_EXTERNAL/);

  await writeFile(evidence.contextPath, JSON.stringify(evidence.expectedHostContext));
  let output = "";
  const previousExitCode = process.exitCode;
  try {
    const result = await hostEvidenceAssessmentMain([
      evidence.evidenceDir, evidence.contextPath, evidence.assessmentPath
    ], { stdout: { write: value => { output += value; } } });
    assert.equal(result.outcome, "COMPLETED");
    assert.equal(JSON.parse(output).signalReplay.outcome, "PASS");
    assert.deepEqual(JSON.parse(await readFile(evidence.assessmentPath, "utf8")), result);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("host assessment CLI bounds delayed open, stat, read, close, realpath, and output I/O", async t => {
  const evidence = await hostAssessmentFixture(t);
  await writeFile(evidence.contextPath, JSON.stringify(evidence.expectedHostContext));
  const delayed = (operation, delayMs) => new Promise((resolve, reject) => {
    setTimeout(() => Promise.resolve().then(operation).then(resolve, reject), delayMs);
  });
  const openState = {};
  const cases = [
    {
      name: "open",
      timeoutMs: 200,
      delayMs: 400,
      io: {
        open: async (path, ...args) => {
          openState.openCalls = (openState.openCalls ?? 0) + 1;
          const handle = await delayed(async () => openFile(path, ...args), 400);
          openState.lateHandleReturned = true;
          const close = handle.close.bind(handle);
          handle.close = () => {
            openState.lateHandleClosed = true;
            return close();
          };
          return handle;
        }
      }
    },
    {
      name: "stat",
      timeoutMs: 100,
      delayMs: 400,
      io: {
        open: async (path, ...args) => {
          const handle = await openFile(path, ...args);
          if (path === evidence.contextPath) {
            const stat = handle.stat.bind(handle);
            handle.stat = (...statArgs) =>
              delayed(() => stat(...statArgs), 180);
          }
          return handle;
        }
      }
    },
    {
      name: "read",
      timeoutMs: 100,
      delayMs: 400,
      io: {
        open: async (path, ...args) => {
          const handle = await openFile(path, ...args);
          if (path === evidence.contextPath) {
            const read = handle.read.bind(handle);
            handle.read = (...readArgs) => delayed(() => read(...readArgs), 180);
          }
          return handle;
        }
      }
    },
    {
      name: "close",
      timeoutMs: 100,
      delayMs: 400,
      io: {
        open: async (path, ...args) => {
          const handle = await openFile(path, ...args);
          if (path === evidence.contextPath) {
            const close = handle.close.bind(handle);
            handle.close = () => delayed(() => close(), 180);
          }
          return handle;
        }
      }
    },
    {
      name: "realpath",
      timeoutMs: 100,
      delayMs: 400,
      io: { realpath: path => delayed(() => realpathFile(path), 180) }
    },
    {
      name: "write",
      timeoutMs: 800,
      delayMs: 1_000,
      io: {
        writeFile: (path, ...args) => path.endsWith(".tmp") ?
          delayed(() => writeFile(path, ...args), 1_000) : writeFile(path, ...args)
      }
    }
  ];

  for (const scenario of cases) {
    const outputPath = join(evidence.root, `delayed-${scenario.name}.json`);
    const output = [];
    const startedAt = performance.now();
    await assert.rejects(hostEvidenceAssessmentMain([
      evidence.evidenceDir, evidence.contextPath, outputPath
    ], {
      timeoutMs: scenario.timeoutMs,
      io: scenario.io,
      stdout: { write: value => output.push(value) }
    }), /HOST_ASSESSMENT_DEADLINE_EXCEEDED/);
    assert.ok(performance.now() - startedAt < scenario.timeoutMs + 300, scenario.name);
    assert.deepEqual(output, [], scenario.name);
    await new Promise(resolve => setTimeout(resolve, scenario.delayMs + 30));
    await assert.rejects(readFile(outputPath), { code: "ENOENT" }, scenario.name);
    if (scenario.name === "open") {
      assert.deepEqual({
        openCalls: openState.openCalls,
        lateHandleReturned: openState.lateHandleReturned,
        lateHandleClosed: openState.lateHandleClosed
      }, { openCalls: 1, lateHandleReturned: true, lateHandleClosed: true });
    }
    if (scenario.name === "write") {
      const leftovers = (await readdir(evidence.root))
        .filter(name => name.startsWith(".delayed-write.json.") && name.endsWith(".tmp"));
      assert.deepEqual(leftovers, []);
    }
  }
});

test("host assessment bounds late and stalled runtime-source close operations", async t => {
  const sourcePath = fileURLToPath(new URL(
    "../scripts/spot-paper-pilot/core.mjs", import.meta.url));
  for (const stall of [false, true]) {
    const evidence = await hostAssessmentFixture(t);
    let closeStarted = false;
    let releaseClose;
    const controller = new AbortController();
    const io = {
      open: async (path, ...args) => {
        const handle = await openFile(path, ...args);
        if (path === sourcePath) {
          const close = handle.close.bind(handle);
          handle.close = () => {
            closeStarted = true;
            if (stall) {
              return new Promise(resolve => {
                releaseClose = async () => {
                  await close();
                  resolve();
                };
              });
            }
            return new Promise((resolve, reject) => {
              setTimeout(() => close().then(resolve, reject), 600);
            });
          };
        }
        return handle;
      }
    };
    const startedAt = performance.now();
    const result = await assessHostEvidence({
      evidenceDir: evidence.evidenceDir,
      expectedHostContext: evidence.expectedHostContext,
      context: {
        deadlineAt: performance.now() + 100,
        monotonicNow: () => performance.now(),
        controller,
        signal: controller.signal,
        pendingOperations: new Set()
      },
      io
    });
    assert.ok(performance.now() - startedAt < 400, `stall=${stall}`);
    assert.equal(result.outcome, "UNKNOWN", JSON.stringify(result));
    assert.equal(result.reason, "HOST_ASSESSMENT_DEADLINE_EXCEEDED");
    assert.equal(closeStarted, true);
    if (stall) await releaseClose();
  }
});

test("exported assessment cannot return COMPLETED after synchronous replay expires the deadline", async t => {
  const firstEvidence = await hostAssessmentFixture(t);
  let firstClockCalls = 0;
  const firstDeadlineAt = performance.now() + 60_000;
  const firstController = new AbortController();
  const successful = await assessHostEvidence({
    evidenceDir: firstEvidence.evidenceDir,
    expectedHostContext: firstEvidence.expectedHostContext,
    context: {
      deadlineAt: firstDeadlineAt,
      monotonicNow: () => {
        firstClockCalls++;
        return performance.now();
      },
      controller: firstController,
      signal: firstController.signal,
      pendingOperations: new Set()
    }
  });
  assert.equal(successful.outcome, "COMPLETED");

  const expiredEvidence = await hostAssessmentFixture(t);
  let clockCalls = 0;
  const deadlineAt = performance.now() + 60_000;
  const expiredController = new AbortController();
  const expired = await assessHostEvidence({
    evidenceDir: expiredEvidence.evidenceDir,
    expectedHostContext: expiredEvidence.expectedHostContext,
    context: {
      deadlineAt,
      monotonicNow: () => {
        clockCalls++;
        return clockCalls >= firstClockCalls ? deadlineAt : performance.now();
      },
      controller: expiredController,
      signal: expiredController.signal,
      pendingOperations: new Set()
    }
  });
  assert.equal(clockCalls, firstClockCalls);
  assert.equal(expired.outcome, "UNKNOWN", JSON.stringify(expired));
  assert.equal(expired.reason, "HOST_ASSESSMENT_DEADLINE_EXCEEDED");
});

test("host assessment output publication preserves pre-existing output on collision", async t => {
  const evidence = await hostAssessmentFixture(t);
  await writeFile(evidence.contextPath, JSON.stringify(evidence.expectedHostContext));
  const output = Buffer.from("preserve existing output");
  await writeFile(evidence.assessmentPath, output);
  await assert.rejects(hostEvidenceAssessmentMain([
    evidence.evidenceDir, evidence.contextPath, evidence.assessmentPath
  ], { stdout: { write() {} } }), { code: "EEXIST" });
  assert.deepEqual(await readFile(evidence.assessmentPath), output);
});

test("host assessment rejects interruptions, failed children, pending journals, and old-profile mixes", async t => {
  for (const { mutate, pending } of [
    { mutate: ({ fixture }) => { fixture.hostState = { interruptedBy: "SIGTERM" }; } },
    { mutate: ({ fixture }) => { fixture.hostState = { childExitCode: 7 }; } },
    { pending: true }
  ]) {
    const evidence = await hostAssessmentFixture(t, { mutate, pending });
    assert.equal((await assessHostEvidence({
      evidenceDir: evidence.evidenceDir,
      expectedHostContext: evidence.expectedHostContext
    })).outcome, "UNKNOWN");
  }

  for (const journalContent of ["{not-json", Buffer.alloc(8 * 1024 * 1024 + 1)]) {
    const invalid = await hostAssessmentFixture(t);
    await writeFile(join(invalid.evidenceDir, "runtime",
      invalid.hostManifest.runId, "journal.json"), journalContent);
    assert.equal((await assessHostEvidence({
      evidenceDir: invalid.evidenceDir,
      expectedHostContext: invalid.expectedHostContext
    })).outcome, "UNKNOWN");
  }

  for (const profileId of [
    DEFAULT_PAPER_EVIDENCE_PROFILE_ID, "BTC_EUR_PAPER_4H_V1"
  ]) {
    const oldProfile = getPaperEvidenceProfile(profileId);
    const mixed = await hostAssessmentFixture(t, {
      profileLimits: {
        maxCycles: oldProfile.maxCycles,
        maxRequests: oldProfile.maxRequests,
        maxDurationMs: oldProfile.maxDurationMs,
        pollIntervalMs: oldProfile.pollIntervalMs
      }
    });
    assert.equal((await assessHostEvidence({
      evidenceDir: mixed.evidenceDir,
      expectedHostContext: mixed.expectedHostContext
    })).outcome, "UNKNOWN", profileId);
  }
});

test("host assessment rejects timestamp, budget, accounting, and replay discrepancies", async t => {
  const timestamp = await hostAssessmentFixture(t, { elapsedMs: 28_806_000 });
  const timestampResult = await assessHostEvidence({
    evidenceDir: timestamp.evidenceDir,
    expectedHostContext: timestamp.expectedHostContext
  });
  assert.equal(timestampResult.outcome, "FAILED", JSON.stringify(timestampResult));
  assert.ok(timestampResult.assessment.reasons.includes("RUNTIME_BOUND_OR_TIMESTAMP_INVALID"));

  const budget = await hostAssessmentFixture(t, {
    mutate: ({ fixture }) => { fixture.report.requests++; }
  });
  assert.equal((await assessHostEvidence({
    evidenceDir: budget.evidenceDir,
    expectedHostContext: budget.expectedHostContext
  })).outcome, "UNKNOWN");

  const accounting = await hostAssessmentFixture(t, {
    mutate: ({ fixture }) => { fixture.report.feesCents++; }
  });
  const accountingResult = await assessHostEvidence({
    evidenceDir: accounting.evidenceDir,
    expectedHostContext: accounting.expectedHostContext
  });
  assert.equal(accountingResult.outcome, "FAILED", JSON.stringify(accountingResult));
  assert.ok(accountingResult.assessment.reasons.includes(
    "INTEGER_LEDGER_OR_CAUSAL_FILL_RECONCILIATION_FAILED"));

  const replay = await hostAssessmentFixture(t, {
    mutate: ({ fixture }) => {
      const event = fixture.readback.events[1];
      event.signals = [{
        id: "forged-signal", direction: "ENTRY", candleAt: 1,
        closeNano: "1", signalKnownAt: 2
      }];
      fixture.report.signals = event.signals;
    }
  });
  const replayResult = await assessHostEvidence({
    evidenceDir: replay.evidenceDir,
    expectedHostContext: replay.expectedHostContext
  });
  assert.equal(replayResult.signalReplay.outcome, "FAILED");
  assert.equal(replayResult.outcome, "FAILED");
});

test("host terminal shorter than eight hours is never labeled full duration", async t => {
  const evidence = await hostAssessmentFixture(t, { elapsedMs: 7 * 60 * 60 * 1000 });
  const result = await assessHostEvidence({
    evidenceDir: evidence.evidenceDir,
    expectedHostContext: evidence.expectedHostContext
  });
  assert.equal(result.assessment.durationStatus, "PARTIAL_BOUNDED_DURATION");
  assert.notEqual(result.assessment.runClassification, "COMPLETED_EIGHT_HOURS");
  assert.equal(result.assessment.profitability, "NOT_ASSESSED");
});

test("480-cycle host evidence ending before eight hours remains partial", async t => {
  const evidence = await hostAssessmentFixture(t, { elapsedMs: 7 * 60 * 60 * 1000 });
  const readback = evidence.fixture.readback;
  const report = readback.report;
  const observation = readback.events[1];
  observation.cycle = 480;
  observation.id = `observation:480:${observation.ohlc.latestClosedAt}:${observation.ticker.sha256}`;
  const gaps = Array.from({ length: 479 }, (_, index) => {
    const cycle = index + 1;
    return {
      id: `gap:${cycle}:${cycle * 2}:HTTP_429`,
      type: "data_gap",
      reason: "HTTP_429",
      cycle,
      signals: [],
      fills: []
    };
  });
  report.dataGaps = 479;
  report.requests = 960;
  report.stopReason = "CYCLE_LIMIT";
  readback.events = [
    readback.events[0], ...gaps, observation,
    { ...readback.events.at(-1), at: report.endedAt, report }
  ];
  readback.eventCount = readback.events.length;
  readback.checkpoint = {
    ...readback.checkpoint,
    cycle: 480,
    counters: { requests: 960, bytes: report.deliveredBytes },
    stopReason: "CYCLE_LIMIT"
  };
  readback.report = report;
  const paperAssessment = assessPaperEvidence({
    paperExitCode: 0,
    paperReport: report,
    readback,
    provenance: null,
    responseBodies: evidence.fixture.responseBodies,
    profileId: HOST_EIGHT_HOUR_PROFILE_ID,
    expectedHostContext: evidence.expectedHostContext,
    hostManifest: evidence.hostManifest,
    hostManifestSha256: evidence.expectedHostContext.launchManifestSha256,
    hostState: evidence.hostState
  });
  const replay = replaySpotPaperSignals({
    readback,
    provenance: null,
    responseBodies: evidence.fixture.responseBodies,
    profileId: HOST_EIGHT_HOUR_PROFILE_ID,
    expectedHostContext: evidence.expectedHostContext,
    hostManifest: evidence.hostManifest,
    hostManifestSha256: evidence.expectedHostContext.launchManifestSha256,
    hostState: evidence.hostState
  });
  assert.equal(paperAssessment.outcome, "COMPLETED", JSON.stringify(paperAssessment));
  assert.equal(paperAssessment.cycleCoverage, 1);
  assert.equal(paperAssessment.durationStatus, "PARTIAL_BOUNDED_DURATION");
  assert.equal(paperAssessment.runClassification, "PARTIAL_BOUNDED_RUN");
  assert.equal(replay.outcome, "PASS", JSON.stringify(replay));
});

test("paper evidence rejects observation records missing either or both raw market references", () => {
  for (const fields of [["ohlc"], ["ticker"], ["ohlc", "ticker"]]) {
    const fixture = paperEvidenceFixture();
    for (const field of fields) delete fixture.readback.events[1][field];
    const assessment = assessPaperEvidence({
      paperExitCode: 0, paperReport: fixture.report, readback: fixture.readback,
      provenance: fixture.provenance, responseBodies: fixture.responseBodies
    });
    assert.equal(assessment.outcome, "FAILED", fields.join("+"));
    assert.equal(assessment.acceptedObservations, 0, fields.join("+"));
    assert.equal(assessment.dataAcceptance, "NOT_ASSESSED", fields.join("+"));
    assert.equal(assessment.quoteAccountingReconciled, false, fields.join("+"));
  }
});

test("paper evidence keeps genuine request-error gaps reference-optional", () => {
  const fixture = paperEvidenceFixture();
  const { report, readback } = fixture;
  const gap = {
    id: "gap:2:3:HTTP_429", type: "data_gap", reason: "HTTP_429",
    at: report.startedAt + 60_000
  };
  report.dataGaps = 1;
  report.requests = 3;
  readback.events.splice(2, 0, gap);
  readback.events.at(-1).report = report;
  readback.eventCount = readback.events.length;
  readback.checkpoint = {
    ...readback.checkpoint,
    counters: { requests: 3, bytes: report.deliveredBytes },
    cycle: 2
  };
  const assessment = assessPaperEvidence({
    paperExitCode: 0, paperReport: report, readback,
    provenance: fixture.provenance, responseBodies: fixture.responseBodies
  });
  assert.equal(assessment.outcome, "COMPLETED");
  assert.equal(assessment.acceptedObservations, 1);
  assert.equal(assessment.dataGaps, 1);
  assert.ok(assessment.reasons.includes("HTTP_429"));
});

test("bounded duration with only request failures is not accepted data or a completed hour", () => {
  const fixture = paperEvidenceFixture();
  const { report, readback } = fixture;
  const gap = {
    id: "gap:1:2:FETCH_FAILED", type: "data_gap",
    reason: "FETCH_FAILED", at: report.startedAt + 3_600_000
  };
  report.observations = 0;
  report.dataGaps = 1;
  report.requests = 2;
  report.deliveredBytes = 0;
  report.signals = [];
  readback.events.splice(1, 1, gap);
  readback.events.at(-1).at = report.endedAt;
  readback.events.at(-1).report = report;
  readback.eventCount = readback.events.length;
  readback.checkpoint = {
    ledger: {
      initialCashCents: 100_000, cashCents: 100_000,
      realizedPnlCents: 0, feesCents: 0, position: null,
      lastMark: null, fills: []
    },
    counters: { requests: 2, bytes: 0 }, cycle: 1,
    stopReason: "DURATION_LIMIT"
  };
  const assessment = assessPaperEvidence({
    paperExitCode: 0, paperReport: report, readback,
    provenance: fixture.provenance, responseBodies: fixture.responseBodies
  });
  assert.equal(assessment.boundedTermination, true);
  assert.equal(assessment.outcome, "FAILED");
  assert.equal(assessment.acceptedObservations, 0);
  assert.equal(assessment.dataAcceptance, "FAILED_DATA_ACCEPTANCE");
  assert.equal(assessment.runClassification, "FAILED_DATA_ACCEPTANCE");
});

test("paper evidence permits a quote-triggered stop fill on a verified missed-window gap", () => {
  const fixture = paperEvidenceFixture({ withFill: true });
  const { report, readback, responseBodies } = fixture;
  const priorPosition = structuredClone(report.position);
  const priorFill = report.fills[0];
  const stoppedAt = report.startedAt + 60_000;
  const ohlcRaw = JSON.stringify(ohlcData(
    Array(21).fill("68000.00000000"), stoppedAt - 22 * MINUTE - 1_000
  ));
  const tickerRaw = JSON.stringify(tickerData({
    bid: "66600.00000000", ask: "66601.00000000"
  }));
  const ohlcHash = sha256(Buffer.from(ohlcRaw, "utf8"));
  const tickerHash = sha256(Buffer.from(tickerRaw, "utf8"));
  responseBodies[ohlcHash] = ohlcRaw;
  responseBodies[tickerHash] = tickerRaw;
  const quoteReceivedAt = stoppedAt + 30;
  const exitPriceNano = String((6_660_000_000_000n * 9_990n + 5_000n) / 10_000n);
  const exitGrossCents = Number((BigInt(priorPosition.quantitySat) *
    BigInt(exitPriceNano) * 2n + 100_000_000_000_000n) /
    (2n * 100_000_000_000_000n));
  const exitFeeCents = Number((BigInt(exitGrossCents) * 50n * 2n + 10_000n) / 20_000n);
  const exitFill = {
    id: `exit:${priorPosition.entrySignalId}:stop`, side: "SELL",
    quantitySat: priorPosition.quantitySat, priceNano: exitPriceNano,
    grossCents: exitGrossCents, feeCents: exitFeeCents,
    reason: "SAMPLED_2PCT_BID_STOP", signalAt: quoteReceivedAt + 1,
    quoteReceivedAt
  };
  const proceeds = exitGrossCents - exitFeeCents;
  const entryCost = priorPosition.entryCostCents;
  const gap = {
    id: `observation:2:${BASE + 21 * MINUTE}:${tickerHash}`,
    type: "data_gap", dataGap: "MISSED_DECISION_WINDOW", cycle: 2,
    signalKnownAt: stoppedAt + 10,
    ohlc: {
      path: `responses/${ohlcHash}.json`, sha256: ohlcHash,
      bytes: Buffer.byteLength(ohlcRaw), requestStartedAt: stoppedAt,
      receivedAt: stoppedAt + 5, latestClosedAt: stoppedAt - 2 * MINUTE - 1_000,
      ageMs: 60_000
    },
    ticker: {
      path: `responses/${tickerHash}.json`, sha256: tickerHash,
      bytes: Buffer.byteLength(tickerRaw),
      requestStartedAt: stoppedAt + 15, receivedAt: quoteReceivedAt,
      acquisitionAgeMs: 0
    },
    signals: [], fills: [exitFill]
  };
  report.fills = [priorFill, exitFill];
  report.cashCents = 100_000 - entryCost + proceeds;
  report.feesCents += exitFeeCents;
  report.realizedPnlCents = proceeds - entryCost;
  report.position = null;
  report.positionStatus = "FLAT";
  report.unrealizedPnlCents = 0;
  report.equityCents = report.cashCents;
  report.lastMark = null;
  report.observations = 1;
  report.dataGaps = 1;
  report.requests = 4;
  report.deliveredBytes = Object.values(responseBodies)
    .reduce((sum, raw) => sum + Buffer.byteLength(raw), 0);
  readback.events.splice(2, 0, gap);
  readback.events.at(-1).report = report;
  readback.checkpoint = {
    ledger: {
      initialCashCents: 100_000, cashCents: report.cashCents,
      realizedPnlCents: report.realizedPnlCents, feesCents: report.feesCents,
      position: null, lastMark: null, fills: report.fills
    },
    counters: { requests: 4, bytes: report.deliveredBytes },
    cycle: 2, stopReason: "DURATION_LIMIT"
  };
  readback.eventCount = readback.events.length;
  const assessment = assessPaperEvidence({
    paperExitCode: 0, paperReport: report, readback,
    provenance: fixture.provenance, responseBodies
  });
  assert.equal(assessment.outcome, "COMPLETED", JSON.stringify(assessment));
  assert.equal(assessment.quoteAccountingReconciled, true);
  assert.equal(assessment.fills[1].reason, "SAMPLED_2PCT_BID_STOP");
});

test("paper evidence distinguishes partial duration, risk stops, and invalid timestamps", () => {
  const fixture = paperEvidenceFixture();
  fixture.report.endedAt -= 60_000;
  fixture.readback.events.at(-1).at = fixture.report.endedAt;
  fixture.readback.events.at(-1).report = fixture.report;
  const partial = assessPaperEvidence({
    paperExitCode: 0, paperReport: fixture.report, readback: fixture.readback,
    provenance: fixture.provenance, responseBodies: fixture.responseBodies
  });
  assert.equal(partial.outcome, "COMPLETED");
  assert.equal(partial.runClassification, "PARTIAL_BOUNDED_RUN");
  assert.equal(partial.elapsedMs, 3_540_000);
  assert.equal(partial.durationCoverage, 0.9833333333333333);

  const riskFixture = paperEvidenceFixture();
  riskFixture.report.stopReason = "SESSION_LOSS_LIMIT";
  riskFixture.readback.checkpoint.stopReason = "SESSION_LOSS_LIMIT";
  riskFixture.readback.events.at(-1).report = riskFixture.report;
  const risk = assessPaperEvidence({
    paperExitCode: 0, paperReport: riskFixture.report,
    readback: riskFixture.readback, provenance: riskFixture.provenance,
    responseBodies: riskFixture.responseBodies
  });
  assert.equal(risk.runClassification, "RISK_STOP");

  const invalidFixture = paperEvidenceFixture();
  invalidFixture.report.endedAt = invalidFixture.report.startedAt +
    3_600_000 + 5_001;
  invalidFixture.readback.events.at(-1).at = invalidFixture.report.endedAt;
  invalidFixture.readback.events.at(-1).report = invalidFixture.report;
  const invalid = assessPaperEvidence({
    paperExitCode: 0, paperReport: invalidFixture.report,
    readback: invalidFixture.readback, provenance: invalidFixture.provenance,
    responseBodies: invalidFixture.responseBodies
  });
  assert.equal(invalid.outcome, "FAILED");
  assert.ok(invalid.reasons.includes("RUNTIME_BOUND_OR_TIMESTAMP_INVALID"));
});

test("reaching sixty cycles before sixty elapsed minutes remains partial", () => {
  const fixture = paperEvidenceFixture();
  const { report, readback } = fixture;
  const start = readback.events[0];
  const observation = readback.events[1];
  const cycles = Array.from({ length: 60 }, (_, index) => ({
    ...observation, id: `observation:${index + 1}`, cycle: index + 1
  }));
  report.stopReason = "CYCLE_LIMIT";
  report.observations = 60;
  report.requests = 120;
  report.deliveredBytes *= 60;
  report.endedAt = report.startedAt + 59 * MINUTE;
  const terminal = { id: "run-terminal", type: "terminal", at: report.endedAt, report };
  readback.events = [start, ...cycles, terminal];
  readback.eventCount = readback.events.length;
  readback.report = report;
  readback.checkpoint = {
    ...readback.checkpoint,
    counters: { requests: 120, bytes: report.deliveredBytes },
    cycle: 60, stopReason: "CYCLE_LIMIT"
  };
  const assessment = assessPaperEvidence({
    paperExitCode: 0, paperReport: report, readback,
    provenance: fixture.provenance, responseBodies: fixture.responseBodies
  });
  assert.equal(assessment.outcome, "COMPLETED");
  assert.equal(assessment.runClassification, "PARTIAL_BOUNDED_RUN");
  assert.equal(assessment.cycleCoverage, 1);
  assert.equal(assessment.elapsedMs, 59 * MINUTE);
  assert.equal(assessment.durationCoverage, 59 / 60);
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
  assert.equal(JSON.parse(await readFile(assessmentPath, "utf8")).signalReplay, "NOT_PERFORMED");

  const fourHour = fourHourPaperFixture();
  const fourHourRun = join(root, "four-hour-run");
  const fourHourResponses = join(fourHourRun, "responses");
  await mkdir(fourHourResponses, { recursive: true });
  for (const [hash, raw] of Object.entries(fourHour.responseBodies)) {
    await writeFile(join(fourHourResponses, `${hash}.json`), raw);
  }
  const fourHourPaperPath = join(root, "four-hour-paper.json");
  const fourHourReadbackPath = join(root, "four-hour-readback.json");
  const fourHourProvenancePath = join(root, "four-hour-manifest.json");
  const fourHourAssessmentPath = join(root, "four-hour-assessment.json");
  await writeFile(fourHourPaperPath, JSON.stringify(fourHour.report));
  await writeFile(fourHourReadbackPath, JSON.stringify(fourHour.readback));
  await writeFile(fourHourProvenancePath, JSON.stringify(fourHour.provenance));
  const expectedDispatchEnvironment = Object.fromEntries(
    Object.entries(fourHour.expectedDispatch).map(([field, value]) => [
      `MERIDIAN_EXPECTED_DISPATCH_${field.replace(/^workflowRunId$/, "runId")
        .replace(/^workflowRunNumber$/, "runNumber")
        .replace(/^workflowRunAttempt$/, "runAttempt").replace(/[A-Z]/g,
        letter => `_${letter}`).toUpperCase()}`, String(value)
    ]));
  const fourHourOutput = execFileSync(process.execPath, [
    PAPER_ASSESSMENT_PATH, fourHourPaperPath, fourHourReadbackPath, "0",
    fourHourProvenancePath, fourHourRun, fourHourAssessmentPath, "BTC_EUR_PAPER_4H_V1"
  ], {
    encoding: "utf8",
    env: { ...process.env, ...expectedDispatchEnvironment }
  });
  assert.equal(JSON.parse(fourHourOutput).profileId, "BTC_EUR_PAPER_4H_V1");
  assert.equal(JSON.parse(fourHourOutput).durationStatus, "PARTIAL_BOUNDED_DURATION");
  assert.equal(JSON.parse(fourHourOutput).dispatchIdentity, "PASS");
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

test("four-hour paper workflow is a fixed owner-only one-shot with bounded retained evidence", () => {
  const trigger = FOUR_HOUR_PAPER_WORKFLOW.match(/^on:\n([\s\S]*?)(?=^permissions:)/m)?.[1];
  assert.equal(trigger.trim(), "workflow_dispatch:");
  assert.doesNotMatch(trigger, /schedule:|pull_request:|push:|inputs:/);
  for (const required of [
    "github.actor == 'Achi1984'",
    "github.triggering_actor == 'Achi1984'",
    "github.ref == 'refs/heads/main'",
    "github.run_number == 1",
    "github.run_attempt == 1",
    "timeout-minutes: 270",
    "contents: read",
    "ref: 81edf0b5dc3d455c2c1e1906791d56c731bea0c9",
    "BTC_EUR_PAPER_4H_V1",
    "--mode paper --network",
    "--max-cycles 240",
    "--max-duration-ms 14400000",
    "--poll-interval-ms 60000",
    "actual_elapsed_wall_ms",
    "assessment.json",
    "signal-replay.json",
    "SHA256SUMS",
    "retention-days: 14"
  ]) assert.ok(FOUR_HOUR_PAPER_WORKFLOW.includes(required), required);
  assert.equal((FOUR_HOUR_PAPER_WORKFLOW.match(
    /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/g) || []).length, 2);
  for (const trustedContext of [
    "MERIDIAN_EXPECTED_DISPATCH_REPOSITORY: ${{ github.repository }}",
    "MERIDIAN_EXPECTED_DISPATCH_REF: ${{ github.ref }}",
    "MERIDIAN_EXPECTED_DISPATCH_WORKFLOW_SHA: ${{ github.sha }}",
    "MERIDIAN_EXPECTED_DISPATCH_RUN_ID: ${{ github.run_id }}",
    "MERIDIAN_EXPECTED_DISPATCH_RUN_NUMBER: ${{ github.run_number }}",
    "MERIDIAN_EXPECTED_DISPATCH_RUN_ATTEMPT: ${{ github.run_attempt }}",
    "MERIDIAN_EXPECTED_DISPATCH_WORKFLOW_PATH: .github/workflows/spot-paper-pilot-four-hour-once.yml"
  ]) assert.ok(FOUR_HOUR_PAPER_WORKFLOW.includes(trustedContext), trustedContext);
  assert.match(FOUR_HOUR_PAPER_WORKFLOW,
    /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(FOUR_HOUR_PAPER_WORKFLOW,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(FOUR_HOUR_PAPER_WORKFLOW, /if: always\(\)[\s\S]*?Retain evidence, including failed attempts/);
  assert.doesNotMatch(FOUR_HOUR_PAPER_WORKFLOW, /secrets\.|schedule:|pull_request:|inputs:/);
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
  const provider = providerFor(clock, candles.map(closes => ohlcData(closes)), [tickerData(), tickerData()]);
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
