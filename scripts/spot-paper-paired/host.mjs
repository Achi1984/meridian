#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageHostEvidence } from "../spot-paper-pilot/package-host-evidence.mjs";
import { readRunJournal } from "../spot-paper-pilot/journal.mjs";
import {
  SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT,
  SPOT_PAPER_PAIRED_NEXT_RUN_ACCEPTED_RESEARCH_SOURCE_SHA256,
  SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR,
  createBaselineArm, createCashControlArm, createChallengerArm,
  pairedConfigDigest, pairedResearchSourceDigest, runSpotPaperPaired,
  resolveSpotPaperPairedAccountContract,
  SPOT_PAPER_PAIRED, SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256,
  SPOT_PAPER_PAIRED_SOURCE_ID, SPOT_PAPER_RESEARCH_COMPARISON_ID
} from "./forward.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
const MAX_STATUS_MS = 5_000;
const SOURCE_FILES = [
  "scripts/spot-paper-paired/host.mjs",
  "scripts/spot-paper-paired/forward.mjs",
  "scripts/spot-paper-paired/fee-scenario.mjs",
  "scripts/spot-paper-paired/feed.mjs",
  "scripts/spot-paper-pilot/core.mjs",
  "scripts/spot-paper-pilot/journal.mjs",
  "scripts/spot-paper-pilot/provider.mjs",
  "scripts/spot-paper-paired-report/contract.mjs",
  "scripts/spot-paper-paired-report/evaluate.mjs",
  "scripts/spot-paper-paired-report/cli.mjs"
];

export const SPOT_PAPER_PAIRED_HOST_DEFAULTS = Object.freeze({
  pair: SPOT_PAPER_PAIRED.pair,
  maxCycles: SPOT_PAPER_PAIRED.maxCycles,
  maxRequests: SPOT_PAPER_PAIRED.maxRequests,
  maxBytes: SPOT_PAPER_PAIRED.maxBytes,
  maxResponseBytes: SPOT_PAPER_PAIRED.maxResponseBytes,
  maxDurationMs: SPOT_PAPER_PAIRED.maxDurationMs,
  requestTimeoutMs: SPOT_PAPER_PAIRED.requestTimeoutMs,
  pollIntervalMs: SPOT_PAPER_PAIRED.pollIntervalMs,
  initialCashCents: SPOT_PAPER_PAIRED.initialCashCents,
  maxEntryCents: SPOT_PAPER_PAIRED.maxEntryCents,
  feeBpsPerSide: SPOT_PAPER_PAIRED.feeBpsPerSide,
  slippageBpsPerSide: SPOT_PAPER_PAIRED.slippageBpsPerSide,
  stopLossBps: SPOT_PAPER_PAIRED.stopLossBps,
  maxSessionLossCents: SPOT_PAPER_PAIRED.maxSessionLossCents
});

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function validateLocation(dataRoot, runId) {
  assert(typeof dataRoot === "string" && dataRoot.length > 0 &&
    resolve(dataRoot) === dataRoot, "ABSOLUTE_NORMALIZED_DATA_ROOT_REQUIRED");
  assert(typeof runId === "string" && RUN_ID_PATTERN.test(runId), "INVALID_RUN_ID");
  return { dataRoot, runId, runDirectory: join(dataRoot, runId) };
}

