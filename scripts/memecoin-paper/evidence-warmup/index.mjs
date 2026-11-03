import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat, mkdir, open, link, unlink} from "node:fs/promises";
import path from "node:path";
import {acquireOwnerCensus} from "../owner-census.mjs";

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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 &&
    Number.isFinite(new Date(value).getTime());
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

function validateJsonValue(value, state = {nodes: 0, seen: new WeakSet()}, depth = 0) {
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
    for (const child of value) validateJsonValue(child, state, depth + 1);
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
      validateJsonValue(descriptor.value, state, depth + 1);
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
       (record.completeness === "COMPLETE" && record.payload.status !== "SOURCE_BOUND") ||
       record.payload.sourceAtMs !== record.sourceAtMs ||
       record.payload.receivedAt !== record.receivedAt)) {
    throw new TypeError("warmup price record is invalid");
  }
  if (record.kind === "census" &&
      (!validTime(record.observedAt) || record.payload.observedAt !== record.observedAt ||
       typeof record.policyVersion !== "string" || !record.policyVersion ||
       record.source !== record.payload.source ||
       record.payload.censusPolicyVersion !== record.policyVersion ||
       record.payload.receivedAt !== record.receivedAt ||
       record.payload.receipt?.receivedAt !== record.receivedAt ||
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

async function assertPrivateDirectory(directory, {create = false, target = false} = {}) {
  const resolved = path.resolve(directory);
  if (create) await mkdir(resolved, {recursive: true, mode: 0o700});
  const parts = resolved.split(path.sep).filter(Boolean);
  let current = path.parse(resolved).root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("warmup storage ancestry is not a trusted directory");
    }
    const isTarget = index === parts.length - 1;
    const stickyRoot = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
    if ((!stickyRoot && (stat.mode & 0o022) !== 0) ||
        (isTarget && (stat.uid !== process.getuid?.() ||
          (stat.mode & 0o077) !== 0)) ||
        (!isTarget && stat.uid !== process.getuid?.() && stat.uid !== 0)) {
      throw new Error("warmup storage ancestry is not private");
    }
    if (target && isTarget && !stat.isDirectory()) {
      throw new Error("warmup store is not a directory");
    }
  }
  return resolved;
}

