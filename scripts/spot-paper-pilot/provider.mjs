import { createHash } from "node:crypto";
import { SPOT_PAPER_PILOT_LIMITS } from "./core.mjs";

const API_ORIGIN = "https://api.kraken.com";

async function readBoundedBody(response, counters, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("EMPTY_HTTP_BODY");
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    counters.bytes += value.byteLength;
    if (length > SPOT_PAPER_PILOT_LIMITS.maxResponseBytes ||
        counters.bytes > maxBytes) {
      await reader.cancel().catch(() => {});
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
  maxRequests = SPOT_PAPER_PILOT_LIMITS.maxRequests,
  maxBytes = SPOT_PAPER_PILOT_LIMITS.maxBytes,
  requestTimeoutMs = SPOT_PAPER_PILOT_LIMITS.requestTimeoutMs
} = {}) {
  if (typeof fetchImpl !== "function" || typeof now !== "function") {
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

  async function get(path, params) {
    if (counters.requests >= maxRequests) throw new Error("REQUEST_BUDGET_EXHAUSTED");
    counters.requests++;
    const requestStartedAt = now();
    if (!Number.isSafeInteger(requestStartedAt) || requestStartedAt < 0) {
      throw new Error("INVALID_CLOCK");
    }
    const url = new URL(path, API_ORIGIN);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetchImpl(url, {
      method: "GET", headers: { accept: "application/json" },
      redirect: "error", signal: requestSignal
    });
    if (!response.ok) {
      if (response.body) await readBoundedBody(response, counters, maxBytes);
      if (response.status === 429) throw new Error("HTTP_429");
      throw new Error(`HTTP_${response.status}`);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
      throw new Error("INVALID_CONTENT_TYPE");
    }
    const rawBytes = await readBoundedBody(response, counters, maxBytes);
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
  }

  return Object.freeze({
    fetchOhlc: () => get("/0/public/OHLC", { pair: "XBTEUR", interval: "1" }),
    fetchTicker: () => get("/0/public/Ticker", { pair: "XBTEUR" }),
    counters: () => ({ ...counters })
  });
}
