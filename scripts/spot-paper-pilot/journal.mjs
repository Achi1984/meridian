import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const SCHEMA = "SPOT_PAPER_PILOT_JOURNAL_V1";
const DEFAULT_IO_TIMEOUT_MS = 5_000;
const CLEANUP_GRACE_MS = 1_000;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encoded(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function unknownError(cause) {
  const error = new Error("JOURNAL_UNKNOWN", { cause });
  error.code = "JOURNAL_UNKNOWN";
  return error;
}

function contextFor(options = {}) {
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const now = monotonicNow();
  return {
    monotonicNow,
    deadlineAt: options.deadlineAt ?? now + DEFAULT_IO_TIMEOUT_MS,
    signal: options.signal
  };
}

async function bounded(operation, context, cleanupLateResult) {
  const assertActive = () => {
    if (context.signal?.aborted) throw unknownError(context.signal.reason ?? new Error("aborted"));
    if (!Number.isFinite(context.deadlineAt - context.monotonicNow()) ||
        context.monotonicNow() >= context.deadlineAt) {
      throw unknownError(new Error("deadline exceeded"));
    }
  };
  assertActive();
  const remaining = context.deadlineAt - context.monotonicNow();
  let timer;
  let abortListener;
  let finished = false;
  const task = Promise.resolve().then(() => {
    assertActive();
    return operation();
  });
  task.then(value => {
    if (finished && cleanupLateResult) {
      void Promise.resolve().then(() => cleanupLateResult(value)).catch(() => {});
    }
  }, () => {});
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(unknownError(new Error("deadline exceeded"))), remaining);
  });
  const aborted = context.signal ? new Promise((_, reject) => {
    abortListener = () => reject(unknownError(context.signal.reason ?? new Error("aborted")));
    context.signal.addEventListener("abort", abortListener, { once: true });
  }) : new Promise(() => {});
  try {
    const result = await Promise.race([task, timeout, aborted]);
    try {
      assertActive();
    } catch (error) {
      if (cleanupLateResult) {
        void Promise.resolve().then(() => cleanupLateResult(result)).catch(() => {});
      }
      throw error;
    }
    return result;
  } finally {
    finished = true;
    clearTimeout(timer);
    if (abortListener) context.signal.removeEventListener("abort", abortListener);
  }
}

function cleanupContext(context) {
  return {
    monotonicNow: context.monotonicNow,
    deadlineAt: context.monotonicNow() + CLEANUP_GRACE_MS,
    signal: null
  };
}

async function closeHandle(handle, context) {
  if (!handle) return;
  try {
    await bounded(() => handle.close(), cleanupContext(context));
  } catch {}
}

function openHandle(path, flags, mode, io, context) {
  return bounded(() => io.open(path, flags, mode),
    context, handle => closeHandle(handle, context));
}

async function syncDirectory(path, io, context) {
  const handle = await openHandle(path, constants.O_RDONLY, undefined, io, context);
  try {
    await bounded(() => handle.sync(), context);
  } finally {
    await closeHandle(handle, context);
  }
}

async function writeSynced(path, bytes, io, context, exclusive = false) {
  const handle = await openHandle(path, exclusive ? "wx" : "w", 0o600, io, context);
  try {
    await bounded(() => handle.writeFile(bytes), context);
    await bounded(() => handle.sync(), context);
  } finally {
    await closeHandle(handle, context);
  }
}

