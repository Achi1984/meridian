import { applyPaperObservation, advanceStrategy, buildReport, createLedger,
  createStrategyState, parseKrakenOhlc, parseKrakenTicker, sha256,
  SPOT_PAPER_PILOT_LIMITS, SPOT_PAPER_PILOT_VERSION } from "./core.mjs";
import { createRunJournal } from "./journal.mjs";

const TERMINAL_REPORT_GRACE_MS = 5_000;

const integer = (value, min, max, name) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`INVALID_${name}`);
  }
  return value;
};

function validateConfig(config) {
  if (!config || !["observe", "paper"].includes(config.mode)) throw new Error("MODE_REQUIRED");
  if (typeof config.runId !== "string" || typeof config.dataRoot !== "string" ||
      !config.dataRoot.trim()) throw new Error("RUN_ID_AND_DATA_ROOT_REQUIRED");
  return {
    ...config,
    maxCycles: integer(config.maxCycles ?? SPOT_PAPER_PILOT_LIMITS.maxCycles, 1,
      SPOT_PAPER_PILOT_LIMITS.maxCycles, "MAX_CYCLES"),
    maxDurationMs: integer(config.maxDurationMs ?? SPOT_PAPER_PILOT_LIMITS.maxDurationMs, 1,
      SPOT_PAPER_PILOT_LIMITS.maxDurationMs, "DURATION"),
    requestTimeoutMs: integer(config.requestTimeoutMs ??
      SPOT_PAPER_PILOT_LIMITS.requestTimeoutMs, 1,
      SPOT_PAPER_PILOT_LIMITS.requestTimeoutMs, "REQUEST_TIMEOUT"),
    terminalReportGraceMs: integer(config.terminalReportGraceMs ??
      TERMINAL_REPORT_GRACE_MS, 1, TERMINAL_REPORT_GRACE_MS, "TERMINAL_GRACE"),
    pollIntervalMs: integer(config.pollIntervalMs ?? SPOT_PAPER_PILOT_LIMITS.minPollIntervalMs,
      SPOT_PAPER_PILOT_LIMITS.minPollIntervalMs, SPOT_PAPER_PILOT_LIMITS.maxDurationMs,
      "POLL_INTERVAL"),
    now: config.now ?? Date.now,
    monotonicNow: config.monotonicNow ?? (() => performance.now()),
    sleep: config.sleep ?? ((ms, signal) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new Error("ABORTED"));
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("ABORTED"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    }))
  };
}

function validateAcquisition(response, counters) {
  if (Number.isSafeInteger(response?.bytes) && response.bytes >= 0) {
    counters.bytes += response.bytes;
    if (response.bytes > SPOT_PAPER_PILOT_LIMITS.maxResponseBytes) {
      throw new Error("RESPONSE_BYTE_LIMIT");
    }
    if (counters.bytes > SPOT_PAPER_PILOT_LIMITS.maxBytes) {
      throw new Error("RUN_BYTE_LIMIT");
    }
  }
  if (!response || typeof response.raw !== "string" ||
      !Number.isSafeInteger(response.bytes) || response.bytes < 0 ||
      Buffer.byteLength(response.raw, "utf8") !== response.bytes ||
      sha256(Buffer.from(response.raw, "utf8")) !== response.sha256 ||
      !Number.isSafeInteger(response.requestStartedAt) ||
      !Number.isSafeInteger(response.receivedAt) ||
      response.receivedAt < response.requestStartedAt) {
    throw new Error("INVALID_ACQUISITION_RECEIPT");
  }
  return response;
}

function errorCode(error) {
  return String(error?.message ?? error).split("\n", 1)[0].slice(0, 120);
}

function shouldStopOnDataError(code) {
  return /^(INVALID_|STALE_|OHLC_|UNEXPECTED_|INSUFFICIENT_|CONFLICTING_|CLOSED_CANDLE_|CLOCK_|RESPONSE_BYTE_LIMIT|RUN_BYTE_LIMIT|REQUEST_BUDGET_EXHAUSTED|TICKER_|EMPTY_|TRUNCATED_|(?:NOTIONAL|ENTRY_COST|PNL|SESSION_PNL|CASH|FEES|EQUITY)_OVERFLOW|HTTP_4\d\d$)/.test(code) &&
    code !== "HTTP_429";
}

