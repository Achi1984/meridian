import {createHash} from "node:crypto";
import {mkdtemp} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalCheckpointBytes, CheckpointStore} from "./checkpoint-store.mjs";
import {PaperCheckpointSession} from "./checkpoint-session.mjs";
import {
  SYNTHETIC_SMART_WALLET_ALLOWLIST,
  SYNTHETIC_SOURCE,
  syntheticCandidate
} from "./synthetic-fixtures.mjs";

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const MAX_LIMITS = Object.freeze({
  maxTicks: 256,
  maxCandidates: 100,
  maxQuotes: 1_024,
  maxOperations: 10_000,
  maxInputBytes: 8 * 1024 * 1024
});
const HASH = /^[a-f0-9]{64}$/;
const EXTERNAL_INPUT_KIND = "MEMECOIN_EXTERNAL_READ_ONLY_INPUT_V1";
const externalReadOnlyInputs = new WeakMap();

class InputBudgetError extends RangeError {}

function integerTime(value) {
  return Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
}

function boundedLimits(limits = {}) {
  const result = {...MAX_LIMITS, ...limits};
  if (Object.keys(result).some(key => !Object.hasOwn(MAX_LIMITS, key)) ||
      Object.entries(result).some(([key, value]) => !Number.isSafeInteger(value) ||
        value < (key === "maxCandidates" ? 0 : 1) || value > MAX_LIMITS[key]) ||
      result.maxOperations < 2) {
    throw new RangeError("runner limits must be positive and may only tighten supported bounds");
  }
  return result;
}

function operationId(runId, startedAt, sequence, purpose) {
  const digest = createHash("sha256")
    .update(`${runId}\n${startedAt}\n${sequence}\n${purpose}`)
    .digest("hex");
  return `runner:${purpose}:${digest}`;
}

function detachInput(value, remainingBytes) {
  let nodes = 0;
  let bytes = 0;
  const seen = new WeakSet();
  function charge(count) {
    bytes += count;
    if (bytes > remainingBytes) throw new InputBudgetError("runner input byte budget reached");
  }
  function chargeString(value) {
    let length = 2;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code === 34 || code === 92) length += 2;
      else if (code <= 0x1f) {
        length += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
      }
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          length += 4;
          index += 1;
        } else {
          length += 6;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) length += 6;
      else if (code <= 0x7f) length += 1;
      else if (code <= 0x7ff) length += 2;
      else length += 3;
      if (length > remainingBytes - bytes) {
        throw new InputBudgetError("runner input byte budget reached");
      }
    }
    charge(length);
  }
  function copy(item, depth = 0) {
    if (++nodes > 100_000 || depth > 64) throw new RangeError("runner input node/depth budget reached");
    if (item === null || typeof item === "boolean") {
      charge(item === null || item === true ? 4 : 5);
      return item;
    }
    if (typeof item === "string") {
      if (item.length > 262_144) throw new RangeError("runner input string is oversized");
      chargeString(item);
      return item;
    }
    if (typeof item === "bigint") {
      const encoded = JSON.stringify({$bigint: item.toString()});
      if (encoded.length > 55) throw new RangeError("runner integer is oversized");
      charge(encoded.length);
      return item;
    }
    if (typeof item === "number" && Number.isFinite(item) &&
        (!Number.isInteger(item) || Number.isSafeInteger(item))) {
      const normalized = Object.is(item, -0) ? 0 : item;
      charge(JSON.stringify(normalized).length);
      return normalized;
    }
    if (!item || typeof item !== "object" || seen.has(item) ||
        (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)) {
      throw new TypeError("runner input must be bounded plain data");
    }
    seen.add(item);
    const names = Object.keys(item);
    const array = Array.isArray(item);
    if (Object.getOwnPropertySymbols(item).length ||
        (array
          ? Object.getOwnPropertyNames(item).length !== item.length + 1 ||
            names.length !== item.length || names.some((name, index) => name !== String(index))
          : Object.getOwnPropertyNames(item).length !== names.length)) {
      throw new TypeError("runner input contains hidden fields or a non-dense array");
    }
    const result = array ? [] : {};
    charge(2);
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const descriptor = Object.getOwnPropertyDescriptor(item, name);
      if (!descriptor || !("value" in descriptor) || name === "$bigint" || name === "$map") {
        throw new TypeError("runner input contains an accessor or reserved key");
      }
      if (index) charge(1);
      if (!array) {
        chargeString(name);
        charge(1);
      }
      Object.defineProperty(result, name, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    seen.delete(item);
    return result;
  }
  const detached = copy(value);
  const canonicalBytes = canonicalCheckpointBytes(detached);
  if (canonicalBytes.length !== bytes) throw new TypeError("runner input canonical byte accounting mismatch");
  return {value: detached, bytes: canonicalBytes.length};
}

