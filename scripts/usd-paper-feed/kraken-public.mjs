import { createHash } from "node:crypto";
import { validateUsdQuote } from "../paper-capital-challenge/account-contract.mjs";
import { USD_PAPER_FEED_LIMITS } from "./limits.mjs";
import { UsdCampaignBudget } from "./campaign-budget.mjs";

export { USD_PAPER_FEED_LIMITS } from "./limits.mjs";

const API_ORIGIN = "https://api.kraken.com";
const PAIR = "BTC/USD";
const KRAKEN_PAIR = "XBTUSD";
const RESULT_PAIR = "XXBTZUSD";
const SOURCE_ID = "kraken-public-btc-usd";
const {
  maxQuoteAgeMs: QUOTE_MAX_AGE_MS, maxEvents: MAX_EVENTS, maxRequests: MAX_REQUESTS,
  maxResponseBytes: MAX_RESPONSE_BYTES, maxBytes: MAX_TOTAL_BYTES,
  maxSpanMs: MAX_SPAN_MS, maxClosedMinuteAgeMs: MAX_CLOSED_MINUTE_AGE_MS,
  minSampleIntervalMs: MIN_SAMPLE_INTERVAL_MS, requestTimeoutMs: MAX_REQUEST_TIMEOUT_MS
} = USD_PAPER_FEED_LIMITS;
const DECIMAL = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,8})?$/;