async function publishSnapshot({ path, runDirectory, oldPayload, nextPayload, io, context, phase }) {
  const payloadBytes = encoded(nextPayload);
  const envelopeBytes = encoded({ payload: nextPayload, sha256: digest(payloadBytes) });
  const pendingPath = join(runDirectory, "journal.pending");
  const previousBytes = oldPayload ? encoded(oldPayload) : null;
  const marker = {
    schemaVersion: "SPOT_PAPER_PILOT_PENDING_V1",
    previousSequence: oldPayload?.sequence ?? null,
    previousSha256: previousBytes ? digest(previousBytes) : null,
    nextSequence: nextPayload.sequence,
    candidateSha256: digest(payloadBytes)
  };
  await phase("before-pending", marker, context);
  await writeSynced(pendingPath, encoded(marker), io, context, true);
  await syncDirectory(runDirectory, io, context);
  await phase("after-pending", marker, context);

  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeSynced(temporary, envelopeBytes, io, context, true);
  await phase("after-file-sync", marker, context);
  await phase("before-rename", marker, context);
  await bounded(() => io.rename(temporary, path), context);
  await phase("after-rename", marker, context);
  await syncDirectory(runDirectory, io, context);
  await phase("after-directory-sync", marker, context);

  const readback = await bounded(() => io.readFile(path), context);
  await phase("after-readback", marker, context);
  if (!readback.equals(envelopeBytes)) throw new Error("journal exact readback mismatch");
  const verified = JSON.parse(readback.toString("utf8"));
  if (verified.payload.sequence !== nextPayload.sequence ||
      digest(encoded(verified.payload)) !== verified.sha256 ||
      verified.sha256 !== digest(payloadBytes)) {
    throw new Error("journal readback checksum mismatch");
  }
  await phase("before-ack", marker, context);
  await bounded(() => io.rm(pendingPath), context);
  await syncDirectory(runDirectory, io, context);
  return nextPayload;
}

function validateRunId(runId) {
  if (typeof runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(runId)) {
    throw new Error("INVALID_RUN_ID");
  }
}

function validatePayload(payload) {
  if (!payload || payload.schemaVersion !== SCHEMA || !Array.isArray(payload.events) ||
      typeof payload.runId !== "string" || !Number.isSafeInteger(payload.sequence) ||
      payload.sequence !== payload.events.length) {
    throw new Error("INVALID_JOURNAL_SCHEMA");
  }
  const ids = new Map();
  for (const event of payload.events) {
    if (!event || typeof event.id !== "string" || !event.id) {
      throw new Error("INVALID_JOURNAL_EVENT");
    }
    if (ids.has(event.id)) throw new Error("DUPLICATE_JOURNAL_EVENT");
    ids.set(event.id, event);
  }
}