function freezeData(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freezeData(item);
    Object.freeze(value);
  }
  return value;
}

function exactDataKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) return false;
  const keys = Object.getOwnPropertyNames(value);
  return keys.sort().join(",") === [...expected].sort().join(",") &&
    keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && "value" in descriptor;
    });
}

export function createBoundedExternalReadOnlyInput(input) {
  const detached = detachInput(input, MAX_LIMITS.maxInputBytes);
  const value = detached.value;
  if (!exactDataKeys(value, [
        "kind", "schemaVersion", "producerRevision", "sourceContracts", "timing", "payload"
      ]) ||
      value.kind !== EXTERNAL_INPUT_KIND || value.schemaVersion !== 1 ||
      typeof value.producerRevision !== "string" ||
      !/^[A-Za-z0-9._:-]{1,160}$/.test(value.producerRevision) ||
      !exactDataKeys(value.sourceContracts, ["candidateIntakeSha", "evidenceSha", "quotesSha"]) ||
      !["candidateIntakeSha", "evidenceSha", "quotesSha"].every(key =>
        value.sourceContracts[key] === null ||
        (typeof value.sourceContracts[key] === "string" &&
         /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value.sourceContracts[key]))) ||
      !exactDataKeys(value.timing, [
        "sourceTimestamp", "receiptTimestamp", "uncertaintyMs", "monotonicElapsedMs", "clockSource"
      ]) ||
      !integerTime(value.timing.sourceTimestamp) || !integerTime(value.timing.receiptTimestamp) ||
      value.timing.sourceTimestamp > value.timing.receiptTimestamp ||
      !Number.isSafeInteger(value.timing.uncertaintyMs) || value.timing.uncertaintyMs < 0 ||
      !Number.isFinite(value.timing.monotonicElapsedMs) || value.timing.monotonicElapsedMs < 0 ||
      typeof value.timing.clockSource !== "string" || value.timing.clockSource.length > 120 ||
      !value.payload || typeof value.payload !== "object" || Array.isArray(value.payload)) {
    throw new TypeError("external read-only input does not match the bounded v1 contract");
  }
  freezeData(value);
  const digest = createHash("sha256").update(canonicalCheckpointBytes(value)).digest("hex");
  externalReadOnlyInputs.set(value, {digest, bytes: detached.bytes});
  return value;
}

function syntheticCandidateEvidence(candidate) {
  if (!candidate || candidate.source !== SYNTHETIC_SOURCE) return false;
  for (const group of [candidate.evidence, candidate.analystEvidence]) {
    if (group === undefined) continue;
    if (!group || typeof group !== "object" || Array.isArray(group)) return false;
    for (const evidence of Object.values(group)) {
      if (evidence?.source !== SYNTHETIC_SOURCE) return false;
    }
  }
  return true;
}

function syntheticQuote(quote, identity) {
  return Boolean(quote && quote.fixtureOnly === true &&
    quote.source === SYNTHETIC_SOURCE &&
    ["chainId", "mint", "pool", "quote", "decimals"].every(key => quote[key] === identity[key]) &&
    integerTime(quote.observedAt) && Number.isSafeInteger(quote.priceMicros) && quote.priceMicros > 0 &&
    quote.mode === "HYPOTHETICAL" && quote.executable === true &&
    ["feeCents", "spreadCents", "slippageCents", "priceImpactCents", "networkCents"]
      .every(key => (typeof quote.costs?.[key] === "number" &&
        Number.isSafeInteger(quote.costs[key]) && quote.costs[key] >= 0) ||
        (typeof quote.costs?.[key] === "bigint" && quote.costs[key] >= 0n) ||
        (typeof quote.costs?.[key] === "string" && /^\d{1,40}$/.test(quote.costs[key]))));
}

