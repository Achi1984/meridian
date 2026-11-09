import test from "node:test";
import assert from "node:assert/strict";
import {
  appendUsdAccountEvent, createUsdAccountJournal, replayUsdAccount
} from "../scripts/paper-capital-challenge/account.mjs";
import { USD_MODELED_COSTS } from "../scripts/paper-capital-challenge/account-contract.mjs";
import { PAPER_CAPITAL_CHALLENGE_POLICY as POLICY } from "../scripts/paper-capital-challenge/policy.mjs";
import {
  createKrakenUsdPublicFeed, USD_PAPER_FEED_LIMITS
} from "../scripts/usd-paper-feed/kraken-public.mjs";

// Provider-shaped fixtures below are synthetic; no provider request is made.
const BASE = Date.UTC(2025, 0, 1);
const RECEIVED_AT = BASE + 125_000;
const BINDING = {
  campaignId: POLICY.campaignId,
  currency: "USD",
  strategyVersion: "synthetic-usd-feed-test-v1",
  costVersion: USD_MODELED_COSTS.version
};

function ticker(pair = "XXBTZUSD") {
  return {
    error: [],
    result: {
      [pair]: {
        a: ["43000.12345678", "1", "1.23456789"],
        b: ["43000.12345677", "1", "1.23456789"],
        c: ["43000.12345677", "0.1"]
      }
    }
  };
}

function candle(timestamp, close = "43000") {
  return [timestamp, "42000", "44000", "41000", close, "43000", "1.25", 4];
}

function ohlc({ rows = [candle(60), candle(120)], pair = "XXBTZUSD" } = {}) {
  const epochRows = rows.map(row => [row[0] + BASE / 1000, ...row.slice(1)]);
  return {
    error: [],
    result: { [pair]: epochRows, last: epochRows.at(-1)?.[0] ?? 0 }
  };
}

function ohlcAt(timestampMs) {
  const minute = Math.floor(timestampMs / 60_000) * 60;
  const rows = [candle(minute - 60), candle(minute)];
  return { error: [], result: { XXBTZUSD: rows, last: minute } };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" }
  });
}

function paddedResponse(value) {
  return new Response(`${JSON.stringify(value)}${" ".repeat(60_000)}`, {
    headers: { "content-type": "application/json" }
  });
}

function fixtureFetch({ tickerData = ticker(), ohlcData = ohlc(), onRequest } = {}) {
  return async (url, options) => {
    onRequest?.(url, options);
    if (url.pathname.endsWith("/Ticker")) return jsonResponse(tickerData);
    if (url.pathname.endsWith("/OHLC")) return jsonResponse(ohlcData);
    throw new Error("UNEXPECTED_FIXTURE_ENDPOINT");
  };
}

function feed(options = {}) {
  return createKrakenUsdPublicFeed({
    now: () => RECEIVED_AT,
    monotonicNow: () => 1,
    fetchImpl: fixtureFetch(),
    ...options
  });
}

test("construction is inert and one native USD sample emits the offline-runner shape", async () => {
  let fetches = 0;
  let clockReads = 0;
  const provider = createKrakenUsdPublicFeed({
    now: () => { clockReads++; return RECEIVED_AT; },
    fetchImpl: async () => { fetches++; return jsonResponse(ticker()); }
  });
  assert.deepEqual(provider.counters(), { requests: 0, bytes: 0, events: 0 });
  assert.equal(fetches, 0);
  assert.equal(clockReads, 0);

  const requests = [];
  const sample = await createKrakenUsdPublicFeed({
    now: () => RECEIVED_AT,
    monotonicNow: () => 1,
    fetchImpl: fixtureFetch({
      onRequest(url, options) {
        requests.push({ url, options });
      }
    })
  }).fetchObservation();

  assert.deepEqual(Object.keys(sample).sort(), ["id", "observedAtMs", "quote"]);
  assert.equal(sample.observedAtMs, RECEIVED_AT);
  assert.equal(sample.quote.schemaVersion, "NATIVE_BTC_USD_QUOTE_V1");
  assert.equal(sample.quote.marketPair, "BTC/USD");
  assert.equal(sample.quote.baseCurrency, "BTC");
  assert.equal(sample.quote.quoteCurrency, "USD");
  assert.equal(sample.quote.nativeInstrument, "BTC/USD");
  assert.equal(sample.quote.evidenceKind, "OFFLINE_CALLER_ASSERTION");
  assert.equal(sample.quote.bid, "43000.12345677");
  assert.equal(sample.quote.ask, "43000.12345678");
  assert.equal(sample.quote.quotedAtMs, sample.quote.receivedAtMs);
  assert.equal(sample.quote.receivedAtMs, RECEIVED_AT);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.origin, "https://api.kraken.com");
  assert.equal(requests[0].url.pathname, "/0/public/Ticker");
  assert.equal(requests[0].url.searchParams.get("pair"), "XBTUSD");
  assert.equal(requests[1].url.pathname, "/0/public/OHLC");
  assert.equal(requests[1].url.searchParams.get("pair"), "XBTUSD");
  assert.equal(requests[1].url.searchParams.get("interval"), "1");
  for (const { options } of requests) {
    assert.equal(options.method, "GET");
    assert.equal(options.headers.accept, "application/json");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(Object.hasOwn(options.headers, "authorization"), false);
  }
});

