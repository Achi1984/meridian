import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  composeSpotPaperPairedHost, inspectSpotPaperPairedRun, main, runSpotPaperPairedHost,
  runSpotPaperPairedWithSignals, SPOT_PAPER_PAIRED_HOST_DEFAULTS
} from "../scripts/spot-paper-paired/host.mjs";
import { createRunJournal } from "../scripts/spot-paper-pilot/journal.mjs";
import { SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256 } from
  "../scripts/spot-paper-paired/forward.mjs";
import {
  SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT
} from "../scripts/spot-paper-paired/forward.mjs";

async function rootFixture(t) {
  const dataRoot = await mkdtemp(join(tmpdir(), "paired-host-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  return dataRoot;
}

async function completedJournal(dataRoot, runId) {
  const startedAt = Date.UTC(2025, 0, 1);
  const journal = await createRunJournal({
    dataRoot, runId, manifest: { runId, startedAt },
    deadlineAt: performance.now() + 5_000,
    monotonicNow: () => performance.now()
  });
  const checkpoint = { states: [], counters: { requests: 0, bytes: 0 }, cycle: 0 };
  await journal.append({ id: "paired-start", type: "start", at: startedAt }, checkpoint);
  await journal.append({
    id: "paired-terminal", type: "terminal", at: startedAt + 1,
    report: { runId, outcome: "COMPLETED_BOUNDED", liveTrading: false }
  }, { ...checkpoint, stopReason: "CYCLE_LIMIT" });
  await journal.close({
    deadlineAt: performance.now() + 5_000,
    monotonicNow: () => performance.now()
  });
}

test("paired host defaults are frozen and its disabled command makes no run request", async t => {
  assert.equal(SPOT_PAPER_PAIRED_HOST_DEFAULTS.maxCycles, 480);
  assert.equal(SPOT_PAPER_PAIRED_HOST_DEFAULTS.maxRequests, 960);
  assert.equal(SPOT_PAPER_PAIRED_HOST_DEFAULTS.maxDurationMs, 8 * 60 * 60 * 1000);
  assert.match(SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256, /^[a-f0-9]{64}$/);
  const dataRoot = await rootFixture(t);
  const output = { value: "", write(text) { this.value += text; } };
  const result = await main(["disabled"], { output });
  assert.equal(result.status, "DISABLED");
  assert.match(output.value, /NO_RUN_REQUESTED/);
  const missing = await inspectSpotPaperPairedRun({
    dataRoot, runId: "paired-host-disabled"
  });
  assert.equal(missing.status, "NOT_FOUND");
  const missingExport = await main([
    "export", "--data-root", dataRoot, "--run-id", "paired-host-disabled"
  ], { output });
  assert.equal(missingExport.status, "NOT_FOUND");
  assert.equal(missingExport.verifiedTerminal, false);
  assert.equal(missingExport.report, null);
  assert.equal(missingExport.journal, null);
});

test("host composition rejects an existing evidence path before integration or feed access", async t => {
  const dataRoot = await rootFixture(t);
  await mkdir(join(dataRoot, "already-used"));
  await assert.rejects(runSpotPaperPairedHost({
    dataRoot, runId: "already-used"
  }), /EVIDENCE_PATH_ALREADY_EXISTS/);
});

test("host composition preserves legacy V2 and makes the trend pair opt-in", async t => {
  const dataRoot = await rootFixture(t);
  const runId = "paired-host-next-fee-contract";
  await assert.rejects(composeSpotPaperPairedHost({dataRoot, runId}),
    /ACCOUNT_CONTRACT_SELECTION_REQUIRED/);
  const legacyV2 = await composeSpotPaperPairedHost({
    dataRoot, runId,
    accountContractId: SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT.contractId
  });
  assert.equal(legacyV2.accountContractVersion, 2);
  assert.equal(legacyV2.feeBpsPerSide, 20);
  assert.equal(legacyV2.slippageBpsPerSide, 10);
  assert.equal(Object.hasOwn(legacyV2.expectedIdentity, "modelPairId"), false);
  assert.deepEqual(legacyV2.expectedIdentity.models.map(model => model.modelId), [
    "BTC_EUR_SMA5_SMA20_V1",
    "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1",
    "CASH_CONTROL_V1"
  ]);
  await assert.rejects(composeSpotPaperPairedHost({
    dataRoot, runId: "paired-host-v1-trend",
    accountContractId: "BTC_EUR_PAIRED_PAPER_V1",
    modelPairId: "BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1"
  }), /MODEL_PAIR_ACCOUNT_CONTRACT_MISMATCH/);
  await assert.rejects(composeSpotPaperPairedHost({
    dataRoot, runId: "paired-host-unknown-pair",
    accountContractId: SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT.contractId,
    modelPairId: "UNKNOWN_PAIR"
  }), /UNKNOWN_MODEL_PAIR/);
  const composition = await composeSpotPaperPairedHost({
    dataRoot, runId,
    accountContractId: SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT.contractId,
    modelPairId: "BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1"
  });
  assert.equal(composition.accountContractId,
    "BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2");
  assert.equal(composition.accountContractVersion, 2);
  assert.equal(composition.feeBpsPerSide, 20);
  assert.equal(composition.slippageBpsPerSide, 10);
  assert.equal(composition.expectedIdentity.modelPairId,
    "BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1");
  assert.deepEqual(composition.expectedIdentity.models.map(model => model.modelId), [
    "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1",
    "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1",
    "CASH_CONTROL_V1"
  ]);
  assert.equal(composition.expectedIdentity.researchSourceSha256,
    "dc7be719198ff3c936354c75352dfb782eaece65761b4fb47ba5d3fc0f756e25");

  const output = { value: "", write(text) { this.value += text; } };
  const legacyIdentity = await main([
    "identity", "--data-root", dataRoot, "--run-id", "legacy-v2-identity",
    "--account-contract", SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT.contractId
  ], { output });
  assert.equal(Object.hasOwn(legacyIdentity, "modelPairId"), false);
  assert.deepEqual(legacyIdentity.models.map(model => model.modelId), [
    "BTC_EUR_SMA5_SMA20_V1",
    "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1",
    "CASH_CONTROL_V1"
  ]);

  const identity = await main([
    "identity", "--data-root", dataRoot, "--run-id", "identity-export",
    "--account-contract", SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT.contractId,
    "--model-pair", "BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1"
  ], { output });
  assert.equal(identity.modelPairId, composition.modelPairId);
  assert.deepEqual(identity.models.map(model => model.modelId),
    composition.expectedIdentity.models.map(model => model.modelId));
});

test("legacy V1 host selection keeps the original fixed model identities", async t => {
  const dataRoot = await rootFixture(t);
  const composition = await composeSpotPaperPairedHost({
    dataRoot, runId: "paired-host-legacy-v1",
    accountContractId: "BTC_EUR_PAIRED_PAPER_V1"
  });
  assert.equal(Object.hasOwn(composition.expectedIdentity, "modelPairId"), false);
  assert.deepEqual(composition.expectedIdentity.models.map(model => model.modelId), [
    "BTC_EUR_SMA5_SMA20_V1",
    "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1",
    "CASH_CONTROL_V1"
  ]);
  assert.equal(composition.feeBpsPerSide, 50);
});

test("read-only status/report/export and package commands reuse paired journal helpers", async t => {
  const dataRoot = await rootFixture(t);
  const runId = "paired-host-evidence";
  await completedJournal(dataRoot, runId);
  const inspected = await inspectSpotPaperPairedRun({ dataRoot, runId });
  assert.equal(inspected.status, "TERMINAL_JOURNAL_VERIFIED");
  assert.equal(inspected.verifiedTerminal, true);

  const output = { value: "", write(text) { this.value += text; } };
  const report = await main(["report", "--data-root", dataRoot, "--run-id", runId],
    { output });
  assert.equal(report.report.runId, runId);
  const exported = await main(["export", "--data-root", dataRoot, "--run-id", runId],
    { output });
  assert.equal(exported.schemaVersion, "SPOT_PAPER_PAIRED_HOST_EXPORT_V1");
  assert.equal(exported.status, "TERMINAL_JOURNAL_VERIFIED");
  assert.equal(exported.verifiedTerminal, true);
  assert.equal(exported.reconciliationStatus, "READ_ONLY_VERIFIED");
  assert.deepEqual(exported.report,
    exported.journal.events.at(-1).report);
  assert.equal(exported.journal.reconciliationStatus, "READ_ONLY_VERIFIED");
  assert.equal(Object.hasOwn(exported, "runDirectory"), false);
  const archivePath = join(dataRoot, `${runId}.tar`);
  const manifestPath = join(dataRoot, `${runId}.manifest.json`);
  const packaged = await main([
    "package", "--data-root", dataRoot, "--run-id", runId,
    "--archive", archivePath, "--manifest", manifestPath,
    "--retrieval-window-ms", "1"
  ], { output });
  assert.equal(packaged.status, "PACKAGED_BYTES_ONLY");
  assert.equal(packaged.roundTripVerified, true);
  assert.equal(packaged.retrievalWindowMs, 1);
  assert.equal(JSON.parse(await readFile(manifestPath, "utf8")).preservation, "BYTE_EXACT");
});

test("SIGTERM is mapped to a bounded abort signal and its listener is removed", async () => {
  const signals = new EventEmitter();
  await assert.rejects(runSpotPaperPairedWithSignals(async signal => {
    assert.equal(signal.aborted, false);
    const aborted = new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    signals.emit("SIGTERM");
    await aborted;
  }, { signalSource: signals }), /SIGTERM/);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});
