import {createHash} from "node:crypto";
import {open} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {PaperCheckpointSession} from "./checkpoint-session.mjs";
import {canonicalCheckpointBytes, CheckpointStore} from "./checkpoint-store.mjs";
import {createPaperExecutionStep} from "./execution-step.mjs";
import {PAPER_LEDGER_POLICY} from "./ledger.mjs";
import {SYNTHETIC_SMART_WALLET_ALLOWLIST, syntheticCandidate} from "./synthetic-fixtures.mjs";
import {scout} from "./stages.mjs";

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const SYNTHETIC_SOURCE = "SYNTHETIC_FIXTURE_ONLY";
const BUDGET_KEYS = [
  "requests", "bytes", "events", "candidates", "cycles", "durationMs",
  "callbackTimeoutMs", "maxWallClockUncertaintyMs"
];
const MAXIMA = {
  requests: 960, bytes: 10_485_760, events: 1_000, candidates: 300, cycles: 300,
  durationMs: EIGHT_HOURS_MS, callbackTimeoutMs: 30_000, maxWallClockUncertaintyMs: 60_000
};
const syntheticClocks = new WeakMap();
const offlineFixtureAdaptersBySource = new WeakMap();
const FIXTURE_FAULTS = new Set([
  "NONE", "DISCONNECT", "CALLBACK_TIMEOUT", "LATE_DEADLINE", "WAIT_FOR_STOP",
  "CLOCK_JUMP", "LOST_ACK", "NO_CANDIDATES", "MISSING_EVIDENCE", "MISSING_COSTS",
  "NO_MARK", "REQUEST_BUDGET", "SPOOF_SOURCE", "QUOTE_AFTER_RECEIPT"
]);
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const DISABLED = Object.freeze({
  status: "DISABLED",
  enabled: false,
  executionStarted: false,
  reason: "Composition requires an explicit SYNTHETIC_TEST_ONLY offline proof configuration"
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function integerTime(value) {
  return Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
}

function exactKeys(value, expected) {
  if (!isRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
  const keys = Object.getOwnPropertyNames(value);
  if (keys.sort().join(",") !== [...expected].sort().join(",")) return false;
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor;
  });
}

function onlyDataKeys(value, allowed) {
  if (!isRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
  const keys = Object.getOwnPropertyNames(value);
  if (Object.keys(value).length !== keys.length) return false;
  return keys.every(key => {
    if (!allowed.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor;
  });
}

function validateConfig(config) {
  if (!exactKeys(config, ["version", "mode", "enabled", "runId", "startedAt", "budgets"]) ||
      config.version !== 1 || config.mode !== "SYNTHETIC_TEST_ONLY" ||
      config.enabled !== true || typeof config.runId !== "string" || !SAFE_ID.test(config.runId) ||
      !integerTime(config.startedAt) || !exactKeys(config.budgets, BUDGET_KEYS)) {
    throw new TypeError("invalid bounded composition configuration");
  }
  for (const key of BUDGET_KEYS) {
    const minimum = key === "maxWallClockUncertaintyMs" ? 0 : key === "bytes" ? 1024 : 1;
    if (!Number.isSafeInteger(config.budgets[key]) ||
        config.budgets[key] < minimum || config.budgets[key] > MAXIMA[key]) {
      throw new RangeError(`budget ${key} is outside its supported bound`);
    }
  }
  if (config.budgets.callbackTimeoutMs > config.budgets.durationMs ||
      config.budgets.candidates > config.budgets.cycles) {
    throw new RangeError("callback, candidate, and cycle budgets are inconsistent");
  }
  return Object.freeze({...config, budgets: Object.freeze({...config.budgets})});
}

export function createSyntheticClock(options = {}) {
  if (!onlyDataKeys(options, ["wallStart", "monotonicStart"])) {
    throw new TypeError("synthetic clock options must be bounded data");
  }
  const wallStart = options.wallStart ?? Date.now();
  const monotonicStart = options.monotonicStart ?? 0;
  if (!integerTime(wallStart) || !Number.isFinite(monotonicStart) || monotonicStart < 0) {
    throw new TypeError("synthetic clock values are outside their bounds");
  }
  const performanceStart = performance.now();
  let wallOffset = 0;
  let monotonicOffset = 0;
  const clock = Object.freeze({
    wallClock() {
      return Math.floor(wallStart + performance.now() - performanceStart + wallOffset);
    },
    monotonicClock() {
      return monotonicStart + performance.now() - performanceStart + monotonicOffset;
    },
    advance(milliseconds = 1) {
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > EIGHT_HOURS_MS) {
        throw new RangeError("synthetic clock advance is outside its bound");
      }
      wallOffset += milliseconds;
      monotonicOffset += milliseconds;
    },
    jumpWall(milliseconds) {
      if (!Number.isSafeInteger(milliseconds) || Math.abs(milliseconds) > 60_000) {
        throw new RangeError("synthetic wall-clock jump is outside its bound");
      }
      wallOffset += milliseconds;
    }
  });
  syntheticClocks.set(clock, {source: "SYNTHETIC_FIXTURE_CLOCK", uncertaintyMs: 0});
  return clock;
}

function clockAttestationFor(clock) {
  return syntheticClocks.get(clock);
}

export function offlineFixtureAdapters(options = {}) {
  if (!onlyDataKeys(options, ["clock", "fault"])) {
    throw new TypeError("only a clock and named offline fixture fault may be selected");
  }
  const clock = options.clock ?? createSyntheticClock();
  const fault = options.fault ?? "NONE";
  if (!syntheticClocks.has(clock) || !FIXTURE_FAULTS.has(fault)) {
    throw new TypeError("only bounded built-in offline fixture scenarios are supported");
  }
  let exitCount = 0;
  const adapters = Object.freeze({
    async acquireCandidates({now, signal, recordRequest}) {
      if (fault === "DISCONNECT") throw Object.assign(new Error("fixture disconnect"), {code: "DISCONNECTED"});
      if (fault === "CALLBACK_TIMEOUT" || fault === "LATE_DEADLINE") {
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      if (fault === "WAIT_FOR_STOP") {
        return new Promise(resolve => signal.addEventListener("abort", () => resolve([]), {once: true}));
      }
      if (fault === "REQUEST_BUDGET") {
        recordRequest({bytes: 4, events: 1});
        recordRequest({bytes: 4, events: 1});
      }
      if (fault === "CLOCK_JUMP") clock.jumpWall(100);
      if (fault === "NO_CANDIDATES") return [];
      const row = syntheticCandidate(now - 1_000);
      if (fault === "MISSING_EVIDENCE") delete row.evidence.top10OwnerPct;
      if (fault === "SPOOF_SOURCE") row.source = "DexScreener public API";
      clock.advance();
      return [row];
    },
    async entryQuote({candidate: token, now}) {
      const result = fixtureQuote(token, "fixture-entry-1", now, 10_000);
      if (fault === "MISSING_COSTS") delete result.costs.networkCents;
      if (fault === "QUOTE_AFTER_RECEIPT") result.observedAt = now + 1_000;
      clock.advance();
      return result;
    },
    async exitQuote({candidate: token, now, purpose}) {
      if (fault === "NO_MARK" && purpose === "risk-mark") return null;
      exitCount += 1;
      const price = exitCount === 1 ? 10_000 : 9_000;
      const result = fixtureQuote(token, `fixture-exit-${exitCount}`, now, price);
      clock.advance();
      return result;
    }
  });
  offlineFixtureAdaptersBySource.set(adapters, {clock, fault});
  return adapters;
}

function boundedData(value, maxBytes) {
  let nodes = 0;
  let observedBytes = 0;
  const seen = new WeakSet();
  function charge(bytes) {
    observedBytes += bytes;
    if (observedBytes > maxBytes) {
      throw Object.assign(new RangeError("adapter result exceeds the global byte budget"), {code: "BYTE_BUDGET"});
    }
  }
  function detach(item, depth = 0) {
    if (++nodes > 20_000 || depth > 32) throw new RangeError("adapter result exceeds its shape bound");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") {
      charge(Buffer.byteLength(item));
      return item;
    }
    if (typeof item === "number" && Number.isFinite(item) &&
        (!Number.isInteger(item) || Number.isSafeInteger(item))) return item;
    if (typeof item === "bigint" && item.toString().length <= 40) return item.toString();
    if (!item || typeof item !== "object" || seen.has(item) ||
        (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype &&
         Object.getPrototypeOf(item) !== null)) {
      throw new TypeError("adapter result is not bounded plain data");
    }
    seen.add(item);
    const keys = Object.keys(item);
    if (Object.getOwnPropertySymbols(item).length > 0 ||
        Object.getOwnPropertyNames(item).length !== keys.length + Number(Array.isArray(item)) ||
        (Array.isArray(item) && keys.length !== item.length)) {
      throw new TypeError("adapter result contains hidden or sparse data");
    }
    const result = Array.isArray(item) ? [] : {};
    for (const key of keys) {
      charge(Buffer.byteLength(key) + 1);
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !("value" in descriptor)) throw new TypeError("adapter result contains an accessor");
      Object.defineProperty(result, key, {
        value: detach(descriptor.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    seen.delete(item);
    return result;
  }
  let detached;
  let encoded;
  try {
    detached = detach(value);
    encoded = JSON.stringify(detached);
  } catch (error) {
    throw Object.assign(new TypeError("adapter result is not bounded JSON data"), {
      code: error?.code === "BYTE_BUDGET" ? "BYTE_BUDGET" : "INVALID_ADAPTER_DATA",
      cause: error
    });
  }
  const bytes = Buffer.byteLength(encoded);
  if (bytes > maxBytes) throw Object.assign(new RangeError("global byte budget exhausted"), {code: "BYTE_BUDGET"});
  return {value: detached, bytes};
}

function publicError(error) {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,48}$/.test(error.code)
    ? error.code : "COMPOSITION_FAILURE";
  return {status: "UNKNOWN", code, reason: code};
}

export function createPaperPilotComposition(options = {}) {
  if (!onlyDataKeys(options, ["config", "dataDirectory", "adapters", "clock", "signal"])) {
    throw new TypeError("composition factory options must be bounded data");
  }
  let {config, dataDirectory, adapters, clock, signal} = options;
  if (config === undefined || config === null) {
    return Object.freeze({start: async () => DISABLED, stop: () => false, status: () => DISABLED});
  }
  if (!isRecord(config)) throw new TypeError("composition configuration must be plain data");
  const enabled = Object.getOwnPropertyDescriptor(config, "enabled");
  if (!enabled || !("value" in enabled)) throw new TypeError("configuration cannot contain accessors");
  if (enabled.value !== true) return Object.freeze({
    start: async () => DISABLED, stop: () => false, status: () => DISABLED
  });
  config = validateConfig(config);
  if (!clock && adapters) clock = offlineFixtureAdaptersBySource.get(adapters)?.clock;
  if (!clock) clock = createSyntheticClock();
  if (!adapters) adapters = offlineFixtureAdapters({clock});
  if (typeof dataDirectory !== "string" || !path.isAbsolute(dataDirectory) ||
      !syntheticClocks.has(clock) ||
      clockAttestationFor(clock).uncertaintyMs > config.budgets.maxWallClockUncertaintyMs) {
    throw new TypeError("absolute storage and a module-generated synthetic clock are required");
  }
  if (!offlineFixtureAdaptersBySource.has(adapters) ||
      offlineFixtureAdaptersBySource.get(adapters).clock !== clock) {
    throw new TypeError("only module-generated offline fixture adapters may run");
  }
  const {fault} = offlineFixtureAdaptersBySource.get(adapters);
  if (signal !== undefined && Object.getPrototypeOf(signal) !== AbortSignal.prototype) {
    throw new TypeError("signal must be a native AbortSignal");
  }
  const clockAttestation = clockAttestationFor(clock);

  const abort = new AbortController();
  const abortParent = () => abort.abort(signal?.reason);
  if (signal?.aborted) abort.abort(signal.reason);
  else signal?.addEventListener("abort", abortParent, {once: true});
  let state = "CREATED";
  let runPromise;
  let anchor;
  let previousMono = null;
  let deadlineAt;
  let counters;
  let store;
  let session;
  let step;
  let ledgerEventsCounted = 0;
  let terminalReceipt = null;
  const provenance = {candidates: [], quotes: []};

  function readTime() {
    const wall = clock.wallClock();
    const mono = clock.monotonicClock();
    if (!integerTime(wall) || !Number.isFinite(mono) || mono < 0 ||
        (previousMono !== null && mono < previousMono)) {
      throw Object.assign(new Error("clock is invalid or monotonic time regressed"), {code: "CLOCK_INVALID"});
    }
    previousMono = mono;
    if (!anchor) {
      anchor = {wall, mono};
    } else {
      const expectedWall = anchor.wall + (mono - anchor.mono);
      if (Math.abs(wall - expectedWall) >
          config.budgets.maxWallClockUncertaintyMs - clockAttestation.uncertaintyMs) {
        throw Object.assign(new Error("wall clock diverged from monotonic elapsed time"), {code: "CLOCK_JUMP"});
      }
      if (mono - anchor.mono > config.budgets.durationMs || wall > deadlineAt) {
        throw Object.assign(new Error("composition time budget or eight-hour window ended"), {code: "DEADLINE"});
      }
    }
    return {wall, mono, elapsedMs: anchor ? mono - anchor.mono : 0};
  }

  function chargeEvent(count = 1) {
    if (!Number.isSafeInteger(count) || count < 0 ||
        counters.events + count > config.budgets.events) {
      throw Object.assign(new Error("global event budget exhausted"), {code: "EVENT_BUDGET"});
    }
    counters.events += count;
  }

  function accountRequest({bytes = 0, events = 1} = {}) {
    if (abort.signal.aborted) {
      throw Object.assign(new Error("request accounting after cancellation is forbidden"), {code: "STOPPED"});
    }
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(events) || events < 0 ||
        counters.requests + 1 > config.budgets.requests ||
        counters.bytes + bytes > config.budgets.bytes ||
        counters.events + events > config.budgets.events) {
      throw Object.assign(new Error("global request, byte, or event budget exhausted"), {code: "GLOBAL_BUDGET"});
    }
    counters.requests += 1;
    counters.bytes += bytes;
    counters.events += events;
  }

  async function invokeAdapter(name, input) {
    if (abort.signal.aborted) throw Object.assign(new Error("composition stopped"), {code: "STOPPED"});
    const before = readTime();
    const remainingMs = Math.min(config.budgets.durationMs - before.elapsedMs, deadlineAt - before.wall);
    if (remainingMs <= 0) throw Object.assign(new Error("composition deadline reached"), {code: "DEADLINE"});
    let timer;
    let timedOut = false;
    let timeoutCode = "CALLBACK_TIMEOUT";
    const callbackSignal = abort.signal;
    const adapterPromise = Promise.resolve().then(() => adapters[name]({
      ...input,
      signal: callbackSignal,
      now: before.wall,
      deadlineAt,
      remaining: Object.freeze({
        requests: config.budgets.requests - counters.requests,
        bytes: config.budgets.bytes - counters.bytes,
        events: config.budgets.events - counters.events,
        candidates: config.budgets.candidates - counters.candidates,
        cycles: config.budgets.cycles - counters.cycles
      }),
      recordRequest: accountRequest
    }));
    const timeoutMs = Math.min(config.budgets.callbackTimeoutMs, remainingMs);
    if (remainingMs <= config.budgets.callbackTimeoutMs) timeoutCode = "DEADLINE";
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        abort.abort();
        reject(Object.assign(new Error("adapter deadline exceeded"), {code: timeoutCode}));
      }, timeoutMs);
    });
    let abortListener;
    const abortPromise = new Promise((_, reject) => {
      abortListener = () => reject(Object.assign(new Error("composition cancelled"), {code: "STOPPED"}));
      callbackSignal.addEventListener("abort", abortListener, {once: true});
      if (callbackSignal.aborted) abortListener();
    });
    let result;
    try {
      result = await Promise.race([adapterPromise, timeoutPromise, abortPromise]);
    } catch (error) {
      if (timedOut) throw Object.assign(new Error("adapter did not settle before its deadline"), {code: timeoutCode});
      if (abort.signal.aborted && error?.code !== "STOPPED") {
        throw Object.assign(new Error("composition was cancelled"), {code: "STOPPED"});
      }
      throw error;
    } finally {
      clearTimeout(timer);
      callbackSignal.removeEventListener("abort", abortListener);
    }
    if (abort.signal.aborted) throw Object.assign(new Error("late adapter result ignored after cancellation"), {code: "STOPPED"});
    const after = readTime();
    const bounded = boundedData(result, config.budgets.bytes);
    if (counters.bytes + bounded.bytes > config.budgets.bytes) {
      throw Object.assign(new Error("global byte budget exhausted"), {code: "BYTE_BUDGET"});
    }
    counters.bytes += bounded.bytes;
    chargeEvent();
    return {result: bounded.value, receiptAt: after.wall, elapsedMs: after.elapsedMs};
  }

  async function runStep(method, input) {
    const ledgerReserve = 2 * PAPER_LEDGER_POLICY.maxOpenPositions + 3;
    const methodReserve = method === "finishRun" ? 1
      : method === "observeExitQuote" ? 3 : ledgerReserve;
    if (counters.events + 1 + methodReserve > config.budgets.events) {
      throw Object.assign(new Error("global event budget cannot admit another ledger step"), {code: "EVENT_BUDGET"});
    }
    chargeEvent();
    if (!Object.hasOwn(input, "now")) input.now = readTime().wall;
    const result = await step[method](input);
    const ledgerEvents = session.snapshot().summary.eventCount;
    const delta = ledgerEvents - ledgerEventsCounted;
    if (delta < 0 || counters.events + delta > config.budgets.events) {
      throw Object.assign(new Error("global event budget exhausted by ledger events"), {code: "EVENT_BUDGET"});
    }
    counters.events += delta;
    ledgerEventsCounted = ledgerEvents;
    return result;
  }

  async function finish() {
    if (!step || terminalReceipt || abort.signal.aborted) return null;
    const result = await runStep("finishRun", {
      eventId: `${config.runId}:finish`,
      marks: []
    });
    if (result?.receipt) terminalReceipt = result.receipt;
    return {result, receipt: terminalReceipt};
  }

  async function execute() {
    counters = {requests: 0, bytes: 0, events: 0, candidates: 0, cycles: 0};
    deadlineAt = config.startedAt + EIGHT_HOURS_MS;
    if (abort.signal.aborted) {
      state = "STOPPED";
      return {status: "STOPPED", code: "STOPPED", terminalReceipt: null};
    }
    const initial = readTime();
    if (initial.wall < config.startedAt) {
      state = "BLOCKED";
      return {status: "BLOCKED", code: "RUN_WINDOW_NOT_STARTED", terminalReceipt: null};
    }
    if (initial.wall > deadlineAt) {
      state = "BLOCKED";
      return {status: "BLOCKED", code: "RUN_WINDOW_EXPIRED", terminalReceipt: null};
    }
    state = "RUNNING";
    const storeOptions = fault === "LOST_ACK" ? {
      async onPhase(name, details) {
        if (name === "after-rename" && details.sequence === 1) {
          throw new Error("offline fixture lost checkpoint acknowledgement");
        }
      }
    } : undefined;
    store = await CheckpointStore.open(dataDirectory, storeOptions);
    if (abort.signal.aborted) {
      await store.close();
      store = null;
      state = "STOPPED";
      return {status: "STOPPED", code: "STOPPED", terminalReceipt: null};
    }
    const prior = await store.readCheckpoint();
    if (abort.signal.aborted) {
      await store.close();
      store = null;
      state = "STOPPED";
      return {status: "STOPPED", code: "STOPPED", terminalReceipt: null};
    }
    if (prior.status !== "ABSENT") {
      await store.close();
      store = null;
      state = "BLOCKED";
      return {status: "BLOCKED", code: "RESTART_NOT_ALLOWED", terminalReceipt: null};
    }
    session = await PaperCheckpointSession.open({store, runId: config.runId, startedAt: config.startedAt});
    step = createPaperExecutionStep({
      session, store, runId: config.runId, startedAt: config.startedAt, endAt: deadlineAt,
      limits: {
        maxEvents: Math.min(256, config.budgets.events),
        maxCommands: Math.min(512, Math.max(1, config.budgets.events - 1)),
        maxBytes: Math.min(1_048_576, config.budgets.bytes)
      }
    });
    counters.events = 1;
    let pendingAuthorization = false;
    const acquisition = await invokeAdapter("acquireCandidates", {});
    if (!Array.isArray(acquisition.result) ||
        acquisition.result.length > config.budgets.candidates ||
        acquisition.result.length > config.budgets.cycles) {
      throw Object.assign(new Error("candidate stream is invalid or exceeds its bound"), {code: "CANDIDATE_BOUND"});
    }
    counters.candidates = acquisition.result.length;
    chargeEvent(acquisition.result.length);
    for (const candidate of acquisition.result) {
      if (!integerTime(candidate?.sampledAt) ||
          candidate.sampledAt > acquisition.receiptAt + clockAttestation.uncertaintyMs) {
        throw Object.assign(new Error("candidate source time is later than its receipt"), {
          code: "SOURCE_AFTER_RECEIPT"
        });
      }
    }
    const selected = scout(acquisition.result, {
      now: acquisition.receiptAt,
      maxCandidates: config.budgets.candidates,
      source: SYNTHETIC_SOURCE
    }).selected;
    let lastStatus = "NO_CANDIDATES";

    for (const candidate of selected.slice(0, config.budgets.cycles)) {
      counters.cycles += 1;
      if (abort.signal.aborted) throw Object.assign(new Error("composition stopped"), {code: "STOPPED"});
      if (candidate.source !== SYNTHETIC_SOURCE) {
        throw Object.assign(new Error("real or caller-labeled evidence is not admitted by offline composition"), {
          code: "SOURCE_PROVENANCE"
        });
      }
      provenance.candidates.push({
        source: candidate.source,
        sourceTimestamp: candidate.sampledAt,
        receiptTimestamp: acquisition.receiptAt,
        identity: {chainId: candidate.chainId, mint: candidate.mint, pool: candidate.pool, quote: candidate.quote},
        units: {tokenQuantity: "base units", decimals: candidate.decimals, marketValues: "USD"},
        evidence: Object.entries({...candidate.evidence, ...candidate.analystEvidence}).map(([name, item]) => ({
          name,
          digest: createHash("sha256").update(canonicalCheckpointBytes(item)).digest("hex"),
          source: item?.source ?? null,
          sourceTimestamp: item?.observedAt ?? null,
          slot: item?.slot ?? null,
          binding: item?.binding ?? null,
          coverageComplete: item?.coverage?.complete === true
        }))
      });
      const authorization = await runStep("authorizeEntry", {
        eventId: `${config.runId}:authorize:${counters.cycles}`,
        tickId: `${config.runId}:tick:${counters.cycles}`,
        candidate,
        smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST,
        marks: []
      });
      lastStatus = authorization.status;
      if (authorization.status !== "AUTHORIZED") continue;
      pendingAuthorization = true;

      const entry = await invokeAdapter("entryQuote", {candidate, authorization});
      const quote = entry.result;
      if (quote === null) {
        lastStatus = "QUOTE_UNAVAILABLE";
        break;
      }
      if (!quote || quote.source !== SYNTHETIC_SOURCE) {
        throw Object.assign(new Error("quote source provenance is not the synthetic fixture source"), {
          code: "QUOTE_PROVENANCE"
        });
      }
      if (!integerTime(quote.observedAt) ||
          quote.observedAt > entry.receiptAt + clockAttestation.uncertaintyMs) {
        throw Object.assign(new Error("entry quote observation is later than its receipt"), {
          code: "QUOTE_AFTER_RECEIPT"
        });
      }
      provenance.quotes.push({
        purpose: "entry",
        source: quote.source,
        sourceTimestamp: quote.observedAt,
        receiptTimestamp: entry.receiptAt,
        identity: {chainId: quote.chainId, mint: quote.mint, pool: quote.pool, quote: quote.quote},
        units: {price: "priceMicros", costs: "integer cents", quantity: "token base units"}
      });
      const entryInput = {
        eventId: quote.eventId,
        authorizationId: authorization.authorizationId,
        quote,
        marks: []
      };
      const fill = await runStep("executeEntry", entryInput);
      lastStatus = fill.status;
      if (fill.status !== "FILLED_PAPER") break;
      pendingAuthorization = false;
      chargeEvent();
      const replay = await step.executeEntry(entryInput);
      if (replay.status !== fill.status || replay.receipt?.hash !== fill.receipt?.hash) {
        throw Object.assign(new Error("duplicate command did not return its original receipt"), {
          code: "DUPLICATE_EVENT_MISMATCH"
        });
      }

      const markEnvelope = await invokeAdapter("exitQuote", {
        candidate, purpose: "risk-mark", previousQuote: quote
      });
      const mark = markEnvelope.result;
      if (mark === null) {
        lastStatus = "VALUATION_UNAVAILABLE";
        break;
      }
      if (!mark || mark.source !== SYNTHETIC_SOURCE) {
        throw Object.assign(new Error("risk mark source provenance is not synthetic"), {code: "QUOTE_PROVENANCE"});
      }
      if (!integerTime(mark.observedAt) ||
          mark.observedAt > markEnvelope.receiptAt + clockAttestation.uncertaintyMs) {
        throw Object.assign(new Error("risk-mark observation is later than its receipt"), {
          code: "QUOTE_AFTER_RECEIPT"
        });
      }
      provenance.quotes.push({
        purpose: "risk-mark", source: mark.source, sourceTimestamp: mark.observedAt,
        receiptTimestamp: markEnvelope.receiptAt,
        identity: {chainId: mark.chainId, mint: mark.mint, pool: mark.pool, quote: mark.quote},
        units: {price: "priceMicros", costs: "integer cents"}
      });
      const risk = await runStep("riskSnapshot", {
        eventId: `${config.runId}:risk:mark`,
        marks: [mark]
      });
      lastStatus = risk.status;

      const exitEnvelope = await invokeAdapter("exitQuote", {
        candidate, purpose: "exit", previousQuote: mark
      });
      const exitQuote = exitEnvelope.result;
      if (exitQuote === null) {
        lastStatus = "VALUATION_UNAVAILABLE";
        break;
      }
      if (!exitQuote || exitQuote.source !== SYNTHETIC_SOURCE) {
        throw Object.assign(new Error("exit quote source provenance is not synthetic"), {code: "QUOTE_PROVENANCE"});
      }
      if (!integerTime(exitQuote.observedAt) ||
          exitQuote.observedAt > exitEnvelope.receiptAt + clockAttestation.uncertaintyMs) {
        throw Object.assign(new Error("exit quote observation is later than its receipt"), {
          code: "QUOTE_AFTER_RECEIPT"
        });
      }
      provenance.quotes.push({
        purpose: "exit", source: exitQuote.source, sourceTimestamp: exitQuote.observedAt,
        receiptTimestamp: exitEnvelope.receiptAt,
        identity: {chainId: exitQuote.chainId, mint: exitQuote.mint, pool: exitQuote.pool, quote: exitQuote.quote},
        units: {price: "priceMicros", costs: "integer cents"}
      });
      const exit = await runStep("observeExitQuote", {
        eventId: exitQuote.eventId, quote: exitQuote
      });
      lastStatus = exit.status;
      await runStep("riskSnapshot", {
        eventId: `${config.runId}:risk:post-exit`,
        marks: []
      });
      break;
    }

    const terminal = await finish();
    const snapshot = session.snapshot();
    state = terminal?.receipt ? "FINISHED" : "UNKNOWN";
    return {
      status: state,
      mode: "SYNTHETIC_TEST_ONLY",
      executionStarted: true,
      strategyOutcome: lastStatus,
      terminalState: {
        status: terminal?.result?.status ?? "OPEN",
        openPositions: terminal?.result?.openPositions ?? [],
        equityCents: terminal?.result?.equityCents ?? null,
        reservedPositions: pendingAuthorization ? 1 : 0,
        note: terminal?.result?.note ?? "No terminal liquidation or valuation is inferred."
      },
      terminalReceipt,
      checkpoint: {...session.metadata},
      accounting: {
        cashCents: snapshot.summary.cashCents,
        openPositions: snapshot.summary.openPositions,
        realizedGrossCents: snapshot.summary.pnl.realizedGrossCents,
        realizedNetCents: snapshot.summary.pnl.realizedNetCents,
        unrealizedGrossCents: snapshot.summary.pnl.unrealizedGrossCents,
        unrealizedNetCents: snapshot.summary.pnl.unrealizedNetCents,
        executionRealistic: false
      },
      budgets: counters,
      timing: {
        clockSource: clockAttestation.source,
        clockUncertaintyMs: clockAttestation.uncertaintyMs,
        wallStartedAt: anchor.wall,
        monotonicElapsedMs: readTime().elapsedMs,
        endAt: deadlineAt
      },
      provenance,
      authority: {providerExecution: false, signing: false, orders: false, wallet: false, liveReady: false}
    };
  }

  function start() {
    if (runPromise) return runPromise;
    if (state !== "CREATED") return Promise.resolve({status: state, terminalReceipt});
    state = "RUNNING";
    runPromise = execute().catch(error => {
      state = error?.code === "STOPPED" ? "STOPPED" : "UNKNOWN";
      return {...publicError(error), state, executionStarted: Boolean(session), terminalReceipt};
    }).finally(async () => {
      if (session) await session.close().catch(() => {});
      else if (store) await store.close().catch(() => {});
      signal?.removeEventListener("abort", abortParent);
    });
    return runPromise;
  }

  return Object.freeze({
    start,
    stop: () => {
      if (state !== "RUNNING") return false;
      abort.abort();
      return true;
    },
    status: () => Object.freeze({state, terminalReceipt})
  });
}

