import {createHash, randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {EventEmitter} from "node:events";
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
const PROOFS = new Set(["PIPELINE_QUOTE", "ACTIVE_STOP", "REAL_SIGNAL_CHILD", "PLATFORM_FOREGROUND"]);
const BUDGETS = Object.freeze({
  requests: 40, bytes: 1_000_000, events: 128, candidates: 4, cycles: 8,
  durationMs: 20_000, callbackTimeoutMs: 1_000, maxWallClockUncertaintyMs: 10
});
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const MAX_ACCEPTANCE_MS = 60_000;
const MAX_FOREGROUND_PHASE_MS = 60_000;
const MAX_REPLACEMENT_READBACK_MS = 15_000;
const REAL_SIGNAL_HANDSHAKE_MS = 25_000;
const NS_PER_MS = 1_000_000n;
const ACCEPTANCE_DEADLINE_ENV = "PAPER_SYNTHETIC_ACCEPTANCE_DEADLINE_HR_NS";
const FOREGROUND_ARM_PROTOCOL = "synthetic-platform-foreground-arm/v1";
const FOREGROUND_CLAIM_PROTOCOL = "synthetic-platform-foreground-claim/v2";

function requireProof(condition) {
  if (!condition) throw new Error("synthetic acceptance contract not satisfied");
}

function parseAcceptanceDeadline(value) {
  requireProof(typeof value === "string" && value.length <= 32 &&
    /^(0|[1-9][0-9]*)$/.test(value));
  const deadline = BigInt(value);
  requireProof(deadline > 0n);
  const remainingNs = deadline - process.hrtime.bigint();
  requireProof(remainingNs <= BigInt(MAX_ACCEPTANCE_MS) * NS_PER_MS);
  return {
    deadlineMonotonicNs: deadline,
    timeoutMs: remainingNs <= 0n ? 0 : Number(remainingNs / NS_PER_MS)
  };
}

export function isVerifiedRealSignalDrillReceipt(value) {
  const signal = value?.signalDrill;
  return value?.status === "UNKNOWN" && value.contractChecks === "PASS" &&
    value.proof === "SYNTHETIC_REAL_SIGTERM" &&
    value.evaluation === "UNKNOWN" && value.outcome === "OPEN_UNVALUED_TERMINAL_POSITION" &&
    value.hostAcceptance === "NOT_ASSESSED" && value.providerTrust === "NOT_ASSESSED" &&
    value.liveExecution === false && value.networkAccessed === false &&
    signal?.status === "VERIFIED" && signal.signal === "SIGTERM" &&
    Number.isSafeInteger(signal.targetPid) && signal.targetPid > 0 &&
    signal.signalSentExactlyOnce === true && signal.signalObservedAfterFill === true &&
    signal.fillAcknowledged === true && Number.isFinite(signal.sendToExitMs) &&
    signal.sendToExitMs >= 0 &&
    /^[a-f0-9]{64}$/.test(signal.fillCheckpointSha256) &&
    /^[a-f0-9]{64}$/.test(signal.fillReceiptSha256) &&
    Number.isSafeInteger(signal.fillCheckpointSequence) && signal.fillCheckpointSequence >= 0 &&
    signal.childExit?.code === 2 && signal.childExit.signal === null &&
    signal.checkpointPersistence === "ACKNOWLEDGED" && signal.restartDenied === true &&
    signal.immutableReadback === true && signal.openUnvaluedPositions === 1;
}

function acceptanceOperation({
  timeoutMs = MAX_ACCEPTANCE_MS, monotonicNow = () => performance.now(),
  fileSystem = {}, signalSource = process, deadlineMonotonicNs,
  maxTimeoutMs = MAX_ACCEPTANCE_MS, finalizationTimeoutMs = MAX_ACCEPTANCE_MS,
  readbackTimeoutMs = MAX_REPLACEMENT_READBACK_MS,
  allowPhaseTransition = false
} = {}) {
  requireProof(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= maxTimeoutMs &&
    Number.isSafeInteger(maxTimeoutMs) && maxTimeoutMs <= MAX_FOREGROUND_PHASE_MS &&
    Number.isSafeInteger(finalizationTimeoutMs) && finalizationTimeoutMs > 0 &&
    finalizationTimeoutMs <= MAX_ACCEPTANCE_MS);
  const fs = {lstat, mkdir, open, realpath, ...fileSystem};
  const controller = new AbortController();
  const failure = new Error("acceptance operation ended");
  failure.code = "ACCEPTANCE_UNKNOWN";
  const start = monotonicNow();
  requireProof(Number.isFinite(start));
  let deadline = start + timeoutMs;
  const initialDeadlineMonotonicNs = deadlineMonotonicNs ??
    process.hrtime.bigint() + BigInt(timeoutMs) * NS_PER_MS;
  let absoluteDeadline = initialDeadlineMonotonicNs;
  requireProof(typeof absoluteDeadline === "bigint" && absoluteDeadline > 0n);
  let previous = start;
  let stopPilot;
  let phaseTransitioned = false;
  let phase = "initial";
  let timer;
  let discoveryTimer;
  let discoveryActive = false;
  let discoveryStart;
  let discoveryDeadline;
  let discoveryAbsoluteDeadline;
  const cancel = () => controller.abort(failure);
  const check = () => {
    const now = monotonicNow();
    const nowNs = process.hrtime.bigint();
    if (!Number.isFinite(now) || now < previous || now >= deadline ||
        nowNs >= absoluteDeadline ||
        (discoveryActive && (now >= discoveryDeadline || nowNs >= discoveryAbsoluteDeadline))) cancel();
    previous = now;
    if (controller.signal.aborted) throw failure;
  };
  const onSignal = () => {
    if (stopPilot) stopPilot();
    else cancel();
  };
  signalSource.on("SIGINT", onSignal);
  signalSource.on("SIGTERM", onSignal);
  const armTimer = durationMs => {
    clearTimeout(timer);
    const remainingMs = Number((absoluteDeadline - process.hrtime.bigint()) / NS_PER_MS);
    timer = setTimeout(cancel, Math.max(0, Math.min(durationMs, remainingMs)));
  };
  armTimer(timeoutMs);
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
    deadlineMonotonicNs: initialDeadlineMonotonicNs,
    lstat: filename => wait(() => fs.lstat(filename)),
    realpath: filename => wait(() => fs.realpath(filename)),
    mkdir: (...args) => wait(() => fs.mkdir(...args)),
    read: (filename, maximum) => wait(() => readBoundedPrivateFile(
      filename, maximum, {openFile}
    )),
    setPilotStop: stop => { stopPilot = stop; },
    beginFinalization(signalAt) {
      beginPhase(finalizationTimeoutMs, "finalization", signalAt);
    },
    beginReadbackDiscovery() {
      requireProof(allowPhaseTransition && phase === "initial" &&
        !phaseTransitioned && !discoveryActive && !controller.signal.aborted);
      discoveryStart = {monotonicMs: monotonicNow(), monotonicNs: process.hrtime.bigint()};
      requireProof(Number.isFinite(discoveryStart.monotonicMs));
      discoveryDeadline = discoveryStart.monotonicMs + readbackTimeoutMs;
      discoveryAbsoluteDeadline = discoveryStart.monotonicNs +
        BigInt(readbackTimeoutMs) * NS_PER_MS;
      discoveryActive = true;
      phase = "readback-discovery";
      discoveryTimer = setTimeout(cancel, Math.max(0,
        Math.min(readbackTimeoutMs, Number(
          (discoveryAbsoluteDeadline - process.hrtime.bigint()) / NS_PER_MS
        ))));
    },
    endReadbackDiscovery() {
      requireProof(discoveryActive && phase === "readback-discovery");
      check();
      clearTimeout(discoveryTimer);
      discoveryActive = false;
      phase = "initial";
    },
    beginReadback() {
      beginPhase(readbackTimeoutMs, "readback", discoveryActive ? discoveryStart : undefined);
    },
    get phase() { return phase; },
    abort: cancel,
    dispose() {
      clearTimeout(timer);
      clearTimeout(discoveryTimer);
      signalSource.removeListener("SIGINT", onSignal);
      signalSource.removeListener("SIGTERM", onSignal);
      cancel();
    }
  };
  function beginPhase(durationMs, nextPhase, phaseStart = {
    monotonicMs: monotonicNow(), monotonicNs: process.hrtime.bigint()
  }) {
    if (!controller.signal.aborted) check();
    requireProof(allowPhaseTransition && !phaseTransitioned && !controller.signal.aborted &&
      Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= MAX_ACCEPTANCE_MS);
    requireProof(Number.isFinite(phaseStart.monotonicMs) &&
      typeof phaseStart.monotonicNs === "bigint" && phaseStart.monotonicNs > 0n);
    if (phaseStart.monotonicMs >= deadline || phaseStart.monotonicNs >= absoluteDeadline ||
        (discoveryActive &&
          (phaseStart.monotonicMs >= discoveryDeadline ||
           phaseStart.monotonicNs >= discoveryAbsoluteDeadline))) {
      cancel();
      throw failure;
    }
    phaseTransitioned = true;
    phase = nextPhase;
    previous = Math.max(previous, phaseStart.monotonicMs);
    deadline = phaseStart.monotonicMs + durationMs;
    absoluteDeadline = phaseStart.monotonicNs + BigInt(durationMs) * NS_PER_MS;
    if (discoveryActive) {
      clearTimeout(discoveryTimer);
      discoveryActive = false;
    }
    armTimer(durationMs);
  }
}