function safeTime(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_${name}`);
  return value;
}

function decimal(value, name) {
  if (typeof value !== "string" || value.length > 25 || !DECIMAL.test(value)) {
    throw new Error(`INVALID_${name}`);
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
}

function resultObject(data, endpoint) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      !Array.isArray(data.error) || data.error.some(item => typeof item !== "string")) {
    throw new Error(`INVALID_${endpoint}_SCHEMA`);
  }
  if (data.error.length) throw new Error(`${endpoint}_API_ERROR`);
  if (!data.result || typeof data.result !== "object" || Array.isArray(data.result)) {
    throw new Error(`INVALID_${endpoint}_SCHEMA`);
  }
  return data.result;
}

function nativePair(result, endpoint, allowLast = false) {
  const keys = Object.keys(result);
  const pairKeys = keys.filter(key => key !== "last");
  if (pairKeys.length !== 1 || pairKeys[0] !== RESULT_PAIR ||
      (allowLast ? keys.length !== 2 || !keys.includes("last") : keys.length !== 1)) {
    throw new Error(`UNEXPECTED_${endpoint}_PAIR`);
  }
  return result[RESULT_PAIR];
}

function parseTicker(data) {
  const ticker = nativePair(resultObject(data, "TICKER"), "TICKER");
  if (!ticker || typeof ticker !== "object" || Array.isArray(ticker) ||
      !Array.isArray(ticker.a) || ticker.a.length !== 3 ||
      !Array.isArray(ticker.b) || ticker.b.length !== 3 ||
      !Array.isArray(ticker.c) || ticker.c.length !== 2 ||
      !/^\d+$/.test(ticker.a[1]) || !/^\d+$/.test(ticker.b[1])) {
    throw new Error("INVALID_TICKER_SCHEMA");
  }
  const ask = decimal(ticker.a[0], "ASK");
  const bid = decimal(ticker.b[0], "BID");
  decimal(ticker.a[2], "ASK_VOLUME");
  decimal(ticker.b[2], "BID_VOLUME");
  decimal(ticker.c[0], "LAST_TRADE");
  decimal(ticker.c[1], "LAST_TRADE_VOLUME");
  if (bid <= 0n || ask < bid) throw new Error("INVALID_TICKER_BOOK");
  return { bid: ticker.b[0], ask: ticker.a[0] };
}

function parseClosedCandles(data, receivedAtMs) {
  const result = resultObject(data, "OHLC");
  const rows = nativePair(result, "OHLC", true);
  if (!Array.isArray(rows) || rows.length < 1 || !Number.isSafeInteger(result.last) ||
      result.last < 0) {
    throw new Error("INVALID_OHLC_SCHEMA");
  }
  let previousAtMs = null;
  const candles = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 8 ||
        !Number.isSafeInteger(row[0]) || row[0] < 0) {
      throw new Error("INVALID_OHLC_ROW");
    }
    const timestamp = row[0] * 1000;
    if (!Number.isSafeInteger(timestamp) || timestamp % 60_000 !== 0 ||
        timestamp > receivedAtMs || (previousAtMs !== null &&
          timestamp !== previousAtMs + 60_000)) {
      throw new Error("INVALID_OHLC_TIMESTAMP");
    }
    const open = decimal(row[1], "OHLC_OPEN");
    const high = decimal(row[2], "OHLC_HIGH");
    const low = decimal(row[3], "OHLC_LOW");
    const close = decimal(row[4], "OHLC_CLOSE");
    const vwap = decimal(row[5], "OHLC_VWAP");
    const volume = decimal(row[6], "OHLC_VOLUME");
    if (!Number.isSafeInteger(row[7]) || row[7] < 0 || open <= 0n || high <= 0n ||
        low <= 0n || close <= 0n || high < open || high < close || high < low ||
        low > open || low > close ||
        (volume > 0n && (vwap <= 0n || vwap < low || vwap > high)) ||
        (volume === 0n && vwap !== 0n && (vwap < low || vwap > high))) {
      throw new Error("INVALID_OHLC_VALUES");
    }
    if (timestamp + 60_000 <= receivedAtMs) {
      candles.push(Object.freeze({
        timestamp,
        open: row[1],
        high: row[2],
        low: row[3],
        close: row[4],
        closeNano: String(close)
      }));
    }
    previousAtMs = timestamp;
  }
  const cursorAtMs = result.last * 1000;
  if (!Number.isSafeInteger(cursorAtMs) || cursorAtMs < previousAtMs) {
    throw new Error("INVALID_OHLC_CURSOR");
  }
  if (!candles.length) throw new Error("NO_CLOSED_MINUTE");
  return Object.freeze(candles);
}

function responseAbortError() {
  return new Error("REQUEST_ABORTED");
}

async function readBoundedBody(response, counters, readerRef, assertActive) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("EMPTY_HTTP_BODY");
  readerRef.reader = reader;
  const chunks = [];
  let length = 0;
  for (;;) {
    assertActive();
    const { done, value } = await reader.read();
    if (!done && !readerRef.settled) readerRef.rawBodyBytes += value.byteLength;
    assertActive();
    if (done) break;
    length += value.byteLength;
    counters.bytes += value.byteLength;
    if (length > MAX_RESPONSE_BYTES || counters.bytes > MAX_TOTAL_BYTES) {
      try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
      throw new Error(length > MAX_RESPONSE_BYTES ? "RESPONSE_BYTE_LIMIT" : "RUN_BYTE_LIMIT");
    }
    chunks.push(Buffer.from(value));
  }
  const contentLength = response.headers.get("content-length");
  const advertised = contentLength === null ? null : Number(contentLength);
  const compressed = Boolean(response.headers.get("content-encoding"));
  if (!compressed && advertised !== null && Number.isFinite(advertised) &&
      advertised >= 0 && advertised !== length) {
    throw new Error("TRUNCATED_HTTP_BODY");
  }
  const bytes = Buffer.concat(chunks, length);
  reader.releaseLock();
  readerRef.reader = null;
  return bytes;
}

export function createKrakenUsdPublicFeed({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  monotonicNow = () => performance.now(),
  signal,
  requestTimeoutMs = MAX_REQUEST_TIMEOUT_MS,
  campaignBudget
} = {}) {
  if (typeof fetchImpl !== "function" || typeof now !== "function" ||
      typeof monotonicNow !== "function" || !Number.isSafeInteger(requestTimeoutMs) ||
      requestTimeoutMs < 1 || requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS ||
      (signal !== undefined && typeof signal?.addEventListener !== "function")) {
    throw new TypeError("INVALID_PUBLIC_FEED_CONFIGURATION");
  }
  const budget = campaignBudget?.store;
  const budgetConfiguration = campaignBudget && structuredClone(campaignBudget.configuration);
  const retainBudgetTip = campaignBudget?.retainRestartTip;
  if (campaignBudget !== undefined) {
    if (!(budget instanceof UsdCampaignBudget) || typeof retainBudgetTip !== "function") {
      throw new TypeError("INVALID_DURABLE_CAMPAIGN_BUDGET");
    }
    budget.assertConfiguration(budgetConfiguration);
  }
  async function retainTip() {
    try { await retainBudgetTip(budget.tip); } catch (error) {
      budget.block();
      throw error;
    }
  }

  const counters = { requests: 0, bytes: 0, events: 0 };
  let firstObservedAtMs = null;
  let lastAttemptAtMs = null;
  let previousQuoteAtMs = null;
  let inFlight = false;
  let terminalError = null;
  let sampleId = null;

  async function get(endpoint, params, runtime = {}) {
    if (counters.requests >= MAX_REQUESTS) throw new Error("REQUEST_BUDGET_EXHAUSTED");
    if (counters.bytes + MAX_RESPONSE_BYTES > MAX_TOTAL_BYTES) {
      throw new Error("RUN_BYTE_BUDGET_EXHAUSTED");
    }
    const clock = runtime.monotonicNow ?? monotonicNow;
    const startedMono = clock();
    if (!Number.isFinite(startedMono) || startedMono < 0) throw new Error("INVALID_MONOTONIC_CLOCK");
    const requestStartedAt = safeTime(now(), "CLOCK");
    const parentSignals = [signal, runtime.signal].filter(Boolean);
    if (parentSignals.some(parent => typeof parent.addEventListener !== "function")) {
      throw new TypeError("INVALID_ABORT_SIGNAL");
    }
    if (parentSignals.some(parent => parent.aborted)) throw responseAbortError();

    let reservationId = null;
    if (budget) {
      reservationId = await budget.reserveRequest(sampleId, endpoint, requestStartedAt);
      await retainTip();
      budget.assertConfiguration(budgetConfiguration);
    }
    if (parentSignals.some(parent => parent.aborted)) throw responseAbortError();
    const controller = new AbortController();
    const cancelFromParent = () => controller.abort(responseAbortError());
    for (const parent of parentSignals) parent.addEventListener("abort", cancelFromParent, { once: true });

    const url = new URL(`/0/public/${endpoint}`, API_ORIGIN);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const effectiveDeadline = startedMono + requestTimeoutMs;
    const readerRef = { reader: null, rawBodyBytes: 0, settled: false };
    let response = null;
    let completed = false;
    let timer;
    let abortListener;
    const cleanupResponse = value => {
      if (readerRef.reader) {
        const reader = readerRef.reader;
        let cancellation;
        try { cancellation = reader.cancel(); } catch {}
        try { reader.releaseLock?.(); } catch {}
        if (cancellation) void Promise.resolve(cancellation).catch(() => {}).finally(() => {
          try { reader.releaseLock?.(); } catch {}
        });
      } else if (value?.body) {
        try { void Promise.resolve(value.body.cancel()).catch(() => {}); } catch {}
      }
    };
    const assertActive = () => {
      if (controller.signal.aborted) throw controller.signal.reason ?? responseAbortError();
      if (clock() >= effectiveDeadline) throw new Error("REQUEST_TIMEOUT");
    };
    counters.requests++;
    const work = (async () => {
      assertActive();
      response = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "omit",
        redirect: "error",
        signal: controller.signal
      });
      if (controller.signal.aborted) {
        cleanupResponse(response);
        throw controller.signal.reason ?? responseAbortError();
      }
      assertActive();
      if (!response.ok) {
        if (response.body) await readBoundedBody(response, counters, readerRef, assertActive);
        throw new Error(response.status === 429 ? "HTTP_429" : `HTTP_${response.status}`);
      }
      const jsonContent = /^application\/json(?:\s*;|$)/i.test(
        response.headers.get("content-type") ?? "");
      if (!jsonContent && !budget) {
        throw new Error("INVALID_CONTENT_TYPE");
      }
      const body = await readBoundedBody(response, counters, readerRef, assertActive);
      if (!jsonContent) throw new Error("INVALID_CONTENT_TYPE");
      const receivedAt = safeTime(now(), "RECEIVED_AT");
      if (receivedAt < requestStartedAt) throw new Error("CLOCK_MOVED_BACKWARDS");
      assertActive();
      let data;
      try {
        data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      } catch {
        throw new Error("INVALID_JSON_RESPONSE");
      }
      assertActive();
      return {
        data,
        requestStartedAt,
        receivedAt,
        sha256: createHash("sha256").update(body).digest("hex")
      };
    })();
    work.then(() => {
      if (completed) cleanupResponse(response);
    }, () => {});
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error("REQUEST_TIMEOUT");
        controller.abort(error);
        cleanupResponse(response);
        reject(error);
      }, requestTimeoutMs);
    });
    try {
      const result = await Promise.race([
        work,
        timeout,
        new Promise((_, reject) => {
          abortListener = () => reject(controller.signal.reason ?? responseAbortError());
          if (controller.signal.aborted) abortListener();
          else controller.signal.addEventListener("abort", abortListener, { once: true });
        })
      ]);
      if (controller.signal.aborted || clock() >= effectiveDeadline) {
        cleanupResponse(response);
        throw controller.signal.aborted ? controller.signal.reason ?? responseAbortError() :
          new Error("REQUEST_TIMEOUT");
      }
      completed = true;
      return result;
    } finally {
      clearTimeout(timer);
      if (abortListener) controller.signal.removeEventListener("abort", abortListener);
      for (const parent of parentSignals) parent.removeEventListener("abort", cancelFromParent);
      if (!completed) cleanupResponse(response);
      readerRef.settled = true;
      if (budget && reservationId !== null) {
        await budget.finalizeRequest(reservationId, readerRef.rawBodyBytes,
          completed ? "SUCCESS" : "FAILED");
        await retainTip();
      }
    }
  }

  async function fetchSample({ runtime = {}, decide = null } = {}) {
    if (inFlight) throw new Error("SAMPLE_ALREADY_IN_FLIGHT");
    inFlight = true;
    let attemptStarted = false;
    try {
      if (terminalError) throw new Error("FEED_TERMINAL_FAILURE", { cause: terminalError });
      const startedAt = safeTime(now(), "CLOCK");
      if (lastAttemptAtMs !== null) {
        if (startedAt < lastAttemptAtMs) throw new Error("CLOCK_MOVED_BACKWARDS");
        if (startedAt - lastAttemptAtMs < MIN_SAMPLE_INTERVAL_MS) {
          throw new Error("SAMPLE_INTERVAL_TOO_SHORT");
        }
      }
      if (counters.events >= MAX_EVENTS) throw new Error("EVENT_LIMIT_REACHED");
      if (MAX_REQUESTS - counters.requests < 2) throw new Error("REQUEST_BUDGET_EXHAUSTED");
      if (counters.bytes + 2 * MAX_RESPONSE_BYTES > MAX_TOTAL_BYTES) {
        throw new Error("RUN_BYTE_BUDGET_EXHAUSTED");
      }
      if (firstObservedAtMs !== null && startedAt - firstObservedAtMs > MAX_SPAN_MS) {
        throw new Error("OBSERVATION_WINDOW_LIMIT_REACHED");
      }

      lastAttemptAtMs = startedAt;
      attemptStarted = true;
      if (budget) {
        sampleId = await budget.beginSample(startedAt);
        await retainTip();
      }
      let ticker;
      let ohlc;
      let candles;
      let candleEvidence = null;
      let candidateDecision = null;
      let decisionAtMs = null;
      if (decide) {
        ohlc = await get("OHLC", { pair: KRAKEN_PAIR, interval: "1" }, runtime);
        candles = parseClosedCandles(ohlc.data, ohlc.receivedAt);
        const latestClosedMinuteAtMs = candles.at(-1).timestamp;
        if (observedAtMsPast(ohlc.receivedAt, latestClosedMinuteAtMs)) {
          throw new Error("STALE_CLOSED_MINUTE");
        }
        candleEvidence = Object.freeze({
          schemaVersion: "NATIVE_BTC_USD_CLOSED_CANDLES_V1",
          nativeInstrument: PAIR,
          intervalMinutes: 1,
          responseDigest: ohlc.sha256,
          receivedAtMs: ohlc.receivedAt,
          candles
        });
        candidateDecision = decide(candleEvidence);
        if (candidateDecision &&
            (typeof candidateDecision === "object" || typeof candidateDecision === "function") &&
            typeof candidateDecision.then === "function") {
          if (candidateDecision instanceof Promise) {
            void candidateDecision.catch(() => {});
          }
          throw new Error("ASYNC_CAUSAL_DECISION_UNSUPPORTED");
        }
        if (signal?.aborted || runtime.signal?.aborted) throw responseAbortError();
        decisionAtMs = safeTime(now(), "DECISION_TIME");
        if (decisionAtMs < ohlc.receivedAt) throw new Error("CLOCK_MOVED_BACKWARDS");
        ticker = await get("Ticker", { pair: KRAKEN_PAIR }, runtime);
      } else {
        ticker = await get("Ticker", { pair: KRAKEN_PAIR }, runtime);
        ohlc = await get("OHLC", { pair: KRAKEN_PAIR, interval: "1" }, runtime);
        candles = parseClosedCandles(ohlc.data, ohlc.receivedAt);
      }
      const observedAtMs = safeTime(now(), "OBSERVATION_TIME");
      if (observedAtMs < ticker.receivedAt || observedAtMs < ohlc.receivedAt) {
        throw new Error("CLOCK_MOVED_BACKWARDS");
      }
      if (firstObservedAtMs !== null && observedAtMs - firstObservedAtMs > MAX_SPAN_MS) {
        throw new Error("OBSERVATION_WINDOW_LIMIT_REACHED");
      }
      const latestClosedMinuteAtMs = candles.at(-1).timestamp;
      const prices = parseTicker(ticker.data);
      if (previousQuoteAtMs !== null && ticker.receivedAt < previousQuoteAtMs) {
        throw new Error("QUOTE_OUT_OF_ORDER");
      }
      const quote = {
        schemaVersion: "NATIVE_BTC_USD_QUOTE_V1",
        id: `kraken-usd-${ticker.receivedAt}-${ticker.sha256.slice(0, 16)}`,
        marketPair: PAIR,
        baseCurrency: "BTC",
        quoteCurrency: "USD",
        sourceId: SOURCE_ID,
        nativeInstrument: PAIR,
        evidenceKind: "OFFLINE_CALLER_ASSERTION",
        bid: prices.bid,
        ask: prices.ask,
        quotedAtMs: ticker.receivedAt,
        receivedAtMs: ticker.receivedAt,
        maxAgeMs: QUOTE_MAX_AGE_MS
      };
      validateUsdQuote(quote, observedAtMs);
      if (observedAtMs - latestClosedMinuteAtMs - 60_000 > MAX_CLOSED_MINUTE_AGE_MS) {
        throw new Error("STALE_CLOSED_MINUTE");
      }
      const observation = Object.freeze({
        id: quote.id,
        observedAtMs,
        quote: Object.freeze(quote)
      });
      if (decide) {
        if (decisionAtMs > ticker.requestStartedAt ||
            ticker.requestStartedAt > ticker.receivedAt ||
            ticker.receivedAt > observedAtMs) {
          throw new Error("NONCAUSAL_SAMPLE_TIMING");
        }
        if (budget) {
          await budget.completeSample(sampleId);
          await retainTip();
          sampleId = null;
        }
        if (firstObservedAtMs === null) firstObservedAtMs = observedAtMs;
        previousQuoteAtMs = ticker.receivedAt;
        counters.events++;
        return Object.freeze({
          schemaVersion: "BTC_USD_CLOSED_CANDLE_CAUSAL_SAMPLE_V1",
          candleEvidence,
          decision: candidateDecision,
          decisionAtMs,
          tickerRequestStartedAtMs: ticker.requestStartedAt,
          tickerReceivedAtMs: ticker.receivedAt,
          observation
        });
      }
      if (budget) {
        await budget.completeSample(sampleId);
        await retainTip();
        sampleId = null;
      }
      if (firstObservedAtMs === null) firstObservedAtMs = observedAtMs;
      previousQuoteAtMs = ticker.receivedAt;
      counters.events++;
      return observation;
    } catch (error) {
      const exhausted = ["EVENT_LIMIT_REACHED", "REQUEST_BUDGET_EXHAUSTED",
        "RUN_BYTE_BUDGET_EXHAUSTED", "OBSERVATION_WINDOW_LIMIT_REACHED"]
        .includes(error.message);
      if (attemptStarted || exhausted) {
        terminalError = error;
      }
      if (budget && sampleId !== null) {
        try {
          await budget.stopSample(sampleId);
          await retainTip();
        } catch {
          budget.block();
        }
      }
      throw error;
    } finally {
      sampleId = null;
      inFlight = false;
    }
  }

  function fetchObservation(runtime = {}) {
    return fetchSample({ runtime });
  }

  function fetchCausalSample({ decide, runtime = {} } = {}) {
    if (typeof decide !== "function") throw new TypeError("INVALID_CAUSAL_DECISION");
    return fetchSample({ runtime, decide });
  }

  return Object.freeze({
    fetchObservation,
    fetchCausalSample,
    counters: () => Object.freeze({ ...counters })
  });
}

function observedAtMsPast(receivedAtMs, latestClosedMinuteAtMs) {
  return receivedAtMs - latestClosedMinuteAtMs - 60_000 > MAX_CLOSED_MINUTE_AGE_MS;
}
