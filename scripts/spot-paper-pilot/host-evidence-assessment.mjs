#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readRunJournal } from "./journal.mjs";
import {
  HOST_LAUNCH_MANIFEST, inspectHostRun, runtimeSourceDigest
} from "./host-entrypoint.mjs";
import { HOST_EIGHT_HOUR_PROFILE_ID } from "./evidence-profiles.mjs";
import { verifyExpectedHostContext } from "./host-context.mjs";
import { assessPaperEvidence } from "./paper-evidence-assessment.mjs";
import { replaySpotPaperSignals } from "./signal-replay.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST_PATH = join(ROOT, "scripts/spot-paper-pilot/host-launch-manifest.json");
const MAX_MANIFEST_BYTES = 16_384;
const MAX_CONTEXT_BYTES = 16_384;
const MAX_STATE_BYTES = 16_384;
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const INSPECTION_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 15_000;
const READ_CHUNK_BYTES = 64 * 1024;
const isInteger = Number.isSafeInteger;

function createDeadlineContext(timeoutMs = TOTAL_TIMEOUT_MS) {
  const controller = new AbortController();
  return {
    deadlineAt: performance.now() + timeoutMs,
    monotonicNow: () => performance.now(),
    controller,
    signal: controller.signal,
    pendingOperations: new Set()
  };
}

function assertActive(context) {
  if (context.signal?.aborted) {
    throw new Error(context.signal.reason?.message ?? "HOST_ASSESSMENT_ABORTED");
  }
  if (!Number.isFinite(context.monotonicNow()) ||
      context.monotonicNow() >= context.deadlineAt) {
    throw new Error("HOST_ASSESSMENT_DEADLINE_EXCEEDED");
  }
}

function trackOperation(context, promise) {
  context.pendingOperations.add(promise);
  promise.then(
    () => context.pendingOperations.delete(promise),
    () => context.pendingOperations.delete(promise)
  );
  return promise;
}

function startCleanup(context, operation) {
  const cleanup = trackOperation(context, Promise.resolve().then(operation));
  cleanup.catch(() => {});
}

async function boundedIo(operation, context, cleanupLateResult) {
  assertActive(context);
  let timedOut = false;
  const task = trackOperation(context, Promise.resolve().then(() => {
    assertActive(context);
    return operation();
  }));
  const cleanupLate = value => {
    if ((timedOut || context.signal.aborted ||
        context.monotonicNow() >= context.deadlineAt) && cleanupLateResult) {
      startCleanup(context, () => cleanupLateResult(value));
    }
  };
  task.then(cleanupLate, () => cleanupLate(undefined));
  const timeout = new Promise((_, reject) => {
    const remaining = Math.max(0, context.deadlineAt - context.monotonicNow());
    const timer = setTimeout(() => {
      timedOut = true;
      const error = new Error("HOST_ASSESSMENT_DEADLINE_EXCEEDED");
      context.controller.abort(error);
      reject(error);
    }, remaining);
    task.finally(() => clearTimeout(timer)).catch(() => {});
  });
  const result = await Promise.race([task, timeout]);
  assertActive(context);
  return result;
}

function startHandleClose(handle, context) {
  startCleanup(context, () => handle.close());
}

async function closeHandle(handle, context) {
  try {
    if (context.signal.aborted || context.monotonicNow() >= context.deadlineAt) {
      startHandleClose(handle, context);
      return;
    }
    await boundedIo(() => handle.close(), context);
  } catch (error) {
    if (error.message === "HOST_ASSESSMENT_DEADLINE_EXCEEDED" &&
        context.pendingOperations.size === 0) {
      startHandleClose(handle, context);
    }
    throw error;
  }
}

async function readBoundedFile(path, maxBytes, context, io) {
  assertActive(context);
  let handle;
  try {
    handle = await boundedIo(() => (io.open ?? open)(path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)),
    context, lateHandle => lateHandle.close());
    const info = await boundedIo(() => handle.stat(), context);
    if (!info.isFile() || info.size > maxBytes) {
      throw new Error("INPUT_FILE_INVALID_OR_TOO_LARGE");
    }
    const chunks = [];
    let total = 0;
    for (;;) {
      assertActive(context);
      const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, maxBytes + 1 - total));
      const { bytesRead } = await boundedIo(
        () => handle.read(buffer, 0, buffer.length, total), context);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new Error("INPUT_FILE_INVALID_OR_TOO_LARGE");
      chunks.push(buffer.subarray(0, bytesRead));
    }
    assertActive(context);
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error.code === "ELOOP") throw new Error("INPUT_FILE_INVALID_OR_TOO_LARGE");
    throw error;
  } finally {
    if (handle) await closeHandle(handle, context);
  }
}