function boundedTask(operation, {
  deadlineAt, monotonicNow, signal, timeoutCode, onTimeout
}) {
  const remaining = deadlineAt - monotonicNow();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return Promise.reject(new Error(timeoutCode));
  }
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("ABORTED"));
  let timer;
  let abortListener;
  const task = Promise.resolve().then(operation);
  task.catch(() => {});
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      if (abortListener) signal.removeEventListener("abort", abortListener);
    };
    timer = setTimeout(() => {
      onTimeout?.();
      cleanup();
      reject(new Error(timeoutCode));
    }, remaining);
    if (signal) {
      abortListener = () => {
        cleanup();
        reject(signal.reason ?? new Error("ABORTED"));
      };
      signal.addEventListener("abort", abortListener, { once: true });
    }
    task.then(value => {
      cleanup();
      resolve(value);
    }, error => {
      cleanup();
      reject(error);
    });
  });
}

function boundedProviderCall(method, context) {
  const controller = new AbortController();
  const requestDeadlineAt = Math.min(context.deadlineAt,
    context.monotonicNow() + context.requestTimeoutMs);
  const timeoutCode = requestDeadlineAt >= context.deadlineAt ?
    "DURATION_LIMIT" : "REQUEST_TIMEOUT";
  const onParentAbort = () => controller.abort(
    context.signal.reason ?? new Error("RUN_ABORTED"));
  if (context.signal?.aborted) onParentAbort();
  else context.signal?.addEventListener("abort", onParentAbort, { once: true });
  return boundedTask(
    () => method({ ...context, signal: controller.signal }),
    { ...context, deadlineAt: requestDeadlineAt, signal: controller.signal, timeoutCode,
      onTimeout: () => controller.abort(new Error(timeoutCode)) }
  ).finally(() => {
    context.signal?.removeEventListener("abort", onParentAbort);
    if (!controller.signal.aborted) controller.abort(new Error("REQUEST_FINISHED"));
  });
}

function awaitJournal(operation, options, timeoutCode = "JOURNAL_UNKNOWN") {
  return boundedTask(operation, { ...options, timeoutCode });
}

function isUnknownPersistence(error) {
  return error?.code === "JOURNAL_UNKNOWN" || error?.message === "JOURNAL_UNKNOWN";
}

function syncTransportCounters(provider, counters) {
  const reported = provider.counters?.();
  if (Number.isSafeInteger(reported?.requests)) {
    counters.requests = Math.max(counters.requests, reported.requests);
  }
  if (Number.isSafeInteger(reported?.bytes)) {
    counters.bytes = Math.max(counters.bytes, reported.bytes);
  }
}

