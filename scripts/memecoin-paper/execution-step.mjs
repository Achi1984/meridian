import {createHash} from "node:crypto";
import {canonicalCheckpointBytes, MAX_CHECKPOINT_BYTES} from "./checkpoint-store.mjs";
import {PAPER_LEDGER_POLICY} from "./ledger.mjs";
import {analyzeCandidate, filterCandidate} from "./stages.mjs";

const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const MAX_RECORDS = 10_000;
const MAX_EVENTS = 10_000;
const WINDOW_MS = 8 * 60 * 60 * 1000;
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;
const COSTS = ["feeCents", "spreadCents", "slippageCents", "priceImpactCents", "networkCents"];
const SCHEMAS = {
  authorizeEntry: ["eventId", "tickId", "candidate", "smartWalletAllowlist", "now", "marks"],
  executeEntry: ["eventId", "authorizationId", "quote", "now", "marks"],
  observeExitQuote: ["eventId", "quote", "now"],
  riskSnapshot: ["eventId", "now", "marks"],
  finishRun: ["eventId", "now", "marks"]
};
const TIME_KEYS = new Set(["now", "startedAt", "deadlineAt", "sampledAt", "observedAt", "pairCreatedAt"]);
const digest = value => createHash("sha256").update(canonicalCheckpointBytes(value)).digest("hex");
const reject = reason => ({status: "REJECT", reason, entriesAllowed: false});
const safeId = value => typeof value === "string" && SAFE_ID.test(value);

function integerTime(value) {
  return Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
}

// Bound and detach queued data before any asynchronous work or caller mutation.
function copyData(value, maxBytes) {
  let nodes = 0;
  let bytes = 0;
  const seen = new WeakSet();
  function copy(item, depth = 0, key = "") {
    if (++nodes > 100_000 || depth > 64) throw new RangeError("input node/depth capacity reached");
    bytes += typeof item === "string" ? Buffer.byteLength(item) : 16;
    if (bytes > maxBytes) throw new RangeError("input byte capacity reached");
    if (typeof item === "string" && item.length > 262_144) throw new RangeError("input string capacity reached");
    const timeEvidence = key === "pairCreatedAt" && item && typeof item === "object" && !Array.isArray(item);
    if (TIME_KEYS.has(key) && !timeEvidence && !integerTime(item)) throw new TypeError("explicit integer times required");
    if (typeof item === "bigint" && item.toString().length > 40) throw new RangeError("integer capacity reached");
    if (item === null || ["string", "boolean", "bigint"].includes(typeof item)) return item;
    if (typeof item === "number" && Number.isFinite(item) &&
        (!Number.isInteger(item) || Number.isSafeInteger(item))) return item;
    if (!item || typeof item !== "object" || seen.has(item) ||
        (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)) {
      throw new TypeError("bounded plain data required");
    }
    seen.add(item);
    const names = Object.keys(item);
    const array = Array.isArray(item);
    if (Object.getOwnPropertySymbols(item).length ||
        (array
          ? Object.getOwnPropertyNames(item).length !== item.length + 1 ||
            names.length !== item.length || names.some((name, index) => name !== String(index))
          : Object.getOwnPropertyNames(item).length !== names.length)) {
      throw new TypeError("hidden fields or non-dense arrays are unsupported");
    }
    const result = Array.isArray(item) ? [] : {};
    for (const name of names) {
      bytes += Buffer.byteLength(name);
      const descriptor = Object.getOwnPropertyDescriptor(item, name);
      if (!descriptor || !("value" in descriptor) || name === "$bigint" || name === "$map") {
        throw new TypeError("accessors and reserved keys are unsupported");
      }
      Object.defineProperty(result, name, {
        value: copy(descriptor.value, depth + 1, name),
        enumerable: true, writable: true, configurable: true
      });
    }
    seen.delete(item);
    if (timeEvidence && !integerTime(result.value)) throw new TypeError("explicit integer evidence time required");
    return result;
  }
  const result = copy(value);
  if (canonicalCheckpointBytes(result).length > maxBytes) throw new RangeError("input byte capacity reached");
  return result;
}

