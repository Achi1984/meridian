import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {createPaperExecutionStep} from "../scripts/memecoin-paper/execution-step.mjs";
import {CheckpointStore} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {PaperCheckpointSession} from "../scripts/memecoin-paper/checkpoint-session.mjs";
import {createMarketQuoteAdapter} from "../scripts/memecoin-paper/market-quote-adapter.mjs";
import {
  SYNTHETIC_MINT, SYNTHETIC_POOL, SYNTHETIC_QUOTE
} from "../scripts/memecoin-paper/synthetic-fixtures.mjs";
import {END, RUN, START, authorization} from "./fixtures/memecoin-paper-execution-step/scenario.mjs";
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
    side: "ENTRY",
    amountAtoms: "100000000",
    quoteDecimals: 6,
    candidateSampledAt: NOW - 2_000,
    authorizedAt: NOW - 1_000,
    slippageBps: 50,
    ...overrides
  };
}

function response(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {"content-type": "application/json", ...headers}
  });
}

function entryResponse(overrides = {}) {
  return syntheticOrderResponse({
    inputMint: SYNTHETIC_QUOTE,
    outputMint: SYNTHETIC_MINT,
    ...overrides
  });
}

function adapterFor(body, options = {}) {
  const calls = [];
  const adapter = createMarketQuoteAdapter({
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

test("disabled adapter is inert and exposes no executable quote", async () => {
  const result = await createMarketQuoteAdapter().getPaperQuote();
  assert.equal(result.status, "DISABLED");
  assert.equal(result.authorizationEligible, false);
  assert.equal(result.quoteCandidate, null);
  assert.equal(result.costEvidence.status, "UNKNOWN");
});

test("read-only entry quote is identity-bound and uses exact units with a post-response receipt clock", async () => {
  const fixture = entryResponse();
  let clockCalls = 0;
  const {adapter, calls} = adapterFor(fixture.body, {
    clock: () => NOW + clockCalls++ * 75
  });
  const result = await adapter.getPaperQuote(request());

  assert.equal(fixture.fixtureLabel, "SYNTHETIC_FIXTURE_ONLY");
  assert.equal(calls.length, 1);
  const call = calls[0];
  const url = new URL(call.url);
  assert.equal(url.origin, "https://api.jup.ag");
  assert.equal(url.pathname, "/swap/v2/order");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    inputMint: SYNTHETIC_QUOTE,
    outputMint: SYNTHETIC_MINT,
    amount: "100000000",
    swapMode: "ExactIn",
    slippageBps: "50"
  });
  assert.equal(url.searchParams.has("taker"), false);
  assert.equal(call.init.method, "GET");
  assert.equal(call.init.redirect, "error");
  assert.equal(call.init.credentials, "omit");
  assert.equal(call.init.referrerPolicy, "no-referrer");
  assert.deepEqual({...call.init.headers}, {accept: "application/json"});
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.sourceProvenance, "INJECTED_TRANSPORT_NOT_AUTHENTICATED");
  assert.equal(result.request.side, "ENTRY");
  assert.equal(result.request.amountAtoms, "100000000");
  assert.deepEqual(result.quoteCandidate.identity, IDENTITY);
  assert.equal(result.quoteCandidate.side, "ENTRY");
  assert.equal(result.quoteCandidate.amount.mint, SYNTHETIC_QUOTE);
  assert.equal(result.quoteCandidate.amount.decimals, 6);
  assert.deepEqual(result.quoteCandidate.priceQuotePerBase, {
    numerator: "5000000",
    denominator: "852873",
    unit: "quote-token per base-token",
    source: "exact raw inAmount/outAmount and caller-supplied decimals; not a USD price"
  });
  assert.equal(result.quoteCandidate.priceMicros, null);
  assert.equal(result.quoteCandidate.executable, false);
  assert.equal(result.quoteCandidate.sourceTime.status, "NOT_PROVIDED_BY_DOCUMENTED_RESPONSE");
  assert.equal(result.quoteCandidate.receiptTime.observedAt, NOW + 75);
  assert.equal(result.quoteCandidate.causalTime.observedAt, NOW - 1_000);
  assert.equal(result.quoteCandidate.route.binding.status, "SINGLE_POOL_MATCH");
  assert.equal(result.authorizationEligible, false);
  assert.equal(result.costEvidence.status, "UNKNOWN");
  for (const component of Object.values(result.costEvidence.components)) {
    assert.equal(component.status, "UNKNOWN");
    assert.equal(component.amount, null);
  }
  assert.deepEqual(result.costEvidence.reported.platformFee, {
    amount: "100", feeBps: 2, feeMint: SYNTHETIC_MINT
  });
});

