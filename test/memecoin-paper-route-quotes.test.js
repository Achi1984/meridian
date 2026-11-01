import assert from "node:assert/strict";
import test from "node:test";
import {createJupiterV2QuoteAdapter} from "../scripts/memecoin-paper-route-quotes/jupiter-v2.mjs";
import {
  SYNTHETIC_MINT,
  SYNTHETIC_POOL,
  SYNTHETIC_QUOTE
} from "../scripts/memecoin-paper/synthetic-fixtures.mjs";
import {syntheticOrderResponse} from "./fixtures/memecoin-paper-route-quotes/jupiter-v2-order.mjs";

const NOW = Date.parse("2026-11-01T18:00:00Z");
const IDENTITY = Object.freeze({
  chainId: "solana",
  mint: SYNTHETIC_MINT,
  pool: SYNTHETIC_POOL,
  quote: SYNTHETIC_QUOTE,
  decimals: 6
});

function request(overrides = {}) {
  return {
    identity: IDENTITY,
    inputMint: SYNTHETIC_MINT,
    outputMint: SYNTHETIC_QUOTE,
    inputDecimals: 6,
    outputDecimals: 6,
    amount: "100000000",
    slippageBps: 50,
    candidateSampledAt: NOW - 2_000,
    authorizedAt: NOW - 1_000,
    ...overrides
  };
}

function response(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {"content-type": "application/json", ...headers}
  });
}

function adapterFor(body, options = {}) {
  const calls = [];
  const adapter = createJupiterV2QuoteAdapter({
    enabled: true,
    clock: () => NOW,
    transport: async (url, init) => {
      calls.push({url, init});
      return typeof body === "function" ? body(url, init) : response(body);
    },
    ...options
  });
  return {adapter, calls};
}

test("disabled adapter is inert and needs no transport or clock", async () => {
  const disabled = createJupiterV2QuoteAdapter();
  assert.deepEqual(await disabled.getQuote(), {
    status: "DISABLED",
    reasons: ["ADAPTER_DISABLED"],
    route: null,
    costEvidence: {
      status: "UNAVAILABLE",
      components: Object.fromEntries(
        ["fee", "spread", "slippage", "priceImpact", "network"].map(name => [
          name,
          {
            status: "UNKNOWN",
            amount: null,
            denomination: null,
            reason: "EXACT_NONOVERLAPPING_USD_COST_NOT_SOURCE_VERIFIED"
          }
        ])
      ),
      doubleCountingPolicy: "Do not add quote output, min-out, feeBps, priceImpact, or lamport estimates as separate USD costs."
    },
    authorizationEligible: false
  });
});

test("quote-only request uses the fixed V2 order route with bounded credential-free options", async () => {
  const fixture = syntheticOrderResponse();
  const {adapter, calls} = adapterFor(fixture.body);
  const result = await adapter.getQuote(request());

  assert.equal(fixture.fixtureLabel, "SYNTHETIC_FIXTURE_ONLY");
  assert.equal(fixture.schemaVersion, "2.0.0");
  assert.equal(calls.length, 1);
  const call = calls[0];
  const url = new URL(call.url);
  assert.equal(url.origin, "https://api.jup.ag");
  assert.equal(url.pathname, "/swap/v2/order");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    inputMint: SYNTHETIC_MINT,
    outputMint: SYNTHETIC_QUOTE,
    amount: "100000000",
    swapMode: "ExactIn",
    slippageBps: "50"
  });
  assert.equal(call.init.method, "GET");
  assert.equal(call.init.redirect, "error");
  assert.equal(call.init.credentials, "omit");
  assert.equal(call.init.referrerPolicy, "no-referrer");
  assert.deepEqual({...call.init.headers}, {accept: "application/json"});
  assert.equal(url.searchParams.has("taker"), false);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.route.inAmount, request().amount);
  assert.equal(result.route.minOutAmount, "16972172");
  assert.equal(result.route.slippageBps, 50);
  assert.equal(result.route.priceImpact.field, "priceImpact");
  assert.equal(result.route.observedAt, NOW);
  assert.equal(result.route.expiresAt, NOW + 15_000);
  assert.equal(result.route.expirySource, "LOCAL_POLICY_ONLY");
  assert.deepEqual(result.routeBinding, {
    status: "SINGLE_POOL_MATCH",
    selectedPool: SYNTHETIC_POOL,
    observedPools: [SYNTHETIC_POOL]
  });
  assert.equal(result.sourceProvenance, "INJECTED_TRANSPORT_NOT_AUTHENTICATED");
  assert.equal(result.authorizationEligible, false);
  assert.equal(result.normalization.status, "UNAVAILABLE");
  assert.equal(result.normalization.authorizationEligible, false);
  assert.equal(result.route.executable, undefined);
  assert.equal(result.costEvidence.status, "UNAVAILABLE");
  for (const component of Object.values(result.costEvidence.components)) {
    assert.equal(component.status, "UNKNOWN");
    assert.equal(component.amount, null);
  }
});