async function withAcceptanceOperation(options, action) {
  const operation = acceptanceOperation(options);
  try {
    const result = await action(operation);
    operation.check();
    return result;
  } catch (error) {
    if (operation.signal.aborted) {
      return {
        summary: {status: "UNKNOWN", code: "SYNTHETIC_ACCEPTANCE_FAILED"},
        ...(["readback", "readback-discovery"].includes(operation.phase) ? {hold: true} : {})
      };
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

function createForegroundHold(signalSource) {
  let release;
  let released = false;
  let observedSignal;
  let foregroundSignalHandler;
  const keepAlive = setInterval(() => {}, 60_000);
  const stopped = new Promise(resolve => { release = resolve; });
  const onTerm = () => {
    observedSignal ??= {
      monotonicMs: performance.now(), monotonicNs: process.hrtime.bigint()
    };
    foregroundSignalHandler?.(observedSignal);
    stop();
  };
  const stop = () => {
    if (released) return;
    released = true;
    clearInterval(keepAlive);
    release();
  };
  signalSource.once("SIGTERM", onTerm);
  signalSource.once("SIGINT", stop);
  return {
    wait: () => stopped,
    subscribeSignal(handler) {
      foregroundSignalHandler = handler;
      if (observedSignal) handler(observedSignal);
      return () => {
        if (foregroundSignalHandler === handler) foregroundSignalHandler = undefined;
      };
    },
    dispose() {
      clearInterval(keepAlive);
      signalSource.removeListener("SIGTERM", onTerm);
      signalSource.removeListener("SIGINT", stop);
    }
  };
}

async function runAcceptance({
  dataRoot, proof = "PIPELINE_QUOTE", httpsOptions, signalSource = process, sendHandshake,
  requestedRunId, foregroundClaimId, foregroundClaimSha256, onForegroundReady,
  foregroundSignalGate
}, operation) {
  requireProof(PROOFS.has(proof) && typeof dataRoot === "string" &&
    path.isAbsolute(dataRoot) && path.normalize(dataRoot) === dataRoot);
  const info = await operation.lstat(dataRoot);
  requireProof(info.isDirectory() && !info.isSymbolicLink() &&
    info.uid === process.getuid() && [0o700, 0o2700].includes(info.mode & 0o7777) &&
    await operation.realpath(dataRoot) === dataRoot);
  const runId = requestedRunId ?? `synthetic-${randomUUID()}`;
  requireProof(/^synthetic-[a-f0-9-]{36}$/.test(runId));
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
  let foregroundSignalResolve;
  let foregroundSignalReject;
  let foregroundSignalObserved = false;
  const foregroundSignal = proof === "PLATFORM_FOREGROUND"
    ? new Promise((resolve, reject) => {
      foregroundSignalResolve = resolve;
      foregroundSignalReject = reject;
    })
    : null;
  foregroundSignal?.catch(() => {});
  let readinessCommitted = false;
  const onForegroundSignal = signalAt => {
    if (foregroundSignalObserved) return;
    foregroundSignalObserved = true;
    if (!operation.signal.aborted) {
      try { operation.beginFinalization(signalAt); } catch { operation.abort(); }
    }
    const accepted = stop();
    if (!readinessCommitted && !accepted) operation.abort();
    foregroundSignalResolve();
  };
  const onForegroundAbort = () => foregroundSignalReject(
    operation.signal.reason ?? new Error("foreground acceptance ended")
  );
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
    } : proof === "PLATFORM_FOREGROUND" ? async entry => {
      requireProof(entry?.status === "FILLED_PAPER" && entry.receipt);
      const checkpointBytes = await operation.read(
        path.join(dataDirectory, "checkpoint.json"), 8 * 1024 * 1024
      );
      const checkpoint = parseCanonical(checkpointBytes);
      const checkpointSequence = entry.receipt.sequence;
      requireProof(Number.isSafeInteger(checkpointSequence) && checkpointSequence >= 0 &&
        checkpoint.sequence === checkpointSequence && Array.isArray(checkpoint.records) &&
        checkpointSequence < checkpoint.records.length);
      const acknowledgedCheckpoint = {
        formatVersion: checkpoint.formatVersion,
        runHeader: checkpoint.runHeader,
        records: checkpoint.records.slice(0, checkpointSequence + 1),
        sequence: checkpointSequence
      };
      const checkpointSha256 = digest(canonicalCheckpointBytes(acknowledgedCheckpoint));
      requireProof(checkpointSha256 === digest(checkpointBytes) &&
        entry.receipt.hash === checkpointSha256 &&
        checkpoint.records[checkpointSequence]?.method === "executeEntry" &&
        checkpoint.records[checkpointSequence]?.resultDigest === entry.receipt.resultDigest &&
        checkpoint.records[checkpointSequence]?.runId === runId);
      const receiptSha256 = digest(canonicalCheckpointBytes(entry.receipt));
      const readyBytes = canonicalCheckpointBytes({
        protocol: "synthetic-platform-foreground/v1",
        status: "READY",
        claimId: foregroundClaimId,
        claimSha256: foregroundClaimSha256,
        runId,
        fillReceiptSha256: receiptSha256,
        checkpointSequence,
        checkpointSha256
      });
      requireProof(!foregroundSignalObserved);
      await writeNew(directory, "readiness.json", readyBytes, operation);
      requireProof(!foregroundSignalObserved);
      readinessCommitted = true;
      if (onForegroundReady) {
        await operation.wait(() => onForegroundReady({
          claimId: foregroundClaimId, runId,
          readinessSha256: digest(readyBytes),
          checkpointSequence, checkpointSha256
        }));
      }
      signalProof.receiptSha256 = receiptSha256;
      signalProof.checkpointSha256 = checkpointSha256;
      signalProof.checkpointSequence = checkpointSequence;
      await foregroundSignal;
      requireProof(foregroundSignalObserved);
      signalProof.observedAfterFill = true;
    } : undefined;
  const pilot = makePilot(onTestEntry);
  operation.setPilotStop(stop);
  let unsubscribeForegroundSignal;
  if (foregroundSignal) {
    unsubscribeForegroundSignal = foregroundSignalGate.subscribeSignal(onForegroundSignal);
    operation.signal.addEventListener("abort", onForegroundAbort, {once: true});
    if (operation.signal.aborted) onForegroundAbort();
  }
  let result;
  try {
    result = await operation.wait(() => {
      requireProof(!foregroundSignalObserved);
      return pilot.start();
    });
  } finally {
    operation.setPilotStop(null);
    if (foregroundSignal) {
      signalSource.removeListener("SIGTERM", onForegroundSignal);
      unsubscribeForegroundSignal?.();
      operation.signal.removeEventListener("abort", onForegroundAbort);
    }
  }
  const exportBytes = canonicalCheckpointBytes(result.report);
  await writeNew(directory, "result.report.json", exportBytes, operation);
  const evaluation = evaluateMemecoinPaperRunExport(exportBytes, expected);
  const operations = result.report.runnerReport?.operationResults ?? [];
  const stoppingProof = proof === "ACTIVE_STOP" || proof === "REAL_SIGNAL_CHILD" ||
    proof === "PLATFORM_FOREGROUND";
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
    if (proof === "REAL_SIGNAL_CHILD" || proof === "PLATFORM_FOREGROUND") {
      requireProof(signalProof.observedAfterFill);
    }
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
    ...(proof === "PLATFORM_FOREGROUND" ? {
      foregroundClaimId, foregroundClaimSha256,
      signalObservation: {
        status: "OBSERVED", signal: "SIGTERM", afterReady: readinessCommitted,
        source: "PROCESS_SIGNAL_HANDLER", platformProvenance: "NOT_ASSESSED"
      },
      networkAccessed: false,
      signalProof: {
        observedAfterFill: signalProof.observedAfterFill,
        fillReceiptSha256: signalProof.receiptSha256,
        fillCheckpointSequence: signalProof.checkpointSequence,
        fillCheckpointSha256: signalProof.checkpointSha256,
        lifecycleStatus: result.status,
        runnerReason: result.report.runnerReport.reason
      }
    } : {}),
    hostAcceptance: "NOT_ASSESSED", providerTrust: "NOT_ASSESSED", liveExecution: false
  };
  await writeNew(directory, "summary.json", canonicalCheckpointBytes(summary), operation);
  return {summary, result, exportBytes, directory};
}

function validForegroundClaimId(value) {
  return typeof value === "string" && value.length <= 64 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes("..");
}

function validForegroundRunId(value) {
  return typeof value === "string" && /^synthetic-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
}

function foregroundPaths(dataRoot, claimId) {
  return {
    arm: path.join(dataRoot, `foreground-arm-${claimId}.json`),
    consumed: path.join(dataRoot, `foreground-arm-consumed-${claimId}.json`),
    claim: path.join(dataRoot, `foreground-claim-${claimId}.json`)
  };
}

function isPrivateDirectory(info) {
  return info.isDirectory() && !info.isSymbolicLink() &&
    info.uid === process.getuid() && [0o700, 0o2700].includes(info.mode & 0o7777);
}

async function verifyForegroundEvidence({dataRoot, claimId, claimBytes, operation}) {
  const claim = parseCanonical(claimBytes);
  const claimSha256 = digest(claimBytes);
  const {arm: armPath, consumed: consumedPath} = foregroundPaths(dataRoot, claimId);
  const armBytes = await operation.read(armPath, 16 * 1024);
  const arm = parseCanonical(armBytes);
  const consumedBytes = await operation.read(consumedPath, 16 * 1024);
  const consumed = parseCanonical(consumedBytes);
  const runId = claim.runId;
  const armSha256 = digest(armBytes);
  requireProof(claim.protocol === FOREGROUND_CLAIM_PROTOCOL &&
    claim.status === "CLAIMED" && claim.claimId === claimId && validForegroundRunId(runId) &&
    claim.armSha256 === armSha256 &&
    arm.protocol === FOREGROUND_ARM_PROTOCOL && arm.status === "ARMED" &&
    arm.claimId === claimId && arm.runId === runId && arm.dataRoot === dataRoot &&
    /^[0-9a-f-]{36}$/.test(arm.armId) &&
    consumed.protocol === "synthetic-platform-foreground-arm-consumed/v1" &&
    consumed.status === "CONSUMED" && consumed.claimId === claimId &&
    consumed.runId === runId && consumed.armSha256 === armSha256);
  const directory = path.join(dataRoot, runId);
  const info = await operation.lstat(directory);
  requireProof(isPrivateDirectory(info) && await operation.realpath(directory) === directory);
  const readinessBytes = await operation.read(path.join(directory, "readiness.json"), 16 * 1024);
  const readiness = parseCanonical(readinessBytes);
  const configBytes = await operation.read(path.join(directory, "config.json"), 16 * 1024);
  const config = parseCanonical(configBytes);
  const expected = {
    runId, configSha256: digest(configBytes), producerRevision: PRODUCER_REVISION
  };
  const summary = parseCanonical(await operation.read(path.join(directory, "summary.json"), 64 * 1024));
  const exportBytes = await operation.read(path.join(directory, "result.report.json"), 8 * 1024 * 1024);
  const report = parseCanonical(exportBytes);
  const checkpointBytes = await operation.read(
    path.join(directory, "state", "checkpoint.json"), 8 * 1024 * 1024
  );
  const checkpoint = parseCanonical(checkpointBytes);
  const readbackBytes = await operation.read(path.join(
    directory, "receiver", digest(Buffer.from(runId, "utf8")), "export.json"
  ), 8 * 1024 * 1024);
  const evaluation = evaluateMemecoinPaperRunExport(exportBytes, expected);
  const operations = report.runnerReport?.operationResults ?? [];
  const openPositions = report.runnerReport?.terminalResult?.openPositions ?? [];
  const entryOperation = operations.find(item =>
    item.method === "executeEntry" && item.status === "FILLED_PAPER");
  const receipt = entryOperation?.receipt;
  const sequence = readiness.checkpointSequence;
  const acknowledgedCheckpoint = {
    formatVersion: checkpoint.formatVersion,
    runHeader: checkpoint.runHeader,
    records: checkpoint.records?.slice(0, sequence + 1),
    sequence
  };
  const record = checkpoint.records?.[sequence];
  requireProof(config.runId === runId && config.mode === "SYNTHETIC_TEST_ONLY" &&
    readiness.protocol === "synthetic-platform-foreground/v1" &&
    readiness.status === "READY" && readiness.claimId === claimId &&
    readiness.claimSha256 === claimSha256 && readiness.runId === runId &&
    Number.isSafeInteger(sequence) && sequence >= 0 &&
    /^[0-9a-f]{64}$/.test(readiness.checkpointSha256) &&
    /^[0-9a-f]{64}$/.test(readiness.fillReceiptSha256) &&
    digest(canonicalCheckpointBytes(acknowledgedCheckpoint)) === readiness.checkpointSha256 &&
    digest(canonicalCheckpointBytes(receipt)) === readiness.fillReceiptSha256 &&
    record?.method === "executeEntry" && record.resultDigest === receipt?.resultDigest &&
    record.runId === runId && receipt?.runId === runId &&
    receipt.sequence === sequence && receipt.hash === readiness.checkpointSha256 &&
    summary.status === "UNKNOWN" && summary.contractChecks === "PASS" &&
    summary.proof === "SYNTHETIC_PLATFORM_FOREGROUND" &&
    summary.foregroundClaimId === claimId && summary.foregroundClaimSha256 === claimSha256 &&
    summary.runId === runId && summary.configSha256 === expected.configSha256 &&
    summary.producerRevision === PRODUCER_REVISION &&
    summary.evaluation === "UNKNOWN" && summary.outcome === "OPEN_UNVALUED_TERMINAL_POSITION" &&
    summary.entryFills === 1 && summary.exits === 0 && summary.stopAccepted === true &&
    summary.restartDenied === true && summary.immutableReadback === true &&
    summary.signalObservation?.status === "OBSERVED" &&
    summary.signalObservation?.signal === "SIGTERM" &&
    summary.signalObservation?.afterReady === true &&
    summary.signalObservation?.source === "PROCESS_SIGNAL_HANDLER" &&
    summary.signalObservation?.platformProvenance === "NOT_ASSESSED" &&
    summary.hostAcceptance === "NOT_ASSESSED" &&
    summary.providerTrust === "NOT_ASSESSED" && summary.liveExecution === false &&
    summary.networkAccessed === false &&
    summary.signalProof?.observedAfterFill === true &&
    summary.signalProof?.fillReceiptSha256 === readiness.fillReceiptSha256 &&
    summary.signalProof?.fillCheckpointSequence === sequence &&
    summary.signalProof?.fillCheckpointSha256 === readiness.checkpointSha256 &&
    summary.signalProof?.lifecycleStatus === "STOPPED" &&
    summary.signalProof?.runnerReason === "SHUTDOWN" &&
    !Object.hasOwn(summary.signalObservation, "signalToExitMs") &&
    report.persistence === "ACKNOWLEDGED" &&
    report.checkpointSha256 === digest(checkpointBytes) &&
    checkpointBytes.equals(canonicalCheckpointBytes(report.checkpoint)) &&
    report.runnerReport?.reason === "SHUTDOWN" &&
    operations.filter(item => item.method === "executeEntry" && item.status === "FILLED_PAPER").length === 1 &&
    !operations.some(item => item.method === "observeExitQuote" && item.status === "CLOSED_PAPER") &&
    openPositions.length === 1 && openPositions[0].markStatus === "VALUATION_UNAVAILABLE" &&
    evaluation.overall === "UNKNOWN" &&
    evaluation.outcome === "OPEN_UNVALUED_TERMINAL_POSITION" &&
    !evaluation.checks.some(item => item.status === "FAIL") &&
    summary.exportSha256 === digest(exportBytes) && summary.byteLength === exportBytes.length &&
    readbackBytes.equals(exportBytes));
  return {
    status: "UNKNOWN", mode: "READ_ONLY_REPLACEMENT", readback: "VERIFIED",
    claimId, runId, claimSha256, readinessSha256: digest(readinessBytes),
    fillCount: evaluation.evidence.entryFills,
    checkpointSequence: sequence, checkpointSha256: readiness.checkpointSha256,
    restartDenied: true, immutableReadback: true,
    exportSha256: digest(exportBytes), byteLength: exportBytes.length,
    signalObservation: "PROCESS_SIGTERM_OBSERVED",
    platformProvenance: "NOT_ASSESSED"
  };
}

async function runForegroundAcceptance({
  dataRoot, claimId, signalSource, signalGate, onReady, operation
}) {
  requireProof(validForegroundClaimId(claimId) && typeof dataRoot === "string" &&
    path.isAbsolute(dataRoot) && path.normalize(dataRoot) === dataRoot);
  operation.beginReadbackDiscovery();
  let rootInfo;
  try {
    rootInfo = await operation.lstat(dataRoot);
    if (!isPrivateDirectory(rootInfo) || await operation.realpath(dataRoot) !== dataRoot) {
      return {
        summary: {
          status: "UNKNOWN", mode: "INERT_ROOT_UNAVAILABLE", readback: "UNKNOWN",
          claimId, platformProvenance: "NOT_ASSESSED"
        },
        hold: true
      };
    }
  } catch {
    return {
      summary: {
        status: "UNKNOWN", mode: "INERT_ROOT_UNAVAILABLE", readback: "UNKNOWN",
        claimId, platformProvenance: "NOT_ASSESSED"
      },
      hold: true
    };
  }
  const {arm: armPath, consumed: consumedPath, claim: claimPath} =
    foregroundPaths(dataRoot, claimId);
  let claimExists = false;
  try {
    await operation.lstat(claimPath);
    claimExists = true;
  } catch (error) {
    if (error.code !== "ENOENT") {
      return {
        summary: {
          status: "UNKNOWN", mode: "READ_ONLY_REPLACEMENT", readback: "UNKNOWN",
          claimId, platformProvenance: "NOT_ASSESSED"
        },
        hold: true
      };
    }
  }
  if (claimExists) {
    operation.beginReadback();
    let claimBytes;
    try {
      claimBytes = await operation.read(claimPath, 16 * 1024);
      const readback = await verifyForegroundEvidence({
        dataRoot, claimId, claimBytes, operation
      });
      return {
        summary: readback,
        hold: true
      };
    } catch {
      let claimedRunId;
      try { claimedRunId = parseCanonical(claimBytes).runId; } catch {}
      return {
        summary: {
          status: "UNKNOWN", mode: "READ_ONLY_REPLACEMENT", readback: "UNKNOWN",
          claimId, runId: claimedRunId, platformProvenance: "NOT_ASSESSED"
        },
        hold: true
      };
    }
  }
  let consumedExists = false;
  try {
    await operation.lstat(consumedPath);
    consumedExists = true;
  } catch (error) {
    if (error.code !== "ENOENT") {
      return {
        summary: {
          status: "UNKNOWN", mode: "INERT_CONSUMED_ARM", readback: "UNKNOWN",
          claimId, platformProvenance: "NOT_ASSESSED"
        },
        hold: true
      };
    }
  }
  if (consumedExists) {
    operation.beginReadback();
    return {
      summary: {
        status: "UNKNOWN", mode: "INERT_CONSUMED_ARM", readback: "NOT_ATTEMPTED",
        claimId, platformProvenance: "NOT_ASSESSED"
      },
      hold: true
    };
  }
  operation.endReadbackDiscovery();
  let armBytes;
  try {
    armBytes = await operation.read(armPath, 16 * 1024);
  } catch {
    return {
      summary: {
        status: "UNKNOWN", mode: "INERT_UNARMED", readback: "NOT_ATTEMPTED",
        claimId, platformProvenance: "NOT_ASSESSED"
      },
      hold: true
    };
  }
  let arm;
  try {
    arm = parseCanonical(armBytes);
  } catch {
    return {
      summary: {
        status: "UNKNOWN", mode: "INERT_INVALID_ARM", readback: "NOT_ATTEMPTED",
        claimId, platformProvenance: "NOT_ASSESSED"
      },
      hold: true
    };
  }
  const runId = arm.runId;
  if (arm.protocol !== FOREGROUND_ARM_PROTOCOL || arm.status !== "ARMED" ||
      arm.claimId !== claimId || !validForegroundRunId(runId) ||
      arm.dataRoot !== dataRoot ||
      !/^[0-9a-f-]{36}$/.test(arm.armId)) {
    return {
      summary: {
        status: "UNKNOWN", mode: "INERT_INVALID_ARM", readback: "NOT_ATTEMPTED",
        claimId, platformProvenance: "NOT_ASSESSED"
      },
      hold: true
    };
  }
  try {
    await operation.lstat(path.join(dataRoot, runId));
    return {
      summary: {
        status: "UNKNOWN", mode: "INERT_RUN_ALREADY_EXISTS", readback: "NOT_ATTEMPTED",
        claimId, runId, platformProvenance: "NOT_ASSESSED"
      },
      hold: true
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      return {
        summary: {
          status: "UNKNOWN", mode: "INERT_RUN_STATE", readback: "NOT_ATTEMPTED",
          claimId, runId, platformProvenance: "NOT_ASSESSED"
        },
        hold: true
      };
    }
  }
  const armSha256 = digest(armBytes);
  const consumedBytes = canonicalCheckpointBytes({
    protocol: "synthetic-platform-foreground-arm-consumed/v1",
    status: "CONSUMED", claimId, runId, armSha256
  });
  try {
    await writeNew(dataRoot, path.basename(consumedPath), consumedBytes, operation);
  } catch {
    return {
      summary: {
        status: "UNKNOWN", mode: "INERT_ARM_ALREADY_CONSUMED", readback: "NOT_ATTEMPTED",
        claimId, runId, platformProvenance: "NOT_ASSESSED"
      },
      hold: true
    };
  }
  const newClaimBytes = canonicalCheckpointBytes({
    protocol: FOREGROUND_CLAIM_PROTOCOL, status: "CLAIMED",
    claimId, runId, armSha256
  });
  try {
    await writeNew(dataRoot, path.basename(claimPath), newClaimBytes, operation);
  } catch {
    return {
      summary: {
        status: "UNKNOWN", mode: "INERT_CLAIM_NOT_ACQUIRED", readback: "NOT_ATTEMPTED",
        claimId, runId, platformProvenance: "NOT_ASSESSED"
      },
      hold: true
    };
  }
  const {summary, ...artifacts} = await runAcceptance({
    dataRoot, proof: "PLATFORM_FOREGROUND", signalSource, foregroundSignalGate: signalGate,
    requestedRunId: runId, foregroundClaimId: claimId,
    foregroundClaimSha256: digest(newClaimBytes),
    onForegroundReady: onReady
  }, operation);
  return {summary, ...artifacts, hold: false};
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
  promise.catch(() => {});
  return {
    promise,
    cancel() {
      clearTimeout(timer);
      removeListeners();
    }
  };
}

function childExitWait(child, monotonicNow = () => performance.now()) {
  let removeListeners = () => {};
  let observedExit = null;
  const promise = new Promise((resolve, reject) => {
    const finish = (action, value) => {
      removeListeners();
      action(value);
    };
    const onExit = (code, signal) => {
      observedExit = {code, signal, observedAtMonotonicMs: monotonicNow()};
      finish(resolve, observedExit);
    };
    const onError = error => finish(reject, error);
    removeListeners = () => {
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
    };
    if (child.exitCode !== null || child.signalCode !== null) {
      observedExit = {
        code: child.exitCode, signal: child.signalCode, observedAtMonotonicMs: monotonicNow()
      };
      resolve(observedExit);
    } else {
      child.once("exit", onExit);
      child.once("error", onError);
    }
  });
  promise.catch(() => {});
  return {
    promise, cancel: () => removeListeners(),
    get observedExit() { return observedExit; },
    signalAttempted: false
  };
}

function sendChildSigtermOnce(child, exitWait, killChild) {
  requireProof(typeof killChild === "function" && !exitWait.signalAttempted &&
    !exitWait.observedExit && child.exitCode === null && child.signalCode === null);
  exitWait.signalAttempted = true;
  requireProof(killChild(child, "SIGTERM") === true);
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

async function realSignalDrill({dataRoot, spawnChild, killChild, signalMonotonicNow}, operation) {
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

    child = spawnChild(process.execPath, [fileURLToPath(import.meta.url)], {
      env: {
        PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: directory,
        PAPER_SYNTHETIC_ACCEPTANCE_PROOF: "REAL_SIGNAL_CHILD",
        PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_CHILD: "true",
        [ACCEPTANCE_DEADLINE_ENV]: operation.deadlineMonotonicNs.toString()
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    });
    handshakeWait = childHandshakeWait(child, REAL_SIGNAL_HANDSHAKE_MS);
    exitWait = childExitWait(child, signalMonotonicNow);
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
    requireProof(!exitWait.observedExit && child.exitCode === null && child.signalCode === null);

    await writeNew(directory, "signal-request.json", canonicalCheckpointBytes({
      pid: child.pid, signal: "SIGTERM", status: "READY",
      runId: handshake.runId, acknowledgementSha256: handshake.acknowledgementSha256
    }), operation);
    requireProof(!exitWait.observedExit && child.exitCode === null && child.signalCode === null);
    const signalSentAtMonotonicMs = signalMonotonicNow();
    sendChildSigtermOnce(child, exitWait, killChild);
    await writeNew(directory, "signal-sent.json", canonicalCheckpointBytes({
      pid: child.pid, signal: "SIGTERM", signalSentAtMonotonicMs, attempts: 1
    }), operation);
    const exit = await operation.wait(() => exitWait.promise);
    childExited = true;
    const sendToExitMs = exit.observedAtMonotonicMs - signalSentAtMonotonicMs;
    requireProof(exit.code === 2 && exit.signal === null &&
      Number.isFinite(sendToExitMs) && sendToExitMs >= 0);

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
        signalSentExactlyOnce: exitWait.signalAttempted, signalObservedAfterFill: true,
        fillAcknowledged: true, sendToExitMs,
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
    requireProof(isVerifiedRealSignalDrillReceipt(summary));
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
  env = process.env, stdout = process.stdout, signalSource = process,
  spawnChild = spawn, killChild = (child, signal) => child.kill(signal),
  signalMonotonicNow = () => performance.now(), ...operationOptions
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
      [undefined, "false", "true"].includes(env.PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_CHILD) &&
      [undefined, "false", "true"].includes(env.PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND));
    if (env.PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND === "true") {
      requireProof(env.PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_DRILL !== "true" &&
        env.PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_CHILD !== "true" &&
        env.PAPER_SYNTHETIC_ACCEPTANCE_HTTPS_ENABLED !== "true" &&
        env.PAPER_SYNTHETIC_ACCEPTANCE_PROOF === undefined &&
        validForegroundClaimId(env.PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID));
      const waitTimeoutValue =
        env.PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND_WAIT_TIMEOUT_MS ?? "60000";
      const finalizationTimeoutValue =
        env.PAPER_SYNTHETIC_ACCEPTANCE_FINALIZATION_TIMEOUT_MS ?? "60000";
      const readbackTimeoutValue =
        env.PAPER_SYNTHETIC_ACCEPTANCE_READBACK_TIMEOUT_MS ?? String(MAX_REPLACEMENT_READBACK_MS);
      requireProof(/^[1-9][0-9]{0,4}$/.test(waitTimeoutValue) &&
        /^[1-9][0-9]{0,4}$/.test(finalizationTimeoutValue) &&
        /^[1-9][0-9]{0,4}$/.test(readbackTimeoutValue));
      const waitTimeoutMs = Number(waitTimeoutValue);
      const finalizationTimeoutMs = Number(finalizationTimeoutValue);
      const readbackTimeoutMs = Number(readbackTimeoutValue);
      requireProof(Number.isSafeInteger(waitTimeoutMs) && waitTimeoutMs <= MAX_FOREGROUND_PHASE_MS &&
        Number.isSafeInteger(finalizationTimeoutMs) && finalizationTimeoutMs <= MAX_ACCEPTANCE_MS &&
        Number.isSafeInteger(readbackTimeoutMs) &&
        readbackTimeoutMs <= MAX_REPLACEMENT_READBACK_MS);
      attempted = true;
      const hold = createForegroundHold(signalSource);
      try {
        const result = await withAcceptanceOperation({
          ...operationOptions, signalSource: new EventEmitter(),
          timeoutMs: waitTimeoutMs, maxTimeoutMs: MAX_FOREGROUND_PHASE_MS,
          finalizationTimeoutMs, readbackTimeoutMs, allowPhaseTransition: true
        }, operation => runForegroundAcceptance({
          dataRoot: env.PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT,
          claimId: env.PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID, signalSource, signalGate: hold,
          onReady: marker => stdout.write(`${JSON.stringify({
            status: "READY", proof: "SYNTHETIC_PLATFORM_FOREGROUND", ...marker
          })}\n`),
          operation
        }));
        stdout.write(`${JSON.stringify(result.summary)}\n`);
        if (result.hold) {
          await hold.wait();
          return 0;
        }
      } finally {
        hold.dispose();
      }
      return 2;
    }
    if (env.PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_CHILD === "true") {
      requireProof(env.PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_DRILL !== "true" &&
        env.PAPER_SYNTHETIC_ACCEPTANCE_HTTPS_ENABLED !== "true" &&
        env.PAPER_SYNTHETIC_ACCEPTANCE_PROOF === "REAL_SIGNAL_CHILD");
      attempted = true;
      const inheritedDeadline = parseAcceptanceDeadline(env[ACCEPTANCE_DEADLINE_ENV]);
      requireProof(inheritedDeadline.timeoutMs > 0);
      requireProof(typeof process.send === "function");
      const {summary} = await withAcceptanceOperation(
        {...operationOptions, signalSource, ...inheritedDeadline},
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
          dataRoot: env.PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT, spawnChild, killChild,
          signalMonotonicNow
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
