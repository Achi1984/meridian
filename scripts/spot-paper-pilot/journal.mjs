import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const SCHEMA = "SPOT_PAPER_PILOT_JOURNAL_V1";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encoded(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicSnapshot(path, payload) {
  const bytes = encoded(payload);
  const envelope = encoded({ payload, sha256: digest(bytes) });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(envelope);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();
  try {
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function validateRunId(runId) {
  if (typeof runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(runId)) {
    throw new Error("INVALID_RUN_ID");
  }
}

function validatePayload(payload) {
  if (!payload || payload.schemaVersion !== SCHEMA || !Array.isArray(payload.events) ||
      typeof payload.runId !== "string") {
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

export async function createRunJournal({ dataRoot, runId, manifest }) {
  validateRunId(runId);
  if (typeof dataRoot !== "string" || !dataRoot.trim()) throw new Error("DATA_ROOT_REQUIRED");
  const root = resolve(dataRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("INVALID_DATA_ROOT");
  await syncDirectory(dirname(root));
  const runDirectory = join(root, runId);
  await mkdir(runDirectory, { mode: 0o700 });
  await syncDirectory(root);
  const lockPath = join(runDirectory, "writer.lock");
  const lock = await open(lockPath, "wx", 0o600);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, runId }) + "\n");
    await lock.sync();
  } finally {
    await lock.close();
  }
  await syncDirectory(runDirectory);
  const responseDirectory = join(runDirectory, "responses");
  await mkdir(responseDirectory, { mode: 0o700 });
  await syncDirectory(runDirectory);
  const journalPath = join(runDirectory, "journal.json");
  let payload = {
    schemaVersion: SCHEMA, runId, manifest, createdAt: manifest?.startedAt ?? Date.now(),
    checkpoint: null, events: []
  };
  await atomicSnapshot(journalPath, payload);
  let closed = false;
  return Object.freeze({
    runDirectory,
    snapshot: () => structuredClone(payload),
    async persistResponse(response) {
      if (closed) throw new Error("JOURNAL_CLOSED");
      if (!response || typeof response.raw !== "string" ||
          !/^[a-f0-9]{64}$/.test(response.sha256)) {
        throw new Error("INVALID_RESPONSE_RECORD");
      }
      const bytes = Buffer.from(response.raw, "utf8");
      if (digest(bytes) !== response.sha256 ||
          (response.bytes !== undefined && response.bytes !== bytes.byteLength)) {
        throw new Error("RESPONSE_CHECKSUM_MISMATCH");
      }
      const relativePath = `responses/${response.sha256}.json`;
      const path = join(runDirectory, relativePath);
      try {
        const handle = await open(path, "wx", 0o600);
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await syncDirectory(responseDirectory);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const existing = await readFile(path);
        if (digest(existing) !== response.sha256 || !existing.equals(bytes)) {
          throw new Error("CONFLICTING_RESPONSE_HASH");
        }
      }
      return {
        path: relativePath, sha256: response.sha256, bytes: bytes.byteLength,
        requestStartedAt: response.requestStartedAt, receivedAt: response.receivedAt
      };
    },
    async append(event, checkpoint) {
      if (closed) throw new Error("JOURNAL_CLOSED");
      if (!event || typeof event.id !== "string" || !event.id) {
        throw new Error("INVALID_JOURNAL_EVENT");
      }
      const existing = payload.events.find(item => item.id === event.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(event)) {
          throw new Error("CONFLICTING_EVENT_ID");
        }
        return { payload: structuredClone(payload), duplicate: true };
      }
      const next = { ...payload, checkpoint,
        events: [...payload.events, structuredClone(event)] };
      validatePayload(next);
      await atomicSnapshot(journalPath, next);
      payload = next;
      return { payload: structuredClone(payload), duplicate: false };
    },
    async close() {
      if (closed) return;
      closed = true;
      await rm(lockPath, { force: true });
      await syncDirectory(runDirectory);
    }
  });
}

export async function readRunJournal({ dataRoot, runId }) {
  validateRunId(runId);
  if (typeof dataRoot !== "string" || !dataRoot.trim()) throw new Error("DATA_ROOT_REQUIRED");
  const runDirectory = join(resolve(dataRoot), runId);
  const info = await lstat(runDirectory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("INVALID_RUN_DIRECTORY");
  const bytes = await readFile(join(runDirectory, "journal.json"));
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
      const body = await readFile(join(runDirectory, response.path));
      if (body.byteLength !== response.bytes || digest(body) !== response.sha256) {
        throw new Error("RESPONSE_CHECKSUM_MISMATCH");
      }
    }
  }
  return envelope.payload;
}