async function assertWritableRunLocation(dataRoot, runId) {
  const { runDirectory } = validateLocation(dataRoot, runId);
  const root = await lstat(dataRoot);
  assert(root.isDirectory() && !root.isSymbolicLink(), "INVALID_DATA_ROOT");
  assert(await realpath(dataRoot) === dataRoot, "DATA_ROOT_NOT_CANONICAL");
  try {
    await lstat(runDirectory);
    throw new Error("EVIDENCE_PATH_ALREADY_EXISTS");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await access(dataRoot, constants.W_OK | constants.X_OK);
  return runDirectory;
}

async function readResearchModules(modelPairId) {
  if (modelPairId === SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR) {
    const [comparisonBytes, entryConfirmationBytes, fiveMinuteTrendBytes] =
      await Promise.all([
        readFile(join(ROOT, "scripts/spot-paper-research/comparison.mjs")),
        readFile(join(ROOT, "scripts/spot-paper-research/entry-confirmation.mjs")),
        readFile(join(ROOT, "scripts/spot-paper-research/five-minute-trend.mjs"))
      ]);
    assert([comparisonBytes, entryConfirmationBytes, fiveMinuteTrendBytes]
      .every(bytes => bytes.byteLength <= MAX_SOURCE_BYTES), "RESEARCH_SOURCE_TOO_LARGE");
    const {nextRunResearchSourceDigest} =
      await import("./next-run-composition.mjs");
    const researchSourceSha256 = nextRunResearchSourceDigest({
      comparisonBytes, entryConfirmationBytes, fiveMinuteTrendBytes
    });
    assert(researchSourceSha256 ===
      SPOT_PAPER_PAIRED_NEXT_RUN_ACCEPTED_RESEARCH_SOURCE_SHA256,
    "RESEARCH_SOURCE_IDENTITY_MISMATCH");
    const [comparisonExports, confirmationExports, trendExports] = await Promise.all([
      import("../spot-paper-research/comparison.mjs"),
      import("../spot-paper-research/entry-confirmation.mjs"),
      import("../spot-paper-research/five-minute-trend.mjs")
    ]);
    return {comparisonExports, confirmationExports, trendExports,
      researchSourceSha256};
  }
  assert(modelPairId === undefined, "UNKNOWN_MODEL_PAIR");
  if (!/^[a-f0-9]{64}$/.test(
    SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256 ?? "")) {
    throw new Error("RESEARCH_INTEGRATION_NOT_ACCEPTED");
  }
  const comparisonPath = join(ROOT, "scripts/spot-paper-research/comparison.mjs");
  const confirmationPath = join(ROOT, "scripts/spot-paper-research/entry-confirmation.mjs");
  const [comparisonBytes, entryConfirmationBytes] = await Promise.all([
    readFile(comparisonPath), readFile(confirmationPath)
  ]);
  assert(comparisonBytes.byteLength <= MAX_SOURCE_BYTES &&
    entryConfirmationBytes.byteLength <= MAX_SOURCE_BYTES, "RESEARCH_SOURCE_TOO_LARGE");
  const researchSourceSha256 = pairedResearchSourceDigest({
    comparisonBytes, entryConfirmationBytes
  });
  assert(researchSourceSha256 === SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256,
    "RESEARCH_SOURCE_IDENTITY_MISMATCH");
  const [comparisonExports, challengerExports] = await Promise.all([
    import("../spot-paper-research/comparison.mjs"),
    import("../spot-paper-research/entry-confirmation.mjs")
  ]);
  return { comparisonExports, challengerExports, researchSourceSha256 };
}

async function sourceDigest(modelPairId) {
  const hash = createHash("sha256");
  const paths = modelPairId === SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR ? [
    ...SOURCE_FILES,
    "scripts/spot-paper-paired/next-run-composition.mjs",
    "scripts/spot-paper-research/five-minute-trend.mjs"
  ] : SOURCE_FILES;
  for (const relativePath of paths) {
    const bytes = await readFile(join(ROOT, relativePath));
    assert(bytes.byteLength <= MAX_SOURCE_BYTES, "HOST_SOURCE_TOO_LARGE");
    hash.update(relativePath).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex");
}

export async function composeSpotPaperPairedHost({
  dataRoot, runId, accountContractId, modelPairId
} = {}) {
  const runDirectory = await assertWritableRunLocation(dataRoot, runId);
  assert(typeof accountContractId === "string", "ACCOUNT_CONTRACT_SELECTION_REQUIRED");
  const accountContract = resolveSpotPaperPairedAccountContract(accountContractId);
  if (accountContract.version === 2) {
    assert(modelPairId === SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR,
      "MODEL_PAIR_SELECTION_REQUIRED");
  } else {
    assert(modelPairId === undefined, "MODEL_PAIR_ACCOUNT_CONTRACT_MISMATCH");
  }
  const {comparisonExports, challengerExports, confirmationExports, trendExports,
    researchSourceSha256} = await readResearchModules(modelPairId);
  const accountIds = {
    baseline: `${runId}-baseline`,
    challenger: `${runId}-challenger`,
    cash: `${runId}-cash`
  };
  const sourceSha256 = await sourceDigest(modelPairId);
  let config;
  if (modelPairId === SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR) {
    const {createSpotPaperPairedNextRunConfig} =
      await import("./next-run-composition.mjs");
    config = createSpotPaperPairedNextRunConfig({
      runId, dataRoot, sourceSha256, researchSourceSha256,
      provider: {sourceId: SPOT_PAPER_PAIRED_SOURCE_ID},
      confirmationExports, trendExports, accountIds, testOnly: false,
      ...SPOT_PAPER_PAIRED_HOST_DEFAULTS
    });
  } else {
    const comparisonEngine = {
      id: SPOT_PAPER_RESEARCH_COMPARISON_ID,
      compare: comparisonExports.compareSpotPaperStrategies
    };
    const arms = [
      createBaselineArm(accountIds.baseline, accountContract),
      createChallengerArm(challengerExports, accountIds.challenger,
        accountContract),
      createCashControlArm(accountIds.cash, accountContract)
    ];
    assert(arms.every(arm =>
      JSON.stringify(arm.accountContract) === JSON.stringify(accountContract)),
    "ACCOUNT_CONTRACT_MISMATCH");
    config = {
      runId, dataRoot, sourceSha256, researchSourceSha256,
      configSha256: "0".repeat(64),
      provider: {sourceId: SPOT_PAPER_PAIRED_SOURCE_ID},
      accountContract, arms, challengerExports, comparisonExports, comparisonEngine,
      ...SPOT_PAPER_PAIRED_HOST_DEFAULTS,
      feeBpsPerSide: accountContract.feeBpsPerSide
    };
    config.configSha256 = pairedConfigDigest(config);
  }
  const expectedIdentity = {
    schemaVersion: "SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_V1",
    runId, pair: SPOT_PAPER_PAIRED.pair,
    sourceSha256: config.sourceSha256,
    configSha256: config.configSha256,
    researchSourceSha256: config.researchSourceSha256,
    feedSourceId: config.provider.sourceId,
    comparisonEngineId: config.comparisonEngine.id,
    ...(modelPairId ? {modelPairId} : {}),
    models: config.arms.map(({role, modelId, accountId}) =>
      ({role, modelId, accountId}))
  };
  return {
    runId, dataRoot, runDirectory, accountIds,
    ...(modelPairId ? {modelPairId} : {}),
    accountContract,
    accountContractId: accountContract.contractId ?? "BTC_EUR_PAIRED_PAPER_V1",
    accountContractVersion: accountContract.version ?? 1,
    feeBpsPerSide: accountContract.feeBpsPerSide,
    slippageBpsPerSide: accountContract.slippageBpsPerSide,
    sourceSha256: config.sourceSha256,
    researchSourceSha256, configSha256: config.configSha256,
    expectedIdentity,
    maxCycles: config.maxCycles, maxRequests: config.maxRequests,
    maxBytes: config.maxBytes, maxResponseBytes: config.maxResponseBytes,
    maxDurationMs: config.maxDurationMs,
    requestTimeoutMs: config.requestTimeoutMs,
    pollIntervalMs: config.pollIntervalMs
  };
}

export async function runSpotPaperPairedWithSignals(run, {
  signalSource = process
} = {}) {
  const controller = new AbortController();
  const onSigterm = () => controller.abort(new Error("SIGTERM"));
  signalSource.once("SIGTERM", onSigterm);
  try {
    return await run(controller.signal);
  } finally {
    signalSource.removeListener("SIGTERM", onSigterm);
  }
}

export async function runSpotPaperPairedHost(options = {}, {
  signalSource = process
} = {}) {
  const composition = await composeSpotPaperPairedHost(options);
  return runSpotPaperPairedWithSignals(signal =>
    runSpotPaperPaired({ ...composition, signal }), { signalSource });
}

function inspectionContext() {
  const monotonicNow = () => performance.now();
  return { monotonicNow, deadlineAt: monotonicNow() + MAX_STATUS_MS };
}

export async function inspectSpotPaperPairedRun({ dataRoot, runId } = {}, {
  includeReport = false, includeJournal = false
} = {}) {
  const { runDirectory } = validateLocation(dataRoot, runId);
  const rootInfo = await lstat(dataRoot).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!rootInfo) return { status: "NOT_FOUND", runId, verifiedTerminal: false };
  assert(rootInfo.isDirectory() && !rootInfo.isSymbolicLink() &&
    await realpath(dataRoot) === dataRoot, "INVALID_DATA_ROOT");
  const context = inspectionContext();
  let directory;
  try {
    directory = await lstat(runDirectory);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { status: "NOT_FOUND", runId, verifiedTerminal: false };
    }
    throw error;
  }
  assert(directory.isDirectory() && !directory.isSymbolicLink(),
    "INVALID_RUN_DIRECTORY");
  const journalPath = join(runDirectory, "journal.json");
  const journalInfo = await lstat(journalPath).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (journalInfo) {
    assert(journalInfo.isFile() && !journalInfo.isSymbolicLink(),
      "INVALID_JOURNAL_FILE");
    assert(journalInfo.size <= MAX_JOURNAL_BYTES, "JOURNAL_SIZE_LIMIT");
  }
  const [lock, pending] = await Promise.all([
    lstat(join(runDirectory, "writer.lock")).then(() => true)
      .catch(error => error.code === "ENOENT" ? false : Promise.reject(error)),
    lstat(join(runDirectory, "journal.pending")).then(() => true)
      .catch(error => error.code === "ENOENT" ? false : Promise.reject(error))
  ]);
  const journal = await readRunJournal({
    dataRoot, runId, deadlineAt: context.deadlineAt,
    monotonicNow: context.monotonicNow
  });
  const terminal = journal.events.at(-1)?.type === "terminal" ?
    journal.events.at(-1) : null;
  const verifiedTerminal = !lock && !pending &&
    journal.reconciliationStatus === "READ_ONLY_VERIFIED" &&
    terminal?.report?.runId === runId;
  const journalExport = includeJournal ? {
    schemaVersion: journal.schemaVersion,
    runId: journal.runId,
    sequence: journal.sequence,
    checkpoint: journal.checkpoint,
    manifest: journal.manifest,
    events: journal.events,
    reconciliationStatus: journal.reconciliationStatus
  } : undefined;
  return {
    schemaVersion: "SPOT_PAPER_PAIRED_HOST_STATUS_V1",
    status: verifiedTerminal ? "TERMINAL_JOURNAL_VERIFIED" :
      lock ? "WRITER_LOCK_PRESENT" : "INCOMPLETE_UNKNOWN",
    runId, runDirectory, verifiedTerminal,
    writerLockPresent: lock, pendingPublication: pending,
    reconciliationStatus: journal.reconciliationStatus,
    sequence: journal.sequence,
    report: includeReport && terminal ? terminal.report : undefined,
    journalExport
  };
}

