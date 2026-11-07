import {createHash} from "node:crypto";
import {constants} from "node:fs";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import {comparableCensusSlots, countCensusOwners} from "../analyst-window-evidence.mjs";
import {acquireOwnerCensus, captureProspectiveOwnerCensus} from "../owner-census.mjs";

export const EVIDENCE_WARMUP_SCHEMA = "MERIDIAN_PAPER_EVIDENCE_WARMUP_V1";
export const DEFAULT_WARMUP_LIMITS = Object.freeze({
  maxFiles: 1,
  maxRecords: 2_500,
  maxBytes: 8 * 1024 * 1024,
  maxWorkUnits: 1_000_000,
  maxElapsedMs: 15_000
});

const DATASET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const HASH = /^[a-f0-9]{64}$/;
const PRICE_KINDS = new Set(["price"]);
const CENSUS_KINDS = new Set(["census"]);
const TRUST = new Set(["REVIEWED", "UNKNOWN", "SYNTHETIC_FIXTURE_ONLY"]);
const COMPLETENESS = new Set(["COMPLETE", "INCOMPLETE", "UNKNOWN"]);
const DEFAULT_FS_OPS = Object.freeze({
  lstat: fsPromises.lstat,
  mkdir: fsPromises.mkdir,
  rmdir: fsPromises.rmdir,
  open: fsPromises.open,
  link: fsPromises.link,
  unlink: fsPromises.unlink
});

class OperationStopped extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

class OperationBudget {
  #startedAt = performance.now();
  #timeoutMs;
  #signal;
  #timer;
  #reason = null;
  #closed = false;
  #stopped;
  #rejectStopped;
  #onAbort;