function parseJson(bytes, errorCode) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(errorCode);
  }
}

function isWithin(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    path !== ".." && !isAbsolute(path));
}

function unknownResult(reason) {
  return {
    schemaVersion: "SPOT_PAPER_HOST_OFFLINE_ASSESSMENT_V1",
    outcome: "UNKNOWN",
    reason,
    hostContextBinding: "NOT_VERIFIED",
    sourceAuthenticity: "UNATTESTED",
    clockAuthenticity: "UNATTESTED",
    providerAuthenticity: "UNATTESTED",
    launchReadiness: "NOT_ASSESSED"
  };
}

async function readHostReadback(evidenceDir, hostManifest, context, io) {
  const runDirectory = join(evidenceDir, "runtime", hostManifest.runId);
  const journalPath = join(runDirectory, "journal.json");
  const pendingPath = join(runDirectory, "journal.pending");
  assertActive(context);
  const pending = await boundedIo(() => (io.lstat ?? lstat)(pendingPath), context)
    .then(() => true, error => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  assertActive(context);
  if (pending) throw new Error("JOURNAL_PENDING_PUBLICATION");
  const firstJournalBytes = await readBoundedFile(
    journalPath, MAX_JOURNAL_BYTES, context, io);
  const journalDeadlineAt = Math.min(context.deadlineAt,
    context.monotonicNow() + INSPECTION_TIMEOUT_MS);
  const journal = await readRunJournal({
    dataRoot: join(evidenceDir, "runtime"),
    runId: hostManifest.runId,
    deadlineAt: journalDeadlineAt,
    monotonicNow: context.monotonicNow,
    io: {
      lstat: async path => {
        const journalContext = {
          ...context,
          deadlineAt: journalDeadlineAt
        };
        return boundedIo(() => (io.lstat ?? lstat)(path), journalContext);
      },
      readFile: async path => {
        const name = path.split(/[\\/]/).at(-1);
        const limit = name === "journal.json" ? MAX_JOURNAL_BYTES :
          name === "journal.pending" ? 16_384 : /^[a-f0-9]{64}\.json$/.test(name) ?
            hostManifest.maxResponseBytes : 0;
        if (!limit) throw new Error("INVALID_JOURNAL_FILE_REFERENCE");
        const journalContext = {
          ...context,
          deadlineAt: journalDeadlineAt
        };
        return readBoundedFile(path, limit, journalContext, io);
      }
    }
  });
  const secondJournalBytes = await readBoundedFile(
    journalPath, MAX_JOURNAL_BYTES, context, io);
  if (!firstJournalBytes.equals(secondJournalBytes)) {
    throw new Error("JOURNAL_CHANGED_DURING_ASSESSMENT");
  }
  if (journal.reconciliationStatus !== "READ_ONLY_VERIFIED") {
    throw new Error(journal.reconciliationStatus ?? "JOURNAL_NOT_TERMINAL");
  }
  const events = journal.events;
  const report = events?.at(-1)?.report;
  return {
    ...journal,
    reconciliation: "TERMINAL_REPORT_AVAILABLE",
    runId: journal.runId,
    eventCount: events?.length,
    resumed: false,
    executionImpact: false,
    report
  };
}

async function readResponseBodies(readback, profile, runDirectory, context, io) {
  const references = new Map();
  for (const event of readback.events) {
    for (const reference of [
      event.ohlc, event.ticker, event.acceptedOhlc, event.acceptedTicker
    ]) {
      if (!reference) continue;
      if (!/^[a-f0-9]{64}$/.test(reference.sha256 ?? "") ||
          reference.path !== `responses/${reference.sha256}.json` ||
          !isInteger(reference.bytes) || reference.bytes < 1 ||
          reference.bytes > profile.maxResponseBytes) {
        throw new Error("INVALID_RAW_REFERENCE");
      }
      if (!references.has(reference.sha256)) references.set(reference.sha256, reference);
    }
  }
  if (references.size > profile.maxRequests) {
    throw new Error("RESPONSE_REFERENCE_LIMIT_EXCEEDED");
  }
  const responseBodies = {};
  let totalBytes = 0;
  for (const [hash, reference] of references) {
    const raw = await readBoundedFile(
      join(runDirectory, reference.path), profile.maxResponseBytes, context, io);
    totalBytes += raw.byteLength;
    if (raw.byteLength !== reference.bytes || totalBytes > profile.maxBytes ||
        createHash("sha256").update(raw).digest("hex") !== hash) {
      throw new Error("RAW_RESPONSE_MISMATCH_OR_LIMIT");
    }
    responseBodies[hash] = raw.toString("utf8");
  }
  return responseBodies;
}

export async function assessHostEvidence({
  evidenceDir, expectedHostContext, deadlineAt, context: suppliedContext, io = {}
} = {}) {
  const context = suppliedContext ?? createDeadlineContext();
  if (deadlineAt !== undefined) context.deadlineAt = Math.min(context.deadlineAt, deadlineAt);
  try {
    if (typeof evidenceDir !== "string" || !evidenceDir.trim() || !isAbsolute(evidenceDir)) {
      throw new Error("ABSOLUTE_EVIDENCE_DIRECTORY_REQUIRED");
    }
    const directory = resolve(evidenceDir ?? "");
    if (directory === "/") {
      throw new Error("ABSOLUTE_EVIDENCE_DIRECTORY_REQUIRED");
    }
    assertActive(context);
    const manifestBytes = await readBoundedFile(
      MANIFEST_PATH, MAX_MANIFEST_BYTES, context, io);
    const hostManifest = parseJson(manifestBytes, "MALFORMED_LAUNCH_MANIFEST");
    if (!HOST_LAUNCH_MANIFEST ||
        JSON.stringify(hostManifest) !== JSON.stringify(HOST_LAUNCH_MANIFEST)) {
      throw new Error("PACKAGED_LAUNCH_MANIFEST_MISMATCH");
    }
    const sourceDigest = await runtimeSourceDigest(ROOT, context, { open: io.open });
    if (sourceDigest !== hostManifest.runtimeSourceSha256) {
      throw new Error("RUNTIME_SOURCE_DIGEST_MISMATCH");
    }
    const hostManifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
    const profileId = HOST_EIGHT_HOUR_PROFILE_ID;
    const profile = {
      maxCycles: hostManifest.maxCycles,
      maxRequests: hostManifest.maxRequests,
      maxBytes: hostManifest.maxBytes,
      maxResponseBytes: hostManifest.maxResponseBytes
    };
    const stateBytes = await readBoundedFile(
      join(directory, "host-state.json"), MAX_STATE_BYTES, context, io);
    const hostState = parseJson(stateBytes, "INVALID_HOST_STATE_JSON");
    const hostInspection = await inspectHostRun(directory, {
      includeReport: true,
      timeoutMs: Math.min(INSPECTION_TIMEOUT_MS, Math.max(1,
        Math.floor(context.deadlineAt - context.monotonicNow()))),
      io: { open: io.open, lstat: io.lstat }
    });
    if (hostInspection.status !== "VERIFIED_TERMINAL" ||
        hostInspection.verifiedTerminal !== true) {
      return unknownResult(hostInspection.reason ?? "HOST_TERMINAL_EVIDENCE_UNVERIFIED");
    }
    const stateBytesAfterInspection = await readBoundedFile(
      join(directory, "host-state.json"), MAX_STATE_BYTES, context, io);
    if (!stateBytes.equals(stateBytesAfterInspection)) {
      throw new Error("HOST_STATE_CHANGED_DURING_ASSESSMENT");
    }

    const readback = await readHostReadback(directory, hostManifest, context, io);
    const terminalReport = readback.events.at(-1)?.report;
    if (!terminalReport || JSON.stringify(terminalReport) !==
        JSON.stringify(hostInspection.report)) {
      throw new Error("HOST_REPORT_JOURNAL_MISMATCH");
    }
    const contextCheck = verifyExpectedHostContext({
      expectedHostContext, hostManifest, hostManifestSha256, hostState, readback
    });
    if (contextCheck.status !== "PASS") {
      return {
        ...unknownResult(contextCheck.reason),
        outcome: contextCheck.status,
        hostContextBinding: contextCheck.status
      };
    }
    const runDirectory = join(directory, "runtime", hostManifest.runId);
    const responseBodies = await readResponseBodies(
      readback, profile, runDirectory, context, io);
    const assessment = assessPaperEvidence({
      paperExitCode: hostState.childExitCode,
      paperReport: readback.report,
      readback,
      provenance: null,
      responseBodies,
      profileId,
      expectedHostContext,
      hostManifest,
      hostManifestSha256,
      hostState
    });
    const signalReplay = replaySpotPaperSignals({
      readback,
      provenance: null,
      responseBodies,
      profileId,
      expectedHostContext,
      hostManifest,
      hostManifestSha256,
      hostState
    });
    const outcome = assessment.outcome === "COMPLETED" && signalReplay.outcome === "PASS" ?
      "COMPLETED" : assessment.outcome === "UNKNOWN" || signalReplay.outcome === "UNKNOWN" ?
        "UNKNOWN" : "FAILED";
    const result = {
      schemaVersion: "SPOT_PAPER_HOST_OFFLINE_ASSESSMENT_V1",
      outcome,
      hostContextBinding: "CONTENT_BOUND",
      imageIdentity: contextCheck.imageIdentity,
      hostIdentity: contextCheck.hostIdentity,
      sourceAuthenticity: "UNATTESTED",
      clockAuthenticity: "UNATTESTED",
      providerAuthenticity: "UNATTESTED",
      launchReadiness: "NOT_ASSESSED",
      assessment,
      signalReplay
    };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_OUTPUT_BYTES) {
      return unknownResult("ASSESSMENT_OUTPUT_LIMIT");
    }
    return result;
  } catch (error) {
    const code = /^[A-Z0-9_]+$/.test(error.message ?? "") ?
      error.message : "HOST_ASSESSMENT_FAILED";
    return unknownResult(code);
  }
}