export function createPaperExecutionRunner({
  externalReadOnlyInput,
  externalInputByteLimit = MAX_LIMITS.maxInputBytes,
  executionStep,
  session,
  runId,
  startedAt,
  endAt,
  executionMode,
  provenance,
  candidateSource,
  quoteSource,
  clock,
  stopSource,
  smartWalletAllowlist,
  limits
} = {}) {
  if (externalReadOnlyInput !== undefined) {
    const input = externalReadOnlyInputs.get(externalReadOnlyInput);
    if (!input || !Number.isSafeInteger(externalInputByteLimit) ||
        externalInputByteLimit < 1 || externalInputByteLimit > MAX_LIMITS.maxInputBytes) {
      throw new TypeError("a bounded external read-only input and byte limit are required");
    }
    if (input.bytes > externalInputByteLimit) {
      throw new RangeError("external read-only input exceeds the configured byte budget");
    }
    let externalRunPromise;
    return Object.freeze({
      run() {
        if (!externalRunPromise) {
          externalRunPromise = Promise.resolve({
            status: "UNKNOWN",
            reason: "external source contracts are not accepted for simulated entry",
            executionMode: "READ_ONLY_EXTERNAL",
            provenance: "UNVERIFIED_CALLER_INPUT",
            realDataSourceCoverage: "NOT_ASSESSED",
            externalInputDigest: input.digest,
            producerRevision: externalReadOnlyInput.producerRevision,
            sourceContracts: {...externalReadOnlyInput.sourceContracts},
            timingClaims: {...externalReadOnlyInput.timing},
            executionStarted: false,
            terminalReceipt: null,
            checkpoint: null,
            unresolved: [
              "candidate-intake contract is not accepted",
              "market-evidence contract is not accepted",
              "quote and complete-cost contract is not accepted",
              "trusted source-time and receipt-time attestation is not accepted"
            ]
          });
        }
        return externalRunPromise;
      }
    });
  }
  const bounds = boundedLimits(limits);
  if (typeof runId !== "string" || !/^[A-Za-z0-9._:-]{1,120}$/.test(runId) ||
      !integerTime(startedAt) || !integerTime(endAt) || endAt <= startedAt ||
      endAt > startedAt + EIGHT_HOURS_MS ||
      executionMode !== "SIMULATED_ONLY" || provenance !== SYNTHETIC_SOURCE ||
      !executionStep || !session || typeof session.snapshot !== "function" ||
      !["authorizeEntry", "executeEntry", "observeExitQuote", "riskSnapshot", "finishRun"]
        .every(method => typeof executionStep[method] === "function") ||
      !candidateSource || typeof candidateSource.poll !== "function" ||
      typeof quoteSource !== "function" || typeof clock !== "function" ||
      typeof stopSource !== "function" ||
      smartWalletAllowlist?.status !== "VERIFIED" ||
      smartWalletAllowlist?.provenance !== SYNTHETIC_SOURCE) {
    throw new TypeError("explicit synthetic PAPER mode, bounded run, and injected sources are required");
  }
  const metadata = session.metadata;
  if (metadata?.runId !== runId || metadata.startedAt !== startedAt ||
      metadata.sequence !== 0 || metadata.deadlineAt !== startedAt + EIGHT_HOURS_MS) {
    throw new TypeError("runner requires the exact fresh checkpoint session");
  }

  let runPromise;
  let state = "RUNNING";
  let sequence = 0;
  let logicalId = 0;
  let latestTime = startedAt;
  let tickCount = 0;
  let candidateCount = 0;
  let quoteCount = 0;
  let operationCount = 0;
  let inputBytes = 0;
  let sourceDone = false;
  let candidateBudgetReached = false;
  const receipts = [];
  const results = [];
  let verifiedTerminalReceipt = null;
  const candidatesByMint = new Map();
  const pendingAuthorizationIds = new Set();
  let ledgerUnknownReason = null;
  let missingTerminalValuationMints = [];

  function nextId(purpose) {
    logicalId += 1;
    return operationId(runId, startedAt, logicalId, purpose);
  }

  function readTime() {
    const now = clock();
    if (!integerTime(now) || now < latestTime) throw new Error("clock is invalid or moved backwards");
    latestTime = now;
    return now;
  }

  function unknown(reason) {
    state = "UNKNOWN";
    return report("UNKNOWN", reason);
  }

  function report(status, reason = null, terminalResult = null) {
    let summary = null;
    if (state !== "UNKNOWN") {
      try {
        summary = session.snapshot().summary;
      } catch {
        state = "UNKNOWN";
        return report("UNKNOWN", "checkpoint/session readback became unavailable");
      }
    }
    return {
      status,
      reason,
      runId,
      executionMode,
      provenance,
      realDataSourceCoverage: "NOT_ASSESSED",
      counters: {ticks: tickCount, candidates: candidateCount, quotes: quoteCount, operations: operationCount},
      inputBytes,
      candidateBudgetReached,
      receipts: receipts.map(item => ({...item})),
      operationResults: results.map(item => ({...item})),
      missingTerminalValuationMints: [...missingTerminalValuationMints],
      pendingAuthorizationIds: [...pendingAuthorizationIds],
      terminalResult,
      terminalReceipt: verifiedTerminalReceipt ? {...verifiedTerminalReceipt} : null,
      summary
    };
  }

  async function invoke(method, input) {
    if (state !== "RUNNING") return {stop: true};
    if (method !== "finishRun" && operationCount + 1 >= bounds.maxOperations) {
      return {budget: true};
    }
    operationCount += 1;
    let result;
    try {
      result = await executionStep[method](input);
    } catch {
      return {unknown: true};
    }
    if (result?.status === "UNKNOWN" && result.receipt === undefined) return {unknown: true};
    if (result?.receipt !== undefined) {
      const receipt = result.receipt;
      if (receipt?.runId !== runId || receipt.sequence !== sequence + 1 ||
          !HASH.test(receipt.hash ?? "") || !HASH.test(receipt.resultDigest ?? "")) {
        return {unknown: true};
      }
      sequence = receipt.sequence;
      receipts.push({...receipt});
    } else if (!(method === "authorizeEntry" && result?.status === "BLOCKED")) {
      return {unacknowledged: true, result};
    }
    results.push({method, status: result?.status ?? "INVALID_RESULT",
      receipt: result?.receipt ? {...result.receipt} : null});
    if (method === "authorizeEntry" && result?.status === "AUTHORIZED") {
      pendingAuthorizationIds.add(result.authorizationId);
    }
    if (method === "executeEntry" && result?.status === "FILLED_PAPER") {
      pendingAuthorizationIds.delete(input.authorizationId);
    }
    if (result.receipt) {
      try {
        for (const event of session.snapshot().auditEvents) {
          if (event.type === "RISK_RESERVATION_RELEASED") {
            pendingAuthorizationIds.delete(event.authorizationId);
          }
        }
      } catch {
        return {unknown: true};
      }
    }
    if (result?.status === "UNKNOWN") {
      return result.receipt ? {ledgerUnknown: true, result} : {unknown: true};
    }
    return {result};
  }

  async function quoteFor(request) {
    if (quoteCount >= bounds.maxQuotes) return null;
    quoteCount += 1;
    let response;
    try {
      response = await quoteSource(request);
    } catch {
      return null;
    }
    if (response === null || response === undefined) return null;
    try {
      const detached = detachInput(response, bounds.maxInputBytes - inputBytes);
      if (inputBytes + detached.bytes > bounds.maxInputBytes) return null;
      inputBytes += detached.bytes;
      return detached.value;
    } catch {
      return null;
    }
  }

  async function checkStop(tick) {
    let now;
    try {
      now = readTime();
    } catch {
      return {shutdown: true};
    }
    if (now >= endAt) return {deadline: true, now};
    let shutdown = false;
    try {
      shutdown = await stopSource({now, tick}) === true;
    } catch {
      shutdown = true;
    }
    try {
      now = readTime();
    } catch {
      return {shutdown: true};
    }
    return now >= endAt ? {deadline: true, now} : {shutdown};
  }

  async function riskPass(tick) {
    const now = readTime();
    if (now >= endAt) return {deadline: true, marks: []};
    let before;
    try {
      before = session.snapshot().summary;
    } catch {
      return {unknown: true};
    }
    const marked = [];
    for (const position of before.openPositions) {
      const candidate = candidatesByMint.get(position.mint);
      if (!candidate) continue;
      const observedAt = readTime();
      if (observedAt >= endAt) return {deadline: true, marks: []};
      const quote = await quoteFor({purpose: "EXIT", candidate, position, now: observedAt, tick});
      const responseTime = readTime();
      if (responseTime >= endAt) return {deadline: true, marks: []};
      if (!syntheticQuote(quote, candidate) || quote.observedAt > responseTime) continue;
      const eventId = nextId("exit");
      const observedNow = readTime();
      if (observedNow >= endAt) return {deadline: true, marks: []};
      const outcome = await invoke("observeExitQuote", {
        eventId,
        quote: {...quote, eventId},
        now: observedNow
      });
      if (outcome.unknown) return {unknown: true};
      if (outcome.ledgerUnknown) return {ledgerUnknown: true, marks: marked};
      if (outcome.budget || outcome.unacknowledged || outcome.stop) return {stop: true};
      if (outcome.result?.status === "MARKED") {
        marked.push({...quote, eventId: nextId("mark")});
      }
    }
    if (state !== "RUNNING") return {stop: true};
    let marks = [];
    if (marked.length) {
      let openMints;
      try {
        openMints = new Set(session.snapshot().summary.openPositions.map(position => position.mint));
      } catch {
        return {unknown: true};
      }
      marks = marked.filter(mark => openMints.has(mark.mint));
    }
    const nowForRisk = readTime();
    if (nowForRisk >= endAt) return {deadline: true, marks: []};
    let risk = await invoke("riskSnapshot", {
      eventId: nextId("risk"),
      now: nowForRisk,
      marks
    });
    if (risk.unknown) return {unknown: true};
    if (risk.budget || risk.unacknowledged || risk.stop) return {stop: true, marks: []};
    let openMints;
    try {
      openMints = new Set(session.snapshot().summary.openPositions.map(position => position.mint));
    } catch {
      return {unknown: true};
    }
    marks = marks.filter(mark => openMints.has(mark.mint));
    if (risk.ledgerUnknown) return {ledgerUnknown: true, marks};
    if (risk.result?.status === "REJECT") return {stop: true, marks: []};
    if (risk.result?.status === "DAILY_LOSS_LIMIT") {
      let openPositions;
      try {
        openPositions = session.snapshot().summary.openPositions;
      } catch {
        return {unknown: true};
      }
      if (openPositions.length) {
        const priorMarks = new Map(marks.map(mark => [mark.mint, mark]));
        const refreshedMarks = [];
        for (const position of openPositions) {
          const candidate = candidatesByMint.get(position.mint);
          if (!candidate) continue;
          const observedAt = readTime();
          if (observedAt >= endAt) return {deadline: true, marks: []};
          const quote = await quoteFor({purpose: "RISK_EXIT", candidate, position, now: observedAt, tick});
          const responseTime = readTime();
          if (responseTime >= endAt) return {deadline: true, marks: []};
          const priorMark = priorMarks.get(position.mint);
          if (!syntheticQuote(quote, candidate) || quote.observedAt > responseTime ||
              (priorMark && quote.observedAt <= priorMark.observedAt)) continue;
          refreshedMarks.push({...quote, eventId: nextId("risk-exit-mark")});
        }
        if (refreshedMarks.length !== openPositions.length) {
          return {stop: true, reason: "DAILY_LOSS_LIMIT", marks: []};
        }
        const refreshedAt = readTime();
        if (refreshedAt >= endAt) return {deadline: true, marks: []};
        risk = await invoke("riskSnapshot", {
          eventId: nextId("risk-exit"),
          now: refreshedAt,
          marks: refreshedMarks
        });
        if (risk.unknown) return {unknown: true};
        if (risk.ledgerUnknown) return {ledgerUnknown: true, marks: []};
        if (risk.budget || risk.unacknowledged || risk.stop) return {stop: true, marks: []};
        try {
          openMints = new Set(session.snapshot().summary.openPositions.map(position => position.mint));
        } catch {
          return {unknown: true};
        }
        marks = refreshedMarks.filter(mark => openMints.has(mark.mint));
      }
      return {stop: true, reason: "DAILY_LOSS_LIMIT", marks};
    }
    return {marks, result: risk.result};
  }

  async function processCandidate(candidate, tick, marks) {
    if (!syntheticCandidateEvidence(candidate)) {
      results.push({method: "candidate", status: "BLOCKED", reason: "synthetic fixture provenance required"});
      return {blocked: true};
    }
    const beforeAuthorization = await checkStop(tick);
    if (beforeAuthorization.deadline) return {deadline: true};
    if (beforeAuthorization.shutdown) return {shutdown: true};
    const authorizeNow = readTime();
    if (authorizeNow >= endAt) return {deadline: true};
    const authEventId = nextId("authorize");
    const authorization = await invoke("authorizeEntry", {
      eventId: authEventId,
      tickId: nextId("tick"),
      candidate,
      smartWalletAllowlist,
      now: authorizeNow,
      marks
    });
    if (authorization.unknown) return {unknown: true};
    if (authorization.ledgerUnknown) return {ledgerUnknown: true};
    if (authorization.budget || authorization.unacknowledged || authorization.stop) return {stop: true};
    const authResult = authorization.result;
    if (authResult?.status !== "AUTHORIZED" ||
        authResult.executionMode !== "SIMULATED_ONLY" || authResult.executionRealistic !== false) {
      return {blocked: authResult?.status === "BLOCKED" || authResult?.status === "REJECT"};
    }
    const afterAuthorization = await checkStop(tick);
    if (afterAuthorization.deadline) return {deadline: true};
    if (afterAuthorization.shutdown) return {shutdown: true};
    const quoteTime = readTime();
    if (quoteTime >= endAt) return {deadline: true};
    const quote = await quoteFor({purpose: "ENTRY", candidate, now: quoteTime, tick});
    const afterQuote = await checkStop(tick);
    if (afterQuote.deadline) return {deadline: true};
    if (afterQuote.shutdown) return {shutdown: true};
    const responseTime = readTime();
    if (responseTime >= endAt) return {deadline: true};
    const authorizedAt = Date.parse(authResult.authorizedAt);
    if (!syntheticQuote(quote, candidate) || quote.observedAt <= candidate.sampledAt ||
        !integerTime(authorizedAt) || quote.observedAt <= authorizedAt || quote.observedAt > responseTime) {
      results.push({method: "entryQuote", status: "BLOCKED", reason: "later complete synthetic quote required"});
      return {blocked: true};
    }
    const beforeExecution = await checkStop(tick);
    if (beforeExecution.deadline) return {deadline: true};
    if (beforeExecution.shutdown) return {shutdown: true};
    const executeNow = readTime();
    if (executeNow >= endAt) return {deadline: true};
    const eventId = nextId("entry");
    const execution = await invoke("executeEntry", {
      eventId,
      authorizationId: authResult.authorizationId,
      quote: {...quote, eventId},
      now: executeNow,
      marks
    });
    if (execution.unknown) return {unknown: true};
    if (execution.ledgerUnknown) return {ledgerUnknown: true};
    if (execution.budget || execution.unacknowledged || execution.stop) return {stop: true};
    if (execution.result?.status === "FILLED_PAPER") candidatesByMint.set(candidate.mint, candidate);
    return {result: execution.result};
  }

  async function finish(reason, now = null) {
    if (state === "UNKNOWN") return report("UNKNOWN", reason);
    let finishAt;
    try {
      finishAt = readTime();
      if (now !== null && finishAt < now) {
        return report("STOPPED", "terminal clock regressed; no finish command issued");
      }
    } catch {
      return report("STOPPED", "clock unavailable; no finish command issued");
    }
    if (operationCount >= bounds.maxOperations) {
      return report("STOPPED", "operation capacity reached; no finish command issued");
    }
    state = "FINISHING";
    let openPositions;
    let result;
    try {
      openPositions = session.snapshot().summary.openPositions;
      missingTerminalValuationMints = openPositions.map(position => position.mint);
      operationCount += 1;
      result = await executionStep.finishRun({
        eventId: nextId("finish"),
        now: finishAt,
        marks: []
      });
    } catch {
      state = "UNKNOWN";
      return report("UNKNOWN", "finish publication outcome is uncertain");
    }
    const receipt = result?.receipt;
    if (result?.status === "REJECT" && !receipt) {
      results.push({method: "finishRun", status: result.status, receipt: null});
      return report("STOPPED", "finish was rejected before dispatch", result);
    }
    let checkpointHead;
    try {
      checkpointHead = session.metadata;
    } catch {
      state = "UNKNOWN";
      return report("UNKNOWN", "finish acknowledgement could not be matched to durable checkpoint");
    }
    if (!receipt || receipt.runId !== runId || receipt.sequence !== sequence + 1 ||
        !HASH.test(receipt.hash ?? "") || !HASH.test(receipt.resultDigest ?? "") ||
        (Object.hasOwn(checkpointHead ?? {}, "hash") &&
          (checkpointHead.sequence !== receipt.sequence || checkpointHead.hash !== receipt.hash))) {
      state = "UNKNOWN";
      return report("UNKNOWN", "finish acknowledgement is unverifiable; publication outcome is uncertain");
    }
    sequence = receipt.sequence;
    receipts.push({...receipt});
    verifiedTerminalReceipt = {...receipt};
    results.push({method: "finishRun", status: result?.status ?? "INVALID_RESULT",
      receipt: {...receipt}});
    state = "FINISHED";
    if (result.status === "UNKNOWN") ledgerUnknownReason = "terminal ledger result is UNKNOWN with a verified receipt";
    return report(ledgerUnknownReason ? "UNKNOWN" : result.status === "FINISHED" ? "FINISHED" : "STOPPED",
      ledgerUnknownReason ?? reason, result);
  }

  async function runOnce() {
    try {
      for (let tick = 0; tick < bounds.maxTicks; tick += 1) {
        if (state === "UNKNOWN") return report("UNKNOWN", "checkpoint outcome uncertain; automatic retry/restart is prohibited");
        tickCount += 1;
        const now = readTime();
        let stopRequested = false;
        try {
          stopRequested = await stopSource({now, tick: tickCount - 1}) === true;
        } catch {
          stopRequested = true;
        }
        if (now >= endAt) return finish("DEADLINE", now);
        const risk = await riskPass(tickCount - 1);
        if (risk.unknown) return unknown("checkpoint or session state is uncertain");
        if (risk.ledgerUnknown) {
          ledgerUnknownReason = "ledger risk/exit result is UNKNOWN with a verified receipt";
          return finish("LEDGER_UNKNOWN");
        }
        if (risk.stop) return finish(risk.reason ?? "RISK_OPERATION_UNAVAILABLE");
        if (risk.deadline) return finish("DEADLINE");
        const afterRiskStop = await checkStop(tickCount - 1);
        if (afterRiskStop.deadline) return finish("DEADLINE", afterRiskStop.now);
        if (stopRequested || afterRiskStop.shutdown) return finish("SHUTDOWN");

        let snapshot;
        try {
          snapshot = session.snapshot().summary;
        } catch {
          return unknown("checkpoint/session readback became unavailable");
        }
        if (!sourceDone && candidateCount < bounds.maxCandidates) {
          const pollNow = readTime();
          if (pollNow >= endAt) return finish("DEADLINE", pollNow);
          let response;
          try {
            response = await candidateSource.poll({now: pollNow, tick: tickCount - 1});
          } catch {
            return finish("CANDIDATE_SOURCE_UNAVAILABLE");
          }
          const afterPollStop = await checkStop(tickCount - 1);
          if (afterPollStop.deadline) return finish("DEADLINE", afterPollStop.now);
          if (afterPollStop.shutdown) return finish("SHUTDOWN");
          let item;
          try {
            if (response === null || response === undefined) item = response;
            else {
              const detached = detachInput(response, bounds.maxInputBytes - inputBytes);
              if (inputBytes + detached.bytes > bounds.maxInputBytes) {
                return finish("INPUT_BUDGET");
              }
              inputBytes += detached.bytes;
              item = detached.value;
            }
          } catch (error) {
            if (error instanceof InputBudgetError) return finish("INPUT_BUDGET");
            return finish("INVALID_CANDIDATE_SOURCE_ITEM");
          }
          if (item?.done === true) {
            sourceDone = true;
          } else if (item?.candidate !== undefined) {
            candidateCount += 1;
            const processed = await processCandidate(item.candidate, tickCount - 1, risk.marks);
            if (processed.unknown) return unknown("checkpoint outcome uncertain; automatic retry/restart is prohibited");
            if (processed.ledgerUnknown) {
              ledgerUnknownReason = "ledger entry result is UNKNOWN with a verified receipt";
              return finish("LEDGER_UNKNOWN");
            }
            if (processed.stop) return finish("EXECUTION_OPERATION_UNAVAILABLE");
            if (processed.shutdown) return finish("SHUTDOWN");
            if (processed.deadline) return finish("DEADLINE");
          } else if (item !== null && item !== undefined) {
            return finish("INVALID_CANDIDATE_SOURCE_ITEM");
          }
        } else if (!sourceDone && candidateCount >= bounds.maxCandidates) {
          candidateBudgetReached = true;
        }

        try {
          snapshot = session.snapshot().summary;
        } catch {
          return unknown("checkpoint/session readback became unavailable");
        }
        if ((sourceDone || candidateBudgetReached) && snapshot.openPositions.length === 0 &&
            pendingAuthorizationIds.size === 0) {
          return finish(sourceDone ? "SOURCES_EXHAUSTED" : "INPUT_BUDGET", readTime());
        }
      }
      return finish("TICK_BUDGET");
    } catch {
      return state === "UNKNOWN"
        ? report("UNKNOWN", "checkpoint outcome uncertain; automatic retry/restart is prohibited")
        : report("STOPPED", "clock or runner input became unavailable; no further work was dispatched");
    }
  }

  return Object.freeze({
    run() {
      if (!runPromise) runPromise = runOnce();
      return runPromise;
    }
  });
}

