import { createHash } from "node:crypto";
import { SPOT_PAPER_PILOT_LIMITS } from "./core.mjs";

const API_ORIGIN = "https://api.kraken.com";
const REQUEST_TIMEOUT_MS = SPOT_PAPER_PILOT_LIMITS.requestTimeoutMs;

function abortError(signal) {
  return signal?.reason ?? new Error("REQUEST_ABORTED");
}

async function readBoundedBody(response, counters, maxBytes, readerRef, assertActive) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("EMPTY_HTTP_BODY");
  readerRef.reader = reader;
  const chunks = [];
  let length = 0;
  for (;;) {
    assertActive();
    const { done, value } = await reader.read();
    assertActive();
    if (done) break;
    length += value.byteLength;
    counters.bytes += value.byteLength;
    if (length > SPOT_PAPER_PILOT_LIMITS.maxResponseBytes ||
        counters.bytes > maxBytes) {
      try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
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
  const body = Buffer.concat(chunks, length);
  reader.releaseLock();
  readerRef.reader = null;
  return body;
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
    const clock = runtime.monotonicNow ?? monotonicNow;
    const startedMono = clock();
    const runDeadline = runtime.deadlineAt ?? deadlineAt ?? Infinity;
    if (!Number.isFinite(startedMono) || startedMono < 0 || startedMono >= runDeadline) {
      throw new Error("REQUEST_TIMEOUT");
    }
    if (runtime.signal?.aborted || signal?.aborted) {
      throw new Error("REQUEST_ABORTED");
    }
    if (counters.requests >= maxRequests) throw new Error("REQUEST_BUDGET_EXHAUSTED");
    const requestStartedAt = now();
    if (!Number.isSafeInteger(requestStartedAt) || requestStartedAt < 0) {
      throw new Error("INVALID_CLOCK");
    }
    counters.requests++;
    const url = new URL(path, API_ORIGIN);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const effectiveDeadline = Math.min(
      runDeadline,
      startedMono + requestTimeoutMs
    );
    const parentSignals = [signal, runtime.signal].filter(Boolean);
    const controller = new AbortController();
    const remaining = effectiveDeadline - startedMono;
    if (!Number.isFinite(remaining) || remaining <= 0 ||
        parentSignals.some(parent => parent.aborted)) {
      throw parentSignals.some(parent => parent.aborted) ?
        abortError(parentSignals.find(parent => parent.aborted)) : new Error("REQUEST_TIMEOUT");
    }
    const cancelFromParent = () => controller.abort(
      parentSignals.find(item => item.aborted)?.reason ?? new Error("REQUEST_ABORTED"));
    for (const parent of parentSignals) {
      if (parent.aborted) cancelFromParent();
      else parent.addEventListener("abort", cancelFromParent, { once: true });
    }
    let response = null;
    const readerRef = { reader: null };
    let timedOut = false;
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
      if (controller.signal.aborted) throw abortError(controller.signal);
      if (clock() >= effectiveDeadline) throw new Error("REQUEST_TIMEOUT");
    };
    const work = (async () => {
      assertActive();
      response = await fetchImpl(url, {
        method: "GET", headers: { accept: "application/json" },
        redirect: "error", signal: controller.signal
      });
      if (controller.signal.aborted) {
        cleanupResponse(response);
        throw abortError(controller.signal);
      }
      assertActive();
      if (!response.ok) {
        if (response.body) {
          await readBoundedBody(
            response, counters, maxBytes, readerRef, assertActive);
        }
        if (response.status === 429) throw new Error("HTTP_429");
        throw new Error(`HTTP_${response.status}`);
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
        throw new Error("INVALID_CONTENT_TYPE");
      }
      const rawBytes = await readBoundedBody(
        response, counters, maxBytes, readerRef, assertActive);
      const receivedAt = now();
      if (!Number.isSafeInteger(receivedAt) || receivedAt < requestStartedAt) {
        throw new Error("CLOCK_MOVED_BACKWARDS");
      }
      assertActive();
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error("INVALID_JSON_RESPONSE");
      }
      assertActive();
      return {
        data, raw, sha256: createHash("sha256").update(rawBytes).digest("hex"),
        bytes: rawBytes.byteLength, requestStartedAt, receivedAt
      };
    })();
    work.then(() => {
      if (completed) cleanupResponse(response);
    }, () => {});
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error("REQUEST_TIMEOUT"));
        cleanupResponse(response);
        reject(new Error("REQUEST_TIMEOUT"));
      }, remaining);
    });
    try {
      const result = await Promise.race([
        work,
        timeout,
        new Promise((_, reject) => {
          abortListener = () =>
            reject(controller.signal.reason ?? new Error("REQUEST_ABORTED"));
          if (controller.signal.aborted) abortListener();
          else controller.signal.addEventListener("abort", abortListener, { once: true });
        })
      ]);
      if (controller.signal.aborted || clock() >= effectiveDeadline) {
        cleanupResponse(response);
        throw controller.signal.aborted ? abortError(controller.signal) :
          new Error("REQUEST_TIMEOUT");
      }
      completed = true;
      return result;
    } finally {
      clearTimeout(timer);
      if (abortListener) controller.signal.removeEventListener("abort", abortListener);
      for (const parent of parentSignals) parent.removeEventListener("abort", cancelFromParent);
      if (!completed) cleanupResponse(response);
    }
  }

  return Object.freeze({
    fetchOhlc: runtime => get("/0/public/OHLC", { pair: "XBTEUR", interval: "1" }, runtime),
    fetchTicker: runtime => get("/0/public/Ticker", { pair: "XBTEUR" }, runtime),
    counters: () => ({ ...counters })
  });
}