test("valid provider-shaped quote replays through the actual USD account and valuation modules", async () => {
  const sample = await feed().fetchObservation();
  const journal = createUsdAccountJournal(BINDING);
  const event = {
    id: sample.id, ...BINDING, observedAtMs: sample.observedAtMs,
    action: "HOLD", quote: sample.quote,
    quantityBtc: null, feeCents: 0, reason: null
  };
  const replay = replayUsdAccount(appendUsdAccountEvent(journal, event));
  assert.equal(replay.entries.length, 1);
  assert.equal(replay.entries[0].event.quote.bid, "43000.12345677");
  assert.equal(replay.entries[0].observation.valuation.marketPair, "BTC/USD");
  assert.equal(replay.entries[0].observation.valuation.currency, "USD");
  assert.equal(replay.entries[0].observation.netEquityCents, POLICY.initialCapitalCents);
  assert.equal(replay.authorization.executionAuthorized, false);
});

test("wrong provider pair identities are rejected for ticker and OHLC", async () => {
  await assert.rejects(
    createKrakenUsdPublicFeed({
      now: () => RECEIVED_AT, monotonicNow: () => 1,
      fetchImpl: fixtureFetch({ tickerData: ticker("XXBTZEUR") })
    }).fetchObservation(),
    /UNEXPECTED_TICKER_PAIR/
  );
  await assert.rejects(
    createKrakenUsdPublicFeed({
      now: () => RECEIVED_AT, monotonicNow: () => 1,
      fetchImpl: fixtureFetch({ ohlcData: ohlc({ pair: "XXBTZEUR" }) })
    }).fetchObservation(),
    /UNEXPECTED_OHLC_PAIR/
  );
});

test("stale quotes and future or unclosed minute data fail closed", async () => {
  let current = RECEIVED_AT;
  const staleFeed = createKrakenUsdPublicFeed({
    now: () => current,
    monotonicNow: () => 1,
    fetchImpl: fixtureFetch({
      onRequest(url) {
        if (url.pathname.endsWith("/OHLC")) current += USD_PAPER_FEED_LIMITS.maxQuoteAgeMs + 1;
      }
    })
  });
  await assert.rejects(staleFeed.fetchObservation(), /STALE_OR_FUTURE_QUOTE/);

  await assert.rejects(
    createKrakenUsdPublicFeed({
      now: () => RECEIVED_AT, monotonicNow: () => 1,
      fetchImpl: fixtureFetch({ ohlcData: ohlc({ rows: [candle(180)] }) })
    }).fetchObservation(),
    /INVALID_OHLC_TIMESTAMP/
  );
  await assert.rejects(
    createKrakenUsdPublicFeed({
      now: () => BASE + 120_500, monotonicNow: () => 1,
      fetchImpl: fixtureFetch({ ohlcData: ohlc({ rows: [candle(120)] }) })
    }).fetchObservation(),
    /NO_CLOSED_MINUTE/
  );
});

test("malformed JSON and oversized responses are rejected", async () => {
  const malformed = new Response("{", { headers: { "content-type": "application/json" } });
  await assert.rejects(
    createKrakenUsdPublicFeed({
      now: () => RECEIVED_AT, monotonicNow: () => 1,
      fetchImpl: async () => malformed
    }).fetchObservation(),
    /INVALID_JSON_RESPONSE/
  );

  const oversized = new Response(" ".repeat(USD_PAPER_FEED_LIMITS.maxResponseBytes + 1), {
    headers: { "content-type": "application/json" }
  });
  await assert.rejects(
    createKrakenUsdPublicFeed({
      now: () => RECEIVED_AT, monotonicNow: () => 1,
      fetchImpl: async () => oversized
    }).fetchObservation(),
    /RESPONSE_BYTE_LIMIT/
  );
});