export async function runOfflineDemo() {
  const {createPaperExecutionStep} = await import("./execution-step.mjs");
  const startedAt = Date.parse("2026-11-02T12:00:00.000Z");
  const endAt = startedAt + EIGHT_HOURS_MS;
  const runId = "synthetic-paper-runner-demo";
  const directory = await mkdtemp(path.join(os.tmpdir(), "meridian-paper-runner-"));
  const store = await CheckpointStore.open(directory);
  let session;
  try {
    session = await PaperCheckpointSession.open({store, runId, startedAt});
    let clockTime = startedAt;
    const clock = () => (clockTime += 1_000);
    const candidate = syntheticCandidate(startedAt);
    let candidateSent = false;
    const runner = createPaperExecutionRunner({
      executionStep: createPaperExecutionStep({session, store, runId, startedAt, endAt}),
      session,
      runId,
      startedAt,
      endAt,
      executionMode: "SIMULATED_ONLY",
      provenance: SYNTHETIC_SOURCE,
      candidateSource: {
        poll: async () => {
          if (candidateSent) return {done: true};
          candidateSent = true;
          return {candidate};
        }
      },
      quoteSource: async ({purpose, candidate: selected, now}) => ({
        eventId: "source-event",
        source: SYNTHETIC_SOURCE,
        fixtureOnly: true,
        chainId: selected.chainId,
        mint: selected.mint,
        pool: selected.pool,
        quote: selected.quote,
        decimals: selected.decimals,
        observedAt: now,
        priceMicros: purpose === "ENTRY" ? 10_000 : 9_000,
        mode: "HYPOTHETICAL",
        executable: true,
        costs: {feeCents: 2, spreadCents: 1, slippageCents: 1, priceImpactCents: 1, networkCents: 2}
      }),
      clock,
      stopSource: () => false,
      smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST,
      limits: {maxTicks: 8, maxCandidates: 2, maxQuotes: 8, maxOperations: 32}
    });
    const report = await runner.run();
    const readback = await store.readCheckpoint();
    if (readback.status !== "OK" || !Buffer.isBuffer(readback.bytes)) {
      throw new Error("offline demo checkpoint readback is unavailable");
    }
    let checkpoint;
    try {
      checkpoint = JSON.parse(readback.bytes.toString("utf8"));
    } catch {
      throw new Error("offline demo checkpoint readback is invalid");
    }
    const canonicalBytes = canonicalCheckpointBytes(checkpoint);
    const finalRecord = checkpoint.records?.at(-1);
    const receipt = report.terminalReceipt;
    const resultReceipt = report.terminalResult?.receipt;
    const readbackHash = createHash("sha256").update(readback.bytes).digest("hex");
    if (!canonicalBytes.equals(readback.bytes) || readbackHash !== readback.hash ||
        !receipt || !resultReceipt || receipt.runId !== runId ||
        resultReceipt.runId !== runId || receipt.sequence !== readback.sequence ||
        receipt.sequence !== checkpoint.sequence || receipt.hash !== readback.hash ||
        resultReceipt.hash !== readback.hash || receipt.resultDigest !== resultReceipt.resultDigest ||
        finalRecord?.method !== "finishRun" || finalRecord.sequence !== receipt.sequence ||
        finalRecord.commandId !== report.terminalResult.commandId ||
        finalRecord.resultDigest !== receipt.resultDigest) {
      throw new Error("offline demo terminal result does not match durable checkpoint readback");
    }
    return {
      ...report,
      checkpointDirectory: directory,
      durableReadback: {
        status: readback.status,
        sequence: readback.sequence,
        hash: readback.hash,
        method: finalRecord.method,
        commandId: finalRecord.commandId,
        resultDigest: finalRecord.resultDigest
      }
    };
  } finally {
    await session?.close();
    if (!session) await store.close().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== "--offline-demo") {
    process.stderr.write("Usage: node scripts/memecoin-paper/execution-runner.mjs --offline-demo\n");
    process.exitCode = 2;
  } else {
    try {
      const result = await runOfflineDemo();
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.status !== "FINISHED") process.exitCode = 1;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
