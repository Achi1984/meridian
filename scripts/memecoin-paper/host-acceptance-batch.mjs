import {createHash} from "node:crypto";
import {lstat, mkdir, open, realpath} from "node:fs/promises";
import {spawn} from "node:child_process";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {fileURLToPath, pathToFileURL} from "node:url";
import {evaluateMemecoinPaperRunExport} from "../memecoin-paper-simulated-evaluation/index.mjs";
import {
  PAPER_EXPORT_MOUNT_ROOT,
  readBoundedPrivateFile,
  validatePaperExportStorageRoot
} from "../memecoin-paper-export-host.mjs";
import {canonicalCheckpointBytes} from "./checkpoint-store.mjs";
import {
  PAPER_RUNTIME_SOURCE_POLICY,
  PAPER_RUNTIME_SOURCE_POLICY_SHA256
} from "./paper-runtime-source.mjs";
import {parseMountInfo} from "./volume-protection.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const APPLICATION_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const STORAGE_ROOT = path.join(PAPER_EXPORT_MOUNT_ROOT, "host-acceptance-batch");
const CLAIM_NAME = "batch-claim.json";
const MAX_BATCH_MS = 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_MOUNT_INFO_BYTES = 256 * 1024;
const MAX_EVIDENCE_BYTES = 16 * 1024 * 1024;
const PRODUCER_REVISION = "paper-pilot-composition/3";
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SOURCE_REVISION = /^[a-f0-9]{40}$/;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const PREVIOUS_REHEARSAL_SOURCE = "fc5b3d97f62b8a9098e53a99eaa9a03b7955e5aa";
const PREVIOUS_LOCAL_IMAGE_IDS = new Set([
  "sha256:ec191ba1fbd70d858940bd5e934c79fd000bf1e1a61fdbd442766cd01f2e63b5",
  "sha256:482b1847819a7071d64e823e38850b4556d8dd0245b6e0320f7af4ea3db01a72"
]);
const REQUIRED_PROOFS = Object.freeze([
  "PIPELINE_QUOTE", "ACTIVE_STOP", "CONTROLLER_SOURCE_POLICY_NO_ENTRY"
]);
const PROOF_SCRIPTS = Object.freeze({
  PIPELINE_QUOTE: path.join(SCRIPT_DIRECTORY, "synthetic-host-acceptance.mjs"),
  ACTIVE_STOP: path.join(SCRIPT_DIRECTORY, "synthetic-host-acceptance.mjs"),
  CONTROLLER_SOURCE_POLICY_NO_ENTRY: path.join(SCRIPT_DIRECTORY, "paper-operational-controller.mjs")
});
const CONTROLLER_BUDGETS = Object.freeze({
  requests: 12, bytes: 1_000_000, events: 128, candidates: 4, cycles: 4,
  durationMs: 20_000, callbackTimeoutMs: 1_000, maxWallClockUncertaintyMs: 10
});

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireBatch(condition, code = "BATCH_CONTRACT_FAILED") {
  if (!condition) throw failure(code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateIdentity({sourceRevision, imageDigest, runId}) {
  requireBatch(SOURCE_REVISION.test(sourceRevision ?? ""), "BATCH_IDENTITY_INVALID");
  requireBatch(sourceRevision !== PREVIOUS_REHEARSAL_SOURCE, "BATCH_SOURCE_PIN_STALE");
  requireBatch(IMAGE_DIGEST.test(imageDigest ?? ""), "BATCH_IDENTITY_INVALID");
  requireBatch(!PREVIOUS_LOCAL_IMAGE_IDS.has(imageDigest), "BATCH_IMAGE_DIGEST_NOT_PUBLISHED");
  requireBatch(SAFE_RUN_ID.test(runId ?? "") && !runId.includes(".."), "BATCH_IDENTITY_INVALID");
  return {sourceRevision, imageDigest, runId};
}

function createDeadline({
  timeoutMs = MAX_BATCH_MS,
  monotonicNow = () => performance.now(),
  signalSource = process
} = {}) {
  requireBatch(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_BATCH_MS,
    "BATCH_TIMEOUT_INVALID");
  const started = monotonicNow();
  requireBatch(Number.isFinite(started), "BATCH_CLOCK_INVALID");
  const deadline = started + timeoutMs;
  let previous = started;
  let activeChild = null;
  let shutdownSignal = null;
  let holdResolver = null;
  let timer;
  let forceKillTimer;
  const abortController = new AbortController();
  let childStarted = false;
  const timeoutFailure = failure("BATCH_DEADLINE_EXCEEDED");
  const cancel = error => {
    if (!abortController.signal.aborted) abortController.abort(error);
    if (activeChild) terminate(activeChild);
  };
  const check = () => {
    const now = monotonicNow();
    if (!Number.isFinite(now) || now < previous) cancel(failure("BATCH_CLOCK_INVALID"));
    else if (now >= deadline) cancel(timeoutFailure);
    previous = now;
    if (abortController.signal.aborted) throw abortController.signal.reason;
  };
  const onSignal = signal => {
    shutdownSignal ??= signal;
    if (holdResolver) holdResolver();
    if (activeChild) {
      try { activeChild.kill(signal); } catch {}
    } else {
      cancel(failure("BATCH_CANCELLED"));
    }
  };
  const onInterrupt = () => onSignal("SIGINT");
  const onTerminate = () => onSignal("SIGTERM");
  signalSource.on("SIGINT", onInterrupt);
  signalSource.on("SIGTERM", onTerminate);
  timer = setTimeout(() => cancel(timeoutFailure), timeoutMs);

  function terminate(child) {
    try { child.kill("SIGTERM"); } catch {}
    if (forceKillTimer) clearTimeout(forceKillTimer);
    forceKillTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, 250);
    forceKillTimer.unref?.();
  }

  async function wait(action, lateCleanup) {
    check();
    let onAbort;
    const aborted = new Promise((resolve, reject) => {
      onAbort = () => reject(abortController.signal.reason ?? failure("BATCH_CANCELLED"));
      abortController.signal.addEventListener("abort", onAbort, {once: true});
    });
    const pending = Promise.resolve().then(() => {
      check();
      return action();
    });
    let delivered = false;
    try {
      const value = await Promise.race([pending, aborted]);
      check();
      delivered = true;
      return value;
    } finally {
      abortController.signal.removeEventListener("abort", onAbort);
      if (!delivered && lateCleanup) pending.then(lateCleanup, () => {});
    }
  }

  return {
    check,
    wait,
    signal: abortController.signal,
    setActiveChild(child) { activeChild = child; childStarted = true; },
    clearActiveChild(child) { if (activeChild === child) activeChild = null; },
    get childStarted() { return childStarted; },
    get shutdownSignal() { return shutdownSignal; },
    stopDeadline() { clearTimeout(timer); },
    async hold() {
      if (shutdownSignal || abortController.signal.aborted) return;
      await new Promise(resolve => {
        holdResolver = resolve;
        if (shutdownSignal || abortController.signal.aborted) resolve();
      });
    },
    dispose() {
      clearTimeout(timer);
      signalSource.removeListener("SIGINT", onInterrupt);
      signalSource.removeListener("SIGTERM", onTerminate);
      if (forceKillTimer && !abortController.signal.aborted) clearTimeout(forceKillTimer);
    }
  };
}

function closeLate(handle) {
  try { Promise.resolve(handle.close()).catch(() => {}); } catch {}
}

async function openWithin(operation, fs, ...args) {
  return operation.wait(() => fs.open(...args), closeLate);
}

async function closeWithin(operation, handle) {
  try {
    await operation.wait(() => handle.close());
  } catch (error) {
    if (!operation.signal.aborted) throw error;
    closeLate(handle);
    throw error;
  }
}

async function syncDirectory(directory, operation, fs) {
  const handle = await openWithin(operation, fs, directory, "r");
  try {
    await operation.wait(() => handle.sync());
  } finally {
    await closeWithin(operation, handle);
  }
}

async function validateActualMount(operation, fs) {
  const handle = await openWithin(operation, fs, "/proc/self/mountinfo", "r");
  let bytes;
  try {
    const buffer = Buffer.alloc(MAX_MOUNT_INFO_BYTES + 1);
    let length = 0;
    while (length < buffer.byteLength) {
      const {bytesRead} = await operation.wait(() =>
        handle.read(buffer, length, buffer.byteLength - length, null));
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    requireBatch(length > 0 && length <= MAX_MOUNT_INFO_BYTES, "BATCH_MOUNT_INFO_INVALID");
    bytes = buffer.subarray(0, length);
  } finally {
    await closeWithin(operation, handle);
  }
  const mountInfo = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  requireBatch(parseMountInfo(mountInfo), "BATCH_MOUNT_IDENTITY_INVALID");
}

async function boundedRead(filename, maximum, operation, fs, runtimeUid) {
  requireBatch(Number.isSafeInteger(maximum) && maximum > 0, "BATCH_FILE_LIMIT_INVALID");
  return operation.wait(() => readBoundedPrivateFile(filename, maximum, {
    runtimeUid,
    openFile: async (...args) => {
      const handle = await openWithin(operation, fs, ...args);
      return {
        stat: () => operation.wait(() => handle.stat()),
        read: (...values) => operation.wait(() => handle.read(...values)),
        close: () => operation.wait(() => handle.close())
      };
    }
  }));
}

async function writeExclusive(directory, filename, bytes, operation, fs, runtimeUid) {
  requireBatch(bytes.byteLength > 0 && bytes.byteLength <= MAX_EVIDENCE_BYTES,
    "BATCH_EVIDENCE_LIMIT_EXCEEDED");
  try {
    const target = path.join(directory, filename);
    const handle = await openWithin(operation, fs, target, "wx", 0o600);
    try {
      await operation.wait(() => handle.writeFile(bytes));
      await operation.wait(() => handle.sync());
    } finally {
      await closeWithin(operation, handle);
    }
    await syncDirectory(directory, operation, fs);
    const readback = await boundedRead(target, MAX_EVIDENCE_BYTES, operation, fs, runtimeUid);
    requireBatch(readback.equals(bytes), "BATCH_EVIDENCE_READBACK_FAILED");
    return sha256(readback);
  } catch (error) {
    if (filename === CLAIM_NAME) error.claimAcquired = true;
    throw error;
  }
}

async function makePrivateDirectory(directory, operation, fs, runtimeUid) {
  await operation.wait(() => fs.mkdir(directory, {mode: 0o700}));
  await syncDirectory(path.dirname(directory), operation, fs);
  const info = await operation.wait(() => fs.lstat(directory));
  requireBatch(info.isDirectory() && !info.isSymbolicLink() && info.uid === runtimeUid &&
    [0o700, 0o2700].includes(info.mode & 0o7777), "BATCH_PRIVATE_DIRECTORY_UNSAFE");
  return directory;
}

function boundedOutput(stream, onOverflow) {
  let length = 0;
  const chunks = [];
  stream?.on("data", chunk => {
    const bytes = Buffer.from(chunk);
    const remaining = MAX_OUTPUT_BYTES - length;
    if (remaining > 0) {
      const kept = bytes.subarray(0, remaining);
      chunks.push(kept);
      length += kept.byteLength;
    }
    if (bytes.byteLength > remaining) onOverflow();
  });
  stream?.on("error", onOverflow);
  return () => Buffer.concat(chunks, length);
}

async function runChild(args, env, operation, spawnImpl) {
  operation.check();
  const child = spawnImpl(process.execPath, args, {
    cwd: APPLICATION_ROOT,
    env: {PATH: process.env.PATH ?? "", LANG: "C", TZ: "UTC", ...env},
    stdio: ["ignore", "pipe", "pipe"]
  });
  operation.setActiveChild(child);
  let exit = null;
  let spawnError = null;
  let outputExceeded = false;
  const stdout = boundedOutput(child.stdout, () => {
    outputExceeded = true;
    try { child.kill("SIGTERM"); } catch {}
  });
  const stderr = boundedOutput(child.stderr, () => {
    outputExceeded = true;
    try { child.kill("SIGTERM"); } catch {}
  });
  const finished = new Promise(resolve => {
    child.once("exit", (code, signal) => {
      exit = {code, signal, observedAtMonotonicMs: performance.now()};
    });
    child.once("error", error => { spawnError = error; });
    child.once("close", (code, signal) => {
      if (!exit && code !== null) {
        exit = {code, signal, observedAtMonotonicMs: performance.now()};
      }
      resolve();
    });
  });
  try {
    await operation.wait(() => finished, () => {
      operation.setActiveChild(null);
      try { child.kill("SIGKILL"); } catch {}
    });
  } finally {
    operation.clearActiveChild(child);
  }
  return {
    exit,
    spawnError: spawnError ? "CHILD_SPAWN_FAILED" : null,
    outputExceeded,
    stdout: stdout(),
    stderr: stderr()
  };
}

function parseChildJson(bytes) {
  try {
    return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes).trim());
  } catch {
    throw failure("BATCH_CHILD_OUTPUT_INVALID");
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function captureChildEvidence(proofDirectory, name, child, operation, fs, runtimeUid) {
  if (child.stdout.byteLength > 0) {
    await writeExclusive(proofDirectory, `${name}.stdout`, child.stdout, operation, fs, runtimeUid);
  }
  if (child.stderr.byteLength > 0) {
    await writeExclusive(proofDirectory, `${name}.stderr`, child.stderr, operation, fs, runtimeUid);
  }
  const exitBytes = canonicalCheckpointBytes({
    exit: child.exit,
    spawnError: child.spawnError,
    outputExceeded: child.outputExceeded
  });
  await writeExclusive(proofDirectory, `${name}.exit.json`, exitBytes, operation, fs, runtimeUid);
}

function validateSyntheticSummary(summary, proof) {
  const isPipeline = proof === "PIPELINE_QUOTE";
  requireBatch(isRecord(summary) &&
    summary.status === (isPipeline ? "PASS" : "UNKNOWN") &&
    summary.contractChecks === "PASS" &&
    summary.proof === `SYNTHETIC_${proof}` &&
    summary.producerRevision === PRODUCER_REVISION &&
    summary.hostAcceptance === "NOT_ASSESSED" &&
    summary.providerTrust === "NOT_ASSESSED" &&
    summary.liveExecution === false &&
    summary.restartDenied === true && summary.immutableReadback === true &&
    summary.https?.status === "DISABLED" &&
    (isPipeline
      ? summary.evaluation === "PASS" &&
        summary.outcome === "SIMULATED_ENTRY_EXIT_COMPLETE" &&
        summary.entryFills === 1 && summary.exits === 1
      : summary.evaluation === "UNKNOWN" &&
        summary.outcome === "OPEN_UNVALUED_TERMINAL_POSITION" &&
        summary.stopAccepted === true && summary.entryFills === 1 && summary.exits === 0),
  "BATCH_PROOF_RESULT_UNEXPECTED");
}

function controllerManifest(runId) {
  const config = {
    version: 1,
    mode: "SOURCE_BACKED_PAPER",
    enabled: true,
    runId,
    startedAt: Date.now() - 5_000,
    budgets: {...CONTROLLER_BUDGETS},
    sourcePolicy: structuredClone(PAPER_RUNTIME_SOURCE_POLICY),
    sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256
  };
  return {
    schemaVersion: "memecoin-paper-operational-manifest/v2",
    config,
    sourcePolicy: structuredClone(PAPER_RUNTIME_SOURCE_POLICY)
  };
}

async function runSyntheticProof({
  proof, batchDirectory, operation, fs, spawnImpl, runtimeUid
}) {
  const proofDirectory = await makePrivateDirectory(
    path.join(batchDirectory, proof.toLowerCase()), operation, fs, runtimeUid
  );
  const env = {
    PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
    PAPER_SYNTHETIC_ACCEPTANCE_HTTPS_ENABLED: "false",
    PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: proofDirectory,
    PAPER_SYNTHETIC_ACCEPTANCE_PROOF: proof
  };
  const child = await runChild([PROOF_SCRIPTS[proof]], env, operation, spawnImpl);
  await captureChildEvidence(proofDirectory, proof, child, operation, fs, runtimeUid);
  requireBatch(child.exit?.code === (proof === "PIPELINE_QUOTE" ? 0 : 2) &&
    child.exit.signal === null && child.spawnError === null && !child.outputExceeded,
  "BATCH_PROOF_EXIT_UNEXPECTED");
  const summary = parseChildJson(child.stdout);
  validateSyntheticSummary(summary, proof);
  const runDirectory = path.join(proofDirectory, summary.runId);
  const configBytes = await boundedRead(
    path.join(runDirectory, "config.json"), 64 * 1024, operation, fs, runtimeUid
  );
  const exportBytes = await boundedRead(
    path.join(runDirectory, "result.report.json"), MAX_EVIDENCE_BYTES, operation, fs, runtimeUid
  );
  requireBatch(sha256(configBytes) === summary.configSha256 &&
    sha256(exportBytes) === summary.exportSha256 &&
    exportBytes.byteLength === summary.byteLength, "BATCH_PROOF_READBACK_MISMATCH");
  await writeExclusive(proofDirectory, `${proof}.readback.json`, canonicalCheckpointBytes({
    configSha256: sha256(configBytes),
    exportSha256: sha256(exportBytes),
    byteLength: exportBytes.byteLength,
    readback: true
  }), operation, fs, runtimeUid);
  return {proof, status: summary.status, exitCode: child.exit.code, summary};
}

async function runControllerProof({
  batchDirectory, runId, operation, fs, spawnImpl, runtimeUid
}) {
  const proof = "CONTROLLER_SOURCE_POLICY_NO_ENTRY";
  const proofDirectory = await makePrivateDirectory(
    path.join(batchDirectory, "controller-no-entry"), operation, fs, runtimeUid
  );
  const runsDirectory = await makePrivateDirectory(
    path.join(proofDirectory, "runs"), operation, fs, runtimeUid
  );
  const manifestRunId = `controller-no-entry-${runId}`;
  const manifest = controllerManifest(manifestRunId);
  const manifestBytes = canonicalCheckpointBytes(manifest);
  await writeExclusive(proofDirectory, "manifest.json", manifestBytes, operation, fs, runtimeUid);
  const child = await runChild([
    PROOF_SCRIPTS[proof], "start", "--enable",
    "--manifest", path.join(proofDirectory, "manifest.json"),
    "--runs-dir", runsDirectory
  ], {}, operation, spawnImpl);
  await captureChildEvidence(proofDirectory, proof, child, operation, fs, runtimeUid);
  requireBatch(child.exit?.code === 2 && child.exit.signal === null &&
    child.spawnError === null && !child.outputExceeded,
  "BATCH_CONTROLLER_EXIT_UNEXPECTED");
  const result = parseChildJson(child.stdout);
  requireBatch(isRecord(result) && result.status === "UNKNOWN" &&
    result.runId === manifestRunId && result.runDirectoryCreated === true &&
    result.executionStarted === true && result.exportStatus === "ACKNOWLEDGED" &&
    result.statusPersistence === "ACKNOWLEDGED" && result.evaluatorOverall === "UNKNOWN",
  "BATCH_CONTROLLER_RESULT_UNEXPECTED");
  const expectedDirectory = path.join(runsDirectory, manifestRunId);
  requireBatch(result.runDirectory === expectedDirectory, "BATCH_CONTROLLER_PATH_UNEXPECTED");
  const exportBytes = await boundedRead(
    path.join(expectedDirectory, "run-export.json"), MAX_EVIDENCE_BYTES, operation, fs, runtimeUid
  );
  const expectedConfigSha256 = sha256(canonicalCheckpointBytes(manifest.config));
  const evaluation = evaluateMemecoinPaperRunExport(exportBytes, {
    runId: manifestRunId,
    configSha256: expectedConfigSha256,
    producerRevision: PRODUCER_REVISION
  });
  const report = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(exportBytes));
  requireBatch(evaluation.overall === "UNKNOWN" &&
    evaluation.evidence.entryFills === 0 &&
    report.runnerReport?.reason === "SOURCE_POLICY_UNAPPROVED" &&
    report.runnerReport?.sourcePolicy?.networkAccessed === false &&
    report.runnerReport?.counters?.quotes === 0,
  "BATCH_CONTROLLER_EXPORT_UNEXPECTED");
  await writeExclusive(proofDirectory, `${proof}.readback.json`, canonicalCheckpointBytes({
    configSha256: expectedConfigSha256,
    exportSha256: sha256(exportBytes),
    byteLength: exportBytes.byteLength,
    evaluation: evaluation.overall,
    entryFills: evaluation.evidence.entryFills,
    readback: true
  }), operation, fs, runtimeUid);
  return {proof, status: result.status, exitCode: child.exit.code, result, exportSha256: sha256(exportBytes)};
}

async function createClaim(identity, storageRoot, operation, fs, runtimeUid) {
  const claimBytes = canonicalCheckpointBytes({
    schemaVersion: "paper-host-acceptance-batch-claim/v1",
    status: "CLAIMED",
    sourceRevision: identity.sourceRevision,
    imageDigest: identity.imageDigest,
    runId: identity.runId,
    proofs: REQUIRED_PROOFS
  });
  try {
    await writeExclusive(storageRoot, CLAIM_NAME, claimBytes, operation, fs, runtimeUid);
    return {claimed: true, claimSha256: sha256(claimBytes)};
  } catch (error) {
    if (error.code === "EEXIST") return {claimed: false};
    throw error;
  }
}

async function validateStorage(mountRoot, storageRoot, operation, fs, runtimeUid, validator) {
  await operation.wait(() => validator(mountRoot, storageRoot, {
    lstatPath: filename => operation.wait(() => fs.lstat(filename)),
    mkdirPath: (directory, options) => operation.wait(() => fs.mkdir(directory, options)),
    runtimeUid
  }));
  await syncDirectory(mountRoot, operation, fs);
  const info = await operation.wait(() => fs.lstat(storageRoot));
  requireBatch(info.isDirectory() && !info.isSymbolicLink() && info.uid === runtimeUid &&
    [0o700, 0o2700].includes(info.mode & 0o7777) &&
    await operation.wait(() => fs.realpath(storageRoot)) === storageRoot,
  "BATCH_STORAGE_ROOT_UNSAFE");
}

async function runBatchWork({
  identity, mountRoot, storageRoot, operation, fs, validator, mountValidator, spawnImpl, runtimeUid
}) {
  await operation.wait(() => mountValidator(operation, fs));
  await validateStorage(mountRoot, storageRoot, operation, fs, runtimeUid, validator);
  const claim = await createClaim(identity, storageRoot, operation, fs, runtimeUid);
  if (!claim.claimed) {
    return {
      status: "ALREADY_CLAIMED",
      requestedIdentity: identity,
      executionStarted: false
    };
  }
  const proofs = [];
  try {
    const batchDirectory = await makePrivateDirectory(
      path.join(storageRoot, identity.runId), operation, fs, runtimeUid
    );
    for (const proof of REQUIRED_PROOFS) {
      operation.check();
      if (operation.shutdownSignal) throw failure("BATCH_CANCELLED");
      const result = proof === "CONTROLLER_SOURCE_POLICY_NO_ENTRY"
        ? await runControllerProof({
          batchDirectory, runId: identity.runId, operation, fs, spawnImpl, runtimeUid
        })
        : await runSyntheticProof({
          proof, batchDirectory, operation, fs, spawnImpl, runtimeUid
        });
      proofs.push(result);
      await writeExclusive(
        batchDirectory, `${proof.toLowerCase()}.result.json`,
        canonicalCheckpointBytes(result), operation, fs, runtimeUid
      );
      if (operation.shutdownSignal) throw failure("BATCH_CANCELLED");
    }
    operation.check();
    return {
      ...identity,
      status: "BATCH_COMPLETE",
      executionStarted: true,
      proofs,
      hostAcceptance: "NOT_ASSESSED",
      networkAccessed: false,
      liveExecution: false,
      claimSha256: claim.claimSha256
    };
  } catch (error) {
    error.claimAcquired = true;
    error.proofs = proofs;
    if (error.code === "EEXIST") error.code = "BATCH_EVIDENCE_ALREADY_EXISTS";
    throw error;
  }
}

async function waitInert(signalSource) {
  await new Promise(resolve => {
    const finish = () => {
      signalSource.removeListener("SIGINT", finish);
      signalSource.removeListener("SIGTERM", finish);
      resolve();
    };
    signalSource.once("SIGINT", finish);
    signalSource.once("SIGTERM", finish);
  });
}

export async function runHostAcceptanceBatch({
  enabled = false,
  sourceRevision,
  imageDigest,
  runId,
  hold = false,
  timeoutMs = MAX_BATCH_MS,
  mountRoot = PAPER_EXPORT_MOUNT_ROOT,
  storageRoot = mountRoot === PAPER_EXPORT_MOUNT_ROOT
    ? STORAGE_ROOT
    : path.join(mountRoot, "host-acceptance-batch"),
  runtimeUid = typeof process.getuid === "function" ? process.getuid() : -1,
  runtimeGid = typeof process.getgid === "function" ? process.getgid() : -1,
  monotonicNow,
  signalSource = process,
  fileSystem = {lstat, mkdir, open},
  validateStorageRoot = validatePaperExportStorageRoot,
  validateMount = validateActualMount,
  spawnImpl = spawn,
  onResult
} = {}) {
  if (enabled !== true) {
    const result = {status: "DISABLED", executionStarted: false};
    onResult?.(result);
    if (hold) await waitInert(signalSource);
    return result;
  }
  const identity = validateIdentity({sourceRevision, imageDigest, runId});
  requireBatch(runtimeUid === process.getuid() && runtimeGid === process.getgid(),
    "BATCH_RUNTIME_IDENTITY_INVALID");
  const fs = {lstat, mkdir, open, realpath, ...fileSystem};
  const operation = createDeadline({timeoutMs, monotonicNow, signalSource});
  let result;
  try {
    result = await runBatchWork({
      identity, mountRoot, storageRoot, operation, fs,
      validator: validateStorageRoot, mountValidator: validateMount, spawnImpl, runtimeUid
    });
    operation.check();
  } catch (error) {
    result = {
      ...identity,
      status: error.code === "BATCH_DEADLINE_EXCEEDED" ||
        error.code === "BATCH_CANCELLED" || error.claimAcquired ? "UNKNOWN" : "BLOCKED",
      code: typeof error.code === "string" && error.code.startsWith("BATCH_")
        ? error.code
        : "BATCH_OPERATION_FAILED",
      executionStarted: operation.childStarted,
      ...(Array.isArray(error.proofs) ? {proofs: error.proofs} : {})
    };
  }
  operation.stopDeadline();
  try {
    onResult?.(result);
    if (hold && !operation.signal.aborted) await operation.hold();
    return result;
  } finally {
    operation.dispose();
  }
}

function environmentConfig(env) {
  const enabled = env.PAPER_HOST_ACCEPTANCE_BATCH_ENABLED;
  if (enabled === undefined || enabled === "false") {
    if (![undefined, "false", "true"].includes(env.PAPER_HOST_ACCEPTANCE_BATCH_HOLD)) {
      throw failure("BATCH_CONFIGURATION_INVALID");
    }
    return {enabled: false, hold: env.PAPER_HOST_ACCEPTANCE_BATCH_HOLD === "true"};
  }
  if (enabled !== "true" || ![undefined, "false", "true"].includes(
    env.PAPER_HOST_ACCEPTANCE_BATCH_HOLD
  )) {
    throw failure("BATCH_CONFIGURATION_INVALID");
  }
  return {
    enabled: true,
    hold: env.PAPER_HOST_ACCEPTANCE_BATCH_HOLD === "true",
    sourceRevision: env.PAPER_HOST_ACCEPTANCE_BATCH_SOURCE_REVISION,
    imageDigest: env.PAPER_HOST_ACCEPTANCE_BATCH_IMAGE_DIGEST,
    runId: env.PAPER_HOST_ACCEPTANCE_BATCH_RUN_ID
  };
}

export async function main({
  env = process.env,
  stdout = process.stdout,
  signalSource = process,
  ...options
} = {}) {
  let result;
  let emitted = false;
  const emitResult = value => {
    stdout.write(`${JSON.stringify(value)}\n`);
    emitted = true;
  };
  try {
    const config = environmentConfig(env);
    if (config.enabled) {
      requireBatch(typeof process.getuid === "function" && process.getuid() === 1000 &&
        typeof process.getgid === "function" && process.getgid() === 1000,
      "BATCH_RUNTIME_IDENTITY_INVALID");
    }
    result = await runHostAcceptanceBatch({
      ...options, ...config, signalSource, onResult: emitResult
    });
  } catch (error) {
    result = {
      status: "BLOCKED",
      code: typeof error.code === "string" && error.code.startsWith("BATCH_")
        ? error.code
        : "BATCH_CONFIGURATION_INVALID",
      executionStarted: false
    };
  }
  if (!emitted) emitResult(result);
  return result.status === "DISABLED" || result.status === "BATCH_COMPLETE" ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
