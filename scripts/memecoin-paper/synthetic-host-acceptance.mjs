import {createHash, randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {lstat, mkdir, open, realpath} from "node:fs/promises";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {fileURLToPath, pathToFileURL} from "node:url";
import {canonicalCheckpointBytes} from "./checkpoint-store.mjs";
import {
  createPaperPilotComposition, createSyntheticClock, offlineFixtureAdapters
} from "./paper-pilot-composition.mjs";
import {readBoundedPrivateFile} from "../memecoin-paper-export-host.mjs";
import {
  createExportTransfer, createFileReceiver, createInProcessTransport
} from "../memecoin-paper-run-export-transfer/index.mjs";
import {
  createHttpsExportTransport, readExportOverHttps
} from "../memecoin-paper-run-export-https/https.mjs";
import {evaluateMemecoinPaperRunExport} from "../memecoin-paper-simulated-evaluation/index.mjs";

const PRODUCER_REVISION = "paper-pilot-composition/3";
const PROOFS = new Set(["PIPELINE_QUOTE", "ACTIVE_STOP", "REAL_SIGNAL_CHILD"]);
const BUDGETS = Object.freeze({
  requests: 40, bytes: 1_000_000, events: 128, candidates: 4, cycles: 8,
  durationMs: 20_000, callbackTimeoutMs: 1_000, maxWallClockUncertaintyMs: 10
});
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const MAX_ACCEPTANCE_MS = 60_000;
const REAL_SIGNAL_HANDSHAKE_MS = 25_000;

function requireProof(condition) {
  if (!condition) throw new Error("synthetic acceptance contract not satisfied");
}

function acceptanceOperation({
  timeoutMs = MAX_ACCEPTANCE_MS, monotonicNow = () => performance.now(),
  fileSystem = {}, signalSource = process
} = {}) {
  requireProof(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_ACCEPTANCE_MS);
  const fs = {lstat, mkdir, open, realpath, ...fileSystem};
  const controller = new AbortController();
  const failure = new Error("acceptance operation ended");
  failure.code = "ACCEPTANCE_UNKNOWN";
  const start = monotonicNow();
  requireProof(Number.isFinite(start));
  const deadline = start + timeoutMs;
  let previous = start;
  let stopPilot;
  const cancel = () => controller.abort(failure);
  const check = () => {
    const now = monotonicNow();
    if (!Number.isFinite(now) || now < previous || now >= deadline) cancel();
    previous = now;
    if (controller.signal.aborted) throw failure;
  };
  const onSignal = () => {
    if (stopPilot) stopPilot();
    else cancel();
  };
  signalSource.on("SIGINT", onSignal);
  signalSource.on("SIGTERM", onSignal);
  const timer = setTimeout(cancel, timeoutMs);
  const cleanup = handle => {
    // Closing is best effort; a stalled close must not extend the operation.
    try { Promise.resolve(handle.close()).catch(() => {}); } catch {}
  };
  const wait = async (action, lateCleanup) => {
    check();
    let onAbort;
    const cancelled = new Promise((resolve, reject) => {
      onAbort = () => reject(failure);
      controller.signal.addEventListener("abort", onAbort, {once: true});
    });
    const pending = Promise.resolve().then(() => {
      check();
      return action();
    });
    let delivered = false;
    try {
      const value = await Promise.race([pending, cancelled]);
      check();
      delivered = true;
      return value;
    } finally {
      controller.signal.removeEventListener("abort", onAbort);
      if (!delivered && lateCleanup) pending.then(lateCleanup, () => {});
    }
  };
  const openFile = async (...args) => {
    const handle = await wait(() => fs.open(...args), cleanup);
    let closing = false;
    return {
      writeFile: (...values) => wait(() => handle.writeFile(...values)),
      sync: () => wait(() => handle.sync()),
      stat: () => wait(() => handle.stat()),
      read: (...values) => wait(() => handle.read(...values)),
      close: async () => {
        if (closing) return;
        closing = true;
        if (controller.signal.aborted) {
          cleanup(handle);
          return;
        }
        let submitted = false;
        try {
          await wait(() => {
            submitted = true;
            return handle.close();
          });
        } catch (error) {
          if (!submitted) cleanup(handle);
          throw error;
        }
      }
    };
  };
  return {
    check, wait, open: openFile, signal: controller.signal,
    lstat: filename => wait(() => fs.lstat(filename)),
    realpath: filename => wait(() => fs.realpath(filename)),
    mkdir: (...args) => wait(() => fs.mkdir(...args)),
    read: (filename, maximum) => wait(() => readBoundedPrivateFile(
      filename, maximum, {openFile}
    )),
    setPilotStop: stop => { stopPilot = stop; },
    dispose() {
      clearTimeout(timer);
      signalSource.removeListener("SIGINT", onSignal);
      signalSource.removeListener("SIGTERM", onSignal);
      cancel();
    }
  };
}

async function withAcceptanceOperation(options, action) {
  const operation = acceptanceOperation(options);
  try {
    const result = await action(operation);
    operation.check();
    return result;
  } catch (error) {
    if (operation.signal.aborted) {
      return {summary: {status: "UNKNOWN", code: "SYNTHETIC_ACCEPTANCE_FAILED"}};
    }
    throw error;
  } finally {
    operation.dispose();
  }
}

async function writeNew(directory, name, bytes, operation) {
  const filename = path.join(directory, name);
  const handle = await operation.open(filename, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const parent = await operation.open(directory, "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
  requireProof((await operation.read(filename, 16 * 1024 * 1024)).equals(bytes));
}

export async function transferSyntheticAcceptance(options) {
  const {summary, outcome} = await withAcceptanceOperation(options, async operation => ({
    outcome: await transferAcceptance(options, operation)
  }));
  return summary ? {status: summary.status} : outcome;
}

async function transferAcceptance({
  exportBytes, expected, privateOrigin, transport, writeAuthorization, readAuthorization,
  attemptDirectory
}, operation) {
  requireProof(typeof writeAuthorization === "string" && typeof readAuthorization === "string" &&
    writeAuthorization !== readAuthorization);
  const transfer = createExportTransfer({enabled: true, privateOrigin, transport});
  if (evaluateMemecoinPaperRunExport(exportBytes, expected).overall === "FAIL") {
    return {status: "REJECTED"};
  }
  try {
    await writeNew(attemptDirectory, "https-attempt.json", canonicalCheckpointBytes({
      ...expected, exportSha256: digest(exportBytes), byteLength: exportBytes.length
    }), operation);
  } catch {
    return {status: "UNKNOWN"};
  }
  const upload = await operation.wait(() => transfer.transfer({
    exportBytes, expected, writeAuthorization, explicitlyAuthorized: true, signal: operation.signal
  }));
  if (upload.status !== "TRANSFER_ACKNOWLEDGED") return {status: upload.status};
  const readback = await operation.wait(() => readExportOverHttps({
    transport, privateOrigin, expected,
    expectedExportSha256: digest(exportBytes),
    expectedByteLength: exportBytes.byteLength,
    readAuthorization, signal: operation.signal
  }));
  if (readback.status !== "READ_BACK") return {status: readback.status};
  requireProof(readback.bytes.equals(exportBytes));
  return {status: "READ_BACK", overall: readback.evaluation.overall};
}

export async function runSyntheticHostAcceptance(options = {}) {
  if (options.enabled !== true) return {summary: {status: "DISABLED", executionStarted: false}};
  return withAcceptanceOperation(options, operation => runAcceptance(options, operation));
}

function waitForSignalAfterEntry(signalSource, signal, notifyParent) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action, value) => {
      if (settled) return;
      settled = true;
      signalSource.removeListener("SIGTERM", onSignal);
      signal.removeEventListener("abort", onAbort);
      action(value);
    };
    const onSignal = () => finish(resolve);
    const onAbort = () => finish(reject, signal.reason ?? new Error("signal drill ended"));
    signalSource.once("SIGTERM", onSignal);
    signal.addEventListener("abort", onAbort, {once: true});
    if (signal.aborted) onAbort();
    else Promise.resolve().then(notifyParent).catch(error => finish(reject, error));
  });
}