export async function createRunJournal({
  dataRoot, runId, manifest, deadlineAt, monotonicNow, signal, io: injectedIo = {},
  phase: injectedPhase
}) {
  validateRunId(runId);
  if (typeof dataRoot !== "string" || !dataRoot.trim()) throw new Error("DATA_ROOT_REQUIRED");
  const io = { lstat, mkdir, open, readFile, rename, rm, ...injectedIo };
  const context = contextFor({ deadlineAt, monotonicNow, signal });
  const phase = async (name, details, operationContext = context) => {
    if (injectedPhase) {
      await bounded(() => injectedPhase(name, details), operationContext);
    }
  };
  const root = resolve(dataRoot);
  await bounded(() => io.mkdir(root, { recursive: true, mode: 0o700 }), context);
  const rootInfo = await bounded(() => io.lstat(root), context);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("INVALID_DATA_ROOT");
  await syncDirectory(dirname(root), io, context);
  const runDirectory = join(root, runId);
  await bounded(() => io.mkdir(runDirectory, { mode: 0o700 }), context);
  await syncDirectory(root, io, context);
  const lockPath = join(runDirectory, "writer.lock");
  const lock = await openHandle(lockPath, "wx", 0o600, io, context);
  try {
    await bounded(() => lock.writeFile(JSON.stringify({ pid: process.pid, runId }) + "\n"), context);
    await bounded(() => lock.sync(), context);
  } catch (error) {
    throw unknownError(error);
  } finally {
    await closeHandle(lock, context);
  }
  await syncDirectory(runDirectory, io, context);
  const responseDirectory = join(runDirectory, "responses");
  await bounded(() => io.mkdir(responseDirectory, { mode: 0o700 }), context);
  await syncDirectory(runDirectory, io, context);

  const journalPath = join(runDirectory, "journal.json");
  const initial = {
    schemaVersion: SCHEMA, runId, manifest,
    createdAt: manifest?.startedAt ?? Date.now(),
    sequence: 0, checkpoint: null, events: []
  };
  try {
    await publishSnapshot({
      path: journalPath, runDirectory, oldPayload: null, nextPayload: initial,
      io, context, phase
    });
  } catch (error) {
    throw unknownError(error);
  }
  let payload = initial;
  let closed = false;
  let busy = false;
  let poisoned = false;

  async function mutate(operation, options = {}) {
    if (closed) throw new Error("JOURNAL_CLOSED");
    if (poisoned) throw unknownError(new Error("journal is fenced after ambiguous I/O"));
    if (busy) {
      const error = new Error("JOURNAL_BUSY");
      error.code = "JOURNAL_BUSY";
      throw error;
    }
    busy = true;
    try {
      return await operation(contextFor({
        deadlineAt: options.deadlineAt ?? context.deadlineAt,
        monotonicNow: options.monotonicNow ?? context.monotonicNow,
        signal: options.signal === undefined ? context.signal : options.signal
      }));
    } catch (error) {
      if (error.code === "CONFLICTING_EVENT_ID") throw error;
      poisoned = true;
      throw unknownError(error);
    } finally {
      busy = false;
    }
  }

  return Object.freeze({
    runDirectory,
    snapshot: () => structuredClone(payload),
    get poisoned() { return poisoned; },
    async persistResponse(response, options = {}) {
      if (!response || typeof response.raw !== "string" ||
          !/^[a-f0-9]{64}$/.test(response.sha256)) {
        throw new Error("INVALID_RESPONSE_RECORD");
      }
      const bytes = Buffer.from(response.raw, "utf8");
      if (digest(bytes) !== response.sha256 ||
          (response.bytes !== undefined && response.bytes !== bytes.byteLength)) {
        throw new Error("RESPONSE_CHECKSUM_MISMATCH");
      }
      return mutate(async operationContext => {
        const relativePath = `responses/${response.sha256}.json`;
        const path = join(runDirectory, relativePath);
        const record = {
          sha256: response.sha256, bytes: bytes.byteLength,
          requestStartedAt: response.requestStartedAt, receivedAt: response.receivedAt
        };
        await phase("response-before-write", record, operationContext);
        try {
          await writeSynced(path, bytes, io, operationContext, true);
          await syncDirectory(responseDirectory, io, operationContext);
          await phase("response-after-sync", record, operationContext);
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
        const readback = await bounded(() => io.readFile(path), operationContext);
        if (!readback.equals(bytes) || digest(readback) !== response.sha256) {
          throw new Error("response exact readback mismatch");
        }
        await phase("response-after-readback", record, operationContext);
        return {
          path: relativePath, sha256: response.sha256, bytes: bytes.byteLength,
          requestStartedAt: response.requestStartedAt, receivedAt: response.receivedAt
        };
      }, options);
    },
    async append(event, checkpoint, options = {}) {
      if (!event || typeof event.id !== "string" || !event.id) {
        throw new Error("INVALID_JOURNAL_EVENT");
      }
      return mutate(async operationContext => {
        const existing = payload.events.find(item => item.id === event.id);
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(event)) {
            const error = new Error("CONFLICTING_EVENT_ID");
            error.code = "CONFLICTING_EVENT_ID";
            throw error;
          }
          return { payload: structuredClone(payload), duplicate: true };
        }
        const next = {
          ...payload, sequence: payload.sequence + 1, checkpoint,
          events: [...payload.events, structuredClone(event)]
        };
        validatePayload(next);
        const acknowledged = await publishSnapshot({
          path: journalPath, runDirectory, oldPayload: payload, nextPayload: next,
          io, context: operationContext, phase
        });
        payload = acknowledged;
        return { payload: structuredClone(payload), duplicate: false };
      }, options);
    },
    async close(options = {}) {
      if (closed) return;
      if (poisoned) throw unknownError(new Error("journal is fenced after ambiguous I/O"));
      return mutate(async operationContext => {
        closed = true;
        await phase("close-before-unlock", { runId }, operationContext);
        await bounded(() => io.rm(lockPath), operationContext);
        await syncDirectory(runDirectory, io, operationContext);
        await phase("close-after-unlock", { runId }, operationContext);
      }, options);
    }
  });
}

async function exists(path, io, context) {
  try {
    await bounded(() => io.lstat(path), context);
    return true;
  } catch (error) {
    if (error.cause?.code === "ENOENT" || error.code === "ENOENT") return false;
    throw error;
  }
}