test("requests time out and parent abort is propagated", async () => {
  let timedOutSignal;
  const timedOut = createKrakenUsdPublicFeed({
    now: () => RECEIVED_AT,
    monotonicNow: () => 1,
    requestTimeoutMs: 5,
    fetchImpl: async (_url, options) => {
      timedOutSignal = options.signal;
      return new Promise(() => {});
    }
  });
  await assert.rejects(timedOut.fetchObservation(), /REQUEST_TIMEOUT/);
  assert.equal(timedOutSignal.aborted, true);

  const controller = new AbortController();
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const aborted = createKrakenUsdPublicFeed({
    now: () => RECEIVED_AT,
    monotonicNow: () => 1,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      signalStarted();
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    })
  });
  const pending = aborted.fetchObservation({ signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, /REQUEST_ABORTED/);
});

test("request count, event count, bytes and span stay within the USD lane limits", async () => {
  assert.equal(USD_PAPER_FEED_LIMITS.maxEvents, 256);
  assert.equal(USD_PAPER_FEED_LIMITS.maxRequests, 512);
  assert.equal(USD_PAPER_FEED_LIMITS.maxBytes, 512 * 1024);
  assert.equal(USD_PAPER_FEED_LIMITS.maxSpanMs, 24 * 60 * 60 * 1000);
  const limited = createKrakenUsdPublicFeed({
    now: () => RECEIVED_AT,
    monotonicNow: () => 1,
    fetchImpl: async () => { throw new Error("FIXTURE_TRANSPORT_ERROR"); },
    requestTimeoutMs: 1_000
  });
  for (let request = 0; request < USD_PAPER_FEED_LIMITS.maxRequests; request++) {
    await assert.rejects(limited.fetchObservation(), /FIXTURE_TRANSPORT_ERROR/);
  }
  await assert.rejects(limited.fetchObservation(), /REQUEST_BUDGET_EXHAUSTED/);
  assert.equal(limited.counters().requests, USD_PAPER_FEED_LIMITS.maxRequests);
  assert.ok(limited.counters().bytes <= USD_PAPER_FEED_LIMITS.maxBytes);

  let current = RECEIVED_AT;
  const bounded = createKrakenUsdPublicFeed({
    now: () => current,
    monotonicNow: () => 1,
    fetchImpl: async url => url.pathname.endsWith("/Ticker") ?
      jsonResponse(ticker()) : jsonResponse(ohlcAt(current))
  });
  for (let event = 0; event < USD_PAPER_FEED_LIMITS.maxEvents; event++) {
    await bounded.fetchObservation();
    current += USD_PAPER_FEED_LIMITS.minSampleIntervalMs;
  }
  await assert.rejects(bounded.fetchObservation(), /EVENT_LIMIT_REACHED/);
  assert.equal(bounded.counters().events, USD_PAPER_FEED_LIMITS.maxEvents);
  assert.equal(bounded.counters().requests, USD_PAPER_FEED_LIMITS.maxRequests);

  current = RECEIVED_AT;
  const spanBounded = createKrakenUsdPublicFeed({
    now: () => current,
    monotonicNow: () => 1,
    fetchImpl: async url => url.pathname.endsWith("/Ticker") ?
      jsonResponse(ticker()) : jsonResponse(ohlcAt(current))
  });
  await spanBounded.fetchObservation();
  current += USD_PAPER_FEED_LIMITS.maxSpanMs + 1;
  await assert.rejects(spanBounded.fetchObservation(), /OBSERVATION_WINDOW_LIMIT_REACHED/);

  current = RECEIVED_AT;
  const byteBounded = createKrakenUsdPublicFeed({
    now: () => current,
    monotonicNow: () => 1,
    fetchImpl: async url => url.pathname.endsWith("/Ticker") ?
      paddedResponse(ticker()) : paddedResponse(ohlcAt(current))
  });
  for (let event = 0; event < 4; event++) {
    await byteBounded.fetchObservation();
    current += USD_PAPER_FEED_LIMITS.minSampleIntervalMs;
  }
  await assert.rejects(byteBounded.fetchObservation(), /RUN_BYTE_LIMIT/);
});