async function boundedRead(filename, maxBytes) {
  let handle;
  try {
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (error.code === "ENOENT") return {status: "ABSENT"};
    return {status: "UNKNOWN", reason: "WARMUP_FILE_OPEN_FAILED"};
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 66 || stat.size > maxBytes ||
        stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
      return {status: "UNKNOWN", reason: "WARMUP_FILE_BOUNDS_OR_MODE_INVALID"};
    }
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < stat.size + 1) {
      const {bytesRead} = await handle.read(bytes, length, Math.min(bytes.length - length,
        stat.size + 1 - length), length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
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
  } catch {
    return {status: "UNKNOWN", reason: "WARMUP_FILE_READ_FAILED"};
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function sourceKey() {
  return "evidence-warmup.json";
}

export class EvidenceWarmupStore {
  #root;
  #enabled;
  #limits;
  #busy = false;

  constructor(root, {enabled = false, limits} = {}) {
    if (typeof root !== "string" || !path.isAbsolute(root)) {
      throw new TypeError("warmup store path must be absolute");
    }
    this.#root = path.resolve(root);
    this.#enabled = enabled === true;
    this.#limits = validateLimits(limits);
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
    const started = performance.now();
    this.#busy = true;
    let temporary = null;
    try {
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
      validateJsonValue(document, workState);
      if (workState.nodes > this.#limits.maxWorkUnits) {
        return {status: "UNKNOWN", reason: "WORK_LIMIT"};
      }
      document.budgets.workUnits = workState.nodes;
      for (const record of records) {
        validateRecord(record);
        if (identityKey(record.identity) !== identityKey(identity)) {
          return {status: "UNKNOWN", reason: "RECORD_IDENTITY_MISMATCH"};
        }
      }
      const payload = Buffer.from(JSON.stringify(document), "utf8");
      const digest = createHash("sha256").update(payload).digest("hex");
      const bytes = Buffer.concat([Buffer.from(`${digest}\n`, "ascii"), payload]);
      if (bytes.length > this.#limits.maxBytes) {
        return {status: "UNKNOWN", reason: "BYTE_LIMIT"};
      }
      if (this.#limits.maxFiles !== 1) {
        return {status: "UNKNOWN", reason: "FILE_LIMIT"};
      }
      const root = await assertPrivateDirectory(this.#root, {create: true, target: true});
      if (signal?.aborted || performance.now() - started >= this.#limits.maxElapsedMs) {
        return {status: "UNKNOWN", reason: signal?.aborted ? "CANCELLED" : "DEADLINE"};
      }
      const finalPath = path.join(root, sourceKey(datasetId));
      const existing = await boundedRead(finalPath, this.#limits.maxBytes);
      if (existing.status === "OK") {
        return existing.digest === digest && existing.document.datasetId === datasetId
          ? {status: "DUPLICATE", datasetId, digest, byteLength: existing.byteLength}
          : {status: "CONFLICT", reason: "IMMUTABLE_DATASET_CONFLICT"};
      }
      if (existing.status !== "ABSENT") return existing;
      const pendingPath = path.join(root, ".evidence-warmup-pending");
      let handle;
      try {
        handle = await open(pendingPath, "wx", 0o600);
        temporary = pendingPath;
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle?.close();
      }
      if (signal?.aborted || performance.now() - started >= this.#limits.maxElapsedMs) {
        return {status: "UNKNOWN", reason: signal?.aborted ? "CANCELLED" : "DEADLINE"};
      }
      try {
        await link(temporary, finalPath);
      } catch (error) {
        if (error.code === "EEXIST") {
          const current = await boundedRead(finalPath, this.#limits.maxBytes);
          if (current.status === "OK" && current.digest === digest) {
            return {status: "DUPLICATE", datasetId, digest, byteLength: current.byteLength};
          }
          return current.status === "OK"
            ? {status: "CONFLICT", reason: "IMMUTABLE_DATASET_CONFLICT"}
            : {status: "UNKNOWN", reason: "PUBLICATION_STATE_UNKNOWN"};
        }
        return {status: "UNKNOWN", reason: "PUBLICATION_STATE_UNKNOWN"};
      }
      try {
        await syncDirectory(root);
      } catch {
        return {status: "UNKNOWN", reason: "PUBLICATION_STATE_UNKNOWN"};
      }
      return {status: "PUBLISHED", datasetId, digest, byteLength: bytes.length};
    } catch {
      return {status: "UNKNOWN", reason: "WARMUP_PUBLICATION_FAILED"};
    } finally {
      if (temporary) void unlink(temporary).catch(() => {});
      this.#busy = false;
    }
  }

  async read(datasetId) {
    if (!DATASET_ID.test(datasetId ?? "")) return {status: "UNKNOWN", reason: "INVALID_DATASET_ID"};
    try {
      const root = await assertPrivateDirectory(this.#root, {target: true});
      const result = await boundedRead(path.join(root, sourceKey(datasetId)), this.#limits.maxBytes);
      if (result.status !== "OK") return result;
      const document = result.document;
      const workState = {nodes: 0, seen: new WeakSet()};
      validateJsonValue(document, workState);
      if (document?.schema !== EVIDENCE_WARMUP_SCHEMA || document.datasetId !== datasetId ||
          !validIdentity(document.identity) ||
          !Array.isArray(document.records) || document.records.length > this.#limits.maxRecords) {
        return {status: "UNKNOWN", reason: "WARMUP_DOCUMENT_INVALID"};
      }
      for (const record of document.records) {
        validateRecord(record);
        if (identityKey(record.identity) !== identityKey(document.identity)) {
          return {status: "UNKNOWN", reason: "RECORD_IDENTITY_MISMATCH"};
        }
      }
      if (workState.nodes > this.#limits.maxWorkUnits ||
          document.budgets?.workUnits !== workState.nodes) {
        return {status: "UNKNOWN", reason: "WORK_LIMIT_OR_BUDGET_MISMATCH"};
      }
      return {status: "AVAILABLE", document: deepFreeze(document), digest: result.digest,
        byteLength: result.byteLength};
    } catch {
      return {status: "UNKNOWN", reason: "WARMUP_READ_FAILED"};
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

export function createWarmupPriceSource(dataset) {
  const records = dataset?.records ?? [];
  return Object.freeze({
    async readObservation({mint, atMs, denomination, purpose} = {}) {
      const matches = records.filter(record => PRICE_KINDS.has(record.kind) &&
        record.mint === mint && record.sourceAtMs === atMs &&
        record.denomination === denomination);
      if (matches.length !== 1) return null;
      const record = matches[0];
      if (!reviewedOrSynthetic(record, record.payload) ||
          record.completeness !== "COMPLETE" ||
          record.payload.source !== record.source ||
          record.payload.methodologyVersion !== record.methodologyVersion ||
          record.payload.sourceAtMs !== atMs || record.payload.mint !== mint ||
          record.payload.denomination !== denomination ||
          record.payload.receivedAt !== record.receivedAt) return null;
      return deepFreeze({...record.payload, purpose});
    }
  });
}

export function createWarmupCensusSource(dataset) {
  const records = dataset?.records ?? [];
  return Object.freeze({
    async readSnapshots({identity, startAtMs, endAtMs, policy} = {}) {
      const requested = [startAtMs, endAtMs];
      const snapshots = requested.map(endpoint => records.filter(record =>
        CENSUS_KINDS.has(record.kind) && exactIdentity(record, identity) &&
        record.observedAt === endpoint && record.policyVersion === policy?.version));
      const available = snapshots.map(matches => matches.length === 1 &&
        reviewedOrSynthetic(matches[0], matches[0].payload) &&
        matches[0].completeness === "COMPLETE" &&
        matches[0].source === matches[0].payload.source &&
        matches[0].payload.censusPolicyVersion === policy?.version &&
        matches[0].payload.receivedAt === matches[0].receivedAt);
      const exactEndpoints = {available: [], missing: []};
      requested.forEach((endpoint, index) =>
        exactEndpoints[available[index] ? "available" : "missing"].push(endpoint));
      if (!available.every(Boolean)) {
        return {status: "WARMUP", reason: "EXACT_CENSUS_ENDPOINT_UNAVAILABLE",
          coverage: {complete: false, truncated: false, exactEndpoints}, snapshots: []};
      }
      const pair = snapshots.map(matches => matches[0].payload);
      const valid = pair[0].source === pair[1].source &&
        pair.every((snapshot, index) =>
          exactIdentity({identity: snapshot.identity}, identity) &&
          snapshot.observedAt === requested[index] &&
          snapshot.censusPolicyVersion === policy?.version &&
          snapshot.aggregation === policy?.aggregation &&
          snapshot.denominatorPolicy === policy?.denominatorPolicy &&
          JSON.stringify(snapshot.exclusions) === JSON.stringify(policy?.exclusions));
      if (!valid) {
        return {status: "WARMUP", reason: "CENSUS_IDENTITY_OR_POLICY_MISMATCH",
          coverage: {complete: false, truncated: false, exactEndpoints}, snapshots: []};
      }
      return {status: "COMPLETE", identity, coverage: {complete: true,
        truncated: false, exactEndpoints}, snapshots: pair,
      synthetic: snapshots.some(matches => matches[0].trust === "SYNTHETIC_FIXTURE_ONLY")};
    }
  });
}

export function warmupCoverage(dataset, {identity, priceEndpoints = [], censusEndpoints = []} = {}) {
  const prices = dataset?.records?.filter(record => record.kind === "price" &&
    exactIdentity(record, identity)) ?? [];
  const census = dataset?.records?.filter(record => record.kind === "census" &&
    exactIdentity(record, identity)) ?? [];
  const availablePriceEndpoints = priceEndpoints.filter(endpoint => prices.some(record =>
    record.mint === endpoint.mint && record.denomination === endpoint.denomination &&
    record.sourceAtMs === endpoint.atMs && reviewedOrSynthetic(record, record.payload) &&
    record.completeness === "COMPLETE"));
  const availableCensusEndpoints = censusEndpoints.filter(endpoint => census.some(record =>
    record.observedAt === endpoint.atMs && record.policyVersion === endpoint.policyVersion &&
    reviewedOrSynthetic(record, record.payload) && record.completeness === "COMPLETE"));
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