export async function readRunJournal({
  dataRoot, runId, deadlineAt, monotonicNow, io: injectedIo = {}
}) {
  validateRunId(runId);
  if (typeof dataRoot !== "string" || !dataRoot.trim()) throw new Error("DATA_ROOT_REQUIRED");
  const io = { lstat, readFile, ...injectedIo };
  const context = contextFor({ deadlineAt, monotonicNow });
  const runDirectory = join(resolve(dataRoot), runId);
  const info = await bounded(() => io.lstat(runDirectory), context);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("INVALID_RUN_DIRECTORY");
  const lockPresent = await exists(join(runDirectory, "writer.lock"), io, context);
  const pendingPath = join(runDirectory, "journal.pending");
  const pendingPresent = await exists(pendingPath, io, context);
  let pending = null;
  if (pendingPresent) {
    try {
      pending = JSON.parse((await bounded(() => io.readFile(pendingPath), context)).toString("utf8"));
    } catch {
      pending = null;
    }
  }
  let bytes;
  try {
    bytes = await bounded(() => io.readFile(join(runDirectory, "journal.json")), context);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      schemaVersion: SCHEMA, runId, sequence: null, checkpoint: null, events: [],
      reconciliationStatus: pendingPresent ? "UNKNOWN_PENDING_PUBLICATION" :
        lockPresent ? "UNKNOWN_WRITER_OR_INTERRUPTED" : "INCOMPLETE_READ_ONLY"
    };
  }
  let envelope;
  try {
    envelope = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("INVALID_JOURNAL_JSON");
  }
  if (!envelope?.payload || typeof envelope.sha256 !== "string" ||
      digest(encoded(envelope.payload)) !== envelope.sha256) {
    throw new Error("JOURNAL_CHECKSUM_MISMATCH");
  }
  validatePayload(envelope.payload);
  if (envelope.payload.runId !== runId) throw new Error("JOURNAL_RUN_ID_MISMATCH");
  for (const event of envelope.payload.events) {
    for (const response of [event.ohlc, event.ticker, event.acceptedOhlc, event.acceptedTicker]) {
      if (!response?.path) continue;
      if (!/^responses\/[a-f0-9]{64}\.json$/.test(response.path) ||
          response.path !== `responses/${response.sha256}.json`) {
        throw new Error("INVALID_RESPONSE_REFERENCE");
      }
      const body = await bounded(() => io.readFile(join(runDirectory, response.path)), context);
      if (body.byteLength !== response.bytes || digest(body) !== response.sha256) {
        throw new Error("RESPONSE_CHECKSUM_MISMATCH");
      }
    }
  }
  let reconciliationStatus = lockPresent ? "UNKNOWN_WRITER_OR_INTERRUPTED" : "READ_ONLY_VERIFIED";
  if (pendingPresent) {
    const validPending = pending?.schemaVersion === "SPOT_PAPER_PILOT_PENDING_V1" &&
      Number.isSafeInteger(pending.nextSequence) &&
      Number.isSafeInteger(pending.previousSequence) &&
      pending.nextSequence === pending.previousSequence + 1 &&
      /^[a-f0-9]{64}$/.test(pending.previousSha256) &&
      /^[a-f0-9]{64}$/.test(pending.candidateSha256);
    if (!validPending) {
      reconciliationStatus = "UNKNOWN_PENDING_PUBLICATION";
    } else if (envelope.payload.sequence === pending.nextSequence &&
        digest(encoded(envelope.payload)) === pending.candidateSha256) {
      reconciliationStatus = "UNKNOWN_CANDIDATE_VISIBLE_ACK_UNCONFIRMED";
    } else if (envelope.payload.sequence === pending.previousSequence &&
        digest(encoded(envelope.payload)) === pending.previousSha256) {
      reconciliationStatus = "UNKNOWN_CANDIDATE_NOT_VISIBLE";
    } else {
      reconciliationStatus = "UNKNOWN_PREDECESSOR_MISMATCH";
    }
  }
  if (lockPresent && reconciliationStatus === "READ_ONLY_VERIFIED") {
    reconciliationStatus = "UNKNOWN_WRITER_OR_INTERRUPTED";
  }
  return { ...envelope.payload, reconciliationStatus };
}
