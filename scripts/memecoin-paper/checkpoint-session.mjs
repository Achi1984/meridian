import {createHash} from "node:crypto";
import {PaperLedger, PAPER_LEDGER_POLICY} from "./ledger.mjs";
import {canonicalCheckpointBytes, MAX_CHECKPOINT_BYTES} from "./checkpoint-store.mjs";

import {pinClockPolicy, normalizeClockSample, admitClock} from "./clock-policy.mjs";

const CLOCK_SESSION_VERSION = "memecoin-paper-ledger-v3-anchored-clock";
const FORMAT_VERSION = 1;
const POLICY_VERSION = "memecoin-paper-ledger-v2-monotonic-time";
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const MAX_RECORDS = 10_000;
const MAX_INPUT_NODES = 100_000;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const TIME_KEYS = new Set(["now", "startedAt", "deadlineAt", "sampledAt", "observedAt", "pairCreatedAt"]);

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runtimeFingerprint() {
  const zone = new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/Vienna"}).resolvedOptions().timeZone;
  if (zone !== "Europe/Vienna") throw new Error("Europe/Vienna timezone data is unavailable");
  return {
    node: process.versions.node,
    icu: process.versions.icu ?? null,
    tz: process.versions.tz ?? null,
    zone
  };
}

function decodeCanonical(value) {
  if (Array.isArray(value)) return value.map(decodeCanonical);
  if (!value || typeof value !== "object") return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$bigint" &&
      typeof value.$bigint === "string" && /^(0|[1-9]\d*|-[1-9]\d*)$/.test(value.$bigint)) {
    return BigInt(value.$bigint);
  }
  if (keys.length === 1 && keys[0] === "$map" && Array.isArray(value.$map)) {
    return new Map(value.$map.map(([key, item]) => [decodeCanonical(key), decodeCanonical(item)]));
  }
  return Object.fromEntries(keys.map(key => [key, decodeCanonical(value[key])]));
}

function cloneResult(value) {
  if (Array.isArray(value)) return value.map(cloneResult);
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [cloneResult(key), cloneResult(item)]));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneResult(item)]));
  }
  return value;
}

function resultDigest(value) {
  return hash(canonicalCheckpointBytes(value));
}

function requireIntegerTime(value, field) {
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) {
    throw new TypeError(`${field} must be an explicit integer millisecond timestamp`);
  }
}

