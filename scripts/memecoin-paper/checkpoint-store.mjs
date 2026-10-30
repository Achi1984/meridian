import {createHash, randomBytes} from "node:crypto";
import {mkdir, open, rename, rm} from "node:fs/promises";
import path from "node:path";

export const MAX_CHECKPOINT_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_BYTES = 16 * 1024;

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalValue(value, seen = new WeakSet()) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError("checkpoint contains an unsafe number");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "bigint") return {$bigint: value.toString()};
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("checkpoint contains a cycle");
    seen.add(value);
    const result = value.map(item => canonicalValue(item, seen));
    seen.delete(value);
    return result;
  }
  if (value instanceof Map) {
    if (seen.has(value)) throw new TypeError("checkpoint contains a cycle");
    seen.add(value);
    const entries = [...value].map(([key, item]) => [
      canonicalValue(key, seen),
      canonicalValue(item, seen)
    ]);
    entries.sort((left, right) => {
      const a = JSON.stringify(left[0]);
      const b = JSON.stringify(right[0]);
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    seen.delete(value);
    return {$map: entries};
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("checkpoint contains an unsupported value");
  }
  if (seen.has(value)) throw new TypeError("checkpoint contains a cycle");
  seen.add(value);
  const result = {};
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$bigint" &&
      typeof value.$bigint === "string" && /^(0|[1-9]\d*|-[1-9]\d*)$/.test(value.$bigint)) {
    seen.delete(value);
    return {$bigint: value.$bigint};
  }
  if (keys.length === 1 && keys[0] === "$map" && Array.isArray(value.$map)) {
    const entries = value.$map.map(([key, item]) => [
      canonicalValue(key, seen),
      canonicalValue(item, seen)
    ]);
    entries.sort((left, right) => {
      const a = JSON.stringify(left[0]);
      const b = JSON.stringify(right[0]);
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    seen.delete(value);
    return {$map: entries};
  }
  for (const key of keys.sort()) {
    if (key === "$bigint" || key === "$map") throw new TypeError("checkpoint uses a reserved canonical key");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new TypeError("checkpoint contains an accessor");
    Object.defineProperty(result, key, {
      value: canonicalValue(descriptor.value, seen),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  seen.delete(value);
  return result;
}

export function canonicalCheckpointBytes(value) {
  return Buffer.from(JSON.stringify(canonicalValue(value)), "utf8");
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function boundedRead(filePath, maxBytes) {
  let handle;
  try {
    handle = await open(filePath, "r");
  } catch (error) {
    if (error.code === "ENOENT") return {status: "ABSENT"};
    return {status: "UNAVAILABLE", reason: "checkpoint read failed"};
  }
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) return {status: "OVERSIZE"};
    return {status: "OK", bytes: buffer.subarray(0, length)};
  } catch {
    return {status: "UNAVAILABLE", reason: "checkpoint read failed"};
  } finally {
    await handle.close();
  }
}

export class CheckpointStore {
  #directory;
  #checkpointPath;
  #pendingPath;
  #lockPath;
  #maxBytes;
  #onPhase;
  #closed = false;
  #busy = false;

  constructor(directory, {maxBytes = MAX_CHECKPOINT_BYTES, onPhase} = {}) {
    if (typeof directory !== "string" || !path.isAbsolute(directory)) {
      throw new TypeError("checkpoint directory must be an absolute path");
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_CHECKPOINT_BYTES) {
      throw new RangeError("checkpoint byte limit is outside the supported bound");
    }
    if (onPhase !== undefined && typeof onPhase !== "function") {
      throw new TypeError("checkpoint phase hook must be a function");
    }
    this.#directory = path.resolve(directory);
    this.#checkpointPath = path.join(this.#directory, "checkpoint.json");
    this.#pendingPath = path.join(this.#directory, ".checkpoint-pending");
    this.#lockPath = path.join(this.#directory, ".checkpoint-lock");
    this.#maxBytes = maxBytes;
    this.#onPhase = onPhase;
  }

  static async open(directory, options = {}) {
    const store = new CheckpointStore(directory, options);
    await mkdir(store.#directory, {recursive: true});
    let handle;
    try {
      handle = await open(store.#lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code === "EEXIST") {
        const busy = new Error("checkpoint store already has an owner; stale locks are never stolen");
        busy.code = "CHECKPOINT_BUSY";
        throw busy;
      }
      throw error;
    }
    try {
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      await rm(store.#lockPath, {force: true}).catch(() => {});
      throw error;
    } finally {
      await handle.close();
    }
    try {
      await syncDirectory(store.#directory);
    } catch (error) {
      await rm(store.#lockPath, {force: true}).catch(() => {});
      throw new Error(`checkpoint directory fsync is required: ${error.message}`);
    }
    return store;
  }

  async #phase(name, details) {
    if (this.#onPhase) await this.#onPhase(name, details);
  }

  #assertUsable() {
    if (this.#closed) throw new Error("checkpoint store is closed");
    if (this.#busy) {
      const error = new Error("checkpoint I/O is still in progress");
      error.code = "CHECKPOINT_BUSY";
      throw error;
    }
  }

  async #readPending() {
    const result = await boundedRead(this.#pendingPath, MAX_PENDING_BYTES);
    if (result.status === "ABSENT") return result;
    if (result.status !== "OK") return {status: "CORRUPT", reason: "pending marker is unreadable or oversized"};
    try {
      const pending = JSON.parse(result.bytes.toString("utf8"));
      if (!canonicalCheckpointBytes(pending).equals(result.bytes) ||
          Object.keys(pending).sort().join(",") !==
            ["candidateHash", "expectedHash", "expectedSequence", "sequence", "version"].join(",") ||
          pending.version !== 1 || !Number.isSafeInteger(pending.expectedSequence) ||
          pending.expectedSequence < -1 ||
          (pending.expectedHash !== null && !/^[a-f0-9]{64}$/.test(pending.expectedHash)) ||
          !Number.isSafeInteger(pending.sequence) || pending.sequence < 0 ||
          pending.sequence !== pending.expectedSequence + 1 ||
          !/^[a-f0-9]{64}$/.test(pending.candidateHash)) {
        return {status: "CORRUPT", reason: "pending marker is malformed"};
      }
      return {status: "PENDING", pending};
    } catch {
      return {status: "CORRUPT", reason: "pending marker is malformed"};
    }
  }

  async #readCurrent() {
    const result = await boundedRead(this.#checkpointPath, this.#maxBytes);
    if (result.status === "ABSENT") return result;
    if (result.status === "OVERSIZE") return {status: "CORRUPT", reason: "checkpoint exceeds its byte limit"};
    if (result.status !== "OK") return result;
    try {
      const parsed = JSON.parse(result.bytes.toString("utf8"));
      const canonical = canonicalCheckpointBytes(parsed);
      if (!canonical.equals(result.bytes) || !Number.isSafeInteger(parsed.sequence) ||
          parsed.sequence < 0 || !Array.isArray(parsed.records) ||
          parsed.sequence !== parsed.records.length - 1) {
        return {status: "CORRUPT", reason: "checkpoint bytes or sequence are invalid"};
      }
      return {
        status: "OK",
        sequence: parsed.sequence,
        hash: hash(result.bytes),
        bytes: result.bytes
      };
    } catch {
      return {status: "CORRUPT", reason: "checkpoint is not canonical valid JSON"};
    }
  }

  async readCheckpoint() {
    this.#assertUsable();
    const pending = await this.#readPending();
    if (pending.status === "CORRUPT") return pending;
    if (pending.status === "PENDING") {
      return {status: "UNKNOWN", reason: "an earlier publication has no durable acknowledgement"};
    }
    return this.#readCurrent();
  }

  async reconcilePending() {
    this.#assertUsable();
    const pending = await this.#readPending();
    if (pending.status === "ABSENT") return this.#readCurrent();
    if (pending.status !== "PENDING") return pending;
    const current = await this.#readCurrent();
    if (current.status === "OK" && current.sequence === pending.pending.expectedSequence &&
        current.hash === pending.pending.expectedHash) {
      return {
        status: "NOT_PUBLISHED",
        sequence: current.sequence,
        hash: current.hash,
        reason: "the published head is still the exact predecessor; manual cleanup is required"
      };
    }
    return {
      status: "UNKNOWN",
      reason: "publication may have occurred; visible candidate bytes cannot establish durable acknowledgement",
      visibleSequence: current.sequence ?? null,
      visibleHash: current.hash ?? null
    };
  }

  async #writeSynced(filePath, bytes, exclusive = false) {
    const handle = await open(filePath, exclusive ? "wx" : "w", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async #clearPending() {
    await rm(this.#pendingPath, {force: true});
    await syncDirectory(this.#directory);
  }

  async #abortBeforePublication(tempPath) {
    let clearSucceeded = true;
    await rm(tempPath, {force: true}).catch(() => { clearSucceeded = false; });
    await this.#clearPending().catch(() => { clearSucceeded = false; });
    return clearSucceeded;
  }

  async commitCheckpoint({expectedSequence, expectedHash, candidateBytes} = {}) {
    this.#assertUsable();
    if (!(candidateBytes instanceof Uint8Array) || candidateBytes.byteLength === 0 ||
        candidateBytes.byteLength > this.#maxBytes ||
        !Number.isSafeInteger(expectedSequence) || expectedSequence < -1 ||
        (expectedSequence === -1 && expectedHash !== null) ||
        (expectedSequence >= 0 && !/^[a-f0-9]{64}$/.test(expectedHash))) {
      return {status: "NOT_COMMITTED", reason: "checkpoint candidate or predecessor is invalid"};
    }
    const bytes = Buffer.from(candidateBytes);
    let candidate;
    try {
      candidate = JSON.parse(bytes.toString("utf8"));
      if (!canonicalCheckpointBytes(candidate).equals(bytes) ||
          candidate.sequence !== expectedSequence + 1 ||
          candidate.records?.length !== candidate.sequence + 1 ||
          candidate.records[candidate.sequence]?.predecessorHash !== expectedHash) {
        return {status: "NOT_COMMITTED", reason: "candidate does not extend the exact predecessor"};
      }
    } catch {
      return {status: "NOT_COMMITTED", reason: "candidate bytes are invalid"};
    }

    this.#busy = true;
    let published = false;
    let tempPath;
    try {
      await this.#phase("before-predecessor-check", {expectedSequence, expectedHash});
      const pending = await this.#readPending();
      if (pending.status !== "ABSENT") {
        return {status: "UNKNOWN", reason: "an unresolved publication already exists"};
      }
      const current = await this.#readCurrent();
      if (expectedSequence === -1) {
        if (current.status !== "ABSENT") {
          return {status: "NOT_COMMITTED", reason: "checkpoint already exists"};
        }
      } else if (current.status !== "OK" || current.sequence !== expectedSequence ||
          current.hash !== expectedHash) {
        return {status: "NOT_COMMITTED", reason: "checkpoint predecessor changed or is unavailable"};
      }
      await this.#phase("before-pending", {sequence: candidate.sequence});
      const pendingBytes = canonicalCheckpointBytes({
        version: 1,
        expectedSequence,
        expectedHash,
        sequence: candidate.sequence,
        candidateHash: hash(bytes)
      });
      await this.#writeSynced(this.#pendingPath, pendingBytes, true);
      await syncDirectory(this.#directory);
      await this.#phase("after-pending", {sequence: candidate.sequence});

      tempPath = path.join(this.#directory,
        `.checkpoint-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
      await this.#writeSynced(tempPath, bytes, true);
      await this.#phase("after-file-sync", {sequence: candidate.sequence});
      await this.#phase("before-rename", {sequence: candidate.sequence});
      await rename(tempPath, this.#checkpointPath);
      tempPath = null;
      published = true;
      await this.#phase("after-rename", {sequence: candidate.sequence});
      await syncDirectory(this.#directory);
      await this.#phase("after-directory-sync", {sequence: candidate.sequence});

      const readback = await this.#readCurrent();
      await this.#phase("after-readback", {sequence: candidate.sequence});
      if (readback.status !== "OK" || readback.sequence !== candidate.sequence ||
          readback.hash !== hash(bytes) || !readback.bytes.equals(bytes)) {
        return {status: "UNKNOWN", reason: "published checkpoint failed bounded exact readback"};
      }
      await this.#phase("before-ack", {sequence: candidate.sequence, hash: readback.hash});
      await this.#clearPending();
      return {status: "ACK", sequence: candidate.sequence, hash: readback.hash};
    } catch (error) {
      if (!published) {
        const cleared = await this.#abortBeforePublication(tempPath);
        return cleared
          ? {status: "NOT_COMMITTED", reason: "publication failed before rename"}
          : {status: "UNKNOWN", reason: "pre-publication failure left unresolved local state"};
      }
      return {status: "UNKNOWN", reason: "publication outcome is ambiguous; blind retry is forbidden"};
    } finally {
      this.#busy = false;
    }
  }

  async close() {
    this.#assertUsable();
    this.#closed = true;
    await rm(this.#lockPath, {force: true});
    await syncDirectory(this.#directory);
  }
}