function parseArgs(argv) {
  const [command = "disabled", ...rest] = argv;
  assert(["disabled", "identity", "run", "status", "report", "export", "package"]
    .includes(command),
    "UNKNOWN_HOST_COMMAND");
  const values = {};
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index];
    assert(["--data-root",     "--run-id", "--archive", "--manifest", "--account-contract",
      "--model-pair", "--retrieval-window-ms"].includes(key),
      `UNKNOWN_ARGUMENT:${key}`);
    assert(!Object.hasOwn(values, key), `DUPLICATE_ARGUMENT:${key}`);
    const value = rest[++index];
    assert(value && !value.startsWith("--"), `VALUE_REQUIRED:${key}`);
    values[key] = value;
  }
  const allowed = command === "package" ?
    ["--data-root", "--run-id", "--archive", "--manifest", "--retrieval-window-ms"] :
    ["--data-root", "--run-id",
      ...(command === "run" || command === "identity" ?
        ["--account-contract", "--model-pair"] : [])];
  assert(Object.keys(values).every(key => allowed.includes(key)),
    "ARGUMENT_NOT_VALID_FOR_COMMAND");
  if (command === "disabled") {
    assert(rest.length === 0, "DISABLED_TAKES_NO_ARGUMENTS");
  } else {
    assert(values["--data-root"], "DATA_ROOT_REQUIRED");
    if (command !== "package") assert(values["--run-id"], "RUN_ID_REQUIRED");
    if (command === "run" || command === "identity") {
      assert(values["--account-contract"], "ACCOUNT_CONTRACT_SELECTION_REQUIRED");
      if (values["--account-contract"] ===
          SPOT_PAPER_PAIRED_NEXT_RUN_ACCOUNT_CONTRACT.contractId) {
        assert(values["--model-pair"], "MODEL_PAIR_SELECTION_REQUIRED");
      } else {
        assert(values["--model-pair"] === undefined,
          "MODEL_PAIR_ACCOUNT_CONTRACT_MISMATCH");
      }
    }
    if (command === "package") {
      assert(values["--run-id"] && values["--archive"] && values["--manifest"],
        "PACKAGE_ARGUMENTS_REQUIRED");
      if (values["--retrieval-window-ms"] !== undefined) {
        const hold = Number(values["--retrieval-window-ms"]);
        assert(Number.isSafeInteger(hold) && hold >= 1 && hold <= 300_000,
          "INVALID_RETRIEVAL_WINDOW");
        values["--retrieval-window-ms"] = hold;
      }
    } else {
      assert(values["--retrieval-window-ms"] === undefined,
        "RETRIEVAL_WINDOW_ONLY_FOR_PACKAGE");
    }
  }
  return { command, values };
}