async function runAcceptance({
  dataRoot, proof = "PIPELINE_QUOTE", httpsOptions, signalSource = process, sendHandshake
}, operation) {
  requireProof(PROOFS.has(proof) && typeof dataRoot === "string" &&
    path.isAbsolute(dataRoot) && path.normalize(dataRoot) === dataRoot);
  const info = await operation.lstat(dataRoot);
  requireProof(info.isDirectory() && !info.isSymbolicLink() &&
    info.uid === process.getuid() && [0o700, 0o2700].includes(info.mode & 0o7777) &&
    await operation.realpath(dataRoot) === dataRoot);
  const runId = `synthetic-${randomUUID()}`;
  const directory = path.join(dataRoot, runId);
  await operation.mkdir(directory, {mode: 0o700});
  const rootHandle = await operation.open(dataRoot, "r");
  try {
    await rootHandle.sync();
  } finally {
    await rootHandle.close();
  }
  const config = {
    version: 1, mode: "SYNTHETIC_TEST_ONLY", enabled: true, runId,
    startedAt: Date.now() - 5_000, budgets: {...BUDGETS}
  };
  const configBytes = canonicalCheckpointBytes(config);
  const expected = {
    runId, configSha256: digest(configBytes), producerRevision: PRODUCER_REVISION
  };
  await writeNew(directory, "config.json", configBytes, operation);
  const dataDirectory = path.join(directory, "state");
  await operation.mkdir(dataDirectory, {mode: 0o700});
  const makePilot = onTestEntry => {
    const clock = createSyntheticClock({wallStart: config.startedAt + 5_000});
    return createPaperPilotComposition({
      config, dataDirectory, clock,
      adapters: offlineFixtureAdapters({clock, fault: "PIPELINE_QUOTE"}),
      onTestEntry, signal: operation.signal
    });
  };
  let stopAccepted = false;
  const signalProof = {observedAfterFill: false, receiptSha256: null};
  const stop = () => { stopAccepted = pilot.stop() || stopAccepted; };
  const onTestEntry = proof === "ACTIVE_STOP" ? stop
    : proof === "REAL_SIGNAL_CHILD" ? async entry => {
      requireProof(typeof sendHandshake === "function" &&
        entry?.status === "FILLED_PAPER" && entry.receipt);
      const checkpointBytes = await operation.read(
        path.join(dataDirectory, "checkpoint.json"), 8 * 1024 * 1024
      );
      const checkpoint = parseCanonical(checkpointBytes);
      const checkpointSequence = entry.receipt.sequence;
      requireProof(Number.isSafeInteger(checkpointSequence) && checkpointSequence >= 0 &&
        checkpoint.sequence === checkpointSequence && Array.isArray(checkpoint.records) &&
        checkpointSequence < checkpoint.records.length);
      const checkpointRecord = checkpoint.records?.[checkpointSequence];
      const acknowledgedCheckpoint = {
        formatVersion: checkpoint.formatVersion,
        runHeader: checkpoint.runHeader,
        records: checkpoint.records?.slice(0, checkpointSequence + 1),
        sequence: checkpointSequence
      };
      const checkpointSha256 = digest(canonicalCheckpointBytes(acknowledgedCheckpoint));
      requireProof(
        checkpointSha256 === digest(checkpointBytes) &&
        entry.receipt.hash === checkpointSha256 &&
        checkpointRecord?.method === "executeEntry" &&
        checkpointRecord.resultDigest === entry.receipt.resultDigest &&
        checkpointRecord.runId === runId);
      const receiptSha256 = digest(canonicalCheckpointBytes(entry.receipt));
      const acknowledgement = {
        protocol: "synthetic-real-sigterm/v1", runId, status: entry.status, receiptSha256,
        checkpointSha256, checkpointSequence
      };
      const acknowledgementBytes = canonicalCheckpointBytes(acknowledgement);
      await writeNew(directory, "fill-acknowledged.json", acknowledgementBytes, operation);
      signalProof.receiptSha256 = receiptSha256;
      await waitForSignalAfterEntry(signalSource, operation.signal, () => sendHandshake({
        ...acknowledgement, acknowledgementSha256: digest(acknowledgementBytes), pid: process.pid
      }));
      signalProof.observedAfterFill = true;
    } : undefined;
  const pilot = makePilot(onTestEntry);
  operation.setPilotStop(stop);
  let result;
  try {
    result = await operation.wait(() => pilot.start());
  } finally {
    operation.setPilotStop(null);
  }
  const exportBytes = canonicalCheckpointBytes(result.report);
  await writeNew(directory, "result.report.json", exportBytes, operation);
  const evaluation = evaluateMemecoinPaperRunExport(exportBytes, expected);
  const operations = result.report.runnerReport?.operationResults ?? [];
  const stoppingProof = proof === "ACTIVE_STOP" || proof === "REAL_SIGNAL_CHILD";
  const expectedOverall = stoppingProof ? "UNKNOWN" : "PASS";
  requireProof(evaluation.overall === expectedOverall &&
    !evaluation.checks.some(item => item.status === "FAIL") &&
    result.report.persistence === "ACKNOWLEDGED" &&
    operations.some(item => item.method === "executeEntry" && item.status === "FILLED_PAPER"));
  if (stoppingProof) {
    requireProof(stopAccepted && result.status === "STOPPED" &&
      evaluation.outcome === "OPEN_UNVALUED_TERMINAL_POSITION" &&
      result.report.runnerReport.reason === "SHUTDOWN" &&
      result.report.runnerReport.terminalResult.openPositions.length === 1 &&
      result.report.runnerReport.terminalResult.openPositions[0].markStatus === "VALUATION_UNAVAILABLE");
    if (proof === "REAL_SIGNAL_CHILD") requireProof(signalProof.observedAfterFill);
  } else {
    requireProof(result.status === "FINISHED" &&
      evaluation.outcome === "SIMULATED_ENTRY_EXIT_COMPLETE" &&
      operations.some(item => item.method === "observeExitQuote" && item.status === "CLOSED_PAPER"));
  }
  const checkpointBeforeRestart = await operation.read(
    path.join(dataDirectory, "checkpoint.json"), 8 * 1024 * 1024
  );
  const restart = await operation.wait(() => makePilot().start());
  requireProof(restart.code === "RESTART_NOT_ALLOWED" && restart.executionStarted === false);
  requireProof((await operation.read(
    path.join(dataDirectory, "checkpoint.json"), 8 * 1024 * 1024
  )).equals(checkpointBeforeRestart));

  const privateOrigin = "https://synthetic.invalid";
  const receiver = createFileReceiver({
    directory: path.join(directory, "receiver"), privateOrigin,
    authorizeWrite: value => value === "synthetic-write",
    authorizeRead: value => value === "synthetic-read"
  });
  const transfer = createExportTransfer({
    enabled: true, privateOrigin, transport: createInProcessTransport(receiver)
  });
  const upload = await operation.wait(() => transfer.transfer({
    exportBytes, expected, writeAuthorization: "synthetic-write", explicitlyAuthorized: true,
    signal: operation.signal
  }));
  requireProof(upload.status === "TRANSFER_ACKNOWLEDGED");
  const readback = await operation.wait(() => transfer.readback({
    expected, readAuthorization: "synthetic-read", signal: operation.signal
  }));
  requireProof(readback.status === "READ_BACK" && readback.bytes.equals(exportBytes) &&
    readback.evaluation.overall === expectedOverall);
  const remote = httpsOptions
    ? await transferAcceptance({
      ...httpsOptions, exportBytes, expected, attemptDirectory: directory
    }, operation)
    : {status: "DISABLED"};
  const summary = {
    status: remote.status === "DISABLED" || remote.status === "READ_BACK"
      ? remote.status === "READ_BACK" && remote.overall !== expectedOverall ? "BLOCKED" : expectedOverall
      : remote.status === "UNKNOWN" ? "UNKNOWN" : "BLOCKED",
    contractChecks: "PASS",
    proof: `SYNTHETIC_${proof}`, ...expected, exportSha256: digest(exportBytes),
    byteLength: exportBytes.length, evaluation: evaluation.overall, outcome: evaluation.outcome,
    entryFills: evaluation.evidence.entryFills, exits: evaluation.evidence.exits,
    stopAccepted, restartDenied: true, immutableReadback: true, https: remote,
    ...(proof === "REAL_SIGNAL_CHILD" ? {
      signalProof: {
        observedAfterFill: signalProof.observedAfterFill,
        receiptSha256: signalProof.receiptSha256,
        lifecycleStatus: result.status,
        runnerReason: result.report.runnerReport.reason
      }
    } : {}),
    hostAcceptance: "NOT_ASSESSED", providerTrust: "NOT_ASSESSED", liveExecution: false
  };
  await writeNew(directory, "summary.json", canonicalCheckpointBytes(summary), operation);
  return {summary, result, exportBytes, directory};
}