test("exit quote binds the position-open time, direction, and raw base amount", async () => {
  const fixture = syntheticOrderResponse({
    inputMint: SYNTHETIC_MINT,
    outputMint: SYNTHETIC_QUOTE,
    inAmount: "1000000",
    outAmount: "5842157",
    otherAmountThreshold: "5812946"
  });
  let clockCalls = 0;
  const {adapter, calls} = adapterFor(fixture.body, {
    clock: () => NOW + clockCalls++ * 50
  });
  const exitRequest = request({
    side: "EXIT",
    amountAtoms: "1000000",
    positionOpenedAt: NOW - 1_000
  });
  delete exitRequest.authorizedAt;
  const result = await adapter.getPaperQuote(exitRequest);
  const url = new URL(calls[0].url);

  assert.equal(url.searchParams.get("inputMint"), SYNTHETIC_MINT);
  assert.equal(url.searchParams.get("outputMint"), SYNTHETIC_QUOTE);
  assert.equal(url.searchParams.get("amount"), "1000000");
  assert.equal(result.quoteCandidate.side, "EXIT");
  assert.equal(result.quoteCandidate.amount.mint, SYNTHETIC_MINT);
  assert.equal(result.quoteCandidate.causalTime.observedAt, NOW - 1_000);
  assert.equal(result.quoteCandidate.receiptTime.observedAt, NOW + 50);
  assert.equal(result.quoteCandidate.route.binding.status, "SINGLE_POOL_MATCH");
  assert.equal(result.authorizationEligible, false);
});

test("identity mismatch and multi-pool routes remain unavailable", async () => {
  const mismatch = syntheticOrderResponse({
    inputMint: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE"
  });
  const mismatchResult = await adapterFor(mismatch.body).adapter.getPaperQuote(request());
  assert.ok(mismatchResult.reasons.includes("RESPONSE_MINT_MISMATCH"));
  assert.equal(mismatchResult.quoteCandidate, null);

  const multiLeg = entryResponse({
    routePlan: [
      ...entryResponse().body.routePlan,
      {
        ...entryResponse().body.routePlan[0],
        swapInfo: {
          ...entryResponse().body.routePlan[0].swapInfo,
          ammKey: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
        }
      }
    ]
  });
  const multiResult = await adapterFor(multiLeg.body).adapter.getPaperQuote(request());
  assert.equal(multiResult.quoteCandidate.route.binding.status, "MULTI_LEG_UNBOUND");
  assert.ok(multiResult.reasons.includes("SELECTED_POOL_ROUTE_NOT_IDENTITY_BOUND"));
  assert.equal(multiResult.authorizationEligible, false);
});

test("future chronology, malformed decimals, and caller authentication claims are rejected before transport", async () => {
  let calls = 0;
  const {adapter} = adapterFor(syntheticOrderResponse().body, {
    transport: async () => {
      calls += 1;
      return response(syntheticOrderResponse().body);
    }
  });
  const future = await adapter.getPaperQuote(request({candidateSampledAt: NOW + 1}));
  const decimals = await adapter.getPaperQuote(request({quoteDecimals: 19}));
  const authClaim = await adapter.getPaperQuote(request({sourceAuthenticated: true}));
  assert.equal(future.status, "UNAVAILABLE");
  assert.equal(decimals.status, "UNAVAILABLE");
  assert.equal(authClaim.status, "UNAVAILABLE");
  assert.equal(calls, 0);
});

test("stale authorization or candidate chronology is disclosed and remains ineligible", async () => {
  const fixture = entryResponse();
  const result = await adapterFor(fixture.body, {
    clock: () => NOW + 100
  }).adapter.getPaperQuote(request({
    candidateSampledAt: NOW - 6 * 60 * 1000,
    authorizedAt: NOW - 5 * 60 * 1000 - 1
  }));
  assert.ok(result.reasons.includes("CAUSAL_REFERENCE_STALE"));
  assert.equal(result.quoteCandidate.executable, false);
  assert.equal(result.authorizationEligible, false);
});

test("exact price ratio retains large raw-unit precision without floating-point arithmetic", async () => {
  const amount = "123456789012345678901";
  const output = "9876543210987654321";
  const fixture = entryResponse({
    inAmount: amount,
    outAmount: output,
    otherAmountThreshold: "1"
  });
  const {adapter} = adapterFor(fixture.body, {clock: () => NOW});
  const result = await adapter.getPaperQuote(request({
    amountAtoms: amount,
    quoteDecimals: 18,
    identity: {...IDENTITY, decimals: 18}
  }));
  const ratio = result.quoteCandidate.priceQuotePerBase;
  const numerator = BigInt(ratio.numerator);
  const denominator = BigInt(ratio.denominator);
  assert.equal(numerator * BigInt(output), denominator * BigInt(amount));
  assert.equal(result.quoteCandidate.routeAmounts.inputAtoms, amount);
  assert.equal(result.quoteCandidate.routeAmounts.outputAtoms, output);
  assert.equal(result.quoteCandidate.priceMicros, null);
});

