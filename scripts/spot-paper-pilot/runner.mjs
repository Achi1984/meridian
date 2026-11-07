import { applyPaperObservation, advanceStrategy, buildReport, createLedger,
  createStrategyState, parseKrakenOhlc, parseKrakenTicker, sha256,
  SPOT_PAPER_PILOT_LIMITS, SPOT_PAPER_PILOT_VERSION } from "./core.mjs";
import { createRunJournal } from "./journal.mjs";

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
    pollIntervalMs: integer(config.pollIntervalMs ?? SPOT_PAPER_PILOT_LIMITS.minPollIntervalMs,
      SPOT_PAPER_PILOT_LIMITS.minPollIntervalMs, SPOT_PAPER_PILOT_LIMITS.maxDurationMs,
      "POLL_INTERVAL"),
    now: config.now ?? Date.now,
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
  return /^(INVALID_|STALE_|OHLC_|UNEXPECTED_|INSUFFICIENT_|CONFLICTING_|CLOSED_CANDLE_|CLOCK_|RESPONSE_BYTE_LIMIT|RUN_BYTE_LIMIT|REQUEST_BUDGET_EXHAUSTED|TICKER_|EMPTY_|TRUNCATED_|HTTP_4\d\d$)/.test(code) &&
    code !== "HTTP_429";
}