function cloneInput(value, key = "", seen = new WeakSet(), depth = 0, budget = {nodes: 0}) {
  budget.nodes += 1;
  if (budget.nodes > MAX_INPUT_NODES) throw new RangeError("command input exceeds its node limit");
  if (depth > 64) throw new RangeError("command input is too deeply nested");
  if (TIME_KEYS.has(key)) {
    if (key === "pairCreatedAt" && value && typeof value === "object" && !Array.isArray(value)) {
      requireIntegerTime(value.value, "pairCreatedAt.value");
    } else {
      requireIntegerTime(value, key);
    }
  }
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "bigint") {
    if (typeof value === "string" && value.length > 262_144) throw new RangeError("command input string is too long");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError("command input contains a non-finite or unsafe number");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_INPUT_NODES || Object.keys(value).length !== value.length ||
        Object.getOwnPropertySymbols(value).length > 0) {
      throw new RangeError("command input array is sparse or oversized");
    }
    if (seen.has(value)) throw new TypeError("command input contains a cycle");
    seen.add(value);
    const result = value.map(item => cloneInput(item, "", seen, depth + 1, budget));
    seen.delete(value);
    return result;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("command input must contain only plain data");
  }
  if (seen.has(value)) throw new TypeError("command input contains a cycle");
  seen.add(value);
  const result = {};
  const names = Object.keys(value);
  if (names.length > MAX_INPUT_NODES || Object.getOwnPropertySymbols(value).length > 0 ||
      Object.getOwnPropertyNames(value).length !== names.length) {
    throw new RangeError("command input object is oversized or has hidden fields");
  }
  for (const name of names.sort()) {
    if (name === "$bigint" || name === "$map") throw new TypeError("command input uses a reserved canonical key");
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !("value" in descriptor)) throw new TypeError("command input contains an accessor");
    Object.defineProperty(result, name, {
      value: cloneInput(descriptor.value, name, seen, depth + 1, budget),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  seen.delete(value);
  return result;
}

function validateInputShape(method, input, header) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${method} command inputs are required`);
  }
  const schemas = {
    authorizeEntry: ["authorizationId", "candidate", "filterResult", "scoreResult", "tickId", "now", "marks"],
    executeEntry: ["authorizationId", "quote", "now", "marks"],
    observeExitQuote: ["quote", "eventId", "now"],
    riskSnapshot: ["now", "marks"],
    finishRun: ["now", "marks"]
  };
  const expected = schemas[method];
  if (!expected || expected.some(key => !Object.hasOwn(input, key)) ||
      Object.keys(input).some(key => !expected.includes(key))) {
    throw new TypeError(`${method} command requires exactly its explicit inputs`);
  }
  const cloned = cloneInput(input);
  requireIntegerTime(cloned.now, "now");
  if (method !== "observeExitQuote" && !Array.isArray(cloned.marks)) {
    throw new TypeError(`${method} requires an explicit marks array`);
  }
  if (method === "observeExitQuote" &&
      (typeof cloned.eventId !== "string" || !SAFE_ID.test(cloned.eventId))) {
    throw new TypeError("observeExitQuote requires an explicit bounded eventId");
  }
  if (method === "authorizeEntry" &&
      (typeof cloned.authorizationId !== "string" || !SAFE_ID.test(cloned.authorizationId) ||
       typeof cloned.tickId !== "string" || !SAFE_ID.test(cloned.tickId) ||
       !cloned.candidate || !cloned.filterResult || !cloned.scoreResult)) {
    throw new TypeError("authorizeEntry requires complete candidate and decision inputs");
  }
  if (method === "executeEntry" &&
      (typeof cloned.authorizationId !== "string" || !SAFE_ID.test(cloned.authorizationId) ||
       !cloned.quote || typeof cloned.quote !== "object")) {
    throw new TypeError("executeEntry requires an authorizationId and complete quote input");
  }
  if (method === "observeExitQuote" && (!cloned.quote || typeof cloned.quote !== "object")) {
    throw new TypeError("observeExitQuote requires a complete quote input");
  }
  if (method === "finishRun") cloned.startedAt = header.startedAt;
  canonicalCheckpointBytes(cloned);
  return cloned;
}

function headerFor({runId, startedAt, clockPolicy}) {
  if (clockPolicy !== undefined && !clockPolicy) throw new TypeError("explicit clock policy must be complete");
  if (typeof runId !== "string" || !SAFE_ID.test(runId)) {
    throw new TypeError("runId must be a bounded safe identifier");
  }
  requireIntegerTime(startedAt, "startedAt");
  const deadlineAt = startedAt + EIGHT_HOURS_MS;
  if (!Number.isSafeInteger(deadlineAt) || !Number.isFinite(new Date(deadlineAt).getTime())) {
    throw new RangeError("fixed run deadline is outside supported time bounds");
  }
  return {
    runId,
    startedAt,
    deadlineAt,
    initialCapitalCents: "100000",
    policyVersion: clockPolicy ? CLOCK_SESSION_VERSION : POLICY_VERSION,
    ...(clockPolicy ? {clockPolicy: pinClockPolicy(clockPolicy, startedAt)} : {}),
    policy: {...PAPER_LEDGER_POLICY},
    runtime: runtimeFingerprint()
  };
}

function checkpointValue(header, records) {
  return {
    formatVersion: FORMAT_VERSION,
    runHeader: header,
    sequence: records.length - 1,
    records
  };
}

function inputIdentity(method, inputs, guard = null) {
  return hash(canonicalCheckpointBytes({method, inputs, guard}));
}

function assertRecord(record, sequence, runId, predecessorHash) {
  if (!record || record.sequence !== sequence || record.runId !== runId ||
      record.predecessorHash !== predecessorHash ||
      typeof record.method !== "string" || typeof record.commandId !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.resultDigest)) {
    throw new Error(`checkpoint command ${sequence} has invalid sequence or digest binding`);
  }
}

function invokeLedger(ledger, authorizationRefs, record, inputs) {
  if (record.guard === "clock-fault") return {status: "REJECT", reason: record.clockReceipt.reason, entriesAllowed: false, clockAdmissionBlocked: true, financialStateUnchanged: true};
  if (record.guard === "deadline") {
    return ledger.finishRun({
      startedAt: record.runStart,
      now: inputs.now,
      marks: inputs.marks ?? []
    });
  }
  switch (record.method) {
    case "authorizeEntry": {
      const result = ledger.authorizeEntry(inputs);
      if (result?.status === "AUTHORIZED") authorizationRefs.set(result.authorizationId, result);
      return result;
    }
    case "executeEntry":
      return ledger.executeEntry(authorizationRefs.get(inputs.authorizationId), inputs.quote, {
        now: inputs.now,
        marks: inputs.marks
      });
    case "observeExitQuote":
      return ledger.observeExitQuote(inputs.quote, {now: inputs.now, eventId: inputs.eventId});
    case "riskSnapshot":
      return ledger.riskSnapshot({now: inputs.now, marks: inputs.marks});
    case "finishRun":
      return ledger.finishRun({startedAt: record.runStart, now: inputs.now, marks: inputs.marks});
    default:
      throw new Error(`unsupported checkpoint command method: ${record.method}`);
  }
}

function checkpointError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export class PaperCheckpointSession {
  #store;
  #header;
  #ledger;
  #records;
  #headHash;
  #headSequence;
  #authorizationRefs = new Map();
  #commandDigests = new Map();
  #results = new Map();
  #unknown = false;
  #closed = false;
  #latestCommandTime;
  #clock;
  #clockFault = false;
  #clockRestart = false;
  #previousMonotonicMs;

  constructor(store, header, ledger, records, headHash) {
    this.#store = store;
    this.#header = header;
    this.#ledger = ledger;
    this.#records = records;
    this.#headHash = headHash;
    this.#headSequence = records.length - 1;
    this.#latestCommandTime = [...records].reverse().find(r => r.guard !== "clock-fault")?.inputs.now ?? header.startedAt;
    this.#previousMonotonicMs = header.clockPolicy?.anchorMonotonicMs;
    for (const record of records.slice(1)) {
      this.#commandDigests.set(record.commandId, inputIdentity(record.method, record.inputs, header.clockPolicy ? null : (record.guard ?? null)));
    }
  }

  static async open({store, runId, startedAt, clockPolicy, clock} = {}) {
    if (!store || typeof store.readCheckpoint !== "function" ||
        typeof store.commitCheckpoint !== "function") {
      throw new TypeError("an exclusively opened checkpoint store is required");
    }
    let checkpoint;
    try {
      checkpoint = await store.readCheckpoint();
      if (checkpoint.status === "ABSENT") {
        const header = headerFor({runId, startedAt, clockPolicy});
        if (clockPolicy && (!clock || typeof clock.sample !== "function")) throw new TypeError("anchored mode requires a session clock port");
        if (!clockPolicy && clock !== undefined) throw new TypeError("a clock port requires an explicit clock policy");
        const ledger = new PaperLedger({now: header.startedAt, runId: header.runId});
        const headerResult = {
          ...header,
          constructorStatus: "INITIALIZED"
        };
        const record = {
          sequence: 0,
          runId: header.runId,
          predecessorHash: null,
          commandId: "__header__",
          method: "constructor",
          inputs: header,
          resultDigest: resultDigest(headerResult)
        };
        const records = [record];
        const bytes = canonicalCheckpointBytes(checkpointValue(header, records));
        if (bytes.length > MAX_CHECKPOINT_BYTES) throw checkpointError("CHECKPOINT_OVERSIZE", "initial checkpoint exceeds byte limit");
        const committed = await store.commitCheckpoint({
          expectedSequence: -1,
          expectedHash: null,
          candidateBytes: bytes
        });
        if (committed.status !== "ACK") {
          throw checkpointError("CHECKPOINT_UNKNOWN", committed.reason ?? "initial checkpoint was not acknowledged");
        }
        const session = new PaperCheckpointSession(store, header, ledger, records, committed.hash);
        session.#clock = clock ? Object.freeze({sample: clock.sample.bind(clock)}) : undefined;
        return session;
      }
      if (checkpoint.status !== "OK") {
        const code = checkpoint.status === "CORRUPT" ? "CHECKPOINT_CORRUPT" : "CHECKPOINT_UNKNOWN";
        throw checkpointError(code, checkpoint.reason ?? `checkpoint status is ${checkpoint.status}`);
      }
      const parsed = JSON.parse(checkpoint.bytes.toString("utf8"));
      return PaperCheckpointSession.#restore(store, parsed, checkpoint.hash, {runId, startedAt, clockPolicy, clock});
    } catch (error) {
      if (typeof store.close === "function") await store.close().catch(() => {});
      throw error;
    }
  }

  static #restore(store, checkpoint, currentHash, requested) {
    if (checkpoint.formatVersion !== FORMAT_VERSION || !checkpoint.runHeader ||
        !Array.isArray(checkpoint.records) || checkpoint.records.length === 0 ||
        checkpoint.sequence !== checkpoint.records.length - 1 ||
        checkpoint.records.length > MAX_RECORDS) {
      throw checkpointError("CHECKPOINT_CORRUPT", "checkpoint header or record count is invalid");
    }
    const header = checkpoint.runHeader;
    const expectedHeader = headerFor({runId: header.runId, startedAt: header.startedAt, clockPolicy: requested.clockPolicy});
    if (!requested.clockPolicy && requested.clock !== undefined) throw checkpointError("CHECKPOINT_INCOMPATIBLE", "clock port cannot upgrade a fixture journal");
    if (!canonicalCheckpointBytes(header).equals(canonicalCheckpointBytes(expectedHeader)) ||
        (requested.runId !== undefined && requested.runId !== header.runId) ||
        (requested.startedAt !== undefined && requested.startedAt !== header.startedAt)) {
      throw checkpointError("CHECKPOINT_INCOMPATIBLE", "run policy, fixed window, or runtime fingerprint changed");
    }
    let ledger;
    let predecessorHash = null;
    let prefix = [];
    const authorizationRefs = new Map();
    const commandDigests = new Set();
    const results = new Map();
    let latestTime = header.startedAt;
    let previousMonotonicMs = header.clockPolicy?.anchorMonotonicMs;
    let clockFault = false;
    for (let sequence = 0; sequence < checkpoint.records.length; sequence += 1) {
      const stored = checkpoint.records[sequence];
      assertRecord(stored, sequence, header.runId, predecessorHash);
      const record = {
        ...stored,
        inputs: sequence === 0 ? stored.inputs : decodeCanonical(stored.inputs)
      };
      if (sequence === 0) {
        if (record.method !== "constructor" || record.commandId !== "__header__" ||
            !canonicalCheckpointBytes(record.inputs).equals(canonicalCheckpointBytes(header))) {
          throw checkpointError("CHECKPOINT_CORRUPT", "run header record is inconsistent");
        }
        ledger = new PaperLedger({now: header.startedAt, runId: header.runId});
        const digest = resultDigest({...header, constructorStatus: "INITIALIZED"});
        if (digest !== record.resultDigest) throw checkpointError("CHECKPOINT_CORRUPT", "constructor result digest mismatch");
      } else {
        if (record.method === "constructor" || record.commandId === "__header__" ||
            !SAFE_ID.test(record.commandId) || commandDigests.has(record.commandId)) {
          throw checkpointError("CHECKPOINT_CORRUPT", "duplicate or invalid command identity");
        }
        let commandInputs = decodeCanonical(record.inputs);
        if (record.method === "finishRun") {
          if (commandInputs.startedAt !== header.startedAt) {
            throw checkpointError("CHECKPOINT_CORRUPT", "finishRun changed the fixed start time");
          }
          const finishInputs = {...commandInputs};
          delete finishInputs.startedAt;
          commandInputs = validateInputShape(record.method, finishInputs, header);
        } else {
          commandInputs = validateInputShape(record.method, commandInputs, header);
        }
        if (header.clockPolicy) {
          if (clockFault) throw checkpointError("CHECKPOINT_CORRUPT", "new command after clock fault");
          let expectedReceipt;
          if (record.clockReceipt?.reason === "CLOCK_RESTART_BLOCKED") {
            expectedReceipt = {status: "FAULT", reason: "CLOCK_RESTART_BLOCKED", sample: null, effectiveUtcMs: null};
          } else {
            const sample = normalizeClockSample(record.clockReceipt?.sample);
            expectedReceipt = admitClock(header.clockPolicy, previousMonotonicMs, sample, commandInputs.now);
          }
          if (!canonicalCheckpointBytes(record.clockReceipt ?? null).equals(canonicalCheckpointBytes(expectedReceipt))) {
            throw checkpointError("CHECKPOINT_CORRUPT", "clock receipt is inconsistent");
          }
          clockFault = expectedReceipt.status === "FAULT";
          if (!clockFault) previousMonotonicMs = expectedReceipt.sample.monotonicMs;
        } else if (record.clockReceipt !== undefined) {
          throw checkpointError("CHECKPOINT_CORRUPT", "fixture journal contains a clock receipt");
        }
        if (!clockFault && commandInputs.now < latestTime) {
          throw checkpointError("CHECKPOINT_CORRUPT", "command time moves backwards");
        }
        if (!clockFault) latestTime = commandInputs.now;
        const expectedGuard = clockFault ? "clock-fault" :
          (record.method !== "finishRun" && commandInputs.now > header.deadlineAt ? "deadline" : undefined);
        commandDigests.add(record.commandId);
        const needsStart = !clockFault && (expectedGuard === "deadline" || record.method === "finishRun");
        if (record.guard !== expectedGuard ||
            (needsStart ? record.runStart !== header.startedAt : record.runStart !== undefined)) {
          throw checkpointError("CHECKPOINT_CORRUPT", "command guard or fixed run start is invalid");
        }
        record.inputs = commandInputs;
        const result = invokeLedger(ledger, authorizationRefs, record, commandInputs);
        if (resultDigest(result) !== record.resultDigest) {
          throw checkpointError("CHECKPOINT_INCOMPATIBLE", `replay digest mismatch at sequence ${sequence}`);
        }
        results.set(record.commandId, result);
      }
      prefix.push(stored);
      const prefixBytes = canonicalCheckpointBytes(checkpointValue(header, prefix));
      predecessorHash = hash(prefixBytes);
    }
    const finalBytes = canonicalCheckpointBytes(checkpointValue(header, checkpoint.records));
    if (hash(finalBytes) !== currentHash ||
        !canonicalCheckpointBytes(checkpoint).equals(finalBytes)) {
      throw checkpointError("CHECKPOINT_CORRUPT", "checkpoint final hash or canonical bytes mismatch");
    }
    const session = new PaperCheckpointSession(store, header, ledger, checkpoint.records, currentHash);
    session.#authorizationRefs = authorizationRefs;
    session.#commandDigests = new Map();
    session.#results = results;
    session.#clockFault = clockFault;
    session.#clockRestart = Boolean(header.clockPolicy);
    session.#previousMonotonicMs = previousMonotonicMs;
    session.#latestCommandTime = latestTime;
    for (const stored of checkpoint.records.slice(1)) {
      const decoded = {...stored, inputs: decodeCanonical(stored.inputs)};
      session.#commandDigests.set(stored.commandId,
        inputIdentity(stored.method, decoded.inputs, header.clockPolicy ? null : (stored.guard ?? null)));
    }
    return session;
  }

  get metadata() {
    this.#assertAvailable();
    return Object.freeze({
      runId: this.#header.runId,
      startedAt: this.#header.startedAt,
      deadlineAt: this.#header.deadlineAt,
      sequence: this.#headSequence,
      hash: this.#headHash,
      policyVersion: this.#header.policyVersion,
      ...(this.#header.clockPolicy ? {clockMode: this.#header.clockPolicy.mode, clockAdmissionBlocked: this.#clockFault || this.#clockRestart} : {})
    });
  }

  #assertAvailable() {
    if (this.#closed) throw new Error("checkpoint session is closed");
    if (this.#unknown) throw checkpointError("CHECKPOINT_UNKNOWN", "session publication is unresolved; no result or state is available");
  }

  async #command(commandId, method, rawInput) {
    this.#assertAvailable();
    if (typeof commandId !== "string" || !SAFE_ID.test(commandId) || commandId === "__header__") {
      return {status: "REJECT", reason: "stable bounded command identity required"};
    }
    let inputs;
    try {
      inputs = validateInputShape(method, rawInput, this.#header);
    } catch (error) {
      return {status: "REJECT", reason: error.message};
    }
    let guard = null;
    if (inputs.now > this.#header.deadlineAt && method !== "finishRun") guard = "deadline";
    const digest = inputIdentity(method, inputs, this.#header.clockPolicy ? null : guard);
    if (this.#commandDigests.has(commandId)) {
      if (this.#commandDigests.get(commandId) !== digest) {
        return {status: "REJECT", reason: "command identity reused with different payload"};
      }
      return cloneResult(this.#results.get(commandId));
    }
    // Exact acknowledged retries above are reads and do not sample a new clock.
    if (this.#clockFault) return {status: "REJECT", reason: "CLOCK_FAULT_LATCHED", entriesAllowed: false};
    if (this.#records.length >= MAX_RECORDS) return {status: "REJECT", reason: "checkpoint command capacity reached"};
    let clockReceipt;
    if (this.#header.clockPolicy) {
      if (this.#clockRestart) {
        clockReceipt = {status: "FAULT", reason: "CLOCK_RESTART_BLOCKED", sample: null, effectiveUtcMs: null};
      } else {
        let sample = null;
        try { sample = normalizeClockSample(this.#clock.sample()); } catch { /* Missing clock is a durable fault. */ }
        clockReceipt = admitClock(this.#header.clockPolicy, this.#previousMonotonicMs, sample, inputs.now);
      }
      if (clockReceipt.status === "FAULT") guard = "clock-fault";
    } else if (inputs.now < this.#latestCommandTime) {
      return {status: "REJECT", reason: "NON_MONOTONIC_TIME", entriesAllowed: false};
    }

    const record = {
      sequence: this.#headSequence + 1,
      runId: this.#header.runId,
      predecessorHash: this.#headHash,
      commandId,
      method,
      inputs,
      resultDigest: ""
    };
    if (clockReceipt) record.clockReceipt = clockReceipt;
    if (guard) record.guard = guard;
    if (guard !== "clock-fault" && (guard === "deadline" || method === "finishRun")) record.runStart = this.#header.startedAt;
    let result;
    try {
      result = invokeLedger(this.#ledger, this.#authorizationRefs, record, inputs);
    } catch {
      this.#unknown = true;
      throw checkpointError("CHECKPOINT_UNKNOWN", "ledger command threw; mutated state is withheld");
    }
    try {
      record.resultDigest = resultDigest(result);
    } catch {
      this.#unknown = true;
      throw checkpointError("CHECKPOINT_UNKNOWN", "ledger result cannot be represented canonically");
    }
    const nextRecords = [...this.#records, record];
    let bytes;
    try {
      bytes = canonicalCheckpointBytes(checkpointValue(this.#header, nextRecords));
    } catch {
      this.#unknown = true;
      throw checkpointError("CHECKPOINT_UNKNOWN", "command could not be represented canonically");
    }
    if (bytes.length > MAX_CHECKPOINT_BYTES) {
      this.#unknown = true;
      throw checkpointError("CHECKPOINT_OVERSIZE", "checkpoint byte limit reached after ledger command");
    }
    let committed;
    try {
      committed = await this.#store.commitCheckpoint({
        expectedSequence: this.#headSequence,
        expectedHash: this.#headHash,
        candidateBytes: bytes
      });
    } catch {
      this.#unknown = true;
      return {status: "UNKNOWN", reason: "checkpoint I/O failed; blind retry is forbidden"};
    }
    if (committed.status !== "ACK") {
      this.#unknown = true;
      return {
        status: "UNKNOWN",
        reason: committed.reason ?? "command result has no durable acknowledgement"
      };
    }
    if (guard === "clock-fault") this.#clockFault = true;
    else {
      this.#latestCommandTime = inputs.now;
      if (clockReceipt) this.#previousMonotonicMs = clockReceipt.sample.monotonicMs;
    }
    this.#records = nextRecords;
    this.#headSequence = record.sequence;
    this.#headHash = committed.hash;
    this.#commandDigests.set(commandId, digest);
    this.#results.set(commandId, result);
    return cloneResult(result);
  }

  authorizeEntry(commandId, inputs) {
    return this.#command(commandId, "authorizeEntry", inputs);
  }

  executeEntry(commandId, inputs) {
    return this.#command(commandId, "executeEntry", inputs);
  }

  observeExitQuote(commandId, inputs) {
    return this.#command(commandId, "observeExitQuote", inputs);
  }

  riskSnapshot(commandId, inputs) {
    return this.#command(commandId, "riskSnapshot", inputs);
  }

  finishRun(commandId, inputs) {
    return this.#command(commandId, "finishRun", inputs);
  }

  snapshot() {
    this.#assertAvailable();
    return {
      summary: cloneResult(this.#ledger.summary()),
      auditEvents: cloneResult(this.#ledger.auditEvents())
    };
  }

  async reconcilePending() {
    if (this.#closed) throw new Error("checkpoint session is closed");
    return this.#store.reconcilePending();
  }

  async close() {
    if (this.#closed) return;
    await this.#store.close();
    this.#closed = true;
  }
}
