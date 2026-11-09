import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendUsdAccountEvent, createUsdAccountJournal, replayUsdAccount
} from "../scripts/paper-capital-challenge/account.mjs";
import { USD_MODELED_COSTS } from "../scripts/paper-capital-challenge/account-contract.mjs";
import {
  UsdAccountJournalStore
} from "../scripts/paper-capital-challenge/account-store.mjs";
import { runUsdOfflineStream } from "../scripts/paper-capital-challenge/offline-runner.mjs";
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

function longOhlcAt(timestampMs) {
  const lastClosedMinute = Math.floor((timestampMs - 60_000) / 60_000) * 60;
  const firstMinute = lastClosedMinute - 719 * 60;
  const rows = Array.from({ length: 720 }, (_, index) =>
    [firstMinute + index * 60, "42000.12345678", "44000.12345678",
      "41000.12345678", "43000.12345678", "43000.12345678", "1.23456789", 123]);
  return { error: [], result: { XXBTZUSD: rows, last: lastClosedMinute } };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" }
  });
}

function paddedResponse(value, padding = 120_000) {
  return new Response(`${JSON.stringify(value)}${" ".repeat(padding)}`, {
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
  assert.equal(USD_PAPER_FEED_LIMITS.maxQuoteAgeMs, POLICY.maxValuationAgeMs);
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

test("two feed observations resume through the actual store and runner using the retained tip", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "usd-feed-runner-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = path.join(parent, "account");
  let current = RECEIVED_AT;
  const feedProvider = createKrakenUsdPublicFeed({
    now: () => current,
    monotonicNow: () => 1,
    fetchImpl: async url => url.pathname.endsWith("/Ticker") ?
      jsonResponse(ticker()) : jsonResponse(ohlcAt(current))
  });
  let store = await UsdAccountJournalStore.createNew(directory, { binding: BINDING });
  const firstObservation = await feedProvider.fetchObservation();
  let decisionCalls = 0;
  const decide = () => {
    decisionCalls++;
    return { action: "HOLD", quantityBtc: null, reason: null };
  };
  const firstRun = await runUsdOfflineStream({
    store, observations: [firstObservation], decide
  });
  const independentlyRetainedTip = structuredClone(firstRun.tip);
  assert.equal(firstRun.replay.entries.length, 1);
  assert.equal(decisionCalls, 1);
  await store.close();

  current += USD_PAPER_FEED_LIMITS.minSampleIntervalMs;
  const secondObservation = await feedProvider.fetchObservation();
  store = await UsdAccountJournalStore.reopenExisting(directory, {
    binding: BINDING, expectedTip: independentlyRetainedTip
  });
  let resumedDecisionCalls = 0;
  const resumed = await runUsdOfflineStream({
    store,
    observations: [firstObservation, secondObservation],
    decide(context) {
      resumedDecisionCalls++;
      return decide(context);
    }
  });
  assert.equal(resumedDecisionCalls, 1);
  assert.equal(resumed.replay.entries.length, 2);
  assert.deepEqual(resumed.replay.entries.map(entry => entry.event.id), [
    firstObservation.id, secondObservation.id
  ]);
  assert.deepEqual(resumed.replay.entries[1].event.quote, secondObservation.quote);
  const finalTip = structuredClone(resumed.tip);
  await store.close();

  store = await UsdAccountJournalStore.reopenExisting(directory, {
    binding: BINDING, expectedTip: finalTip
  });
  assert.equal(store.replay.entries.length, 2);
  assert.deepEqual(store.tip, finalTip);
  await store.close();
});

test("720-row synthetic history fixture fits the bounded response size and admits a quote", async () => {
  const history = longOhlcAt(RECEIVED_AT);
  const rawBytes = Buffer.byteLength(JSON.stringify(history));
  assert.equal(rawBytes, 82_854);
  assert.ok(rawBytes < USD_PAPER_FEED_LIMITS.maxResponseBytes);
  const provider = createKrakenUsdPublicFeed({
    now: () => RECEIVED_AT,
    monotonicNow: () => 1,
    fetchImpl: async url => url.pathname.endsWith("/Ticker") ?
      jsonResponse(ticker()) : jsonResponse(history)
  });
  const sample = await provider.fetchObservation();
  assert.equal(sample.quote.marketPair, "BTC/USD");
  assert.equal(provider.counters().bytes, rawBytes + Buffer.byteLength(JSON.stringify(ticker())));
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

test("single-flight guard rejects concurrent calls, including a transport that ignores abort", async () => {
  let fetches = 0;
  let started;
  const requestStarted = new Promise(resolve => { started = resolve; });
  const provider = createKrakenUsdPublicFeed({
    now: () => RECEIVED_AT,
    monotonicNow: () => 1,
    requestTimeoutMs: 10,
    fetchImpl: async () => {
      fetches++;
      started();
      return new Promise(() => {});
    }
  });
  const first = provider.fetchObservation();
  await requestStarted;
  await assert.rejects(provider.fetchObservation(), /SAMPLE_ALREADY_IN_FLIGHT/);
  assert.equal(fetches, 1);
  await assert.rejects(first, /REQUEST_TIMEOUT/);
  await assert.rejects(provider.fetchObservation(), /FEED_TERMINAL_FAILURE/);
  assert.equal(fetches, 1);
});

test("attempt cadence and terminal failures stop rapid repeated transport attempts", async () => {
  let now = RECEIVED_AT;
  let fetches = 0;
  const failed = createKrakenUsdPublicFeed({
    now: () => now,
    monotonicNow: () => 1,
    fetchImpl: async () => {
      fetches++;
      throw new Error("FIXTURE_TRANSPORT_ERROR");
    }
  });
  await assert.rejects(failed.fetchObservation(), /FIXTURE_TRANSPORT_ERROR/);
  now += 1;
  await assert.rejects(failed.fetchObservation(), /FEED_TERMINAL_FAILURE/);
  assert.equal(fetches, 1);

  let goodFetches = 0;
  const sampled = createKrakenUsdPublicFeed({
    now: () => now,
    monotonicNow: () => 1,
    fetchImpl: async url => {
      goodFetches++;
      return url.pathname.endsWith("/Ticker") ? jsonResponse(ticker()) :
        jsonResponse(ohlcAt(now));
    }
  });
  await sampled.fetchObservation();
  await assert.rejects(sampled.fetchObservation(), /SAMPLE_INTERVAL_TOO_SHORT/);
  assert.equal(goodFetches, 2);
});

test("event, span and response-byte ceilings are preflighted or latched before another request", async () => {
  assert.equal(USD_PAPER_FEED_LIMITS.maxEvents, 256);
  assert.equal(USD_PAPER_FEED_LIMITS.maxRequests, 512);
  assert.equal(USD_PAPER_FEED_LIMITS.maxBytes, 32 * 1024 * 1024);
  assert.equal(USD_PAPER_FEED_LIMITS.maxSpanMs, 24 * 60 * 60 * 1000);

  let current = RECEIVED_AT;
  let eventFetches = 0;
  const bounded = createKrakenUsdPublicFeed({
    now: () => current,
    monotonicNow: () => 1,
    fetchImpl: async url => {
      eventFetches++;
      return url.pathname.endsWith("/Ticker") ?
        jsonResponse(ticker()) : jsonResponse(ohlcAt(current));
    }
  });
  for (let event = 0; event < USD_PAPER_FEED_LIMITS.maxEvents; event++) {
    await bounded.fetchObservation();
    current += USD_PAPER_FEED_LIMITS.minSampleIntervalMs;
  }
  await assert.rejects(bounded.fetchObservation(), /EVENT_LIMIT_REACHED/);
  await assert.rejects(bounded.fetchObservation(), /FEED_TERMINAL_FAILURE/);
  assert.equal(eventFetches, USD_PAPER_FEED_LIMITS.maxRequests);
  assert.equal(bounded.counters().events, USD_PAPER_FEED_LIMITS.maxEvents);
  assert.equal(bounded.counters().requests, USD_PAPER_FEED_LIMITS.maxRequests);

  current = RECEIVED_AT;
  let spanFetches = 0;
  const spanBounded = createKrakenUsdPublicFeed({
    now: () => current,
    monotonicNow: () => 1,
    fetchImpl: async url => {
      spanFetches++;
      return url.pathname.endsWith("/Ticker") ?
        jsonResponse(ticker()) : jsonResponse(ohlcAt(current));
    }
  });
  await spanBounded.fetchObservation();
  const spanFetchesBeforeExpiry = spanFetches;
  current += USD_PAPER_FEED_LIMITS.maxSpanMs + 1;
  await assert.rejects(spanBounded.fetchObservation(), /OBSERVATION_WINDOW_LIMIT_REACHED/);
  await assert.rejects(spanBounded.fetchObservation(), /FEED_TERMINAL_FAILURE/);
  assert.equal(spanFetches, spanFetchesBeforeExpiry);

  current = RECEIVED_AT;
  let oversizedFetches = 0;
  const byteBounded = createKrakenUsdPublicFeed({
    now: () => current,
    monotonicNow: () => 1,
    fetchImpl: async url => {
      oversizedFetches++;
      return url.pathname.endsWith("/Ticker") ?
        jsonResponse(ticker()) : paddedResponse(ohlcAt(current), 140_000);
    }
  });
  await assert.rejects(byteBounded.fetchObservation(), /RESPONSE_BYTE_LIMIT/);
  await assert.rejects(byteBounded.fetchObservation(), /FEED_TERMINAL_FAILURE/);
  assert.equal(oversizedFetches, 2);
  assert.equal(byteBounded.counters().requests, 2);

  current = RECEIVED_AT;
  let cumulativeFetches = 0;
  const cumulativeBounded = createKrakenUsdPublicFeed({
    now: () => current,
    monotonicNow: () => 1,
    fetchImpl: async url => {
      cumulativeFetches++;
      return url.pathname.endsWith("/Ticker") ?
        paddedResponse(ticker()) : paddedResponse(ohlcAt(current));
    }
  });
  for (;;) {
    try {
      await cumulativeBounded.fetchObservation();
      current += USD_PAPER_FEED_LIMITS.minSampleIntervalMs;
    } catch (error) {
      assert.match(error.message, /RUN_BYTE_BUDGET_EXHAUSTED/);
      break;
    }
  }
  const fetchesAtExhaustion = cumulativeFetches;
  await assert.rejects(cumulativeBounded.fetchObservation(), /FEED_TERMINAL_FAILURE/);
  assert.equal(cumulativeFetches, fetchesAtExhaustion);
  assert.ok(cumulativeBounded.counters().bytes + 2 * USD_PAPER_FEED_LIMITS.maxResponseBytes >
    USD_PAPER_FEED_LIMITS.maxBytes);
});