export async function main(argv = process.argv.slice(2), {
  output = process.stdout, signalSource = process
} = {}) {
  const { command, values } = parseArgs(argv);
  const {
    "--data-root": dataRoot, "--run-id": runId,
    "--account-contract": accountContractId,
    "--model-pair": modelPairId
  } = values;
  let result;
  let retrievalWindowMs = 0;
  if (command === "disabled") {
    result = {
      status: "DISABLED",
      reason: SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256 ?
        "NO_RUN_REQUESTED" : "RESEARCH_INTEGRATION_NOT_ACCEPTED",
      liveTrading: false, executionImpact: false, autoPromotion: false
    };
  } else if (command === "run") {
    result = await runSpotPaperPairedHost({
      dataRoot, runId, accountContractId, modelPairId
    }, { signalSource });
  } else if (command === "identity") {
    const composition = await composeSpotPaperPairedHost({
      dataRoot, runId, accountContractId, modelPairId
    });
    result = composition.expectedIdentity;
  } else if (command === "status" || command === "report" || command === "export") {
    result = await inspectSpotPaperPairedRun({ dataRoot, runId }, {
      includeReport: command !== "status",
      includeJournal: command === "export"
    });
    if (command === "export") {
      result = {
        schemaVersion: "SPOT_PAPER_PAIRED_HOST_EXPORT_V1",
        runId: result.runId,
        status: result.status,
        verifiedTerminal: result.verifiedTerminal,
        reconciliationStatus: result.reconciliationStatus,
        report: result.report ?? null,
        journal: result.journalExport ?? null
      };
      assert(Buffer.byteLength(JSON.stringify(result), "utf8") <=
        MAX_JOURNAL_BYTES * 2, "HOST_EXPORT_BYTE_LIMIT");
    }
  } else {
    const evidenceDir = validateLocation(dataRoot, runId).runDirectory;
    const lockPresent = await lstat(join(evidenceDir, "writer.lock"))
      .then(() => true).catch(error => error.code === "ENOENT" ? false : Promise.reject(error));
    const pending = await lstat(join(evidenceDir, "journal.pending"))
      .then(() => true).catch(error => error.code === "ENOENT" ? false : Promise.reject(error));
    assert(!lockPresent && !pending, "EVIDENCE_NOT_QUIESCENT");
    result = await packageHostEvidence({
      evidenceDir,
      archivePath: values["--archive"],
      manifestPath: values["--manifest"],
      timeoutMs: 60_000
    });
    retrievalWindowMs = values["--retrieval-window-ms"] ?? 0;
    result = { ...result, retrievalWindowMs };
  }
  output.write(`${JSON.stringify(result, null, 2)}\n`);
  if (retrievalWindowMs > 0) {
    await new Promise(resolve => setTimeout(resolve, retrievalWindowMs));
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message ?? error}\n`);
    process.exitCode = 1;
  });
}