test("multi-leg routes are explicitly unbound and cannot claim the selected pool", async () => {
  const fixture = syntheticOrderResponse();
  const first = fixture.body.routePlan[0];
  const second = {
    swapInfo: {
      ...first.swapInfo,
      ammKey: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
      inputMint: SYNTHETIC_MINT,
      outputMint: SYNTHETIC_QUOTE
    },
    percent: 50,
    bps: 5_000
  };
  const {adapter} = adapterFor({...fixture.body, routePlan: [first, second]});
  const result = await adapter.getQuote(request());
  assert.equal(result.routeBinding.status, "MULTI_LEG_UNBOUND");
  assert.ok(result.reasons.includes("MULTI_LEG_ROUTE_NOT_FIXED_POOL"));
  assert.notEqual(result.routeBinding.status, "SINGLE_POOL_MATCH");
  assert.equal(result.authorizationEligible, false);
});

test("future chronology, expired provider quote, and mismatched mint fail closed", async () => {
  let called = false;
  const future = createJupiterV2QuoteAdapter({
    enabled: true,
    clock: () => NOW,
    transport: async () => { called = true; return response({}); }
  });
  assert.ok((await future.getQuote(request({candidateSampledAt: NOW + 1})))
    .reasons.includes("REQUEST_CHRONOLOGY_INVALID"));
  assert.equal(called, false);

  const expired = syntheticOrderResponse({
    router: "jupiterz",
    expireAt: String(Math.floor((NOW - 1_000) / 1_000))
  });
  const expiredResult = await adapterFor(expired.body).adapter.getQuote(request());
  assert.ok(expiredResult.reasons.includes("PROVIDER_QUOTE_EXPIRED"));

  const mismatched = syntheticOrderResponse({
    inputMint: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE"
  });
  const mismatchResult = await adapterFor(mismatched.body).adapter.getQuote(request());
  assert.ok(mismatchResult.reasons.includes("RESPONSE_MINT_MISMATCH"));
});

test("oversized base-unit integers are rejected without rounding", async () => {
  let requests = 0;
  const adapter = createJupiterV2QuoteAdapter({
    enabled: true,
    clock: () => NOW,
    transport: async () => { requests += 1; return response({}); }
  });
  const tooLarge = "9".repeat(41);
  assert.ok((await adapter.getQuote(request({amount: tooLarge})))
    .reasons.includes("REQUEST_AMOUNT_INVALID"));
  assert.equal(requests, 0);

  const hugeResponse = syntheticOrderResponse({outAmount: tooLarge, otherAmountThreshold: "1"});
  const result = await adapterFor(hugeResponse.body).adapter.getQuote(request());
  assert.ok(result.reasons.includes("RESPONSE_AMOUNT_INVALID"));
});

test("malformed, truncated, and over-cap responses are rejected", async () => {
  const malformed = await adapterFor(() =>
    new Response("{", {headers: {"content-type": "application/json"}})
  ).adapter.getQuote(request());
  assert.ok(malformed.reasons.includes("RESPONSE_JSON_INVALID"));

  const truncated = await adapterFor(() =>
    new Response('{"inputMint":', {headers: {"content-type": "application/json"}})
  ).adapter.getQuote(request());
  assert.ok(truncated.reasons.includes("RESPONSE_JSON_INVALID"));

  const oversizedHeader = await adapterFor(() =>
    new Response("{}", {
      headers: {"content-type": "application/json", "content-length": "262145"}
    })
  ).adapter.getQuote(request());
  assert.ok(oversizedHeader.reasons.includes("RESPONSE_TOO_LARGE"));

  const oversizedBody = await adapterFor(() =>
    new Response(new Uint8Array(262_145), {headers: {"content-type": "application/json"}})
  ).adapter.getQuote(request());
  assert.ok(oversizedBody.reasons.includes("RESPONSE_TOO_LARGE"));
});

test("timeout, redirect, and authentication denial do not retry or follow redirects", async () => {
  let calls = 0;
  const timed = createJupiterV2QuoteAdapter({
    enabled: true,
    clock: () => NOW,
    timeoutMs: 5,
    transport: async (_url, {signal}) => {
      calls += 1;
      await new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), {once: true});
      });
    }
  });
  assert.ok((await timed.getQuote(request())).reasons.includes("REQUEST_TIMEOUT"));
  assert.equal(calls, 1);

  const redirected = await adapterFor(() => ({
    status: 200,
    redirected: true,
    headers: new Headers({"content-type": "application/json"}),
    body: null
  })).adapter.getQuote(request());
  assert.ok(redirected.reasons.includes("REDIRECT_REJECTED"));

  for (const status of [401, 403]) {
    const denied = await adapterFor((_url, _init) => ({
      status,
      headers: new Headers(),
      body: null
    })).adapter.getQuote(request());
    assert.ok(denied.reasons.includes("AUTH_DENIED"));
  }
  assert.equal(calls, 1);
});

test("keyless per-instance request budget blocks a second request inside two seconds", async () => {
  let calls = 0;
  const adapter = createJupiterV2QuoteAdapter({
    enabled: true,
    clock: () => NOW,
    transport: async () => {
      calls += 1;
      return response(syntheticOrderResponse().body);
    }
  });
  await adapter.getQuote(request());
  const limited = await adapter.getQuote(request());
  assert.ok(limited.reasons.includes("KEYLESS_RATE_LIMIT"));
  assert.equal(calls, 1);
});