function completeQuote(quote, identity, now, source) {
  const amount = value => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === "bigint" && value >= 0n && value.toString().length <= 40) ||
    (typeof value === "string" && /^\d{1,40}$/.test(value));
  return quote && identity && ["mint", "chainId", "pool", "quote", "decimals"]
    .every(key => quote[key] === identity[key]) &&
    typeof quote.source === "string" && quote.source.trim().length > 0 && quote.source.length <= 256 &&
    (source === undefined ||
      (quote.source === "SYNTHETIC_FIXTURE_ONLY") === (source === "SYNTHETIC_FIXTURE_ONLY")) &&
    integerTime(quote.observedAt) && quote.observedAt <= now && now - quote.observedAt <= 300_000 &&
    Number.isSafeInteger(quote.priceMicros) && quote.priceMicros > 0 &&
    quote.mode === "HYPOTHETICAL" && quote.executable === true &&
    COSTS.every(key => amount(quote.costs?.[key]));
}

export function createPaperExecutionStep({session, store, runId, startedAt, endAt, limits = {}} = {}) {
  if (!safeId(runId) || !integerTime(startedAt) || !integerTime(endAt) ||
      endAt <= startedAt || endAt > startedAt + WINDOW_MS ||
      !store || typeof store.readCheckpoint !== "function" ||
      !session || typeof session.snapshot !== "function" ||
      Object.keys(SCHEMAS).some(method => typeof session[method] !== "function")) {
    throw new TypeError("explicit bounded run, session, and store required");
  }
  const bounds = {
    maxEvents: MAX_RECORDS - 2,
    maxCommands: MAX_RECORDS - 1,
    maxPendingAuthorizations: PAPER_LEDGER_POLICY.maxOpenPositions,
    maxBytes: MAX_CHECKPOINT_BYTES,
    ...limits
  };
  const ceilings = {
    maxEvents: MAX_RECORDS - 2,
    maxCommands: MAX_RECORDS - 1,
    maxPendingAuthorizations: PAPER_LEDGER_POLICY.maxOpenPositions,
    maxBytes: MAX_CHECKPOINT_BYTES
  };
  if (Object.keys(bounds).some(key => !Object.hasOwn(ceilings, key) ||
      !Number.isSafeInteger(bounds[key]) || bounds[key] < (key === "maxBytes" ? 1024 : 1) ||
      bounds[key] > ceilings[key])) throw new RangeError("limits must tighten existing capacity");
  let head = {...session.metadata};
  if (head.runId !== runId || head.startedAt !== startedAt ||
      head.deadlineAt !== startedAt + WINDOW_MS || head.sequence !== 0) {
    throw new TypeError("only a fresh exact checkpoint run is supported; no resume");
  }
  let state = "RUNNING";
  let tail = Promise.resolve();
  let latestTime = startedAt;
  let inputBytes = 0;
  let commands = 0;
  const finishInputReserve = canonicalCheckpointBytes({
    eventId: "x".repeat(120), now: MAX_TIMESTAMP_MS, marks: []
  }).length;
  const events = new Map();
  const authorizations = new Map();
  const positions = new Map();

  function unknown() {
    state = "UNKNOWN";
    return {status: "UNKNOWN", reason: "checkpoint outcome uncertain; no retry or resume", entriesAllowed: false};
  }

  async function readHead() {
    const readback = await store.readCheckpoint();
    const metadata = session.metadata;
    if (readback.status !== "OK" || !Buffer.isBuffer(readback.bytes) ||
        readback.bytes.length > MAX_CHECKPOINT_BYTES) throw new Error("unavailable checkpoint");
    const checkpoint = JSON.parse(readback.bytes.toString("utf8"));
    if (!canonicalCheckpointBytes(checkpoint).equals(readback.bytes) ||
        createHash("sha256").update(readback.bytes).digest("hex") !== head.hash ||
        readback.hash !== head.hash || readback.sequence !== head.sequence ||
        metadata.hash !== head.hash || metadata.sequence !== head.sequence ||
        metadata.runId !== runId || metadata.startedAt !== startedAt ||
        checkpoint.runHeader?.runId !== runId || checkpoint.runHeader?.startedAt !== startedAt ||
        checkpoint.runHeader?.deadlineAt !== startedAt + WINDOW_MS ||
        checkpoint.sequence !== head.sequence || checkpoint.records?.length !== head.sequence + 1) {
      throw new Error("checkpoint head mismatch");
    }
    return checkpoint;
  }

  async function run(method, input, identity) {
    if (state === "UNKNOWN") return unknown();
    if (state === "FINISHED") return reject("run is finished");
    if (method !== "finishRun" && state !== "RUNNING") return reject("deadline reached; finish explicitly");
    if (input.now < latestTime) return reject("NON_MONOTONIC_TIME");
    latestTime = input.now;
    if (method !== "finishRun" && input.now >= endAt) {
      state = "STOPPED";
      return reject("deadline reached; finish explicitly with observed marks");
    }
    if (method !== "finishRun" && input.now > startedAt + WINDOW_MS) {
      state = "STOPPED";
      return reject("fixed eight-hour deadline exceeded");
    }
    const checkpoint = await readHead();
    const snapshot = session.snapshot();
    // Reserve room for the final command and worst-case reservation releases/exits.
    const final = method === "finishRun";
    if (commands + (final ? 1 : 2) > bounds.maxCommands ||
        head.sequence + (final ? 1 : 2) >= MAX_RECORDS ||
        snapshot.summary.eventCount + (final ? 1 : 2 * PAPER_LEDGER_POLICY.maxOpenPositions + 3) > MAX_EVENTS) {
      return reject("command or ledger event capacity reached");
    }
    let inputs;
    if (method === "authorizeEntry") {
      if (authorizations.size >= bounds.maxPendingAuthorizations) return reject("pending authorization capacity reached");
      let filterResult;
      let scoreResult;
      try {
        filterResult = filterCandidate(input.candidate, {now: input.now, holdUntil: endAt});
        scoreResult = analyzeCandidate(input.candidate, {
          now: input.now, filterResult, smartWalletAllowlist: input.smartWalletAllowlist
        });
      } catch {
        return reject("candidate evidence cannot be evaluated");
      }
      if (!filterResult.accepted || scoreResult.status !== "PASS") {
        return {status: "BLOCKED", entriesAllowed: false, filterResult, scoreResult};
      }
      inputs = {
        authorizationId: `auth:${identity}`, candidate: input.candidate, filterResult, scoreResult,
        tickId: input.tickId, now: input.now, marks: input.marks
      };
    } else if (method === "executeEntry") {
      const auth = authorizations.get(input.authorizationId);
      if (!auth || input.quote.eventId !== input.eventId ||
          !completeQuote(input.quote, auth.candidate, input.now, auth.candidate.source) ||
          input.quote.observedAt <= auth.now || input.quote.observedAt <= auth.candidate.sampledAt) {
        return reject("live authorization and strictly later fully bound quote/costs required");
      }
      inputs = {authorizationId: input.authorizationId, quote: input.quote, now: input.now, marks: input.marks};
    } else if (method === "observeExitQuote") {
      const position = positions.get(input.quote.mint);
      if (input.quote.eventId !== input.eventId ||
          !completeQuote(input.quote, position, input.now, position?.source)) {
        return reject("fully bound exit quote and costs required");
      }
      inputs = {quote: input.quote, eventId: input.eventId, now: input.now};
    } else {
      inputs = {now: input.now, marks: input.marks};
    }
    if (inputs.marks?.some(mark => !completeQuote(mark, positions.get(mark.mint), input.now,
      positions.get(mark.mint)?.source))) return reject("supplied marks must be fully bound with complete costs");
    try {
      copyData(inputs, bounds.maxBytes);
    } catch (error) {
      return reject(error.message);
    }
    const commandId = `step:${identity}`;
    const record = {
      sequence: head.sequence + 1, runId, predecessorHash: head.hash, commandId, method,
      inputs: final ? {...inputs, startedAt} : inputs,
      resultDigest: "0".repeat(64),
      ...(final ? {runStart: startedAt} : {})
    };
    const candidate = {...checkpoint, sequence: record.sequence, records: [...checkpoint.records, record]};
    const finishReserve = final ? 0 : canonicalCheckpointBytes({
      ...record, commandId: `step:${"0".repeat(64)}`, method: "finishRun",
      inputs: {now: MAX_TIMESTAMP_MS, marks: [], startedAt}, runStart: startedAt
    }).length + 64;
    if (canonicalCheckpointBytes(candidate).length + finishReserve > bounds.maxBytes) {
      return reject("checkpoint byte capacity reached before dispatch");
    }
    const result = await session[method](commandId, inputs);
    // UNKNOWN may also be a ledger result: only the exact receipt establishes which.
    record.resultDigest = digest(result);
    const expectedBytes = canonicalCheckpointBytes(candidate);
    const expectedHash = createHash("sha256").update(expectedBytes).digest("hex");
    head = {...head, sequence: record.sequence, hash: expectedHash};
    const confirmed = await readHead();
    if (!canonicalCheckpointBytes(confirmed).equals(expectedBytes)) return unknown();
    commands += 1;
    if (method === "authorizeEntry" && result.status === "AUTHORIZED") {
      authorizations.set(result.authorizationId, {candidate: input.candidate, now: input.now});
    }
    if (method === "executeEntry" && result.status === "FILLED_PAPER") {
      positions.set(input.quote.mint, {...authorizations.get(input.authorizationId).candidate});
      authorizations.delete(input.authorizationId);
    }
    const after = session.snapshot();
    const openMints = new Set(after.summary.openPositions.map(position => position.mint));
    for (const mint of positions.keys()) if (!openMints.has(mint)) positions.delete(mint);
    for (const event of after.auditEvents) {
      if (event.type === "RISK_RESERVATION_RELEASED") authorizations.delete(event.authorizationId);
    }
    if (final) state = "FINISHED";
    return {...result, commandId, receipt: {runId, sequence: head.sequence, hash: head.hash,
      resultDigest: record.resultDigest}};
  }

  function enqueue(method, raw) {
    if (state === "UNKNOWN") return Promise.resolve(unknown());
    let input;
    let identity;
    let size;
    try {
      input = copyData(raw, bounds.maxBytes);
      const schema = SCHEMAS[method];
      const object = value => value && typeof value === "object" && !Array.isArray(value);
      if (!object(input) || Object.keys(input).length !== schema.length ||
          schema.some(key => !Object.hasOwn(input, key)) || !safeId(input.eventId) ||
          !integerTime(input.now) || (method !== "observeExitQuote" && !Array.isArray(input.marks)) ||
          (input.marks && input.marks.some(mark => !object(mark))) ||
          (method === "authorizeEntry" && (!object(input.candidate) || !safeId(input.tickId))) ||
          (["executeEntry", "observeExitQuote"].includes(method) && !object(input.quote)) ||
          (method === "executeEntry" && !safeId(input.authorizationId))) {
        return Promise.resolve(reject("exact explicit operation inputs required"));
      }
      identity = digest({runId, eventId: input.eventId, purpose: method, payload: input});
      if (input.marks) {
        input.marks = input.marks.map((mark, index) => ({
          ...mark,
          ...(!safeId(mark.eventId) ? {eventId: `paper-mark:${identity}:${index}`} : {})
        }));
        input = copyData(input, bounds.maxBytes);
      }
      size = canonicalCheckpointBytes(input).length;
    } catch (error) {
      return Promise.resolve(reject(error.message));
    }
    const prior = events.get(input.eventId);
    if (prior) {
      if (prior.identity !== identity) return Promise.resolve(reject("event identity collision"));
      // Coalesce duplicates: they cannot extend the operation queue or issue I/O.
      return prior.promise.then(result => state === "UNKNOWN" ? unknown() : structuredClone(result));
    }
    const final = method === "finishRun";
    if (events.size >= bounds.maxEvents + (final ? 1 : 0) ||
        inputBytes + size + (final ? 0 : finishInputReserve) > bounds.maxBytes) {
      return Promise.resolve(reject("event/input capacity reached"));
    }
    inputBytes += size;
    const event = {identity};
    events.set(input.eventId, event);
    const operation = tail.then(() => run(method, input, identity)).catch(() => unknown());
    event.promise = operation;
    tail = operation.then(() => {});
    return operation.then(result => structuredClone(result));
  }

  return Object.freeze(Object.fromEntries(Object.keys(SCHEMAS).map(method =>
    [method, input => enqueue(method, input)])));
}