function childHandshakeWait(child, timeoutMs) {
  let removeListeners = () => {};
  let timer;
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeListeners();
      action(value);
    };
    const onMessage = message => finish(resolve, message);
    const onError = error => finish(reject, error);
    const onExit = () => finish(reject, new Error("signal drill child exited before fill acknowledgement"));
    removeListeners = () => {
      child.removeListener("message", onMessage);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
    };
    child.once("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
    timer = setTimeout(() => finish(reject, new Error("fill acknowledgement timed out")), timeoutMs);
  });
  return {
    promise,
    cancel() {
      clearTimeout(timer);
      removeListeners();
    }
  };
}

function childExitWait(child) {
  let removeListeners = () => {};
  const promise = new Promise((resolve, reject) => {
    const finish = action => {
      removeListeners();
      action();
    };
    const onExit = (code, signal) => finish(() => resolve({code, signal}));
    const onError = error => finish(() => reject(error));
    removeListeners = () => {
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
    };
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({code: child.exitCode, signal: child.signalCode});
    } else {
      child.once("exit", onExit);
      child.once("error", onError);
    }
  });
  return {promise, cancel: () => removeListeners()};
}

function detachChild(child) {
  if (child.connected) child.disconnect();
  child.unref();
}

function parseCanonical(bytes) {
  const value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  requireProof(canonicalCheckpointBytes(value).equals(bytes));
  return value;
}