  constructor(timeoutMs, signal) {
    this.#timeoutMs = timeoutMs;
    this.#signal = signal;
    this.#stopped = new Promise((_, reject) => { this.#rejectStopped = reject; });
    void this.#stopped.catch(() => {});
    this.#onAbort = () => this.#stop("CANCELLED");
    if (signal?.aborted) this.#stop("CANCELLED");
    else signal?.addEventListener("abort", this.#onAbort, {once: true});
    this.#timer = setTimeout(() => this.#stop("DEADLINE"), timeoutMs);
  }

  #stop(reason) {
    if (this.#reason || this.#closed) return;
    this.#reason = reason;
    this.#rejectStopped(new OperationStopped(reason));
  }

  check() {
    if (!this.#reason && performance.now() - this.#startedAt >= this.#timeoutMs) {
      this.#stop("DEADLINE");
    }
    if (this.#signal?.aborted) this.#stop("CANCELLED");
    if (this.#reason) throw new OperationStopped(this.#reason);
  }

  async wait(value, {onLate} = {}) {
    this.check();
    const pending = Promise.resolve(value).then(result => {
      if ((this.#closed || this.#reason) && onLate) {
        try { void Promise.resolve(onLate(result)).catch(() => {}); } catch {}
      }
      return result;
    }, error => {
      throw error;
    });
    void pending.catch(() => {});
    const result = await Promise.race([pending, this.#stopped]);
    try {
      this.check();
    } catch (error) {
      if (onLate) {
        try { void Promise.resolve(onLate(result)).catch(() => {}); } catch {}
      }
      throw error;
    }
    return result;
  }

  close() {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#signal?.removeEventListener("abort", this.#onAbort);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 &&
    Number.isFinite(new Date(value).getTime());
}

function bestEffort(operation) {
  try { void Promise.resolve(operation()).catch(() => {}); } catch {}
}

function validIdentity(identity) {
  return isRecord(identity) && identity.chainId === "solana" &&
    ["mint", "pool", "quote"].every(key =>
      typeof identity[key] === "string" && identity[key].length <= 64);
}

function identityKey(identity) {
  return JSON.stringify([
    identity?.chainId, identity?.mint, identity?.pool, identity?.quote
  ]);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validateJsonValue(value, state = {nodes: 0, seen: new WeakSet()}, depth = 0,
  check = () => {}) {
  check();
  state.nodes += 1;
  if (state.nodes > DEFAULT_WARMUP_LIMITS.maxWorkUnits || depth > 64) {
    throw new RangeError("warmup work limit exceeded");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError("warmup contains an unsafe number");
    }
    return;
  }
  if (typeof value !== "object" || state.seen.has(value)) {
    throw new TypeError("warmup contains an unsupported value");
  }
  state.seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) validateJsonValue(child, state, depth + 1, check);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("warmup contains an unsupported object");
    }
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError("warmup contains an accessor");
      }
      validateJsonValue(descriptor.value, state, depth + 1, check);
    }
  }
  state.seen.delete(value);
}

function validateRecord(record) {
  if (!isRecord(record) || !["price", "census", "local-census-acquisition"].includes(record.kind) ||
      !isRecord(record.identity) || record.identity.chainId !== "solana" ||
      !["mint", "pool", "quote"].every(key =>
        typeof record.identity[key] === "string" && record.identity[key].length <= 64) ||
      !TRUST.has(record.trust) || !COMPLETENESS.has(record.completeness) ||
      typeof record.source !== "string" || record.source.length < 1 ||
      record.source.length > 256 || !validTime(record.receivedAt) ||
      !isRecord(record.payload)) {
    throw new TypeError("warmup record is invalid");
  }
  const synthetic = record.payload.source === "SYNTHETIC_FIXTURE_ONLY";
  if ((synthetic && record.trust !== "SYNTHETIC_FIXTURE_ONLY") ||
      (!synthetic && record.trust === "SYNTHETIC_FIXTURE_ONLY") ||
      (record.trust === "REVIEWED" && record.payload.trust === "UNKNOWN") ||
      (record.completeness === "COMPLETE" &&
        (record.payload.status === "UNKNOWN" ||
         ["UNKNOWN", "INCOMPLETE"].includes(record.payload.trust) ||
         ["UNKNOWN", "INCOMPLETE"].includes(record.payload.completeness) ||
         record.payload.coverage?.complete === false))) {
    throw new TypeError("warmup record cannot promote synthetic, unknown, or incomplete evidence");
  }
  if (record.kind === "price" &&
      (!validTime(record.sourceAtMs) || typeof record.mint !== "string" ||
       ![record.identity.mint, record.identity.quote].includes(record.mint) ||
       record.denomination !== "USD" ||
       typeof record.methodologyVersion !== "string" || !record.methodologyVersion ||
       record.source !== record.payload.source ||
       record.payload.mint !== record.mint ||
       record.payload.denomination !== record.denomination ||
       record.payload.methodologyVersion !== record.methodologyVersion ||
       (record.completeness === "COMPLETE" && record.payload.status !== "SOURCE_BOUND") ||
       record.payload.sourceAtMs !== record.sourceAtMs ||
       record.payload.receivedAt !== record.receivedAt ||
       record.receivedAt < record.sourceAtMs ||
       (record.payload.status === "SOURCE_BOUND" &&
         !validReceipt(record.payload.receipt, record.source, record.receivedAt)))) {
    throw new TypeError("warmup price record is invalid");
  }
  if (record.kind === "census" &&
      (!validTime(record.observedAt) || record.payload.observedAt !== record.observedAt ||
       typeof record.policyVersion !== "string" || !record.policyVersion ||
       record.source !== record.payload.source ||
       identityKey(record.payload.identity) !== identityKey(record.identity) ||
       record.payload.censusPolicyVersion !== record.policyVersion ||
       record.payload.receivedAt !== record.receivedAt ||
       record.payload.receipt?.receivedAt !== record.receivedAt ||
       record.receivedAt < record.observedAt ||
       (record.payload.status === "COMPLETE" &&
         !validReceipt(record.payload.receipt, record.source, record.receivedAt)) ||
       (record.completeness === "COMPLETE" &&
         (record.payload.status !== "COMPLETE" || record.payload.coverage?.complete !== true)))) {
    throw new TypeError("warmup census record is invalid");
  }
  if (record.kind === "local-census-acquisition" &&
      (record.observedAtBasis !== "LOCAL_ACQUISITION_TIME" ||
       !validTime(record.observedAt) || record.payload.observedAt !== record.observedAt)) {
    throw new TypeError("local census acquisition time must remain explicitly nonhistorical");
  }
}

function logicalRecordKey(record) {
  if (record.kind === "local-census-acquisition") return null;
  return record.kind === "price"
    ? JSON.stringify(["price", identityKey(record.identity), record.mint,
      record.denomination, record.sourceAtMs])
    : JSON.stringify(["census", identityKey(record.identity), record.policyVersion,
      record.observedAt]);
}

function hasDuplicateLogicalKeys(records, check = () => {}) {
  const keys = new Set();
  for (const record of records) {
    check();
    const key = logicalRecordKey(record);
    if (key === null) continue;
    if (keys.has(key)) return true;
    keys.add(key);
  }
  return false;
}

function validateLimits(limits = {}) {
  const result = {...DEFAULT_WARMUP_LIMITS, ...limits};
  for (const key of Object.keys(DEFAULT_WARMUP_LIMITS)) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 1 ||
        result[key] > DEFAULT_WARMUP_LIMITS[key]) {
      throw new RangeError(`invalid warmup limit: ${key}`);
    }
  }
  if (result.maxFiles !== 1) throw new RangeError("warmup store permits one immutable dataset file");
  return result;
}

function validateDirectoryStat(stat, isTarget) {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("warmup storage ancestry is not a trusted directory");
  }
  const stickyRoot = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
  if ((!stickyRoot && (stat.mode & 0o022) !== 0) ||
      (isTarget && (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)) ||
      (!isTarget && stat.uid !== process.getuid?.() && stat.uid !== 0)) {
    throw new Error("warmup storage ancestry is not private");
  }
}