test("provider expiry, malformed/truncated responses, and over-cap streams fail closed", async () => {
  const expired = entryResponse({
    router: "jupiterz",
    expireAt: String(Math.floor((NOW - 1_000) / 1_000))
  });
  assert.ok((await adapterFor(expired.body).adapter.getPaperQuote(request()))
    .reasons.includes("PROVIDER_QUOTE_EXPIRED"));

  const truncated = await adapterFor(() =>
    new Response('{"inputMint":', {headers: {"content-type": "application/json"}})
  ).adapter.getPaperQuote(request());
  assert.ok(truncated.reasons.includes("RESPONSE_JSON_INVALID"));

  const oversized = await adapterFor(() =>
    new Response(new Uint8Array(262_145), {headers: {"content-type": "application/json"}})
  ).adapter.getPaperQuote(request());
  assert.ok(oversized.reasons.includes("RESPONSE_TOO_LARGE"));
});

test("caller cancellation aborts the response stream without retry", async () => {
  const cancellation = new AbortController();
  let cancelled = false;
  let calls = 0;
  const adapter = createMarketQuoteAdapter({
    enabled: true,
    timeoutMs: 1_000,
    clock: () => NOW,
    transport: async () => {
      calls += 1;
      return {
        status: 200,
        redirected: false,
        url: "",
        headers: new Headers({"content-type": "application/json"}),
        body: new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
          cancel() {
            cancelled = true;
          }
        })
      };
    }
  });
  const pending = adapter.getPaperQuote(request(), {signal: cancellation.signal});
  await new Promise(resolve => setImmediate(resolve));
  cancellation.abort();
  const result = await pending;

  assert.equal(result.status, "UNAVAILABLE");
  assert.ok(result.reasons.includes("REQUEST_CANCELLED"));
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
});

test("the configured request budget caps transport attempts", async () => {
  let calls = 0;
  const adapter = createMarketQuoteAdapter({
    enabled: true,
    maxRequests: 1,
    clock: () => NOW,
    transport: async () => {
      calls += 1;
      return response(entryResponse().body);
    }
  });
  const first = await adapter.getPaperQuote(request());
  const second = await adapter.getPaperQuote(request());
  assert.equal(first.status, "UNAVAILABLE");
  assert.ok(second.reasons.includes("REQUEST_BUDGET_EXHAUSTED"));
  assert.equal(calls, 1);
});

test("the existing Paper consumer cannot fill from an incomplete market quote candidate", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-market-quote-"));
  const store = await CheckpointStore.open(directory);
  const session = await PaperCheckpointSession.open({store, runId: RUN, startedAt: START});
  t.after(async () => {
    await session.close();
    await rm(directory, {recursive: true, force: true});
  });
  const step = createPaperExecutionStep({
    session, store, runId: RUN, startedAt: START, endAt: END
  });
  const authorizationInput = authorization("market-quote-consumer");
  const authorized = await step.authorizeEntry(authorizationInput);
  assert.equal(authorized.status, "AUTHORIZED");

  let clockCalls = 0;
  const fixture = entryResponse().body;
  const market = await adapterFor(fixture, {
    clock: () => START + 2_000 + clockCalls++ * 100
  }).adapter.getPaperQuote({
    identity: {
      chainId: "solana",
      mint: authorizationInput.candidate.mint,
      pool: authorizationInput.candidate.pool,
      quote: authorizationInput.candidate.quote,
      decimals: authorizationInput.candidate.decimals
    },
    side: "ENTRY",
    amountAtoms: "100000000",
    quoteDecimals: 6,
    candidateSampledAt: START,
    authorizedAt: authorizationInput.now,
    slippageBps: 50
  });
  const rejected = await step.executeEntry({
    eventId: "market-quote-unavailable",
    authorizationId: authorized.authorizationId,
    quote: market.quoteCandidate,
    now: START + 3_000,
    marks: []
  });
  assert.equal(market.authorizationEligible, false);
  assert.equal(rejected.status, "REJECT");
  assert.equal(session.metadata.sequence, 1);
  assert.equal(session.snapshot().summary.openPositions.length, 0);
});