async function realSignalDrill({dataRoot}, operation) {
  let directory;
  let child;
  let handshakeWait;
  let exitWait;
  let childExited = false;
  let drillId;
  try {
    requireProof(typeof dataRoot === "string" && path.isAbsolute(dataRoot) &&
      path.normalize(dataRoot) === dataRoot);
    const info = await operation.lstat(dataRoot);
    requireProof(info.isDirectory() && !info.isSymbolicLink() &&
      info.uid === process.getuid() && [0o700, 0o2700].includes(info.mode & 0o7777) &&
      await operation.realpath(dataRoot) === dataRoot);
    drillId = `real-signal-${randomUUID()}`;
    directory = path.join(dataRoot, drillId);
    await operation.mkdir(directory, {mode: 0o700});
    const rootHandle = await operation.open(dataRoot, "r");
    try {
      await rootHandle.sync();
    } finally {
      await rootHandle.close();
    }
    await writeNew(directory, "drill-started.json", canonicalCheckpointBytes({
      protocol: "synthetic-real-sigterm/v1", drillId, status: "STARTED"
    }), operation);

    child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      env: {
        PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: directory,
        PAPER_SYNTHETIC_ACCEPTANCE_PROOF: "REAL_SIGNAL_CHILD",
        PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_CHILD: "true"
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    });
    handshakeWait = childHandshakeWait(child, REAL_SIGNAL_HANDSHAKE_MS);
    requireProof(Number.isSafeInteger(child.pid) && child.pid > 0);
    await writeNew(directory, "child-started.json", canonicalCheckpointBytes({
      pid: child.pid, executable: process.execPath, entrypoint: fileURLToPath(import.meta.url)
    }), operation);
    const handshake = await operation.wait(() => handshakeWait.promise);
    requireProof(handshake && handshake.protocol === "synthetic-real-sigterm/v1" &&
      handshake.status === "FILLED_PAPER" && handshake.pid === child.pid &&
      typeof handshake.runId === "string" && /^synthetic-[0-9a-f-]{36}$/.test(handshake.runId) &&
      /^[0-9a-f]{64}$/.test(handshake.acknowledgementSha256) &&
      /^[0-9a-f]{64}$/.test(handshake.receiptSha256) &&
      /^[0-9a-f]{64}$/.test(handshake.checkpointSha256) &&
      Number.isSafeInteger(handshake.checkpointSequence) && handshake.checkpointSequence >= 0);

    const childDirectory = path.join(directory, handshake.runId);
    const childInfo = await operation.lstat(childDirectory);
    requireProof(childInfo.isDirectory() && !childInfo.isSymbolicLink() &&
      childInfo.uid === process.getuid() && [0o700, 0o2700].includes(childInfo.mode & 0o7777) &&
      await operation.realpath(childDirectory) === childDirectory);
    const acknowledgementBytes = await operation.read(
      path.join(childDirectory, "fill-acknowledged.json"), 16 * 1024
    );
    const acknowledgement = parseCanonical(acknowledgementBytes);
    requireProof(digest(acknowledgementBytes) === handshake.acknowledgementSha256 &&
      acknowledgement.protocol === handshake.protocol && acknowledgement.runId === handshake.runId &&
      acknowledgement.status === handshake.status &&
      acknowledgement.receiptSha256 === handshake.receiptSha256 &&
      acknowledgement.checkpointSha256 === handshake.checkpointSha256 &&
      acknowledgement.checkpointSequence === handshake.checkpointSequence);

    await writeNew(directory, "signal-request.json", canonicalCheckpointBytes({
      pid: child.pid, signal: "SIGTERM", runId: handshake.runId,
      acknowledgementSha256: handshake.acknowledgementSha256, attempts: 1
    }), operation);
    exitWait = childExitWait(child);
    const signalSentAtMonotonicMs = performance.now();
    const delivered = process.kill(child.pid, "SIGTERM");
    requireProof(delivered);
    await writeNew(directory, "signal-sent.json", canonicalCheckpointBytes({
      pid: child.pid, signal: "SIGTERM", signalSentAtMonotonicMs
    }), operation);
    const exit = await operation.wait(() => exitWait.promise);
    childExited = true;
    const signalToExitMs = performance.now() - signalSentAtMonotonicMs;
    requireProof(exit.code === 2 && exit.signal === null &&
      Number.isFinite(signalToExitMs) && signalToExitMs >= 0);

    const childSummary = parseCanonical(await operation.read(
      path.join(childDirectory, "summary.json"), 64 * 1024
    ));
    const configBytes = await operation.read(path.join(childDirectory, "config.json"), 16 * 1024);
    const configSha256 = digest(configBytes);
    const expected = {
      runId: handshake.runId, configSha256, producerRevision: PRODUCER_REVISION
    };
    const exportBytes = await operation.read(path.join(childDirectory, "result.report.json"), 8 * 1024 * 1024);
    const report = parseCanonical(exportBytes);
    const checkpointBytes = await operation.read(
      path.join(childDirectory, "state", "checkpoint.json"), 8 * 1024 * 1024
    );
    const checkpoint = parseCanonical(checkpointBytes);
    const readbackBytes = await operation.read(path.join(
      childDirectory, "receiver", digest(Buffer.from(handshake.runId, "utf8")), "export.json"
    ), 8 * 1024 * 1024);
    const evaluation = evaluateMemecoinPaperRunExport(exportBytes, expected);
    const operations = report.runnerReport?.operationResults ?? [];
    const openPositions = report.runnerReport?.terminalResult?.openPositions ?? [];
    const entryOperation = operations.find(item =>
      item.method === "executeEntry" && item.status === "FILLED_PAPER");
    const entryReceipt = entryOperation?.receipt;
    const acknowledgedCheckpoint = {
      formatVersion: checkpoint.formatVersion,
      runHeader: checkpoint.runHeader,
      records: checkpoint.records?.slice(0, handshake.checkpointSequence + 1),
      sequence: handshake.checkpointSequence
    };
    const acknowledgedRecord = checkpoint.records?.[handshake.checkpointSequence];
    requireProof(childSummary.status === "UNKNOWN" && childSummary.contractChecks === "PASS" &&
      childSummary.proof === "SYNTHETIC_REAL_SIGNAL_CHILD" &&
      childSummary.configSha256 === configSha256 &&
      childSummary.evaluation === "UNKNOWN" &&
      childSummary.outcome === "OPEN_UNVALUED_TERMINAL_POSITION" &&
      childSummary.entryFills === 1 && childSummary.exits === 0 &&
      childSummary.stopAccepted === true && childSummary.restartDenied === true &&
      childSummary.immutableReadback === true &&
      childSummary.signalProof?.observedAfterFill === true &&
      childSummary.signalProof?.lifecycleStatus === "STOPPED" &&
      childSummary.signalProof?.runnerReason === "SHUTDOWN" &&
      childSummary.signalProof?.receiptSha256 === handshake.receiptSha256 &&
      digest(canonicalCheckpointBytes(acknowledgedCheckpoint)) === handshake.checkpointSha256 &&
      acknowledgedRecord?.method === "executeEntry" &&
      acknowledgedRecord.resultDigest === entryReceipt?.resultDigest &&
      entryReceipt?.runId === handshake.runId &&
      entryReceipt?.sequence === handshake.checkpointSequence &&
      entryReceipt?.hash === handshake.checkpointSha256 &&
      digest(canonicalCheckpointBytes(entryReceipt)) === handshake.receiptSha256 &&
      report.persistence === "ACKNOWLEDGED" &&
      report.checkpointSha256 === digest(checkpointBytes) &&
      checkpointBytes.equals(canonicalCheckpointBytes(report.checkpoint)) &&
      readbackBytes.equals(exportBytes) &&
      report.runnerReport?.reason === "SHUTDOWN" &&
      operations.filter(item => item.method === "executeEntry" && item.status === "FILLED_PAPER").length === 1 &&
      !operations.some(item => item.method === "observeExitQuote" && item.status === "CLOSED_PAPER") &&
      openPositions.length === 1 &&
      openPositions[0].markStatus === "VALUATION_UNAVAILABLE" &&
      evaluation.overall === "UNKNOWN" &&
      evaluation.outcome === "OPEN_UNVALUED_TERMINAL_POSITION" &&
      !evaluation.checks.some(item => item.status === "FAIL") &&
      childSummary.exportSha256 === digest(exportBytes) &&
      childSummary.byteLength === exportBytes.length);

    const summary = {
      status: "UNKNOWN", contractChecks: "PASS", proof: "SYNTHETIC_REAL_SIGTERM",
      drillId, runId: handshake.runId, configSha256, producerRevision: PRODUCER_REVISION,
      exportSha256: digest(exportBytes), byteLength: exportBytes.length,
      evaluation: evaluation.overall, outcome: evaluation.outcome,
      entryFills: evaluation.evidence.entryFills, exits: evaluation.evidence.exits,
      signalDrill: {
        status: "VERIFIED", signal: "SIGTERM", targetPid: child.pid,
        signalSentExactlyOnce: true, signalObservedAfterFill: true,
        fillAcknowledged: true, signalToExitMs,
        fillCheckpointSequence: handshake.checkpointSequence,
        fillCheckpointSha256: handshake.checkpointSha256,
        fillReceiptSha256: handshake.receiptSha256,
        childExit: {code: exit.code, signal: exit.signal},
        checkpointPersistence: "ACKNOWLEDGED", restartDenied: true,
        immutableReadback: true, openUnvaluedPositions: openPositions.length
      },
      hostAcceptance: "NOT_ASSESSED", providerTrust: "NOT_ASSESSED",
      liveExecution: false, networkAccessed: false
    };
    await writeNew(directory, "signal-drill-result.json", canonicalCheckpointBytes(summary), operation);
    return {summary};
  } catch {
    const summary = {status: "UNKNOWN", code: "REAL_SIGNAL_DRILL_FAILED", drillId};
    if (directory && !operation.signal.aborted) {
      try {
        await writeNew(directory, "signal-drill-result.json", canonicalCheckpointBytes(summary), operation);
      } catch {}
    }
    return {summary};
  } finally {
    handshakeWait?.cancel();
    exitWait?.cancel();
    if (child && !childExited) detachChild(child);
    else if (child?.connected) child.disconnect();
  }
}