async function assertPrivateDirectory(directory, {create = false, budget, fsOps} = {}) {
  const resolved = path.resolve(directory);
  const parts = resolved.split(path.sep).filter(Boolean);
  if (parts.length === 0) throw new Error("warmup root cannot be a filesystem root");
  let current = path.parse(resolved).root;
  budget.check();
  validateDirectoryStat(await budget.wait(fsOps.lstat(current)), false);
  for (const [index, part] of parts.entries()) {
    budget.check();
    current = path.join(current, part);
    const isTarget = index === parts.length - 1;
    let stat;
    try {
      budget.check();
      stat = await budget.wait(fsOps.lstat(current));
    } catch (error) {
      if (error.code !== "ENOENT" || !create) throw error;
      try {
        budget.check();
        await budget.wait(fsOps.mkdir(current, {mode: 0o700}), {
          onLate: () => bestEffort(() => fsOps.rmdir(current))
        });
      } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      }
      budget.check();
      stat = await budget.wait(fsOps.lstat(current));
    }
    validateDirectoryStat(stat, isTarget);
  }
  return resolved;
}

async function boundedRead(filename, maxBytes, {budget, fsOps}) {
  let handle;
  try {
    budget.check();
    handle = await budget.wait(
      fsOps.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK),
      {onLate: opened => opened.close().catch(() => {})}
    );
  } catch (error) {
    if (error.code === "ENOENT") return {status: "ABSENT"};
    if (error instanceof OperationStopped) throw error;
    return {status: "UNKNOWN", reason: "WARMUP_FILE_OPEN_FAILED"};
  }
  try {
    budget.check();
    const stat = await budget.wait(handle.stat());
    budget.check();
    if (!stat.isFile() || stat.size < 66 || stat.size > maxBytes ||
        stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
      return {status: "UNKNOWN", reason: "WARMUP_FILE_BOUNDS_OR_MODE_INVALID"};
    }
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < stat.size + 1) {
      budget.check();
      const {bytesRead} = await budget.wait(handle.read(bytes, length, Math.min(
        bytes.length - length, stat.size + 1 - length), length));
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    budget.check();
    if (length !== stat.size || length > maxBytes) {
      return {status: "UNKNOWN", reason: "WARMUP_FILE_SIZE_CHANGED"};
    }
    const separator = bytes.indexOf(10, 0, "ascii");
    if (separator !== 64) return {status: "UNKNOWN", reason: "WARMUP_DIGEST_HEADER_INVALID"};
    const digest = bytes.subarray(0, separator).toString("ascii");
    const payloadBytes = bytes.subarray(separator + 1, length);
    const actualDigest = createHash("sha256").update(payloadBytes).digest("hex");
    if (!HASH.test(digest) || digest !== actualDigest) {
      return {status: "UNKNOWN", reason: "WARMUP_DIGEST_MISMATCH"};
    }
    let document;
    try {
      document = JSON.parse(payloadBytes.toString("utf8"));
    } catch {
      return {status: "UNKNOWN", reason: "WARMUP_JSON_INVALID"};
    }
    return {status: "OK", document, digest, byteLength: length};
  } catch (error) {
    if (error instanceof OperationStopped) throw error;
    return {status: "UNKNOWN", reason: "WARMUP_FILE_READ_FAILED"};
  } finally {
    bestEffort(() => handle.close());
  }
}

async function syncDirectory(directory, {budget, fsOps}) {
  budget.check();
  const handle = await budget.wait(fsOps.open(directory, "r"), {
    onLate: opened => opened.close().catch(() => {})
  });
  try {
    await budget.wait(handle.sync());
  } finally {
    bestEffort(() => handle.close());
  }
}

async function removeOwnedPendingMarker(filename, directory, ownership, {budget, fsOps}) {
  budget.check();
  const marker = await budget.wait(fsOps.lstat(filename));
  if (marker.dev !== ownership.dev || marker.ino !== ownership.ino) {
    throw new Error("warmup publication marker ownership changed");
  }
  budget.check();
  await budget.wait(fsOps.unlink(filename));
  budget.check();
  await syncDirectory(directory, {budget, fsOps});
  budget.check();
}

async function publicationPending(filename, budget, fsOps) {
  budget.check();
  try {
    await budget.wait(fsOps.lstat(filename));
    return true;
  } catch (error) {
    if (error instanceof OperationStopped || error.code !== "ENOENT") throw error;
    return false;
  }
}

function sourceKey() {
  return "evidence-warmup.json";
}

export class EvidenceWarmupStore {
  #root;
  #enabled;
  #limits;
  #fsOps;
  #busy = false;

