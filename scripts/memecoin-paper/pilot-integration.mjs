export const SYNTHETIC_TEST_ONLY = "SYNTHETIC_TEST_ONLY";

const DISABLED = Object.freeze({
  status: "DISABLED",
  mode: "DISABLED",
  executionStarted: false,
  reason: "SYNTHETIC_TEST_ONLY mode was not explicitly selected"
});
const REPORT_TYPES = new Set(["SYNTHETIC_CHECKPOINT_ORCHESTRATION_ONLY"]);
const RECEIPT_METHODS = new Set([
  "authorizeEntry", "executeEntry", "observeExitQuote", "riskSnapshot", "finishRun"
]);
const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const DEFAULT_SETTLEMENT_MS = 60_000;
const MAX_POLL_BUDGET = Object.freeze({
  maxRequestsPerRun: 960,
  maxRequestsPerProvider: 480,
  maxBytesPerResponse: 1_048_576,
  maxBytesPerRun: 10_485_760,
  maxEvents: 10_000,
  maxCandidates: 300,
  intervalMs: 30_000
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function identityKey(value) {
  return JSON.stringify([value?.chainId, value?.mint, value?.pool, value?.quote]);
}

function validIdentity(value) {
  return isRecord(value) &&
    ["chainId", "mint", "pool", "quote"].every(key =>
      typeof value[key] === "string" && value[key].length > 0);
}

function validReceipt(receipt, runId) {
  return isRecord(receipt) && receipt.runId === runId &&
    Number.isSafeInteger(receipt.sequence) && receipt.sequence >= 0 &&
    typeof receipt.commandId === "string" && SAFE_ID.test(receipt.commandId) &&
    RECEIPT_METHODS.has(receipt.method) &&
    typeof receipt.resultDigest === "string" && HASH.test(receipt.resultDigest);
}

function validateDisabledManifest(manifest) {
  if (!isRecord(manifest) || manifest.enabled !== false ||
      manifest.stopSwitch?.engaged !== true ||
      !Array.isArray(manifest.providers) ||
      manifest.providers.some(provider => provider?.enabled !== false) ||
      !Array.isArray(manifest.allowedMints) || manifest.allowedMints.length !== 0 ||
      !Array.isArray(manifest.allowedPools) || manifest.allowedPools.length !== 0 ||
      !isRecord(manifest.pollBudget)) {
    throw new TypeError("an unchanged disabled manifest with empty allowlists is required");
  }
  const budget = manifest.pollBudget;
  for (const key of [
    "maxRequestsPerRun", "maxRequestsPerProvider", "maxBytesPerResponse",
    "maxBytesPerRun", "maxEvents", "maxCandidates", "intervalMs"
  ]) {
    if (!Number.isSafeInteger(budget[key]) || budget[key] < 1) {
      throw new TypeError(`manifest pollBudget.${key} must be a positive safe integer`);
    }
  }
  if (budget.maxRequestsPerProvider > budget.maxRequestsPerRun ||
      budget.maxBytesPerResponse > budget.maxBytesPerRun ||
      Object.entries(MAX_POLL_BUDGET).some(([key, maximum]) => budget[key] > maximum)) {
    throw new TypeError("manifest provider budgets are inconsistent");
  }
  return {
    ...manifest,
    stopSwitch: {...manifest.stopSwitch},
    providers: manifest.providers.map(provider => ({...provider})),
    allowedMints: [...manifest.allowedMints],
    allowedPools: [...manifest.allowedPools],
    pollBudget: {...budget}
  };
}

function disabledControl() {
  return Object.freeze({
    start: () => Promise.resolve(DISABLED),
    stop: () => false,
    snapshot: () => DISABLED
  });
}

function validateReceiptInput(input, metadata, runId, startedAt, holdUntil, receipt) {
  if (!isRecord(input) || !REPORT_TYPES.has(input.reportType) ||
      !isRecord(input.metadata) || input.metadata.runId !== runId ||
      input.metadata.startedAt !== startedAt || input.metadata.deadlineAt !== holdUntil ||
      input.metadata.sequence !== metadata.sequence || input.metadata.hash !== metadata.hash ||
      !Array.isArray(input.results) || input.results.length !== metadata.sequence ||
      !isRecord(input.snapshot) || !isRecord(input.snapshot.summary) ||
      input.snapshot.summary.runId !== runId) return false;
  const last = input.results.at(-1);
  return Boolean(last && last.commandId === receipt.commandId &&
    last.method === receipt.method && last.resultDigest === receipt.resultDigest);
}

function validateEmptyReportInput(input, metadata, runId, startedAt, holdUntil) {
  return isRecord(input) &&
    input.reportType === "SYNTHETIC_CHECKPOINT_ORCHESTRATION_ONLY" &&
    input.liveCandidateEvidence === false &&
    isRecord(input.metadata) && input.metadata.runId === runId &&
    input.metadata.startedAt === startedAt && input.metadata.deadlineAt === holdUntil &&
    input.metadata.sequence === 0 && metadata.sequence === 0 &&
    input.metadata.hash === metadata.hash && Array.isArray(input.results) &&
    input.results.length === 0 && isRecord(input.snapshot) &&
    isRecord(input.snapshot.summary) && input.snapshot.summary.runId === runId &&
    Array.isArray(input.snapshot.auditEvents);
}

function readBackMatches(readback, metadata, expectedRunId, latestReceipt) {
  if (!isRecord(readback) || readback.status !== "OK" ||
      readback.hash !== metadata.hash || readback.sequence !== metadata.sequence ||
      !(readback.bytes instanceof Uint8Array)) return false;
  let checkpoint;
  try {
    checkpoint = JSON.parse(Buffer.from(readback.bytes).toString("utf8"));
  } catch {
    return false;
  }
  if (!isRecord(checkpoint) || checkpoint.sequence !== metadata.sequence ||
      !Array.isArray(checkpoint.records) ||
      checkpoint.records.length !== metadata.sequence + 1 ||
      checkpoint.runHeader?.runId !== expectedRunId) return false;
  const lastRecord = checkpoint.records.at(-1);
  if (lastRecord?.runId !== expectedRunId ||
      lastRecord.sequence !== metadata.sequence) return false;
  if (!latestReceipt) return true;
  return latestReceipt.runId === expectedRunId &&
    latestReceipt.sequence === metadata.sequence &&
    lastRecord.commandId === latestReceipt.commandId &&
    lastRecord.method === latestReceipt.method &&
    lastRecord.resultDigest === latestReceipt.resultDigest;
}

function validateProviderResult(result, remaining) {
  const counters = result?.counters;
  const providerCounts = counters?.byProvider;
  if (!isRecord(result) || result.networkAccessed !== false ||
      !["DISABLED", "PARTIAL", "ACQUISITION_FINISHED"].includes(result.status) ||
      !Array.isArray(result.events) ||
      !Array.isArray(result.candidates) || !isRecord(counters) ||
      !safeCount(counters.requests) || !safeCount(counters.bytes) ||
      !safeCount(counters.events) || !safeCount(counters.reservedBytes) ||
      counters.reservedBytes !== 0 ||
      !isRecord(providerCounts) || !safeCount(providerCounts.dex) ||
      !safeCount(providerCounts.rpc) ||
      providerCounts.dex + providerCounts.rpc !== counters.requests ||
      counters.events !== result.events.length ||
      counters.requests > remaining.requests || counters.bytes > remaining.bytes ||
      counters.events > remaining.events ||
      result.candidates.length > remaining.candidates ||
      (result.status === "DISABLED" &&
        (counters.requests !== 0 || counters.bytes !== 0 || counters.events !== 0 ||
         result.events.length !== 0 || result.candidates.length !== 0))) {
    const error = new Error("provider result has missing, inconsistent, or over-budget accounting");
    error.code = "PROVIDER_ACCOUNTING_UNKNOWN";
    throw error;
  }
  return counters;
}

function validateOptions(options) {
  if (!isRecord(options)) throw new TypeError("options must be a plain object");
  if (options.mode !== SYNTHETIC_TEST_ONLY) {
    throw new TypeError("only explicit SYNTHETIC_TEST_ONLY mode is supported");
  }
  const allowed = new Set([
    "mode", "createPilotRunControl", "acquireProviderEvidence", "providerOptions",
    "filterCandidate", "step", "checkpointStore", "checkpointSession",
    "projectOperatorReport", "runId", "startedAt", "holdUntil",
    "clock", "scheduler", "signal", "budgets"
  ]);
  if (Reflect.ownKeys(options).some(key => typeof key !== "string" || !allowed.has(key))) {
    throw new TypeError("unknown pilot integration option");
  }
  for (const key of [
    "createPilotRunControl", "acquireProviderEvidence", "filterCandidate", "step",
    "projectOperatorReport", "clock"
  ]) {
    if (typeof options[key] !== "function") throw new TypeError(`${key} must be injected`);
  }
  if (!isRecord(options.providerOptions) ||
      options.providerOptions.enabled !== false ||
      typeof options.providerOptions.transport !== "function" ||
      typeof options.providerOptions.clock !== "function" ||
      !Array.isArray(options.providerOptions.candidates)) {
    throw new TypeError("a disabled provider configuration and injected transport are required");
  }
  if (options.providerOptions.candidates.length > 10_000 ||
      options.providerOptions.candidates.some(candidate => !validIdentity(candidate)) ||
      new Set(options.providerOptions.candidates.map(identityKey)).size !==
        options.providerOptions.candidates.length) {
    throw new TypeError("provider requests require unique, fully bound identities");
  }
  if (!isObject(options.checkpointStore) ||
      typeof options.checkpointStore.readCheckpoint !== "function" ||
      !isObject(options.checkpointSession) ||
      typeof options.checkpointSession.snapshot !== "function" ||
      !isRecord(options.checkpointSession.metadata)) {
    throw new TypeError("the existing checkpoint store and session interfaces are required");
  }
  if (!isRecord(options.scheduler) ||
      typeof options.scheduler.setTimeout !== "function" ||
      typeof options.scheduler.clearTimeout !== "function") {
    throw new TypeError("an injected bounded scheduler is required");
  }
  const runId = options.runId;
  if (typeof runId !== "string" || !SAFE_ID.test(runId) ||
      !Number.isSafeInteger(options.startedAt) ||
      !Number.isSafeInteger(options.holdUntil) ||
      options.holdUntil !== options.startedAt + EIGHT_HOURS_MS) {
    throw new TypeError("a fixed run identity and exact eight-hour hold window are required");
  }
  if (options.checkpointSession.metadata.runId !== runId ||
      options.checkpointSession.metadata.startedAt !== options.startedAt) {
    throw new TypeError("checkpoint session identity does not match the requested run");
  }
  if (!isRecord(options.budgets)) throw new TypeError("explicit control budgets are required");
  const manifest = validateDisabledManifest(options.providerOptions.manifest);
  if (manifest.durationMs !== EIGHT_HOURS_MS ||
      manifest.pollBudget.intervalMs < 1 || manifest.pollBudget.intervalMs > 60_000) {
    throw new TypeError("manifest duration or polling interval is outside the Paper policy");
  }
  const limits = manifest.pollBudget;
  const budgets = {
    requests: options.budgets.requests,
    events: options.budgets.events,
    cycles: options.budgets.cycles,
    durationMs: options.budgets.durationMs,
    pollIntervalMs: options.budgets.pollIntervalMs,
    callbackSettlementMs: options.budgets.callbackSettlementMs
  };
  if (!safeCount(budgets.requests) || budgets.requests > limits.maxRequestsPerRun ||
      !safeCount(budgets.events) || budgets.events > limits.maxCandidates ||
      !safeCount(budgets.cycles) ||
      !Number.isSafeInteger(budgets.durationMs) || budgets.durationMs < 1 ||
      budgets.durationMs > EIGHT_HOURS_MS ||
      budgets.pollIntervalMs !== limits.intervalMs ||
      budgets.cycles > Math.ceil(EIGHT_HOURS_MS / budgets.pollIntervalMs) ||
      !Number.isSafeInteger(budgets.callbackSettlementMs) ||
      budgets.callbackSettlementMs < 1 ||
      budgets.callbackSettlementMs > DEFAULT_SETTLEMENT_MS) {
    throw new TypeError("control budgets exceed the fixed manifest or eight-hour limits");
  }
  return {manifest, limits, budgets, runId};
}

export function createPilotIntegration(options = {}) {
  if (isRecord(options) && !Object.hasOwn(options, "mode")) return disabledControl();
  const config = validateOptions(options);
  const totals = {requests: 0, bytes: 0, events: 0, candidates: 0, byProvider: {dex: 0, rpc: 0}};
  const providerAudit = [];
  let latestReceipt = null;
  let latestReportInput = null;
  let pendingReportInput = null;
  let stepReceiptMissing = false;
  let lastCheckpointAck = null;
  let operatorReport = Object.freeze({status: "BLOCKED", reason: "no acknowledged report receipt"});

  const remainingBudgets = controllerRemaining => ({
    requests: Math.min(
      controllerRemaining,
      config.limits.maxRequestsPerRun - totals.requests
    ),
    bytes: config.limits.maxBytesPerRun - totals.bytes,
    events: config.limits.maxEvents - totals.events,
    candidates: config.limits.maxCandidates - totals.candidates,
    perProvider: config.limits.maxRequestsPerProvider -
      Math.max(totals.byProvider.dex, totals.byProvider.rpc)
  });

  const callbacks = {
    async acquire({cycleIndex, remainingRequests, remainingEvents, signal}) {
      latestReportInput = null;
      pendingReportInput = null;
      const remaining = remainingBudgets(remainingRequests);
      if (remaining.requests <= 0 || remaining.bytes <= 0 ||
          remaining.events <= 0 || remaining.candidates <= 0 || remainingEvents <= 0 ||
          remaining.perProvider <= 0) {
        return {events: [], requestsUsed: 0, done: true};
      }
      const base = options.providerOptions;
      const perCallManifest = {
        ...config.manifest,
        pollBudget: {
          ...config.limits,
          maxRequestsPerRun: remaining.requests,
          maxRequestsPerProvider: Math.min(config.limits.maxRequestsPerProvider, remaining.perProvider),
          maxBytesPerRun: remaining.bytes,
          maxBytesPerResponse: Math.min(config.limits.maxBytesPerResponse, remaining.bytes),
          maxEvents: Math.min(config.limits.maxEvents, remaining.events),
          maxCandidates: Math.min(config.limits.maxCandidates, remaining.candidates, remainingEvents)
        }
      };
      const acquired = await options.acquireProviderEvidence({
        ...base,
        manifest: perCallManifest,
        enabled: false,
        signal
      });
      const counters = validateProviderResult(acquired, remaining);
      if (counters.byProvider.dex > remaining.perProvider ||
          counters.byProvider.rpc > remaining.perProvider ||
          counters.bytes + totals.bytes > config.limits.maxBytesPerRun ||
          counters.requests + totals.requests > config.limits.maxRequestsPerRun ||
          counters.events + totals.events > config.limits.maxEvents ||
          acquired.candidates.length + totals.candidates > config.limits.maxCandidates) {
        const error = new Error("cumulative provider budget exhausted or exceeded");
        error.code = "RUN_BUDGET_EXHAUSTED";
        throw error;
      }

      const requested = new Set(base.candidates.map(identityKey));
      const cycleEvents = [];
      const observed = new Set();
      for (const item of acquired.candidates) {
        const candidate = item?.candidate;
        const key = identityKey(candidate);
        if (!validIdentity(candidate) || !requested.has(key) ||
            observed.has(key) || item.identityStatus === "MISMATCH" ||
            candidate.source !== SYNTHETIC_TEST_ONLY) {
          const error = new Error("provider candidate identity does not match the synthetic request");
          error.code = "PROVIDER_IDENTITY_MISMATCH";
          throw error;
        }
        observed.add(key);
        const sampledAt = candidate.sampledAt;
        const filterResult = Number.isSafeInteger(sampledAt) &&
          sampledAt >= options.startedAt && sampledAt <= options.holdUntil
          ? await options.filterCandidate(candidate, {now: sampledAt, holdUntil: options.holdUntil})
          : {status: "UNKNOWN", accepted: false, reason: "SAMPLE_TIME_UNAVAILABLE"};
        if (!isRecord(filterResult) ||
            !["PASS", "REJECT", "UNKNOWN"].includes(filterResult.status) ||
            !validIdentity(filterResult.identity) ||
            identityKey(filterResult.identity) !== key ||
            (filterResult.status === "PASS" && filterResult.accepted !== true)) {
          const error = new Error("filter result is incomplete or inconsistent");
          error.code = "FILTER_RESULT_UNKNOWN";
          throw error;
        }
        cycleEvents.push({
          kind: "FILTERED_CANDIDATE",
          runId: config.runId,
          cycleIndex,
          identity: {chainId: candidate.chainId, mint: candidate.mint, pool: candidate.pool, quote: candidate.quote},
          candidate,
          filterResult
        });
      }
      if (cycleEvents.length > remainingEvents) {
        const error = new Error("candidate step batch exceeds remaining controller event budget");
        error.code = "EVENT_BUDGET_EXCEEDED";
        throw error;
      }
      totals.requests += counters.requests;
      totals.bytes += counters.bytes;
      totals.events += counters.events;
      totals.candidates += acquired.candidates.length;
      totals.byProvider.dex += counters.byProvider.dex;
      totals.byProvider.rpc += counters.byProvider.rpc;
      providerAudit.push(...acquired.events);
      return {
        events: cycleEvents,
        requestsUsed: counters.requests,
        done: acquired.status === "DISABLED" || acquired.status === "PARTIAL" ||
          totals.requests >= config.limits.maxRequestsPerRun ||
          totals.bytes >= config.limits.maxBytesPerRun ||
          totals.events >= config.limits.maxEvents ||
          totals.candidates >= config.limits.maxCandidates
      };
    },

    async step({cycleIndex, eventIndex, event, signal}) {
      if (!isRecord(event) || event.kind !== "FILTERED_CANDIDATE" ||
          event.runId !== config.runId || !isRecord(event.identity) ||
          identityKey(event.identity) !== identityKey(event.candidate)) {
        const error = new Error("step event is not bound to this run and candidate");
        error.code = "STEP_IDENTITY_MISMATCH";
        throw error;
      }
      if (event.filterResult.status !== "PASS" || event.filterResult.accepted !== true) {
        latestReportInput = null;
        pendingReportInput = null;
        return undefined;
      }
      const result = await options.step({cycleIndex, eventIndex, event, signal});
      if (result !== undefined && !isRecord(result)) {
        const error = new Error("step result must be plain data");
        error.code = "STEP_RESULT_INVALID";
        throw error;
      }
      latestReceipt = result?.receipt ?? null;
      pendingReportInput = result?.operatorReportInput ?? null;
      stepReceiptMissing = !latestReceipt;
      return result ? {unresolvedPositions: result.unresolvedPositions} : undefined;
    },

    async checkpoint(payload) {
      let reportInput = pendingReportInput ?? latestReportInput;
      latestReportInput = null;
      pendingReportInput = null;
      if (stepReceiptMissing || latestReceipt?.status === "UNKNOWN") {
        lastCheckpointAck = null;
        return {status: "UNKNOWN"};
      }
      let metadata;
      let readback;
      try {
        metadata = options.checkpointSession.metadata;
        readback = await options.checkpointStore.readCheckpoint();
      } catch {
        lastCheckpointAck = null;
        return {status: "UNKNOWN"};
      }
      if (!isRecord(metadata) || metadata.runId !== config.runId ||
          metadata.startedAt !== options.startedAt ||
          metadata.deadlineAt !== options.holdUntil ||
          !Number.isSafeInteger(metadata.sequence) || metadata.sequence < 0 ||
          typeof metadata.hash !== "string" || !HASH.test(metadata.hash) ||
          (latestReceipt && !validReceipt(latestReceipt, config.runId)) ||
          !readBackMatches(readback, metadata, config.runId, latestReceipt)) {
        lastCheckpointAck = null;
        return {status: "UNKNOWN"};
      }
      if (!reportInput && !latestReceipt && metadata.sequence === 0) {
        let snapshot;
        try {
          snapshot = options.checkpointSession.snapshot();
        } catch {
          lastCheckpointAck = null;
          return {status: "UNKNOWN"};
        }
        reportInput = {
          reportType: "SYNTHETIC_CHECKPOINT_ORCHESTRATION_ONLY",
          source: SYNTHETIC_TEST_ONLY,
          liveCandidateEvidence: false,
          metadata,
          results: [],
          snapshot
        };
      }
      if (reportInput && (latestReceipt
        ? !validateReceiptInput(reportInput, metadata, config.runId,
          options.startedAt, options.holdUntil, latestReceipt)
        : !validateEmptyReportInput(reportInput, metadata, config.runId,
          options.startedAt, options.holdUntil))) {
        lastCheckpointAck = null;
        return {status: "UNKNOWN"};
      }
      if (reportInput) latestReportInput = Object.freeze(reportInput);
      lastCheckpointAck = {
        status: "ACKNOWLEDGED",
        sequence: metadata.sequence,
        hash: metadata.hash,
        cycleIndex: payload.cycleIndex
      };
      return {status: "ACKNOWLEDGED", sequence: metadata.sequence, hash: metadata.hash};
    },

    async report({summary}) {
      if (!isRecord(summary) ||
          summary.checkpointAcknowledgement?.status !== "ACKNOWLEDGED" ||
          summary.checkpointAcknowledgement.sequence !== lastCheckpointAck?.sequence ||
          summary.checkpointAcknowledgement.hash !== lastCheckpointAck?.hash ||
          !lastCheckpointAck || !latestReportInput) return;
      const input = latestReportInput;
      if (input.metadata?.sequence !== lastCheckpointAck.sequence ||
          input.metadata?.hash !== lastCheckpointAck.hash ||
          input.metadata?.runId !== config.runId) return;
      const projected = await options.projectOperatorReport(input);
      operatorReport = Object.freeze({
        status: "PROJECTED",
        durableReceipt: {
          runId: config.runId,
          sequence: lastCheckpointAck.sequence,
          hash: lastCheckpointAck.hash
        },
        report: projected
      });
    }
  };

  const controller = options.createPilotRunControl({
    mode: SYNTHETIC_TEST_ONLY,
    callbacks,
    clock: options.clock,
    scheduler: options.scheduler,
    signal: options.signal,
    budgets: config.budgets
  });
  if (!isRecord(controller) || typeof controller.start !== "function" ||
      typeof controller.stop !== "function" || typeof controller.snapshot !== "function") {
    throw new TypeError("createPilotRunControl returned an invalid controller");
  }

  return Object.freeze({
    async start() {
      const summary = await controller.start();
      return {
        summary,
        operatorReport,
        providerAccounting: {
          requests: totals.requests,
          bytes: totals.bytes,
          requestEvents: totals.events,
          candidates: totals.candidates,
          byProvider: {...totals.byProvider}
        }
      };
    },
    stop: () => controller.stop(),
    snapshot: () => controller.snapshot(),
    providerAuditCount: () => providerAudit.length
  });
}
