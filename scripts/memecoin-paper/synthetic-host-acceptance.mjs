import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdir, open, realpath} from "node:fs/promises";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {pathToFileURL} from "node:url";
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
const PROOFS = new Set(["PIPELINE_QUOTE", "ACTIVE_STOP"]);
const BUDGETS = Object.freeze({
  requests: 40, bytes: 1_000_000, events: 128, candidates: 4, cycles: 8,
  durationMs: 20_000, callbackTimeoutMs: 1_000, maxWallClockUncertaintyMs: 10
});
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const MAX_ACCEPTANCE_MS = 60_000;

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

async function runAcceptance({
  dataRoot, proof = "PIPELINE_QUOTE",
  httpsOptions
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
  const stop = () => { stopAccepted = pilot.stop() || stopAccepted; };
  const pilot = makePilot(proof === "ACTIVE_STOP" ? stop : undefined);
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
  const expectedOverall = proof === "ACTIVE_STOP" ? "UNKNOWN" : "PASS";
  requireProof(evaluation.overall === expectedOverall &&
    !evaluation.checks.some(item => item.status === "FAIL") &&
    result.report.persistence === "ACKNOWLEDGED" &&
    operations.some(item => item.method === "executeEntry" && item.status === "FILLED_PAPER"));
  if (proof === "ACTIVE_STOP") {
    requireProof(stopAccepted && result.status === "STOPPED" &&
      evaluation.outcome === "OPEN_UNVALUED_TERMINAL_POSITION" &&
      result.report.runnerReport.reason === "SHUTDOWN");
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
    hostAcceptance: "NOT_ASSESSED", providerTrust: "NOT_ASSESSED", liveExecution: false
  };
  await writeNew(directory, "summary.json", canonicalCheckpointBytes(summary), operation);
  return {summary, result, exportBytes, directory};
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
      [undefined, "false", "true"].includes(env.PAPER_SYNTHETIC_ACCEPTANCE_HTTPS_ENABLED));
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
}