  constructor(root, {enabled = false, limits, fsOps = {}} = {}) {
    if (typeof root !== "string" || !path.isAbsolute(root)) {
      throw new TypeError("warmup store path must be absolute");
    }
    this.#root = path.resolve(root);
    this.#enabled = enabled === true;
    this.#limits = validateLimits(limits);
    this.#fsOps = Object.freeze({...DEFAULT_FS_OPS, ...fsOps});
    if (Object.values(this.#fsOps).some(operation => typeof operation !== "function")) {
      throw new TypeError("warmup filesystem operations must be functions");
    }
  }

  get enabled() {
    return this.#enabled;
  }

  async publish({datasetId, identity, records, capturedAt, versions = {}, budgets = {}} = {},
    {signal} = {}) {
    if (!this.#enabled) return {status: "DISABLED"};
    if (this.#busy) return {status: "UNKNOWN", reason: "PUBLICATION_IN_PROGRESS"};
    if (signal?.aborted) return {status: "UNKNOWN", reason: "CANCELLED"};
    if (!DATASET_ID.test(datasetId ?? "") || !validIdentity(identity) ||
        !validTime(capturedAt) ||
        !Array.isArray(records) || records.length > this.#limits.maxRecords) {
      return {status: "UNKNOWN", reason: "INVALID_WARMUP_PUBLICATION"};
    }
    const budget = new OperationBudget(this.#limits.maxElapsedMs, signal);
    this.#busy = true;
    let temporary = null;
    let linkAttempted = false;
    let markerOwnership = null;
    try {
      budget.check();
      const document = {
        schema: EVIDENCE_WARMUP_SCHEMA,
        datasetId,
        identity,
        capturedAt,
        versions,
        budgets: {...budgets, records: records.length, workUnits: 0},
        records
      };
      const workState = {nodes: 0, seen: new WeakSet()};
      validateJsonValue(document, workState, 0, () => budget.check());
      if (workState.nodes > this.#limits.maxWorkUnits) {
        return {status: "UNKNOWN", reason: "WORK_LIMIT"};
      }
      document.budgets.workUnits = workState.nodes;
      for (const record of records) {
        budget.check();
        validateRecord(record);
        if (identityKey(record.identity) !== identityKey(identity)) {
          return {status: "UNKNOWN", reason: "RECORD_IDENTITY_MISMATCH"};
        }
        if (record.receivedAt > capturedAt) {
          return {status: "UNKNOWN", reason: "RECEIPT_AFTER_CAPTURE"};
        }
      }
      if (hasDuplicateLogicalKeys(records, () => budget.check())) {
        return {status: "UNKNOWN", reason: "DUPLICATE_LOGICAL_RECORD"};
      }
      budget.check();
      const payload = Buffer.from(JSON.stringify(document), "utf8");
      const digest = createHash("sha256").update(payload).digest("hex");
      const bytes = Buffer.concat([Buffer.from(`${digest}\n`, "ascii"), payload]);
      if (bytes.length > this.#limits.maxBytes) {
        return {status: "UNKNOWN", reason: "BYTE_LIMIT"};
      }
      if (this.#limits.maxFiles !== 1) {
        return {status: "UNKNOWN", reason: "FILE_LIMIT"};
      }
      const root = await assertPrivateDirectory(this.#root, {
        create: true, budget, fsOps: this.#fsOps
      });
      budget.check();
      const finalPath = path.join(root, sourceKey(datasetId));
      const pendingPath = path.join(root, ".evidence-warmup-pending");
      if (await publicationPending(pendingPath, budget, this.#fsOps)) {
        return {status: "UNKNOWN", reason: "PUBLICATION_STATE_UNKNOWN"};
      }
      const existing = await boundedRead(finalPath, this.#limits.maxBytes, {
        budget, fsOps: this.#fsOps
      });
      budget.check();
      if (existing.status === "OK") {
        return existing.digest === digest && existing.document.datasetId === datasetId
          ? {status: "DUPLICATE", datasetId, digest, byteLength: existing.byteLength}
          : {status: "CONFLICT", reason: "IMMUTABLE_DATASET_CONFLICT"};
      }
      if (existing.status !== "ABSENT") return existing;
      let handle;
      try {
        budget.check();
        handle = await budget.wait(this.#fsOps.open(pendingPath, "wx", 0o600), {
          onLate: opened => {
            bestEffort(() => opened.close());
            bestEffort(() => this.#fsOps.unlink(pendingPath));
          }
        });
        temporary = pendingPath;
        const markerStat = await budget.wait(handle.stat());
        markerOwnership = {dev: markerStat.dev, ino: markerStat.ino};
        budget.check();
        await budget.wait(handle.writeFile(bytes));
        budget.check();
        await budget.wait(handle.sync());
      } finally {
        if (handle) bestEffort(() => handle.close());
      }
      budget.check();
      try {
        linkAttempted = true;
        budget.check();
        await budget.wait(this.#fsOps.link(temporary, finalPath));
      } catch (error) {
        if (error instanceof OperationStopped) throw error;
        if (error.code === "EEXIST") {
          const current = await boundedRead(finalPath, this.#limits.maxBytes, {
            budget, fsOps: this.#fsOps
          });
          budget.check();
          if (current.status === "OK" && current.digest === digest) {
            await removeOwnedPendingMarker(temporary, root, markerOwnership, {
              budget, fsOps: this.#fsOps
            });
            temporary = null;
            return {status: "DUPLICATE", datasetId, digest, byteLength: current.byteLength};
          }
          if (current.status === "OK") {
            await removeOwnedPendingMarker(temporary, root, markerOwnership, {
              budget, fsOps: this.#fsOps
            });
            temporary = null;
            return {status: "CONFLICT", reason: "IMMUTABLE_DATASET_CONFLICT"};
          }
          return {status: "UNKNOWN", reason: "PUBLICATION_STATE_UNKNOWN"};
        }
        return {status: "UNKNOWN", reason: "PUBLICATION_STATE_UNKNOWN"};
      }
      budget.check();
      await syncDirectory(root, {budget, fsOps: this.#fsOps});
      budget.check();
      await removeOwnedPendingMarker(temporary, root, markerOwnership, {
        budget, fsOps: this.#fsOps
      });
      temporary = null;
      return {status: "PUBLISHED", datasetId, digest, byteLength: bytes.length};
    } catch (error) {
      if (error instanceof OperationStopped) {
        return {status: "UNKNOWN", reason: error.reason};
      }
      return {status: "UNKNOWN", reason: "WARMUP_PUBLICATION_FAILED"};
    } finally {
      if (temporary && !linkAttempted) bestEffort(() => this.#fsOps.unlink(temporary));
      budget.close();
      this.#busy = false;
    }
  }

  async read(datasetId, {signal, timeoutMs = this.#limits.maxElapsedMs} = {}) {
    if (!DATASET_ID.test(datasetId ?? "")) return {status: "UNKNOWN", reason: "INVALID_DATASET_ID"};
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
        timeoutMs > this.#limits.maxElapsedMs) {
      return {status: "UNKNOWN", reason: "INVALID_TIMEOUT"};
    }
    const budget = new OperationBudget(timeoutMs, signal);
    try {
      const root = await assertPrivateDirectory(this.#root, {budget, fsOps: this.#fsOps});
      const pendingPath = path.join(root, ".evidence-warmup-pending");
      if (await publicationPending(pendingPath, budget, this.#fsOps)) {
        return {status: "UNKNOWN", reason: "PUBLICATION_STATE_UNKNOWN"};
      }
      const result = await boundedRead(path.join(root, sourceKey(datasetId)), this.#limits.maxBytes,
        {budget, fsOps: this.#fsOps});
      budget.check();
      if (await publicationPending(pendingPath, budget, this.#fsOps)) {
        return {status: "UNKNOWN", reason: "PUBLICATION_STATE_UNKNOWN"};
      }
      if (result.status !== "OK") return result;
      const document = result.document;
      const workState = {nodes: 0, seen: new WeakSet()};
      validateJsonValue(document, workState, 0, () => budget.check());
      if (document?.schema !== EVIDENCE_WARMUP_SCHEMA || document.datasetId !== datasetId ||
          !validIdentity(document.identity) ||
          !Array.isArray(document.records) || document.records.length > this.#limits.maxRecords) {
        return {status: "UNKNOWN", reason: "WARMUP_DOCUMENT_INVALID"};
      }
      for (const record of document.records) {
        budget.check();
        validateRecord(record);
        if (identityKey(record.identity) !== identityKey(document.identity)) {
          return {status: "UNKNOWN", reason: "RECORD_IDENTITY_MISMATCH"};
        }
      }
      if (document.records.some(record => record.receivedAt > document.capturedAt) ||
          hasDuplicateLogicalKeys(document.records, () => budget.check())) {
        return {status: "UNKNOWN", reason: "DUPLICATE_LOGICAL_RECORD_OR_FUTURE_RECEIPT"};
      }
      if (workState.nodes > this.#limits.maxWorkUnits ||
          document.budgets?.workUnits !== workState.nodes) {
        return {status: "UNKNOWN", reason: "WORK_LIMIT_OR_BUDGET_MISMATCH"};
      }
      budget.check();
      if (await publicationPending(pendingPath, budget, this.#fsOps)) {
        return {status: "UNKNOWN", reason: "PUBLICATION_STATE_UNKNOWN"};
      }
      return {status: "AVAILABLE", document: deepFreeze(document), digest: result.digest,
        byteLength: result.byteLength};
    } catch (error) {
      if (error instanceof OperationStopped) {
        return {status: "UNKNOWN", reason: error.reason};
      }
      return {status: "UNKNOWN", reason: "WARMUP_READ_FAILED"};
    } finally {
      budget.close();
    }
  }
}

function exactIdentity(record, identity) {
  return identityKey(record.identity) === identityKey(identity);
}

function reviewedOrSynthetic(record, payload) {
  return record.trust === "REVIEWED" ||
    (record.trust === "SYNTHETIC_FIXTURE_ONLY" &&
      payload?.source === "SYNTHETIC_FIXTURE_ONLY");
}

function validReceipt(receipt, source, receivedAt) {
  return isRecord(receipt) && receipt.status === "SOURCE_BOUND" &&
    typeof receipt.id === "string" && receipt.id.length > 0 &&
    receipt.source === source && HASH.test(receipt.payloadSha256 ?? "") &&
    receipt.receivedAt === receivedAt;
}

function usablePriceRecord(record, {identity, mint, atMs, denomination}, capturedAt) {
  try { validateRecord(record); } catch { return false; }
  const observation = record.payload;
  return record.kind === "price" && exactIdentity(record, identity) &&
    record.mint === mint && record.sourceAtMs === atMs &&
    record.denomination === denomination && record.completeness === "COMPLETE" &&
    reviewedOrSynthetic(record, observation) && record.source === observation.source &&
    record.methodologyVersion === observation.methodologyVersion &&
    observation.status === "SOURCE_BOUND" && observation.mint === mint &&
    observation.denomination === denomination && observation.sourceAtMs === atMs &&
    observation.sourceAtMs <= observation.receivedAt &&
    observation.receivedAt === record.receivedAt &&
    observation.receivedAt <= capturedAt &&
    typeof observation.valueUsd === "number" &&
    Number.isFinite(observation.valueUsd) && observation.valueUsd > 0 &&
    validReceipt(observation.receipt, observation.source, observation.receivedAt);
}

function usableCensusRecord(record, {identity, atMs, policyVersion}, capturedAt) {
  try { validateRecord(record); } catch { return false; }
  const snapshot = record.payload;
  const validSlot = snapshot.slot === null
    ? snapshot.provenanceType === "OFFCHAIN_TIMESTAMP_NO_SOLANA_SLOT"
    : Number.isSafeInteger(snapshot.slot) && snapshot.slot >= 0 &&
      snapshot.provenanceType === "ONCHAIN_SLOT" && snapshot.commitment === "finalized";
  return record.kind === "census" && exactIdentity(record, identity) &&
    record.observedAt === atMs && record.policyVersion === policyVersion &&
    record.completeness === "COMPLETE" && reviewedOrSynthetic(record, snapshot) &&
    record.source === snapshot.source && snapshot.status === "COMPLETE" &&
    exactIdentity({identity: snapshot.identity}, identity) &&
    snapshot.observedAt === atMs && snapshot.censusPolicyVersion === policyVersion &&
    snapshot.coverage?.complete === true && snapshot.coverage?.truncated === false &&
    snapshot.coverage?.cursorExhausted === true &&
    snapshot.aggregation === "DISTINCT_POSITIVE_BALANCE_OWNER" &&
    typeof snapshot.denominatorPolicy === "string" && snapshot.denominatorPolicy.length > 0 &&
    typeof snapshot.denominatorAtoms === "string" &&
    /^(0|[1-9]\d{0,39})$/.test(snapshot.denominatorAtoms) &&
    BigInt(snapshot.denominatorAtoms) > 0n && Array.isArray(snapshot.exclusions) &&
    snapshot.exclusions.every(value => typeof value === "string" && value.length > 0) &&
    snapshot.receivedAt === record.receivedAt &&
    snapshot.receivedAt >= snapshot.observedAt &&
    snapshot.receivedAt <= capturedAt &&
    validSlot && validReceipt(snapshot.receipt, snapshot.source, snapshot.receivedAt) &&
    countCensusOwners(snapshot.owners) !== null;
}

function exactMatches(records, predicate) {
  const matches = [];
  for (const record of records) {
    if (predicate(record)) matches.push(record);
    if (matches.length > 1) return [];
  }
  return matches;
}

export function createWarmupPriceSource(dataset) {
  const records = Array.isArray(dataset?.records) &&
    dataset.records.length <= DEFAULT_WARMUP_LIMITS.maxRecords ? dataset.records : [];
  const capturedAt = dataset?.capturedAt;
  return Object.freeze({
    async readObservation({mint, atMs, denomination, purpose} = {}) {
      const request = {identity: dataset?.identity, mint, atMs, denomination};
      const datasetIdentityMatches = validIdentity(dataset?.identity) &&
        validIdentity(request.identity);
      const matches = datasetIdentityMatches ? exactMatches(records, record =>
        PRICE_KINDS.has(record.kind) && exactIdentity(record, request.identity) &&
        record.mint === mint && record.sourceAtMs === atMs &&
        record.denomination === denomination) : [];
      if (matches.length !== 1) return null;
      const record = matches[0];
      if (!validTime(capturedAt) || !usablePriceRecord(record, request, capturedAt)) return null;
      return deepFreeze({...record.payload, purpose});
    }
  });
}

export function createWarmupCensusSource(dataset) {
  const records = Array.isArray(dataset?.records) &&
    dataset.records.length <= DEFAULT_WARMUP_LIMITS.maxRecords ? dataset.records : [];
  const capturedAt = dataset?.capturedAt;
  return Object.freeze({
    async readSnapshots({identity, startAtMs, endAtMs, policy} = {}) {
      const requested = [startAtMs, endAtMs];
      const validRequest = validIdentity(identity) && validIdentity(dataset?.identity) &&
        exactIdentity({identity: dataset.identity}, identity) &&
        requested.every(validTime);
      const snapshots = requested.map(endpoint => {
        if (!validRequest) return [];
        return exactMatches(records, record =>
          CENSUS_KINDS.has(record.kind) && exactIdentity(record, identity) &&
          record.observedAt === endpoint && record.policyVersion === policy?.version);
      });
      const available = snapshots.map((matches, index) =>
        matches.length === 1 && validTime(capturedAt) &&
        usableCensusRecord(matches[0], {
          identity, atMs: requested[index], policyVersion: policy?.version
        }, capturedAt));
      const exactEndpoints = {available: [], missing: []};
      requested.forEach((endpoint, index) =>
        exactEndpoints[available[index] ? "available" : "missing"].push(endpoint));
      if (!available.every(Boolean)) {
        return {status: "WARMUP", reason: "EXACT_CENSUS_ENDPOINT_UNAVAILABLE",
          coverage: {complete: false, truncated: false, exactEndpoints}, snapshots: []};
      }
      const pair = snapshots.map(matches => matches[0].payload);
      const samePolicy = pair[0].source === pair[1].source &&
        pair.every((snapshot, index) =>
          snapshot.aggregation === policy?.aggregation &&
          snapshot.denominatorPolicy === policy?.denominatorPolicy &&
          JSON.stringify(snapshot.exclusions) === JSON.stringify(policy?.exclusions));
      if (!samePolicy || !comparableCensusSlots(pair[0], pair[1])) {
        exactEndpoints.available = [];
        exactEndpoints.missing = requested;
        const reason = samePolicy ? "CENSUS_ENDPOINTS_INCOMPARABLE"
          : "CENSUS_IDENTITY_OR_POLICY_MISMATCH";
        return {status: "WARMUP", reason,
          coverage: {complete: false, truncated: false, exactEndpoints}, snapshots: []};
      }
      return {status: "COMPLETE", identity, coverage: {complete: true,
        truncated: false, exactEndpoints}, snapshots: pair,
      synthetic: snapshots.some(matches => matches[0].trust === "SYNTHETIC_FIXTURE_ONLY")};
    }
  });
}

export function warmupCoverage(dataset, {identity, priceEndpoints = [], censusEndpoints = []} = {}) {
  const records = Array.isArray(dataset?.records) &&
    dataset.records.length <= DEFAULT_WARMUP_LIMITS.maxRecords ? dataset.records : [];
  const capturedAt = dataset?.capturedAt;
  const datasetIdentityMatches = validIdentity(identity) && validIdentity(dataset?.identity) &&
    exactIdentity({identity: dataset.identity}, identity);
  const availablePriceEndpoints = priceEndpoints.filter(endpoint => {
    if (!datasetIdentityMatches) return false;
    const matches = exactMatches(records, record => record.kind === "price" &&
      exactIdentity(record, identity) && record.mint === endpoint.mint &&
      record.denomination === endpoint.denomination && record.sourceAtMs === endpoint.atMs);
    return matches.length === 1 && validTime(capturedAt) &&
      usablePriceRecord(matches[0], {...endpoint, identity, atMs: endpoint.atMs}, capturedAt);
  });
  const censusRecordsByEndpoint = censusEndpoints.map(endpoint => {
    if (!datasetIdentityMatches) return [];
    return exactMatches(records, record => record.kind === "census" &&
      exactIdentity(record, identity) && record.observedAt === endpoint.atMs &&
      record.policyVersion === endpoint.policyVersion);
  });
  const censusAvailable = censusEndpoints.map((endpoint, index) => {
    const matches = censusRecordsByEndpoint[index];
    return matches.length === 1 && validTime(capturedAt) &&
      usableCensusRecord(matches[0], {
        identity, atMs: endpoint.atMs, policyVersion: endpoint.policyVersion
      }, capturedAt);
  });
  if (censusEndpoints.length === 2 && censusAvailable.every(Boolean)) {
    const [start, end] = censusRecordsByEndpoint.map(matches => matches[0]);
    const samePolicy = censusEndpoints[0].policyVersion === censusEndpoints[1].policyVersion &&
      start.source === end.source &&
      start.payload.aggregation === end.payload.aggregation &&
      start.payload.denominatorPolicy === end.payload.denominatorPolicy &&
      JSON.stringify(start.payload.exclusions) === JSON.stringify(end.payload.exclusions);
    if (!samePolicy || !comparableCensusSlots(start.payload, end.payload)) {
      censusAvailable.fill(false);
    }
  }
  const availableCensusEndpoints = censusEndpoints.filter((_, index) => censusAvailable[index]);
  return deepFreeze({
    status: "WARMUP",
    datasetId: dataset?.datasetId ?? null,
    exactAvailable: {prices: availablePriceEndpoints, census: availableCensusEndpoints},
    exactMissing: {
      prices: priceEndpoints.filter(item => !availablePriceEndpoints.includes(item)),
      census: censusEndpoints.filter(item => !availableCensusEndpoints.includes(item))
    },
    executionAuthorized: false,
    realDataEntryEligible: false
  });
}

export async function acquireAndPublishOwnerCensus({
  enabled = false,
  store,
  datasetId,
  identity,
  manifest,
  transport,
  clock,
  signal,
  mintEvidence,
  versions = {}
} = {}) {
  if (!enabled || store?.enabled !== true) return {status: "DISABLED"};
  if (typeof clock !== "function") return {status: "UNKNOWN", reason: "INVALID_CLOCK"};
  const result = await acquireOwnerCensus({
    identity, manifest, transport, clock, signal, mintEvidence
  });
  let receivedAt;
  try { receivedAt = clock(); } catch { receivedAt = null; }
  if (!validTime(receivedAt) || !validTime(result?.observedAt)) {
    return {status: "UNKNOWN", reason: "CENSUS_RECEIPT_TIME_UNKNOWN"};
  }
  const record = {
    kind: "local-census-acquisition",
    identity: result.boundIdentity ?? identity,
    observedAt: result.observedAt,
    observedAtBasis: "LOCAL_ACQUISITION_TIME",
    receivedAt,
    source: result.source ?? "Solana JSON-RPC getProgramAccounts",
    trust: "UNKNOWN",
    completeness: "UNKNOWN",
    payload: result
  };
  const publication = await store?.publish({
    datasetId, identity, capturedAt: receivedAt, records: [record], versions,
    budgets: result.provenance ?? {}
  }, {signal});
  return {status: publication?.status ?? "UNKNOWN", censusStatus: result.status,
    censusTrust: "UNAUTHENTICATED_RPC_RESPONSE", observedAtBasis: record.observedAtBasis,
    publication};
}

export async function acquireAndPublishProspectiveOwnerCensus({
  enabled = false, store, datasetId, phase, identity, bounds, transport, clock, signal,
  versions = {}
} = {}) {
  if (enabled !== true || store?.enabled !== true) return {status: "DISABLED"};
  if (!["T0", "T1"].includes(phase) || !DATASET_ID.test(datasetId ?? "") ||
      typeof store.publish !== "function" || typeof store.read !== "function") {
    return {status: "UNKNOWN", reason: "INVALID_PROSPECTIVE_PUBLICATION"};
  }
  const result = await captureProspectiveOwnerCensus({
    enabled: true, identity, bounds, transport, clock, signal
  });
  if (result.capture?.status !== "RECONCILED_DIAGNOSTIC_ONLY") {
    return {status: "UNKNOWN", reason: result.reason, census: result, publication: null};
  }
  const receivedAt = result.capture.acquisitionEndedAt;
  const record = {
    kind: "local-census-acquisition",
    identity: result.boundIdentity,
    observedAt: receivedAt,
    observedAtBasis: "LOCAL_ACQUISITION_TIME",
    receivedAt,
    source: result.source,
    trust: "UNKNOWN",
    completeness: "UNKNOWN",
    payload: {...result, capture: {...result.capture, phase}}
  };
  const publication = await store.publish({
    datasetId, identity: result.boundIdentity, capturedAt: receivedAt, records: [record],
    versions, budgets: result.capture.consumed
  }, {signal});
  if (!["PUBLISHED", "DUPLICATE"].includes(publication?.status)) {
    return {status: publication?.status ?? "UNKNOWN", publication, executionAuthorized: false};
  }
  const readback = await store.read(datasetId, {signal});
  if (readback.status !== "AVAILABLE" || readback.digest !== publication.digest) {
    return {status: "UNKNOWN", reason: "PROSPECTIVE_READBACK_FAILED", publication,
      executionAuthorized: false};
  }
  return {
    status: publication.status, publication, phase, slot: result.capture.slot,
    censusStatus: "UNKNOWN", censusTrust: "UNAUTHENTICATED_RPC_RESPONSE",
    observedAtBasis: "LOCAL_ACQUISITION_TIME", executionAuthorized: false,
    realDataEntryEligible: false
  };
}