function fixtureQuote(candidate, eventId, observedAt, priceMicros) {
  return {
    eventId,
    mint: candidate.mint,
    chainId: candidate.chainId,
    pool: candidate.pool,
    quote: candidate.quote,
    source: SYNTHETIC_SOURCE,
    decimals: candidate.decimals,
    observedAt,
    priceMicros,
    mode: "HYPOTHETICAL",
    executable: true,
    costs: {feeCents: 0, spreadCents: 0, slippageCents: 0, priceImpactCents: 0, networkCents: 0}
  };
}

async function cli(argv) {
  if (argv[0] !== "offline-proof") {
    process.stdout.write(`${JSON.stringify(DISABLED)}\n`);
    return 0;
  }
  const args = argv.slice(1);
  const value = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
  };
  const configPath = value("--config");
  const dataDirectory = value("--data-dir");
  if (!configPath || !dataDirectory || args.length !== 4 ||
      args[0] !== "--config" || args[2] !== "--data-dir") {
    process.stdout.write(`${JSON.stringify({status: "BLOCKED", code: "INVALID_ARGUMENTS"})}\n`);
    return 1;
  }
  try {
    const handle = await open(configPath, "r");
    let bytes;
    try {
      const buffer = Buffer.alloc(65_537);
      const {size} = await handle.stat();
      if (size > 65_536) throw new RangeError("configuration exceeds its byte limit");
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 65_536) throw new RangeError("configuration exceeds its byte limit");
      bytes = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    const config = JSON.parse(bytes.toString("utf8"));
    const pilot = createPaperPilotComposition({config, dataDirectory});
    const result = await pilot.start();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === "FINISHED" ? 0 : 2;
  } catch {
    process.stdout.write(`${JSON.stringify({status: "BLOCKED", code: "INVALID_CONFIGURATION"})}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await cli(process.argv.slice(2));
}
