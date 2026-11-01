export const SYNTHETIC_TEST_ONLY = "SYNTHETIC_TEST_ONLY";
export const READ_ONLY_PAPER = "READ_ONLY_PAPER";
export const PILOT_EVIDENCE_SOURCE = Object.freeze({
  [SYNTHETIC_TEST_ONLY]: "SYNTHETIC_FIXTURE_ONLY",
  [READ_ONLY_PAPER]: "READ_ONLY_PROVIDER_CALLBACK"
});

const MAX_DURATION_MS = 8 * 60 * 60 * 1000;
const MAX_CALLBACK_SETTLEMENT_MS = 60_000;
const MAX_POLL_INTERVAL_MS = 60_000;
const MAX_BUDGET = 10_000;
const HASH = /^[a-f0-9]{64}$/;
const CALLBACKS = ["acquire", "step", "checkpoint", "report"];
const DISABLED_SUMMARY = Object.freeze({
  status: "DISABLED",
  state: "CREATED",
  mode: "DISABLED",
  evidenceSource: "NONE",
  acquisitionStarted: false,
  executionStarted: false,
  externalExecutionStatus: "NOT_ASSESSED",
  runtimeAuthority: "EXTERNAL",
  reason: "No supported pilot mode was explicitly selected"
});

function isRecord(value) {
  return value !== null && typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isDenseDataArray(value) {
  if (!Array.isArray(value) || value.length > MAX_BUDGET ||
      Object.keys(value).length !== value.length ||
      Object.getOwnPropertyNames(value).length !== value.length + 1 ||
      Object.getOwnPropertySymbols(value).length > 0) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) return false;
  }
  return true;
}

function assertInteger(value, name, maximum, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > maximum) {
    throw new TypeError(`${name} must be a bounded ${allowZero ? "nonnegative" : "positive"} integer`);
  }
  return value;
}