async function assertExternalInputPath(evidenceDir, inputPath, label, context, io) {
  const resolved = resolve(inputPath);
  const [evidenceRoot, inputParent] = await Promise.all([
    boundedIo(() => (io.realpath ?? realpath)(evidenceDir), context),
    boundedIo(() => (io.realpath ?? realpath)(dirname(resolved)), context)
  ]);
  assertActive(context);
  const actualPath = join(inputParent, basename(resolved));
  if (!isAbsolute(resolved) || isWithin(evidenceRoot, actualPath)) {
    throw new Error(`${label}_MUST_BE_EXTERNAL_TO_EVIDENCE`);
  }
  return actualPath;
}

async function publishOutput(outputPath, outputBytes, context, io) {
  const temporaryPath = join(dirname(outputPath), `.${basename(outputPath)}.${randomUUID()}.tmp`);
  let published = false;
  let linkStarted = false;
  const remove = path => (io.unlink ?? unlink)(path).catch(error => {
    if (error.code !== "ENOENT") throw error;
  });
  try {
    await boundedIo(
      () => (io.writeFile ?? writeFile)(temporaryPath, outputBytes, { flag: "wx" }),
      context, () => remove(temporaryPath));
    await boundedIo(() => {
      linkStarted = true;
      return (io.link ?? link)(temporaryPath, outputPath);
    },
      context, () => remove(outputPath));
    published = true;
    await boundedIo(() => remove(temporaryPath), context);
    assertActive(context);
  } catch (error) {
    startCleanup(context, () => remove(temporaryPath));
    if (published || linkStarted) {
      startCleanup(context, () => remove(outputPath));
    }
    throw error;
  }
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const context = createDeadlineContext(dependencies.timeoutMs ?? TOTAL_TIMEOUT_MS);
  const io = dependencies.io ?? {};
  const [evidenceDirArg, expectedContextPathArg, outputPathArg] = argv;
  if (!evidenceDirArg || !expectedContextPathArg || !outputPathArg || argv.length !== 3) {
    throw new Error(
      "Usage: host-evidence-assessment.mjs <evidence-directory> <expected-host-context.json> <assessment.json>");
  }
  const evidenceDir = resolve(evidenceDirArg);
  assertActive(context);
  const expectedContextPath = expectedContextPathArg === "-" ? null :
    await assertExternalInputPath(
      evidenceDir, expectedContextPathArg, "EXPECTED_HOST_CONTEXT", context, io);
  const outputPath = await assertExternalInputPath(
    evidenceDir, outputPathArg, "ASSESSMENT_OUTPUT", context, io);
  let expectedHostContext;
  if (expectedContextPath) {
    try {
      const contextBytes = await readBoundedFile(
        expectedContextPath, MAX_CONTEXT_BYTES, context, io);
      expectedHostContext = parseJson(contextBytes, "EXPECTED_HOST_CONTEXT_MALFORMED");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const result = await assessHostEvidence({
    evidenceDir, expectedHostContext, context, io
  });
  assertActive(context);
  const outputBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
  if (outputBytes.byteLength > MAX_OUTPUT_BYTES) {
    throw new Error("ASSESSMENT_OUTPUT_LIMIT");
  }
  await publishOutput(outputPath, outputBytes, context, io);
  try {
    assertActive(context);
  } catch (error) {
    startCleanup(context, () => (io.unlink ?? unlink)(outputPath).catch(() => {}));
    throw error;
  }
  (dependencies.stdout ?? process.stdout).write(outputBytes);
  if (result.outcome !== "COMPLETED") process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