async function authorization(filename, operation) {
  const bytes = await operation.read(filename, 4096);
  const value = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  requireProof(!/[\u0000-\u001f\u007f]/.test(value));
  return value;
}

export async function main({
  env = process.env, stdout = process.stdout, signalSource = process, ...operationOptions
} = {}) {
  if (env.PAPER_SYNTHETIC_ACCEPTANCE_ENABLED === undefined ||
      env.PAPER_SYNTHETIC_ACCEPTANCE_ENABLED === "false") {
    stdout.write(`${JSON.stringify({status: "DISABLED", executionStarted: false})}\n`);
    return 0;
  }
  let attempted = false;
  try {
    requireProof(env.PAPER_SYNTHETIC_ACCEPTANCE_ENABLED === "true" &&
      [undefined, "false", "true"].includes(env.PAPER_SYNTHETIC_ACCEPTANCE_HTTPS_ENABLED) &&
      [undefined, "false", "true"].includes(env.PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_DRILL) &&
      [undefined, "false", "true"].includes(env.PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_CHILD));
    if (env.PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_CHILD === "true") {
      requireProof(env.PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_DRILL !== "true" &&
        env.PAPER_SYNTHETIC_ACCEPTANCE_HTTPS_ENABLED !== "true" &&
        env.PAPER_SYNTHETIC_ACCEPTANCE_PROOF === "REAL_SIGNAL_CHILD" &&
        typeof process.send === "function");
      attempted = true;
      const {summary} = await withAcceptanceOperation(
        {...operationOptions, signalSource},
        operation => runAcceptance({
          dataRoot: env.PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT,
          proof: "REAL_SIGNAL_CHILD",
          signalSource,
          sendHandshake: message => new Promise((resolve, reject) => {
            process.send(message, error => error ? reject(error) : resolve());
          })
        }, operation)
      );
      stdout.write(`${JSON.stringify(summary)}\n`);
      return summary.status === "PASS" ? 0 : 2;
    }
    if (env.PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_DRILL === "true") {
      requireProof(env.PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_CHILD !== "true" &&
        env.PAPER_SYNTHETIC_ACCEPTANCE_HTTPS_ENABLED !== "true" &&
        env.PAPER_SYNTHETIC_ACCEPTANCE_PROOF === undefined);
      attempted = true;
      const {summary} = await withAcceptanceOperation(
        {...operationOptions, signalSource},
        operation => realSignalDrill({
          dataRoot: env.PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT
        }, operation)
      );
      stdout.write(`${JSON.stringify(summary)}\n`);
      return summary.status === "PASS" ? 0 : 2;
    }
    const {summary} = await withAcceptanceOperation(
      {...operationOptions, signalSource},
      async operation => {
        let httpsOptions;
        if (env.PAPER_SYNTHETIC_ACCEPTANCE_HTTPS_ENABLED === "true") {
          const privateOrigin = env.PAPER_SYNTHETIC_ACCEPTANCE_ORIGIN;
          httpsOptions = {
            privateOrigin,
            transport: createHttpsExportTransport({
              privateOrigin,
              ca: await operation.read(env.PAPER_SYNTHETIC_ACCEPTANCE_CA_FILE, 16 * 1024)
            }),
            writeAuthorization: await authorization(
              env.PAPER_SYNTHETIC_ACCEPTANCE_WRITE_AUTH_FILE, operation
            ),
            readAuthorization: await authorization(
              env.PAPER_SYNTHETIC_ACCEPTANCE_READ_AUTH_FILE, operation
            )
          };
          requireProof(httpsOptions.writeAuthorization !== httpsOptions.readAuthorization);
        }
        attempted = true;
        return runAcceptance({
          dataRoot: env.PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT,
          proof: env.PAPER_SYNTHETIC_ACCEPTANCE_PROOF ?? "PIPELINE_QUOTE", httpsOptions
        }, operation);
      }
    );
    stdout.write(`${JSON.stringify(summary)}\n`);
    return summary.status === "PASS" ? 0 : 2;
  } catch {
    stdout.write(`${JSON.stringify({
      status: attempted ? "UNKNOWN" : "BLOCKED", code: "SYNTHETIC_ACCEPTANCE_FAILED"
    })}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
  if (process.env.PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_CHILD === "true" && process.connected) {
    process.disconnect();
  }
}
