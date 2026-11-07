import { createHash } from "node:crypto";
import { SPOT_PAPER_PILOT_LIMITS } from "./core.mjs";

const API_ORIGIN = "https://api.kraken.com";
const REQUEST_TIMEOUT_MS = SPOT_PAPER_PILOT_LIMITS.requestTimeoutMs;

async function readBoundedBody(response, counters, maxBytes, signal, readerRef) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("EMPTY_HTTP_BODY");
  readerRef.reader = reader;
  const chunks = [];
  let length = 0;
  for (;;) {
    if (signal.aborted) throw new Error("REQUEST_ABORTED");
    const { done, value } = await reader.read();
    if (signal.aborted) throw new Error("REQUEST_ABORTED");
    if (done) break;
    length += value.byteLength;
    counters.bytes += value.byteLength;
    if (length > SPOT_PAPER_PILOT_LIMITS.maxResponseBytes ||
        counters.bytes > maxBytes) {
      void reader.cancel().catch(() => {});
      throw new Error(length > SPOT_PAPER_PILOT_LIMITS.maxResponseBytes ?
        "RESPONSE_BYTE_LIMIT" : "RUN_BYTE_LIMIT");
    }
    chunks.push(Buffer.from(value));
  }
  const contentLength = response.headers.get("content-length");
  const advertised = contentLength === null ? null : Number(contentLength);
  const isCompressed = Boolean(response.headers.get("content-encoding"));
  if (!isCompressed && advertised !== null && Number.isFinite(advertised) &&
      advertised >= 0 && advertised !== length) {
    throw new Error("TRUNCATED_HTTP_BODY");
  }
  return Buffer.concat(chunks, length);
}

export function createKrakenProvider({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  signal,
  monotonicNow = () => performance.now(),
  deadlineAt,
  maxRequests = SPOT_PAPER_PILOT_LIMITS.maxRequests,
  maxBytes = SPOT_PAPER_PILOT_LIMITS.maxBytes,
  requestTimeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== "function" || typeof now !== "function" ||
      typeof monotonicNow !== "function") {
    throw new TypeError("fetch and clock dependencies are required");
  }
  if (!Number.isInteger(maxRequests) || maxRequests < 1 ||
      maxRequests > SPOT_PAPER_PILOT_LIMITS.maxRequests ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      maxBytes > SPOT_PAPER_PILOT_LIMITS.maxBytes ||
      requestTimeoutMs !== SPOT_PAPER_PILOT_LIMITS.requestTimeoutMs) {
    throw new Error("INVALID_TRANSPORT_BUDGET");
  }
  const counters = { requests: 0, bytes: 0 };

  async function get(path, params, runtime = {}) {
    if (counters.requests >= maxRequests) throw new Error("REQUEST_BUDGET_EXHAUSTED");
    counters.requests++;
    const requestStartedAt = now();
    if (!Number.isSafeInteger(requestStartedAt) || requestStartedAt < 0) {
      throw new Error("INVALID_CLOCK");
    }
    const url = new URL(path, API_ORIGIN);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const clock = runtime.monotonicNow ?? monotonicNow;
    const startedMono = clock();
    const effectiveDeadline = Math.min(
      runtime.deadlineAt ?? deadlineAt ?? Infinity,
      startedMono + requestTimeoutMs
    );
    const remaining = effectiveDeadline - startedMono;
    if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("REQUEST_TIMEOUT");
    const parentSignals = [signal, runtime.signal].filter(Boolean);
    const controller = new AbortController();
    const cancelFromParent = () => controller.abort(
      parentSignals.find(item => item.aborted)?.reason ?? new Error("REQUEST_ABORTED"));
    for (const parent of parentSignals) {
      if (parent.aborted) cancelFromParent();
      else parent.addEventListener("abort", cancelFromParent, { once: true });
    }
    let response = null;
    const readerRef = { reader: null };
    let timedOut = false;
    let timer;
    let abortListener;
    const cleanupResponse = value => {
      if (value?.body) void value.body.cancel().catch(() => {});
    };
    const work = (async () => {
      response = await fetchImpl(url, {
        method: "GET", headers: { accept: "application/json" },
        redirect: "error", signal: controller.signal
      });
      if (controller.signal.aborted) {
        cleanupResponse(response);
        throw new Error("REQUEST_ABORTED");
      }
      if (!response.ok) {
        if (response.body) {
          await readBoundedBody(response, counters, maxBytes, controller.signal, readerRef);
        }
        if (response.status === 429) throw new Error("HTTP_429");
        throw new Error(`HTTP_${response.status}`);
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
        throw new Error("INVALID_CONTENT_TYPE");
      }
      const rawBytes = await readBoundedBody(
        response, counters, maxBytes, controller.signal, readerRef);
      const receivedAt = now();
      if (!Number.isSafeInteger(receivedAt) || receivedAt < requestStartedAt) {
        throw new Error("CLOCK_MOVED_BACKWARDS");
      }
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error("INVALID_JSON_RESPONSE");
      }
      return {
        data, raw, sha256: createHash("sha256").update(rawBytes).digest("hex"),
        bytes: rawBytes.byteLength, requestStartedAt, receivedAt
      };
    })();
    work.then(() => {}, () => {});
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error("REQUEST_TIMEOUT"));
        if (readerRef.reader) void readerRef.reader.cancel().catch(() => {});
        cleanupResponse(response);
        reject(new Error("REQUEST_TIMEOUT"));
      }, remaining);
    });
    try {
      return await Promise.race([
        work,
        timeout,
        new Promise((_, reject) => {
          abortListener = () =>
            reject(controller.signal.reason ?? new Error("REQUEST_ABORTED"));
          if (controller.signal.aborted) abortListener();
          else controller.signal.addEventListener("abort", abortListener, { once: true });
        })
      ]);
    } finally {
      clearTimeout(timer);
      if (abortListener) controller.signal.removeEventListener("abort", abortListener);
      for (const parent of parentSignals) parent.removeEventListener("abort", cancelFromParent);
      if (timedOut && response) cleanupResponse(response);
    }
  }

  return Object.freeze({
    fetchOhlc: runtime => get("/0/public/OHLC", { pair: "XBTEUR", interval: "1" }, runtime),
    fetchTicker: runtime => get("/0/public/Ticker", { pair: "XBTEUR" }, runtime),
    counters: () => ({ ...counters })
  });
}
