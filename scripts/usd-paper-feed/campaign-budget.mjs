import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import { canonicalCheckpointBytes, CheckpointStore } from "../memecoin-paper/checkpoint-store.mjs";
import { createUsdSmaCandidateConfiguration } from "../usd-paper-composition/sma-candidate.mjs";
import { USD_PAPER_FEED_LIMITS as LIMITS } from "./limits.mjs";

export const USD_CAMPAIGN_BUDGET_VERSION = "USD_CAMPAIGN_ACQUISITION_BUDGET_V1";
export const MAX_USD_CAMPAIGN_BUDGET_BYTES = 512 * 1024;
const TIP_VERSION = "USD_CAMPAIGN_ACQUISITION_TIP_V1";
const MAX_RECORDS = 1 + LIMITS.maxEvents * 2 + LIMITS.maxRequests * 2;
const TOKEN = Symbol("campaign budget");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const equal = (a, b) => canonicalCheckpointBytes(a).equals(canonicalCheckpointBytes(b));

function exact(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== keys.length ||
      keys.some(key => !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"))) {
    throw new Error("INVALID_CAMPAIGN_BUDGET_RECORD");
  }
}

function configuration(value) {
  const expected = createUsdSmaCandidateConfiguration(value?.candidateNotionalCents);
  if (!equal(value, expected)) throw new Error("CAMPAIGN_BUDGET_CONFIGURATION_MISMATCH");
  return expected;
}

function initialState() {
  return {
    samples: 0, requests: 0, usedBytes: 0, reservedBytes: 0,
    firstAttemptAtMs: null, lastSampleAtMs: null, lastRequestAtMs: null,
    pendingSample: null, terminal: false
  };
}

function time(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("INVALID_BUDGET_TIME");
}

function transition(previous, event) {
  const state = structuredClone(previous);
  if (state.terminal) throw new Error("CAMPAIGN_BUDGET_TERMINAL");
  if (event.kind === "SAMPLE") {
    exact(event, ["kind", "atMs"]);
    time(event.atMs);
    if (state.pendingSample) throw new Error("CAMPAIGN_SAMPLE_PENDING");
    if (state.samples >= LIMITS.maxEvents) throw new Error("EVENT_LIMIT_REACHED");
    if (state.requests + 2 > LIMITS.maxRequests) throw new Error("REQUEST_BUDGET_EXHAUSTED");
    if ((state.requests + 2) * LIMITS.maxResponseBytes > LIMITS.maxBytes) {
      throw new Error("RUN_BYTE_BUDGET_EXHAUSTED");
    }
    if (state.lastSampleAtMs !== null &&
        event.atMs - state.lastSampleAtMs < LIMITS.minSampleIntervalMs) {
      throw new Error("SAMPLE_INTERVAL_TOO_SHORT_OR_CLOCK_ROLLBACK");
    }
    if (state.firstAttemptAtMs !== null &&
        event.atMs - state.firstAttemptAtMs > LIMITS.maxSpanMs) {
      throw new Error("OBSERVATION_WINDOW_LIMIT_REACHED");
    }
    state.samples++;
    state.firstAttemptAtMs ??= event.atMs;
    state.lastSampleAtMs = event.atMs;
    state.pendingSample = { id: state.samples, requests: 0, activeRequest: null };
  } else if (event.kind === "RESERVE") {
    exact(event, ["kind", "sampleId", "endpoint", "atMs"]);
    time(event.atMs);
    const sample = state.pendingSample;
    if (!sample || sample.id !== event.sampleId || sample.activeRequest !== null ||
        sample.requests >= 2 || !["Ticker", "OHLC"].includes(event.endpoint)) {
      throw new Error("INVALID_CAMPAIGN_RESERVATION");
    }
    if (event.atMs < state.lastSampleAtMs ||
        (state.lastRequestAtMs !== null && event.atMs < state.lastRequestAtMs)) {
      throw new Error("BUDGET_CLOCK_ROLLBACK");
    }
    if (event.atMs - state.firstAttemptAtMs > LIMITS.maxSpanMs) {
      throw new Error("OBSERVATION_WINDOW_LIMIT_REACHED");
    }
    if (state.requests >= LIMITS.maxRequests ||
        (state.requests + 1) * LIMITS.maxResponseBytes > LIMITS.maxBytes) {
      throw new Error("CAMPAIGN_BUDGET_EXHAUSTED");
    }
    state.requests++;
    state.reservedBytes += LIMITS.maxResponseBytes;
    state.lastRequestAtMs = event.atMs;
    sample.requests++;
    sample.activeRequest = state.requests;
  } else if (event.kind === "BODY") {
    exact(event, ["kind", "reservationId", "rawBodyBytes", "outcome"]);
    if (!state.pendingSample || state.pendingSample.activeRequest !== event.reservationId ||
        !Number.isSafeInteger(event.rawBodyBytes) || event.rawBodyBytes < 0 ||
        !Number.isSafeInteger(state.usedBytes + event.rawBodyBytes) ||
        !["SUCCESS", "FAILED"].includes(event.outcome) ||
        (event.outcome === "SUCCESS" && event.rawBodyBytes > LIMITS.maxResponseBytes)) {
      throw new Error("INVALID_CAMPAIGN_BODY_ACCOUNTING");
    }
    state.usedBytes += event.rawBodyBytes;
    state.reservedBytes -= Math.min(event.rawBodyBytes, LIMITS.maxResponseBytes);
    state.pendingSample.activeRequest = null;
    if (event.outcome === "FAILED") state.terminal = true;
  } else if (event.kind === "COMPLETE") {
    exact(event, ["kind", "sampleId"]);
    if (!state.pendingSample || state.pendingSample.id !== event.sampleId ||
        state.pendingSample.requests !== 2 || state.pendingSample.activeRequest !== null) {
      throw new Error("INVALID_CAMPAIGN_SAMPLE_COMPLETION");
    }
    state.pendingSample = null;
  } else if (event.kind === "STOP") {
    exact(event, ["kind", "sampleId"]);
    if (!state.pendingSample || state.pendingSample.id !== event.sampleId) {
      throw new Error("INVALID_CAMPAIGN_STOP");
    }
    state.terminal = true;
  } else {
    throw new Error("INVALID_CAMPAIGN_BUDGET_EVENT");
  }
  return state;
}