function waitForAbortable(sleep, ms, signal) {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("ABORTED"));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new Error("ABORTED"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(sleep(ms, signal)).then(value => {
      cleanup();
      resolve(value);
    }, error => {
      cleanup();
      reject(error);
    });
  });
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
  const maxRequests = Math.min(config.maxCycles * 2, SPOT_PAPER_PILOT_LIMITS.maxRequests);
  const manifest = {
    schemaVersion: "SPOT_PAPER_PILOT_MANIFEST_V1",
    startedAt,
    model: SPOT_PAPER_PILOT_VERSION, mode: config.mode,
    pair: SPOT_PAPER_PILOT_LIMITS.pair,
    limits: { maxCycles: config.maxCycles, maxRequests,
      maxBytes: SPOT_PAPER_PILOT_LIMITS.maxBytes, maxResponseBytes: SPOT_PAPER_PILOT_LIMITS.maxResponseBytes,
      requestTimeoutMs: SPOT_PAPER_PILOT_LIMITS.requestTimeoutMs,
      maxDurationMs: config.maxDurationMs, pollIntervalMs: config.pollIntervalMs }
  };
  const journal = await createRunJournal({
    dataRoot: config.dataRoot, runId: config.runId, manifest
  });
  let strategy = createStrategyState();
  let ledger = createLedger();
  const counters = { requests: 0, bytes: 0 };
  let stopReason = null;
  let entriesBlocked = false;
  let cycle = 0;
  let lastPollStartedAt = null;
  try {
    try {
      await journal.append({ id: "run-start", type: "start", at: startedAt },
    { strategy, ledger, counters, cycle });
    } catch (error) {
      throw new Error("JOURNAL_WRITE_FAILED", { cause: error });
    }
    while (cycle < config.maxCycles) {
      if (config.signal?.aborted) {
        stopReason = "SIGNAL";
        break;
      }
      const pollStartedAt = config.now();
      if (!Number.isSafeInteger(pollStartedAt) || pollStartedAt < startedAt ||
          (lastPollStartedAt !== null && pollStartedAt < lastPollStartedAt)) {
        stopReason = "CLOCK_ERROR";
        break;
      }
      if (pollStartedAt - startedAt >= config.maxDurationMs) {
        stopReason = "DURATION_LIMIT";
        break;
      }
      if (lastPollStartedAt !== null) {
        const remaining = config.pollIntervalMs - (pollStartedAt - lastPollStartedAt);
        if (remaining > 0) {
          try {
            await waitForAbortable(config.sleep, remaining, config.signal);
          } catch {
            stopReason = "SIGNAL";
            break;
          }
          if (config.signal?.aborted) {
            stopReason = "SIGNAL";
            break;
          }
        }
      }
      lastPollStartedAt = config.now();
      if (!Number.isSafeInteger(lastPollStartedAt) || lastPollStartedAt < pollStartedAt) {
        stopReason = "CLOCK_ERROR";
        break;
      }
      if (lastPollStartedAt - startedAt >= config.maxDurationMs) {
        stopReason = "DURATION_LIMIT";
        break;
      }
      cycle++;
      let ohlcResponse = null;
      let tickerResponse = null;
      let storedOhlc = null;
      let storedTicker = null;
      try {
        if (counters.requests >= maxRequests) {
          throw new Error("REQUEST_BUDGET_EXHAUSTED");
        }
        counters.requests++;
        ohlcResponse = validateAcquisition(await config.provider.fetchOhlc(), counters);
        const parsedOhlc = parseKrakenOhlc(ohlcResponse, config.now());
        try {
          storedOhlc = await journal.persistResponse(ohlcResponse);
        } catch (error) {
          throw new Error("JOURNAL_WRITE_FAILED", { cause: error });
        }
        if (counters.requests >= maxRequests) {
          throw new Error("REQUEST_BUDGET_EXHAUSTED");
        }
        counters.requests++;
        tickerResponse = validateAcquisition(await config.provider.fetchTicker(), counters);
        const quoteAt = config.now();
        const quote = parseKrakenTicker(tickerResponse, quoteAt);
        const candleAgeAtQuote = quoteAt - (parsedOhlc.latestClosedAt + 60_000);
        if (candleAgeAtQuote < 0 || candleAgeAtQuote > SPOT_PAPER_PILOT_LIMITS.maxCandleAgeMs) {
          throw new Error("STALE_OHLC");
        }
        try {
          storedTicker = await journal.persistResponse(tickerResponse);
        } catch (error) {
          throw new Error("JOURNAL_WRITE_FAILED", { cause: error });
        }
        const effectAt = config.now();
        if (!Number.isSafeInteger(effectAt) || effectAt < quoteAt) {
          throw new Error("CLOCK_MOVED_BACKWARDS");
        }
        if (config.signal?.aborted || effectAt - startedAt >= config.maxDurationMs) {
          const reason = config.signal?.aborted ? "SIGNAL" : "DURATION_LIMIT";
          const event = { id: `gap:${cycle}:pre-effect:${reason}`, type: "data_gap",
            reason, at: effectAt, acceptedOhlc: storedOhlc, acceptedTicker: storedTicker };
          try {
            await journal.append(event, { strategy, ledger, counters, cycle, entriesBlocked });
          } catch (error) {
            throw new Error("JOURNAL_WRITE_FAILED", { cause: error });
          }
          stopReason = reason;
          break;
        }
        const effectQuote = parseKrakenTicker(tickerResponse, effectAt);
        const candleAgeAtEffect = effectAt - (parsedOhlc.latestClosedAt + 60_000);
        if (candleAgeAtEffect < 0 || candleAgeAtEffect > SPOT_PAPER_PILOT_LIMITS.maxCandleAgeMs) {
          throw new Error("STALE_OHLC");
        }
        const advanced = advanceStrategy(strategy, parsedOhlc.candles);
        const missed = Boolean(advanced.missedDecisionWindow);
        const signal = advanced.signals.at(-1) ?? null;
        const nextLedger = config.mode === "paper" ?
          applyPaperObservation(ledger, {
            signal, quote: effectQuote, nowMs: effectAt, stopped: entriesBlocked
          }) : { ledger, fills: [], stopReason: null, lossLimitReached: false };
        const event = {
          id: `observation:${cycle}:${parsedOhlc.latestClosedAt}:${effectQuote.sha256}`,
          type: missed ? "data_gap" : "observation",
          cycle, acquiredAt: { ohlc: [ohlcResponse.requestStartedAt, ohlcResponse.receivedAt],
            ticker: [tickerResponse.requestStartedAt, tickerResponse.receivedAt] },
          ohlc: { ...storedOhlc, latestClosedAt: parsedOhlc.latestClosedAt, ageMs: parsedOhlc.ageMs },
          ticker: { ...storedTicker,
            acquisitionAgeMs: effectQuote.ageMs },
          signals: advanced.signals, fills: nextLedger.fills,
          dataGap: missed ? "MISSED_DECISION_WINDOW" : null
        };
        let result;
        try {
          result = await journal.append(event, {
            strategy: advanced.state, ledger: nextLedger.ledger, counters, cycle,
            entriesBlocked: entriesBlocked || nextLedger.lossLimitReached
          });
        } catch (error) {
          throw new Error("JOURNAL_WRITE_FAILED", { cause: error });
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
        if (error?.message === "JOURNAL_WRITE_FAILED") throw error;
        if (config.signal?.aborted) {
          stopReason = "SIGNAL";
          break;
        }
        const code = errorCode(error);
        const gap = { id: `gap:${cycle}:${counters.requests}:${code}`,
        type: "data_gap", reason: code, at: config.now(),
        acceptedOhlc: storedOhlc, acceptedTicker: storedTicker };
        await journal.append(gap, { strategy, ledger, counters, cycle, entriesBlocked });
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
    try {
      await journal.append({ id: "run-terminal", type: "terminal", at: endedAt, report },
        { strategy, ledger, counters, cycle, stopReason, entriesBlocked });
    } catch (error) {
      throw new Error("JOURNAL_WRITE_FAILED", { cause: error });
    }
    return report;
  } finally {
    await journal.close();
  }
}