export async function runSpotPaperPilot(input) {
  const config = validateConfig(input);
  if (!config.provider || typeof config.provider.fetchOhlc !== "function" ||
      typeof config.provider.fetchTicker !== "function") throw new Error("PROVIDER_REQUIRED");
  const startedAt = config.now();
  integer(startedAt, 0, Number.MAX_SAFE_INTEGER, "CLOCK");
  const monotonicStart = config.monotonicNow();
  if (!Number.isFinite(monotonicStart) || monotonicStart < 0) {
    throw new Error("INVALID_MONOTONIC_CLOCK");
  }
  const runDeadlineAt = monotonicStart + config.maxDurationMs;
  const runController = new AbortController();
  const onExternalAbort = () =>
    runController.abort(config.signal.reason ?? new Error("SIGNAL"));
  if (config.signal?.aborted) onExternalAbort();
  else config.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const runContext = { deadlineAt: runDeadlineAt, monotonicNow: config.monotonicNow,
    signal: runController.signal, requestTimeoutMs: config.requestTimeoutMs };
  const maxRequests = Math.min(config.maxCycles * 2, SPOT_PAPER_PILOT_LIMITS.maxRequests);
  const manifest = {
    schemaVersion: "SPOT_PAPER_PILOT_MANIFEST_V1",
    startedAt,
    model: SPOT_PAPER_PILOT_VERSION, mode: config.mode,
    pair: SPOT_PAPER_PILOT_LIMITS.pair,
    limits: { maxCycles: config.maxCycles, maxRequests,
      maxBytes: SPOT_PAPER_PILOT_LIMITS.maxBytes, maxResponseBytes: SPOT_PAPER_PILOT_LIMITS.maxResponseBytes,
      requestTimeoutMs: config.requestTimeoutMs,
      maxDurationMs: config.maxDurationMs, pollIntervalMs: config.pollIntervalMs }
  };
  const journal = await awaitJournal(() => createRunJournal({
    ...config.journalOptions, dataRoot: config.dataRoot, runId: config.runId,
    manifest, ...runContext
  }), runContext);
  let strategy = createStrategyState();
  let ledger = createLedger();
  const counters = { requests: 0, bytes: 0 };
  let stopReason = null;
  let entriesBlocked = false;
  let cycle = 0;
  let lastPollStartedAt = null;
  let lastPollMonotonicAt = null;
  let terminalOutcomeUnknown = false;
  try {
    try {
      await awaitJournal(() => journal.append({ id: "run-start", type: "start", at: startedAt },
        { strategy, ledger, counters, cycle }, runContext), runContext);
    } catch (error) {
      terminalOutcomeUnknown = isUnknownPersistence(error);
      throw new Error(terminalOutcomeUnknown ? "JOURNAL_UNKNOWN" : "JOURNAL_WRITE_FAILED",
        { cause: error });
    }
    while (cycle < config.maxCycles) {
      if (config.signal?.aborted) {
        stopReason = "SIGNAL";
        break;
      }
      if (config.monotonicNow() >= runDeadlineAt) {
        stopReason = "DURATION_LIMIT";
        break;
      }
      const pollStartedAt = config.now();
      if (!Number.isSafeInteger(pollStartedAt) || pollStartedAt < startedAt ||
          (lastPollStartedAt !== null && pollStartedAt < lastPollStartedAt)) {
        stopReason = "CLOCK_ERROR";
        break;
      }
      if (lastPollMonotonicAt !== null) {
        const remaining = config.pollIntervalMs -
          (config.monotonicNow() - lastPollMonotonicAt);
        if (remaining > 0) {
          const sleepController = new AbortController();
          const onSleepAbort = () => sleepController.abort(
            runContext.signal.reason ?? new Error("RUN_ABORTED"));
          if (runContext.signal.aborted) onSleepAbort();
          else runContext.signal.addEventListener("abort", onSleepAbort, { once: true });
          try {
            await boundedTask(
              () => config.sleep(Math.ceil(remaining), sleepController.signal),
              { ...runContext, signal: sleepController.signal,
                timeoutCode: "DURATION_LIMIT",
                onTimeout: () => sleepController.abort(new Error("DURATION_LIMIT")) });
          } catch {
            stopReason = config.signal?.aborted ? "SIGNAL" : "DURATION_LIMIT";
            break;
          } finally {
            runContext.signal.removeEventListener("abort", onSleepAbort);
            if (!sleepController.signal.aborted) {
              sleepController.abort(new Error("SLEEP_FINISHED"));
            }
          }
          if (config.signal?.aborted) {
            stopReason = "SIGNAL";
            break;
          }
        }
      }
      lastPollStartedAt = config.now();
      const actualPollMono = config.monotonicNow();
      if (!Number.isSafeInteger(lastPollStartedAt) || lastPollStartedAt < pollStartedAt ||
          !Number.isFinite(actualPollMono) ||
          (lastPollMonotonicAt !== null && actualPollMono < lastPollMonotonicAt)) {
        stopReason = "CLOCK_ERROR";
        break;
      }
      lastPollMonotonicAt = actualPollMono;
      if (actualPollMono >= runDeadlineAt) {
        stopReason = "DURATION_LIMIT";
        break;
      }
      if (runDeadlineAt - actualPollMono <
          2 * config.requestTimeoutMs) {
        stopReason = "DURATION_LIMIT";
        break;
      }
      cycle++;
      let ohlcResponse = null;
      let tickerResponse = null;
      let storedOhlc = null;
      let storedTicker = null;
      let decisionSignalKnownAt = null;
      let decisionSignals = [];
      try {
        if (counters.requests >= maxRequests) {
          throw new Error("REQUEST_BUDGET_EXHAUSTED");
        }
        counters.requests++;
        ohlcResponse = validateAcquisition(await boundedProviderCall(
          runtime => config.provider.fetchOhlc(runtime), runContext), counters);
        const parsedOhlc = parseKrakenOhlc(ohlcResponse, config.now());
        try {
          storedOhlc = await awaitJournal(
            () => journal.persistResponse(ohlcResponse, runContext), runContext);
        } catch (error) {
          terminalOutcomeUnknown ||= isUnknownPersistence(error);
          throw new Error(terminalOutcomeUnknown ? "JOURNAL_UNKNOWN" : "JOURNAL_WRITE_FAILED",
            { cause: error });
        }
        const advanced = advanceStrategy(strategy, parsedOhlc.candles);
        const missed = Boolean(advanced.missedDecisionWindow);
        const signalKnownAt = config.now();
        if (!Number.isSafeInteger(signalKnownAt) ||
            signalKnownAt < ohlcResponse.receivedAt) {
          throw new Error("CLOCK_ERROR");
        }
        const signals = advanced.signals.map(signal => ({ ...signal, signalKnownAt }));
        decisionSignalKnownAt = signalKnownAt;
        decisionSignals = signals;
        const signal = signals.at(-1) ?? null;
        if (counters.requests >= maxRequests) {
          throw new Error("REQUEST_BUDGET_EXHAUSTED");
        }
        counters.requests++;
        tickerResponse = validateAcquisition(await boundedProviderCall(
          runtime => config.provider.fetchTicker(runtime), runContext), counters);
        if (tickerResponse.requestStartedAt < signalKnownAt) {
          throw new Error("TICKER_PREDATES_SIGNAL");
        }
        const quoteAt = config.now();
        const quote = parseKrakenTicker(tickerResponse, quoteAt);
        const candleAgeAtQuote = quoteAt - (parsedOhlc.latestClosedAt + 60_000);
        if (candleAgeAtQuote < 0 || candleAgeAtQuote > SPOT_PAPER_PILOT_LIMITS.maxCandleAgeMs) {
          throw new Error("STALE_OHLC");
        }
        const effectAt = config.now();
        if (!Number.isSafeInteger(effectAt) || effectAt < quoteAt) {
          throw new Error("CLOCK_MOVED_BACKWARDS");
        }
        if (config.signal?.aborted || config.monotonicNow() >= runDeadlineAt) {
          const reason = config.signal?.aborted ? "SIGNAL" : "DURATION_LIMIT";
          stopReason = reason;
          break;
        }
        const effectQuote = parseKrakenTicker(tickerResponse, effectAt);
        const candleAgeAtEffect = effectAt - (parsedOhlc.latestClosedAt + 60_000);
        if (candleAgeAtEffect < 0 || candleAgeAtEffect > SPOT_PAPER_PILOT_LIMITS.maxCandleAgeMs) {
          throw new Error("STALE_OHLC");
        }
        const nextLedger = config.mode === "paper" ?
          applyPaperObservation(ledger, {
            signal, quote: effectQuote, nowMs: effectAt, stopped: entriesBlocked
          }) : { ledger, fills: [], stopReason: null, lossLimitReached: false };
        try {
          storedTicker = await awaitJournal(
            () => journal.persistResponse(tickerResponse, runContext), runContext);
        } catch (error) {
          terminalOutcomeUnknown ||= isUnknownPersistence(error);
          throw new Error(terminalOutcomeUnknown ? "JOURNAL_UNKNOWN" : "JOURNAL_WRITE_FAILED",
            { cause: error });
        }
        const event = {
          id: `observation:${cycle}:${parsedOhlc.latestClosedAt}:${effectQuote.sha256}`,
          type: missed ? "data_gap" : "observation",
          cycle, acquiredAt: { ohlc: [ohlcResponse.requestStartedAt, ohlcResponse.receivedAt],
            ticker: [tickerResponse.requestStartedAt, tickerResponse.receivedAt] },
          signalKnownAt,
          ohlc: { ...storedOhlc, latestClosedAt: parsedOhlc.latestClosedAt, ageMs: parsedOhlc.ageMs },
          ticker: { ...storedTicker,
            acquisitionAgeMs: effectQuote.ageMs },
          signals, fills: nextLedger.fills,
          dataGap: missed ? "MISSED_DECISION_WINDOW" : null
        };
        let result;
        try {
          result = await awaitJournal(() => journal.append(event, {
            strategy: advanced.state, ledger: nextLedger.ledger, counters, cycle,
            entriesBlocked: entriesBlocked || nextLedger.lossLimitReached
          }, runContext), runContext);
        } catch (error) {
          terminalOutcomeUnknown ||= isUnknownPersistence(error);
          throw new Error(terminalOutcomeUnknown ? "JOURNAL_UNKNOWN" : "JOURNAL_WRITE_FAILED",
            { cause: error });
        }
        if (!result.duplicate) {
          strategy = advanced.state;
          ledger = nextLedger.ledger;
          entriesBlocked ||= nextLedger.lossLimitReached;
        }
        if (nextLedger.stopReason) {
          stopReason = nextLedger.stopReason;
          break;
        }
      } catch (error) {
        syncTransportCounters(config.provider, counters);
        if (error?.message === "JOURNAL_WRITE_FAILED" || error?.message === "JOURNAL_UNKNOWN") {
          throw error;
        }
        if (config.signal?.aborted) {
          stopReason = "SIGNAL";
          break;
        }
        if (error?.message === "DURATION_LIMIT" || config.monotonicNow() >= runDeadlineAt) {
          stopReason = "DURATION_LIMIT";
          break;
        }
        const code = errorCode(error);
        const gap = { id: `gap:${cycle}:${counters.requests}:${code}`,
        type: "data_gap", reason: code, at: config.now(),
        acceptedOhlc: storedOhlc, acceptedTicker: storedTicker,
        signalKnownAt: decisionSignalKnownAt, signals: decisionSignals };
        try {
          await awaitJournal(
            () => journal.append(gap, { strategy, ledger, counters, cycle, entriesBlocked },
              runContext), runContext);
        } catch (writeError) {
          terminalOutcomeUnknown ||= isUnknownPersistence(writeError);
          throw new Error(terminalOutcomeUnknown ? "JOURNAL_UNKNOWN" : "JOURNAL_WRITE_FAILED",
            { cause: writeError });
        }
        if (shouldStopOnDataError(code)) {
          stopReason = code.startsWith("CLOCK_") ? "CLOCK_ERROR" :
            code === "REQUEST_BUDGET_EXHAUSTED" ? "REQUEST_LIMIT" : "INVALID_DATA";
          break;
        }
      }
    }
    if (!stopReason) stopReason = cycle >= config.maxCycles ? "CYCLE_LIMIT" : "DURATION_LIMIT";
    const candidateEnd = config.now();
    const endedAt = Number.isSafeInteger(candidateEnd) && candidateEnd >= startedAt ?
      candidateEnd : null;
    if (endedAt === null) stopReason = "CLOCK_ERROR";
    const allEvents = journal.snapshot().events;
    const report = buildReport({
      runId: config.runId, mode: config.mode, state: strategy, ledger,
      events: allEvents, stopReason, startedAt, endedAt
    });
    report.entriesBlocked = entriesBlocked;
    report.requests = counters.requests;
    report.deliveredBytes = counters.bytes;
    const terminalDeadlineAt = config.monotonicNow() + config.terminalReportGraceMs;
    const terminalContext = { deadlineAt: terminalDeadlineAt,
      monotonicNow: config.monotonicNow, signal: null };
    try {
      await awaitJournal(() => journal.append(
        { id: "run-terminal", type: "terminal", at: endedAt, report },
        { strategy, ledger, counters, cycle, stopReason, entriesBlocked }, terminalContext),
      terminalContext);
    } catch (error) {
      terminalOutcomeUnknown ||= isUnknownPersistence(error);
      throw new Error(terminalOutcomeUnknown ? "JOURNAL_UNKNOWN" : "JOURNAL_WRITE_FAILED",
        { cause: error });
    }
    await awaitJournal(() => journal.close(terminalContext), terminalContext);
    return report;
  } finally {
    config.signal?.removeEventListener("abort", onExternalAbort);
    if (journal && !terminalOutcomeUnknown && !journal.poisoned) {
      if (journal.snapshot().events.at(-1)?.type !== "terminal") {
        const closeDeadline = config.monotonicNow() + config.terminalReportGraceMs;
        await awaitJournal(() => journal.close({
          deadlineAt: closeDeadline, monotonicNow: config.monotonicNow, signal: null
        }), { deadlineAt: closeDeadline, monotonicNow: config.monotonicNow, signal: null });
      }
    }
  }
}