function checkpoint(config, records) {
  return {
    version: 1, schemaVersion: USD_CAMPAIGN_BUDGET_VERSION,
    configuration: config, nativeInstrument: "BTC/USD",
    sourceId: "kraken-public-btc-usd", limits: LIMITS,
    sequence: records.length - 1, records
  };
}

function tip(config, revision, digest) {
  return Object.freeze({
    schemaVersion: TIP_VERSION, configurationDigest: hash(canonicalCheckpointBytes(config)),
    revision, digest
  });
}

async function safeDirectory(directory, creating = false) {
  if (typeof directory !== "string" || !path.isAbsolute(directory) ||
      path.resolve(directory) !== directory) throw new Error("UNSAFE_CAMPAIGN_BUDGET_PATH");
  const parent = path.dirname(directory);
  if (await realpath(parent) !== parent || !(await lstat(parent)).isDirectory()) {
    throw new Error("UNSAFE_CAMPAIGN_BUDGET_PARENT");
  }
  if (creating) {
    await mkdir(directory);
    const handle = await open(parent, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("UNSAFE_CAMPAIGN_BUDGET_PATH");
  for (const name of ["checkpoint.json", ".checkpoint-pending"]) {
    const entry = await lstat(path.join(directory, name)).catch(error => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (entry && (!entry.isFile() || entry.isSymbolicLink())) {
      throw new Error("UNSAFE_CAMPAIGN_BUDGET_PATH");
    }
  }
}

function decode(result, config) {
  if (result.status !== "OK") throw new Error(`CAMPAIGN_BUDGET_${result.status}`);
  const value = JSON.parse(result.bytes.toString("utf8"));
  if (!Array.isArray(value.records) || value.records.length < 1 ||
      value.records.length > MAX_RECORDS || !equal(value, checkpoint(config, value.records))) {
    throw new Error("CAMPAIGN_BUDGET_CONFIGURATION_OR_SCHEMA_MISMATCH");
  }
  if (!equal(value.records[0], { kind: "CREATE", predecessorHash: null })) {
    throw new Error("INVALID_CAMPAIGN_BUDGET_CREATE");
  }
  let state = initialState();
  for (let index = 1; index < value.records.length; index++) {
    const record = value.records[index];
    exact(record, ["predecessorHash", "event"]);
    if (record.predecessorHash !==
        hash(canonicalCheckpointBytes(checkpoint(config, value.records.slice(0, index))))) {
      throw new Error("CAMPAIGN_BUDGET_CHAIN_MISMATCH");
    }
    state = transition(state, record.event);
  }
  return { records: value.records, state, tip: tip(config, value.sequence, result.hash) };
}

export async function inspectUsdCampaignBudget(directory, { configuration: input } = {}) {
  const config = configuration(input);
  await safeDirectory(directory);
  const result = await new CheckpointStore(directory, {
    maxBytes: MAX_USD_CAMPAIGN_BUDGET_BYTES
  }).readCheckpoint();
  if (result.status !== "OK") return { status: result.status };
  try {
    const decoded = decode(result, config);
    return { status: "OK", ...decoded.state, tip: decoded.tip };
  } catch (error) {
    return { status: "CORRUPT", reason: error.message };
  }
}

export class UsdCampaignBudget {
  #store;
  #config;
  #records;
  #state;
  #tip;
  #writable;
  #busy = false;
  #blocked = false;
  #closed = false;

  constructor(token, store, config, decoded, writable) {
    if (token !== TOKEN) throw new Error("USE_CAMPAIGN_BUDGET_FACTORY");
    this.#store = store;
    this.#config = config;
    this.#records = decoded.records;
    this.#state = decoded.state;
    this.#tip = decoded.tip;
    this.#writable = writable;
  }

  static async createNew(directory, { configuration: input, onPhase } = {}) {
    const config = configuration(input);
    await safeDirectory(directory, true);
    const store = await CheckpointStore.open(directory, {
      maxBytes: MAX_USD_CAMPAIGN_BUDGET_BYTES, onPhase
    });
    const records = [{ kind: "CREATE", predecessorHash: null }];
    const commit = await store.commitCheckpoint({
      expectedSequence: -1, expectedHash: null,
      candidateBytes: canonicalCheckpointBytes(checkpoint(config, records))
    });
    if (commit.status !== "ACK") throw new Error(`CAMPAIGN_BUDGET_WRITE_${commit.status}`);
    return new UsdCampaignBudget(TOKEN, store, config, {
      records, state: initialState(), tip: tip(config, commit.sequence, commit.hash)
    }, true);
  }

  static async reopenExisting(directory, { configuration: input, expectedTip, onPhase } = {}) {
    const config = configuration(input);
    await safeDirectory(directory);
    const store = await CheckpointStore.open(directory, {
      maxBytes: MAX_USD_CAMPAIGN_BUDGET_BYTES, onPhase
    });
    try {
      const decoded = decode(await store.readCheckpoint(), config);
      if (expectedTip !== undefined && !equal(expectedTip, decoded.tip)) {
        throw new Error("STALE_OR_MISMATCHED_CAMPAIGN_BUDGET_TIP");
      }
      return new UsdCampaignBudget(TOKEN, store, config, decoded,
        expectedTip !== undefined && !decoded.state.pendingSample && !decoded.state.terminal);
    } catch (error) {
      await store.close();
      throw error;
    }
  }

  get tip() { return this.#tip; }

  snapshot() {
    return Object.freeze({
      ...structuredClone(this.#state),
      chargedBytes: this.#state.requests * LIMITS.maxResponseBytes,
      writable: this.#writable && !this.#blocked && !this.#closed && !this.#state.terminal,
      tip: this.#tip
    });
  }

  assertConfiguration(input) {
    if (!equal(configuration(input), this.#config)) {
      throw new Error("CAMPAIGN_BUDGET_CONFIGURATION_MISMATCH");
    }
    this.#assertWritable();
  }

  #assertWritable() {
    if (this.#closed || this.#blocked || !this.#writable) {
      throw new Error("CAMPAIGN_BUDGET_INSPECTION_ONLY_OR_BLOCKED");
    }
    if (this.#busy) throw new Error("CAMPAIGN_BUDGET_BUSY");
  }

  async #append(event) {
    this.#assertWritable();
    const next = transition(this.#state, event);
    const records = [...this.#records, { predecessorHash: this.#tip.digest, event }];
    if (records.length > MAX_RECORDS) throw new Error("CAMPAIGN_BUDGET_RECORD_LIMIT");
    const candidateBytes = canonicalCheckpointBytes(checkpoint(this.#config, records));
    if (candidateBytes.length > MAX_USD_CAMPAIGN_BUDGET_BYTES) {
      throw new Error("CAMPAIGN_BUDGET_STORAGE_LIMIT");
    }
    this.#busy = true;
    try {
      const commit = await this.#store.commitCheckpoint({
        expectedSequence: this.#tip.revision, expectedHash: this.#tip.digest, candidateBytes
      });
      if (commit.status !== "ACK") throw new Error(`CAMPAIGN_BUDGET_WRITE_${commit.status}`);
      this.#records = records;
      this.#state = next;
      this.#tip = tip(this.#config, commit.sequence, commit.hash);
      return this.#tip;
    } catch (error) {
      this.#blocked = true;
      throw error;
    } finally {
      this.#busy = false;
    }
  }

  async beginSample(atMs) {
    await this.#append({ kind: "SAMPLE", atMs });
    return this.#state.samples;
  }

  async reserveRequest(sampleId, endpoint, atMs) {
    await this.#append({ kind: "RESERVE", sampleId, endpoint, atMs });
    return this.#state.requests;
  }

  finalizeRequest(reservationId, rawBodyBytes, outcome) {
    return this.#append({ kind: "BODY", reservationId, rawBodyBytes, outcome });
  }

  completeSample(sampleId) { return this.#append({ kind: "COMPLETE", sampleId }); }

  async stopSample(sampleId) {
    if (!this.#state.terminal) await this.#append({ kind: "STOP", sampleId });
  }

  block() { this.#blocked = true; }

  async close() {
    if (this.#closed || this.#busy || this.#blocked) throw new Error("CAMPAIGN_BUDGET_RECOVERY_REQUIRED");
    await this.#store.close();
    this.#closed = true;
  }
}