function validateOptions(options) {
  if (!isRecord(options)) throw new TypeError("options must be a plain object");
  const allowed = new Set([
    "mode", "callbacks", "clock", "scheduler", "signal", "budgets"
  ]);
  if (Reflect.ownKeys(options).some(key => typeof key !== "string" || !allowed.has(key))) {
    throw new TypeError("unknown pilot run control option");
  }
  if (![SYNTHETIC_TEST_ONLY, READ_ONLY_PAPER].includes(options.mode)) {
    throw new TypeError("only SYNTHETIC_TEST_ONLY and READ_ONLY_PAPER modes are supported");
  }
  if (!isRecord(options.callbacks) || CALLBACKS.some(name =>
    !Object.hasOwn(options.callbacks, name) || typeof options.callbacks[name] !== "function") ||
      Reflect.ownKeys(options.callbacks).some(key => !CALLBACKS.includes(key))) {
    throw new TypeError("pilot control requires exactly the injected acquire, step, checkpoint, and report callbacks");
  }
  if (typeof options.clock !== "function") throw new TypeError("an injected monotonic clock is required");
  if (!isRecord(options.scheduler) ||
      typeof options.scheduler.setTimeout !== "function" ||
      typeof options.scheduler.clearTimeout !== "function") {
    throw new TypeError("an injected scheduler with setTimeout and clearTimeout is required");
  }
  const signal = options.signal;
  if (signal !== undefined && (!signal || typeof signal.aborted !== "boolean" ||
      typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function")) {
    throw new TypeError("signal must be an AbortSignal");
  }
  if (!isRecord(options.budgets) ||
      Reflect.ownKeys(options.budgets).some(key => ![
        "requests", "events", "cycles", "durationMs", "pollIntervalMs", "callbackSettlementMs"
      ].includes(key))) {
    throw new TypeError("explicit bounded pilot budgets are required");
  }
  const budgets = {
    requests: assertInteger(options.budgets.requests, "requests", MAX_BUDGET, true),
    events: assertInteger(options.budgets.events, "events", MAX_BUDGET, true),
    cycles: assertInteger(options.budgets.cycles, "cycles", MAX_BUDGET, true),
    durationMs: assertInteger(options.budgets.durationMs, "durationMs", MAX_DURATION_MS),
    pollIntervalMs: assertInteger(options.budgets.pollIntervalMs, "pollIntervalMs", MAX_POLL_INTERVAL_MS),
    callbackSettlementMs: assertInteger(
      options.budgets.callbackSettlementMs, "callbackSettlementMs", MAX_CALLBACK_SETTLEMENT_MS
    )
  };
  return {
    mode: options.mode,
    evidenceSource: PILOT_EVIDENCE_SOURCE[options.mode],
    callbacks: options.callbacks,
    clock: options.clock,
    scheduler: options.scheduler,
    signal,
    budgets
  };
}

function diagnosticCode(value) {
  try {
    if (typeof value?.code === "string" && /^[A-Z0-9_]{1,48}$/.test(value.code)) return value.code;
    if (typeof value?.name === "string" && /^[A-Za-z0-9_]{1,48}$/.test(value.name)) return value.name;
  } catch {
    return "CALLBACK_ERROR";
  }
  return "CALLBACK_ERROR";
}

function cloneEvidence(value, budget = {nodes: 0}, depth = 0, seen = new WeakSet()) {
  budget.nodes += 1;
  if (budget.nodes > 20_000 || depth > 16) throw new RangeError("position evidence exceeds its summary bound");
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "bigint") {
    if (typeof value === "string" && value.length > 512) throw new RangeError("position evidence text is too long");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("position evidence contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_000 || !isDenseDataArray(value)) {
      throw new RangeError("position evidence array is sparse or oversized");
    }
    if (seen.has(value)) throw new TypeError("position evidence contains a cycle");
    seen.add(value);
    const result = value.map(item => cloneEvidence(item, budget, depth + 1, seen));
    seen.delete(value);
    return result;
  }
  if (!isRecord(value) || seen.has(value) || Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("position evidence must be plain acyclic data");
  }
  const keys = Object.keys(value);
  if (keys.length > 1_000 || Object.getOwnPropertyNames(value).length !== keys.length) {
    throw new RangeError("position evidence object is oversized or has hidden fields");
  }
  seen.add(value);
  const result = {};
  for (const key of keys.sort()) {
    if (key.length > 120) throw new RangeError("position evidence key is too long");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new TypeError("position evidence contains an accessor");
    Object.defineProperty(result, key, {
      value: cloneEvidence(descriptor.value, budget, depth + 1, seen),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  seen.delete(value);
  return result;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function createPilotRunControl(options = {}) {
  if (!isRecord(options)) throw new TypeError("options must be a plain object");
  if (!Object.hasOwn(options, "mode")) {
    return Object.freeze({
      start: () => Promise.resolve(DISABLED_SUMMARY),
      stop: () => false,
      snapshot: () => DISABLED_SUMMARY
    });
  }
  const config = validateOptions(options);
  const {mode, evidenceSource} = config;
  let state = "CREATED";
  let runPromise = null;
  let stopBeforeStart = false;
  let stopReason = null;
  let failureStatus = null;
  let failureCode = null;
  let uncertain = false;
  let clockLast = null;
  let startedAt = null;
  let deadlineAt = null;
  let deadlineTimer;
  let ownsDeadlineTimer = false;
  let cycleWait = null;
  let activeCallback = null;
  let parentAbortListener = null;
  let reportEmitted = false;
  let checkpointStatus = "NOT_ATTEMPTED";
  let checkpointSequence = null;
  let checkpointHash = null;
  let checkpointProgress = null;
  let unresolvedPositions = null;
  let positionEvidenceStatus = "UNKNOWN";
  let positionEvidenceSourceStep = null;
  let lastKnownPositionEvidence = null;
  let requestAccountingStatus = "KNOWN";
  const controlAbort = new AbortController();
  const callbackStates = {acquire: "NOT_STARTED", step: "NOT_STARTED", checkpoint: "NOT_STARTED"};
  const counts = {requests: 0, events: 0, cycles: 0, completedSteps: 0};

  function clearTimer(handle, owned) {
    if (!owned) return;
    try { config.scheduler.clearTimeout(handle); } catch { /* cleanup must not resurrect the run */ }
  }

  function clearDeadlineTimer() {
    clearTimer(deadlineTimer, ownsDeadlineTimer);
    ownsDeadlineTimer = false;
    deadlineTimer = undefined;
  }

  function detachParentSignal() {
    if (parentAbortListener && config.signal) {
      config.signal.removeEventListener("abort", parentAbortListener);
      parentAbortListener = null;
    }
  }

  function invalidatePositionEvidence(reason) {
    if (positionEvidenceStatus === "SUPPLIED") {
      lastKnownPositionEvidence = {
        status: "STALE",
        reason,
        sourceStep: counts.completedSteps,
        unresolvedPositions
      };
    } else if (lastKnownPositionEvidence) {
      lastKnownPositionEvidence = {...lastKnownPositionEvidence, status: "STALE", reason};
    }
    positionEvidenceStatus = "UNKNOWN";
    unresolvedPositions = null;
    positionEvidenceSourceStep = null;
  }

  function requestStop(reason) {
    if (state === "FINISHED" || state === "UNKNOWN" || state === "FAILED") return false;
    if (stopReason !== null) return false;
    stopReason = reason;
    state = "STOPPING";
    if (activeCallback?.name === "step" || activeCallback?.name === "checkpoint") uncertain = true;
    invalidatePositionEvidence(`STOP_REQUESTED:${reason}`);
    clearDeadlineTimer();
    cycleWait?.();
    try { controlAbort.abort(reason); } catch { /* AbortController implementations may reject a reason */ }
    return true;
  }

  function stop() {
    if (!runPromise) {
      const firstRequest = !stopBeforeStart;
      stopBeforeStart = true;
      return firstRequest;
    }
    return requestStop("OPERATOR_STOP");
  }

  function readClock() {
    const value = config.clock();
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
        (clockLast !== null && value < clockLast)) {
      throw new Error("MONOTONIC_CLOCK_INVALID");
    }
    clockLast = value;
    return value;
  }

  function checkDeadline() {
    if (stopReason) return false;
    let now;
    try {
      now = readClock();
    } catch {
      failureStatus = "UNKNOWN";
      failureCode = "MONOTONIC_CLOCK_INVALID";
      requestStop("MONOTONIC_CLOCK_INVALID");
      return false;
    }
    if (now >= deadlineAt) {
      requestStop("DEADLINE");
      return false;
    }
    return true;
  }

  function markPositionEvidence(result) {
    if (!isRecord(result) || !Object.hasOwn(result, "unresolvedPositions")) {
      invalidatePositionEvidence("LATEST_STEP_DID_NOT_SUPPLY_POSITION_EVIDENCE");
      return;
    }
    if (!Array.isArray(result.unresolvedPositions)) {
      invalidatePositionEvidence("LATEST_STEP_POSITION_EVIDENCE_INVALID");
      return;
    }
    try {
      unresolvedPositions = cloneEvidence(result.unresolvedPositions);
      positionEvidenceStatus = "SUPPLIED";
      positionEvidenceSourceStep = counts.completedSteps;
      lastKnownPositionEvidence = {
        status: "LAST_KNOWN",
        reason: null,
        sourceStep: positionEvidenceSourceStep,
        unresolvedPositions
      };
    } catch {
      invalidatePositionEvidence("LATEST_STEP_POSITION_EVIDENCE_INVALID");
    }
  }

  function callbackPayload(payload, signal) {
    return Object.freeze({...payload, mode, evidenceSource, signal});
  }

  async function invoke(name, callback, payload) {
    if (stopReason) return {kind: "cancelled"};
    const abortController = new AbortController();
    const onControlAbort = () => {
      try { abortController.abort(stopReason); } catch { /* see requestStop */ }
    };
    controlAbort.signal.addEventListener("abort", onControlAbort, {once: true});
    if (controlAbort.signal.aborted) onControlAbort();
    const active = {name, abortController};
    activeCallback = active;
    callbackStates[name] = "RUNNING";
    const invocation = Promise.resolve().then(() => {
      if (abortController.signal.aborted) throw new Error("CALLBACK_CANCELLED_BEFORE_START");
      return callback(callbackPayload(payload, abortController.signal));
    });
    const outcome = await new Promise(resolve => {
      let done = false;
      let settlementTimer;
      let ownsSettlementTimer = false;
      const cleanup = () => {
        controlAbort.signal.removeEventListener("abort", onControlAbort);
        controlAbort.signal.removeEventListener("abort", onStopped);
        clearTimer(settlementTimer, ownsSettlementTimer);
      };
      const finish = value => {
        if (done) return;
        done = true;
        cleanup();
        resolve(value);
      };
      const onStopped = () => {
        onControlAbort();
        try {
          settlementTimer = config.scheduler.setTimeout(
            () => finish({kind: "unsettled"}),
            config.budgets.callbackSettlementMs
          );
          ownsSettlementTimer = settlementTimer !== undefined && settlementTimer !== null;
          if (!ownsSettlementTimer) finish({kind: "unsettled"});
        } catch {
          finish({kind: "unsettled"});
        }
      };
      controlAbort.signal.addEventListener("abort", onStopped, {once: true});
      if (controlAbort.signal.aborted) onStopped();
      invocation.then(
        value => finish({kind: controlAbort.signal.aborted ? "late-success" : "success", value}),
        error => finish({kind: controlAbort.signal.aborted ? "late-failure" : "failure", error})
      );
    });
    if (activeCallback === active) activeCallback = null;
    if (outcome.kind === "success" || outcome.kind === "late-success") {
    callbackStates[name] = outcome.kind === "success" ? "COMPLETED" : "COMPLETED_AFTER_STOP";
    } else if (outcome.kind === "failure" || outcome.kind === "late-failure") {
    callbackStates[name] = outcome.kind === "failure" ? "FAILED" : "FAILED_AFTER_STOP";
    if (name === "acquire") requestAccountingStatus = "UNKNOWN";
    if (!stopReason) {
      failureCode = diagnosticCode(outcome.error);
      failureStatus = "UNKNOWN";
      requestStop(`${name.toUpperCase()}_CALLBACK_FAILED`);
    }
    } else if (outcome.kind === "unsettled") {
      callbackStates[name] = "UNSETTLED";
      uncertain ||= name === "step" || name === "checkpoint";
      if (name === "acquire") requestAccountingStatus = "UNKNOWN";
      if (!stopReason) requestStop("CALLBACK_SETTLEMENT_TIMEOUT");
      if (!failureStatus) failureStatus = "UNKNOWN";
      if (!failureCode) failureCode = "CALLBACK_SETTLEMENT_TIMEOUT";
    } else {
      callbackStates[name] = "CANCELLED";
    }
    return outcome;
  }

  async function waitBetweenCycles() {
    if (stopReason) return false;
    return new Promise(resolve => {
      let handle;
      let ownsTimer = false;
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimer(handle, ownsTimer);
        ownsTimer = false;
        controlAbort.signal.removeEventListener("abort", onAbort);
        if (cycleWait === cancel) cycleWait = null;
        resolve(result);
      };
      const cancel = () => {
        finish(false);
      };
      const onAbort = () => cancel();
      cycleWait = cancel;
      controlAbort.signal.addEventListener("abort", onAbort, {once: true});
      try {
        handle = config.scheduler.setTimeout(() => finish(true), config.budgets.pollIntervalMs);
        ownsTimer = handle !== undefined && handle !== null;
        if (!ownsTimer) {
          failureStatus = "UNKNOWN";
          failureCode = "SCHEDULER_FAILED";
          requestStop("SCHEDULER_FAILED");
          finish(false);
        }
      } catch {
        failureStatus = "UNKNOWN";
        failureCode = "SCHEDULER_FAILED";
        requestStop("SCHEDULER_FAILED");
        finish(false);
      }
    });
  }

  function acceptCheckpoint(value, progress) {
    const valid = isRecord(value) && value.status === "ACKNOWLEDGED" &&
      Number.isSafeInteger(value.sequence) && value.sequence >= 0 &&
      typeof value.hash === "string" && HASH.test(value.hash);
    const sameSequence = valid && checkpointSequence !== null && value.sequence === checkpointSequence;
    const progressAdvanced = checkpointProgress !== null &&
      (progress.eventCount > checkpointProgress.eventCount ||
        progress.completedSteps > checkpointProgress.completedSteps);
    if (!valid ||
        (checkpointSequence !== null && value.sequence < checkpointSequence) ||
        (sameSequence && value.hash !== checkpointHash) ||
        (sameSequence && progressAdvanced)) {
      checkpointStatus = "UNKNOWN";
      uncertain = true;
      failureStatus ??= "UNKNOWN";
      failureCode ??= "CHECKPOINT_ACK_UNKNOWN";
      requestStop("CHECKPOINT_ACK_UNKNOWN");
      return false;
    }
    checkpointStatus = "ACKNOWLEDGED";
    checkpointSequence = value.sequence;
    checkpointHash = value.hash;
    checkpointProgress = progress;
    uncertain = false;
    return true;
  }

  function currentSummary(status) {
    return {
      status,
      state,
      mode,
      evidenceSource,
      acquisitionStarted: callbackStates.acquire !== "NOT_STARTED",
      executionStarted: false,
      externalExecutionStatus: "NOT_ASSESSED",
      runtimeAuthority: "EXTERNAL",
      reason: stopReason,
      failureCode,
      startedAtMonotonicMs: startedAt,
      deadlineAtMonotonicMs: deadlineAt,
      counts: {...counts},
      callbackCompletion: {...callbackStates},
      checkpointAcknowledgement: {
        status: checkpointStatus,
        sequence: checkpointSequence,
        hash: checkpointHash
      },
      requestAccountingStatus,
      positionEvidence: {
        status: positionEvidenceStatus,
        unresolvedPositions: positionEvidenceStatus === "SUPPLIED"
          ? cloneEvidence(unresolvedPositions) : null,
        sourceStep: positionEvidenceStatus === "SUPPLIED" ? positionEvidenceSourceStep : null,
        lastKnown: lastKnownPositionEvidence ? cloneEvidence(lastKnownPositionEvidence) : null
      },
      reportStatus: "NOT_EMITTED"
    };
  }

  async function emitTerminalReport(status) {
    if (reportEmitted) return "NOT_EMITTED";
    reportEmitted = true;
    const reportController = new AbortController();
    let timer;
    let ownsTimer = false;
    let timeoutResolve;
    const timeout = new Promise(resolve => { timeoutResolve = resolve; });
    try {
      timer = config.scheduler.setTimeout(() => {
        try { reportController.abort("REPORT_SETTLEMENT_TIMEOUT"); } catch { /* ignored */ }
        timeoutResolve({kind: "timeout"});
      }, config.budgets.callbackSettlementMs);
      ownsTimer = timer !== undefined && timer !== null;
      if (!ownsTimer) return "UNKNOWN";
    } catch {
      return "UNKNOWN";
    }
    const reportInput = deepFreeze({...currentSummary(status), reportStatus: "EMITTING"});
    let reportStatus = "UNKNOWN";
    const reportPromise = Promise.resolve().then(() =>
      config.callbacks.report(Object.freeze({
        summary: reportInput,
        mode,
        evidenceSource,
        signal: reportController.signal
      }))
    ).then(
      () => ({kind: "completed"}),
      () => ({kind: "failed"})
    );
    try {
      const outcome = await Promise.race([reportPromise, timeout]);
      reportStatus = outcome.kind === "completed" ? "EMITTED"
        : outcome.kind === "failed" ? "FAILED" : "UNKNOWN";
    } finally {
      clearTimer(timer, ownsTimer);
    }
    return reportStatus;
  }

  async function finishRun() {
    clearDeadlineTimer();
    detachParentSignal();
    const status = failureStatus ?? (uncertain || requestAccountingStatus !== "KNOWN" ||
      checkpointStatus !== "ACKNOWLEDGED" ? "UNKNOWN" : "FINISHED");
    state = status;
    const reportStatus = await emitTerminalReport(status);
    return {...currentSummary(status), reportStatus};
  }

  async function runLoop() {
    await Promise.resolve();
    try {
      startedAt = readClock();
      deadlineAt = startedAt + config.budgets.durationMs;
      if (!Number.isFinite(deadlineAt) || deadlineAt <= startedAt) {
        failureStatus = "UNKNOWN";
        failureCode = "MONOTONIC_CLOCK_INVALID";
        requestStop("MONOTONIC_CLOCK_INVALID");
      } else {
        deadlineTimer = config.scheduler.setTimeout(
          () => requestStop("DEADLINE"),
          config.budgets.durationMs
        );
        ownsDeadlineTimer = deadlineTimer !== undefined && deadlineTimer !== null;
        if (!ownsDeadlineTimer) {
          failureStatus = "UNKNOWN";
          failureCode = "SCHEDULER_FAILED";
          requestStop("SCHEDULER_FAILED");
        }
      }
    } catch {
      failureStatus = "UNKNOWN";
      failureCode = "MONOTONIC_CLOCK_INVALID";
      requestStop("MONOTONIC_CLOCK_INVALID");
    }
    if (config.signal) {
      parentAbortListener = () => requestStop("PARENT_ABORT");
      config.signal.addEventListener("abort", parentAbortListener, {once: true});
      if (config.signal.aborted) parentAbortListener();
    }
    if (stopBeforeStart) requestStop("OPERATOR_STOP");
    while (!stopReason) {
      if (!checkDeadline()) break;
      if (counts.cycles >= config.budgets.cycles ||
          counts.requests >= config.budgets.requests ||
          counts.events >= config.budgets.events) {
        requestStop("BUDGET_EXHAUSTED");
        break;
      }
      const cycleIndex = counts.cycles;
      const remainingEvents = config.budgets.events - counts.events;
      counts.cycles += 1;
      const acquired = await invoke("acquire", config.callbacks.acquire, {
        cycleIndex,
        remainingRequests: config.budgets.requests - counts.requests,
        remainingEvents,
        deadlineAtMonotonicMs: deadlineAt
      });
      if (acquired.kind === "failure" || acquired.kind === "unsettled") break;
      if (acquired.kind !== "success" && acquired.kind !== "late-success") break;
      const acquisition = acquired.value;
      if (!isRecord(acquisition) || !isDenseDataArray(acquisition.events) ||
          (acquisition.done !== undefined && typeof acquisition.done !== "boolean") ||
          !Number.isSafeInteger(acquisition.requestsUsed) || acquisition.requestsUsed < 0 ||
          acquisition.requestsUsed > MAX_BUDGET ||
          acquisition.evidenceSource !== evidenceSource) {
        requestAccountingStatus = "UNKNOWN";
        failureStatus = "UNKNOWN";
        failureCode = "INVALID_ACQUISITION_RESULT";
        requestStop("INVALID_ACQUISITION_RESULT");
        break;
      }
      const remainingRequests = config.budgets.requests - counts.requests;
      counts.requests += acquisition.requestsUsed;
      if (acquisition.requestsUsed > remainingRequests) {
        failureStatus = "UNKNOWN";
        failureCode = "REQUEST_BUDGET_EXCEEDED";
        requestStop("REQUEST_BUDGET_EXCEEDED");
        break;
      }
      if (stopReason || acquired.kind === "late-success") break;
      if (!checkDeadline()) break;
      if (acquisition.events.length > remainingEvents) {
        failureStatus = "UNKNOWN";
        failureCode = "EVENT_BUDGET_EXCEEDED";
        uncertain = true;
        requestStop("EVENT_BUDGET_EXCEEDED");
        break;
      }
      let stoppedInSteps = false;
      for (let eventIndex = 0; eventIndex < acquisition.events.length; eventIndex += 1) {
        if (stopReason || !checkDeadline()) {
          stoppedInSteps = true;
          break;
        }
        const event = acquisition.events[eventIndex];
        counts.events += 1;
        invalidatePositionEvidence("STEP_IN_PROGRESS");
        const stepped = await invoke("step", config.callbacks.step, {
          cycleIndex,
          eventIndex,
          event
        });
        if (stepped.kind === "success" && !stopReason) {
          counts.completedSteps += 1;
          markPositionEvidence(stepped.value);
        } else if (stepped.kind === "failure") {
          invalidatePositionEvidence("LATEST_STEP_FAILED");
        } else if (stepped.kind === "unsettled") {
          invalidatePositionEvidence("LATEST_STEP_UNSETTLED");
        } else if (stepped.kind === "late-success" || stepped.kind === "late-failure") {
          invalidatePositionEvidence("LATEST_STEP_SETTLED_AFTER_STOP");
        }
        if (stepped.kind === "failure" || stepped.kind === "unsettled") {
          uncertain = true;
          stoppedInSteps = true;
          break;
        }
        if (stopReason || !checkDeadline()) {
          uncertain = true;
          stoppedInSteps = true;
          break;
        }
      }
      if (stoppedInSteps || stopReason) break;
      const checkpointed = await invoke("checkpoint", config.callbacks.checkpoint, {
        cycleIndex,
        eventCount: counts.events,
        completedSteps: counts.completedSteps,
        unresolvedPositions: positionEvidenceStatus === "SUPPLIED"
          ? cloneEvidence(unresolvedPositions) : null,
        positionEvidenceStatus,
        positionEvidenceSourceStep: positionEvidenceStatus === "SUPPLIED"
          ? positionEvidenceSourceStep : null,
        lastKnownPositionEvidence: lastKnownPositionEvidence
          ? cloneEvidence(lastKnownPositionEvidence) : null
      });
      if (checkpointed.kind === "success" || checkpointed.kind === "late-success") {
        acceptCheckpoint(checkpointed.value, {
          eventCount: counts.events,
          completedSteps: counts.completedSteps
        });
      } else {
        checkpointStatus = "UNKNOWN";
        uncertain = true;
        if (!failureStatus) failureStatus = "UNKNOWN";
        if (!failureCode) failureCode = checkpointed.kind === "failure"
          ? diagnosticCode(checkpointed.error) : "CHECKPOINT_ACK_UNKNOWN";
        if (!stopReason) requestStop("CHECKPOINT_ACK_UNKNOWN");
      }
      if (stopReason) break;
      if (!checkDeadline()) break;
      if (acquisition.done === true) {
        requestStop("SOURCE_COMPLETE");
        break;
      }
      if (counts.cycles >= config.budgets.cycles ||
          counts.requests >= config.budgets.requests ||
          counts.events >= config.budgets.events) {
        requestStop("BUDGET_EXHAUSTED");
        break;
      }
      if (!(await waitBetweenCycles())) break;
    }
    if (!stopReason) requestStop("CONTROL_COMPLETE");
    return finishRun();
  }

  function start() {
    if (runPromise) return runPromise;
    state = "RUNNING";
    runPromise = runLoop().catch(async () => {
      if (!failureStatus) failureStatus = "UNKNOWN";
      if (!failureCode) failureCode = "CONTROL_FAILURE";
      requestStop("CONTROL_FAILURE");
      return finishRun();
    });
    return runPromise;
  }

  function snapshot() {
    return deepFreeze({
      state,
      mode,
      evidenceSource,
      acquisitionStarted: callbackStates.acquire !== "NOT_STARTED",
      executionStarted: false,
      externalExecutionStatus: "NOT_ASSESSED",
      runtimeAuthority: "EXTERNAL",
      reason: stopReason,
      counts: {...counts},
      callbackCompletion: {...callbackStates},
      checkpointAcknowledgement: {
        status: checkpointStatus,
        sequence: checkpointSequence,
        hash: checkpointHash
      }
    });
  }

  return Object.freeze({start, stop, snapshot});
}
