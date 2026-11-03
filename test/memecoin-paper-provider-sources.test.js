import assert from "node:assert/strict";
import test from "node:test";
import {
  BIRDEYE_ORIGIN,
  BIRDEYE_SOURCE,
  DEFAULT_PROVIDER_LIMITS,
  HELIUS_ORIGIN,
  HELIUS_SOURCE,
  createBirdeyeSource,
  createHeliusSource
} from "../scripts/memecoin-paper/provider-sources/index.mjs";
import {
  ANALYST_WINDOW_METRICS,
  PROPOSED_ANALYST_WINDOW_POLICY
} from "../scripts/memecoin-paper/analyst-window-evidence.mjs";
import {analyzeCandidate, filterCandidate} from "../scripts/memecoin-paper/stages.mjs";
import {makeFixture} from "./fixtures/memecoin-paper-analyst-window-evidence/source-shaped.mjs";
import {
  SYNTHETIC_OWNER_A,
  SYNTHETIC_PROGRAM,
  SYNTHETIC_PROVIDER_SECRET,
  SYNTHETIC_PROVIDER_TIME,
  SYNTHETIC_OWNER_B,
  jsonResponse,
  jsonRpcResponse,
  syntheticAccount,
  syntheticPriceResponse,
  syntheticTransaction
} from "./fixtures/memecoin-paper-provider-sources/synthetic.mjs";

const clock = () => SYNTHETIC_PROVIDER_TIME + 1_000;
const address = "So11111111111111111111111111111111111111112";

function helius(transport, options = {}) {
  return createHeliusSource({
    enabled: true,
    secret: SYNTHETIC_PROVIDER_SECRET,
    transport,
    clock,
    ...options
  });
}

function birdeye(transport, options = {}) {
  return createBirdeyeSource({
    enabled: true,
    secret: SYNTHETIC_PROVIDER_SECRET,
    transport,
    clock,
    ...options
  });
}

function rpcTransport(handler) {
  return async (request, context) => {
    assert.equal(new URL(request.url).origin, HELIUS_ORIGIN);
    assert.equal(request.url.includes(SYNTHETIC_PROVIDER_SECRET), false);
    assert.equal(request.body.includes(SYNTHETIC_PROVIDER_SECRET), false);
    assert.equal(request.redirect, "error");
    assert.equal(request.credentials, "omit");
    assert.equal(context.secret, SYNTHETIC_PROVIDER_SECRET);
    const body = JSON.parse(request.body);
    return jsonRpcResponse(request, await handler(body.method, body.params, body));
  };
}

function priceTransport(result) {
  return async (request, context) => {
    assert.equal(new URL(request.url).origin, BIRDEYE_ORIGIN);
    assert.equal(new URL(request.url).pathname, "/defi/historical_price_unix");
    assert.equal(request.method, "GET");
    assert.equal(request.redirect, "error");
    assert.equal(request.credentials, "omit");
    assert.equal(context.secret, SYNTHETIC_PROVIDER_SECRET);
    return jsonResponse(typeof result === "function" ? result(request) : result);
  };
}

test("disabled provider sources make zero requests and cannot provide readiness", async () => {
  let requests = 0;
  const heliusSource = createHeliusSource({transport: () => { requests += 1; }});
  const birdeyeSource = createBirdeyeSource({transport: () => { requests += 1; }});
  const history = await heliusSource.getTransactionsForAddress({address});
  const price = await birdeyeSource.readObservation({
    mint: address,
    atMs: SYNTHETIC_PROVIDER_TIME,
    denomination: "USD",
    purpose: "synthetic-test"
  });
  assert.equal(requests, 0);
  assert.equal(history.reason, "DISABLED");
  assert.equal(price.reason, "DISABLED");
  assert.equal(history.coverage.observedCompleteness, "UNKNOWN");
  assert.equal(price.sourceAtMs, undefined);
  assert.equal(history.coverage.policyApproval, "NOT_APPROVED");
});

test("synthetic Helius history preserves provider, query, raw hash, slot and block time", async () => {
  const source = helius(rpcTransport(async (_method, params) => [
    syntheticTransaction({signature: "sig-1", slot: 44, blockTime: 123})
  ]));
  const result = await source.getTransactionsForAddress({
    address,
    limit: 2,
    startSlot: 40,
    endSlot: 50,
    startBlockTime: 100,
    endBlockTime: 150
  });
  assert.equal(result.status, "CAPTURED");
  assert.equal(result.provider.name, HELIUS_SOURCE);
  assert.equal(result.provider.method, "getTransactionsForAddress");
  assert.deepEqual(result.queryScope, {
    address,
    commitment: "finalized",
    limit: 2,
    startSlot: 40,
    endSlot: 50,
    startBlockTime: 100,
    endBlockTime: 150
  });
  assert.equal(result.data.transactions[0].providerIdentity, HELIUS_SOURCE);
  assert.equal(result.data.transactions[0].originalSlot, 44);
  assert.equal(result.data.transactions[0].originalBlockTime, 123);
  assert.equal(result.data.transactions[0].receiptSha256, result.receipts[0].responseSha256);
  assert.match(result.receipts[0].responseSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.coverage.observedCompleteness, "UNKNOWN");
  assert.equal(result.coverage.policyApproval, "NOT_APPROVED");
});

test("synthetic Helius short transaction pages terminate cursor walking without claiming completeness", async () => {
  const calls = [];
  const source = helius(rpcTransport(async (method, params) => {
    calls.push({method, params});
    return [syntheticTransaction({signature: "last", slot: 20})];
  }));
  const result = await source.getTransactionsForAddress({address, limit: 2});
  assert.equal(result.status, "CAPTURED");
  assert.equal(calls.length, 1);
  assert.equal(result.coverage.cursorExhausted, true);
  assert.equal(result.coverage.observedCompleteness, "UNKNOWN");
});

test("Helius transaction cursor cycles, contradictory duplicates, null metadata and versions fail closed", async t => {
  await t.test("repeated pagination token", async () => {
    let calls = 0;
    const source = helius(rpcTransport(async () => {
      calls += 1;
      return {
        data: [syntheticTransaction({signature: `sig-${calls}`})],
        paginationToken: "repeat"
      };
    }));
    const result = await source.getTransactionsForAddress({address});
    assert.equal(result.reason, "REPEATED_CURSOR");
    assert.equal(calls, 2);
  });
  await t.test("contradictory duplicate signature", async () => {
    let calls = 0;
    const source = helius(rpcTransport(async () => {
      calls += 1;
      return {
        data: [syntheticTransaction({signature: "same", slot: 50 + calls})],
        paginationToken: calls === 1 ? "next" : null
      };
    }));
    const result = await source.getTransactionsForAddress({address});
    assert.equal(result.reason, "CONTRADICTORY_DUPLICATE_TRANSACTION");
  });
  await t.test("null metadata", async () => {
    const source = helius(rpcTransport(async () => [
      syntheticTransaction({meta: null})
    ]));
    const result = await source.getTransactionsForAddress({address});
    assert.equal(result.reason, "NULL_TRANSACTION_METADATA");
  });
  await t.test("unsupported version", async () => {
    const source = helius(rpcTransport(async () => [
      syntheticTransaction({version: 1})
    ]));
    const result = await source.getTransactionsForAddress({address});
    assert.equal(result.reason, "UNSUPPORTED_TRANSACTION_VERSION");
  });
});

test("synthetic Helius account pages continue after short pages and stop only at null paginationKey", async () => {
  const requests = [];
  const source = helius(rpcTransport(async (_method, params) => {
    requests.push(params[1]);
    if (requests.length === 1) {
      return {
        context: {slot: 90},
        accounts: [syntheticAccount({address: SYNTHETIC_PROGRAM})],
        paginationKey: "continue"
      };
    }
    return {
      context: {slot: 90},
      accounts: [syntheticAccount({
        address: SYNTHETIC_OWNER_B, owner: SYNTHETIC_OWNER_B, amount: "23"
      })],
      paginationKey: null
    };
  }));
  const result = await source.getProgramAccountsV2({
    programId: SYNTHETIC_PROGRAM,
    pageSize: 10,
    minContextSlot: 80
  });
  assert.equal(result.status, "CAPTURED");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].paginationKey, null);
  assert.equal(requests[1].paginationKey, "continue");
  assert.deepEqual(result.data.contextSlots, [90, 90]);
  assert.equal(result.data.paginationTerminatedByNull, true);
  assert.equal(result.data.accounts, 2);
  assert.deepEqual(result.data.owners.map(row => row.rawAmount).sort(), ["17", "23"]);
  assert.equal(result.data.reconciliation.matches, true);
  assert.equal(result.coverage.frozenSnapshot, false);
  assert.equal(result.coverage.observedCompleteness, "UNKNOWN");
});

test("Helius account cursor cycles, contradictions, context drift and quotas remain unknown", async t => {
  await t.test("cursor cycle", async () => {
    let calls = 0;
    const source = helius(rpcTransport(async () => {
      calls += 1;
      return {
        context: {slot: 90},
        accounts: [],
        paginationKey: "repeat"
      };
    }));
    const result = await source.getProgramAccountsV2({programId: SYNTHETIC_PROGRAM});
    assert.equal(result.reason, "REPEATED_CURSOR");
    assert.equal(calls, 2);
  });
  await t.test("contradictory account duplicate", async () => {
    let calls = 0;
    const source = helius(rpcTransport(async () => {
      calls += 1;
      return {
        context: {slot: 90},
        accounts: [syntheticAccount({address: SYNTHETIC_PROGRAM, amount: String(calls)})],
        paginationKey: calls === 1 ? "next" : null
      };
    }));
    const result = await source.getProgramAccountsV2({programId: SYNTHETIC_PROGRAM});
    assert.equal(result.reason, "CONTRADICTORY_DUPLICATE_ACCOUNT");
  });
  await t.test("context slot drift", async () => {
    let calls = 0;
    const source = helius(rpcTransport(async () => {
      calls += 1;
      return {
        context: {slot: 90 + calls},
        accounts: [],
        paginationKey: calls === 1 ? "next" : null
      };
    }));
    const result = await source.getProgramAccountsV2({
      programId: SYNTHETIC_PROGRAM,
      minContextSlot: 90
    });
    assert.equal(result.reason, "CONTEXT_SLOT_DRIFT");
    assert.deepEqual(result.data.contextSlots, [91, 92]);
    assert.equal(result.data.minContextSlotIsLowerBound, true);
  });
  await t.test("request quota", async () => {
    let calls = 0;
    const source = helius(rpcTransport(async () => {
      calls += 1;
      return {context: {slot: 90}, accounts: [], paginationKey: "next"};
    }), {limits: {maxRequests: 1}});
    const result = await source.getProgramAccountsV2({programId: SYNTHETIC_PROGRAM});
    assert.equal(result.reason, "REQUEST_QUOTA_EXHAUSTED");
    assert.equal(calls, 1);
  });
  await t.test("unrecognized filters never reach transport", async () => {
    let calls = 0;
    const source = helius(rpcTransport(async () => {
      calls += 1;
      return {context: {slot: 90}, accounts: [], paginationKey: null};
    }));
    const result = await source.getProgramAccountsV2({
      programId: SYNTHETIC_PROGRAM,
      filters: [{constructor: {pollute: true}}]
    });
    assert.equal(result.reason, "INVALID_QUERY_SCOPE");
    assert.equal(calls, 0);
  });
});

test("provider URLs, redirects, and secrets are constrained and redacted", async t => {
  await t.test("redirect rejected", async () => {
    const source = helius(async request => jsonRpcResponse(request, [], {
      redirected: true,
      url: `${HELIUS_ORIGIN}/redirected`
    }));
    const result = await source.getTransactionsForAddress({address});
    assert.equal(result.reason, "REDIRECT_OR_PATH_REJECTED");
    assert.equal(result.receipts.length, 0);
  });
  await t.test("Birdeye response path is allowlisted", async () => {
    const source = birdeye(async request => jsonResponse(syntheticPriceResponse(), {
      url: `${BIRDEYE_ORIGIN}/elsewhere`
    }));
    const result = await source.readObservation({
      mint: address,
      atMs: SYNTHETIC_PROVIDER_TIME,
      denomination: "USD",
      purpose: "TEST"
    });
    assert.equal(result.reason, "REDIRECT_OR_PATH_REJECTED");
  });
  await t.test("secret in transport error is not returned or recorded", async () => {
    let calls = 0;
    const source = helius(async () => {
      calls += 1;
      throw new Error(`failed for ${SYNTHETIC_PROVIDER_SECRET}`);
    });
    const result = await source.getTransactionsForAddress({address});
    assert.equal(result.reason, "TRANSPORT_UNAVAILABLE");
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes(SYNTHETIC_PROVIDER_SECRET), false);
    assert.equal(result.receipts.length, 0);
  });
  await t.test("secret echoed through observation scope is redacted", async () => {
    const source = birdeye(priceTransport(syntheticPriceResponse()));
    const result = await source.readObservation({
      mint: address,
      atMs: SYNTHETIC_PROVIDER_TIME,
      denomination: "USD",
      purpose: SYNTHETIC_PROVIDER_SECRET
    });
    assert.equal(result.status, "SOURCE_BOUND");
    assert.equal(JSON.stringify(result).includes(SYNTHETIC_PROVIDER_SECRET), false);
    assert.equal(result.purpose, "[REDACTED]");
  });
});

test("request deadline, stalled body, cancellation and late transport continuations are bounded", async t => {
  await t.test("stalled body times out and is cancelled", async () => {
    let cancelled = false;
    const source = helius(() => ({
      status: 200,
      headers: new Headers(),
      url: "",
      body: new ReadableStream({
        pull() { return new Promise(() => {}); },
        cancel() { cancelled = true; }
      })
    }), {limits: {requestTimeoutMs: 20, maxDurationMs: 200}});
    const result = await source.getTransactionsForAddress({address});
    assert.equal(result.reason, "REQUEST_TIMEOUT");
    assert.equal(cancelled, true);
  });
  await t.test("external cancellation", async () => {
    const controller = new AbortController();
    const source = helius((_request, {signal}) => new Promise(resolve => {
      signal.addEventListener("abort", () => resolve({
        status: 200,
        headers: new Headers(),
        url: "",
        body: new Response("{}").body
      }), {once: true});
    }));
    const pending = source.getTransactionsForAddress({address, signal: controller.signal});
    setTimeout(() => controller.abort(), 10);
    const result = await pending;
    assert.equal(result.reason, "CANCELLED");
  });
  await t.test("late response body is cancelled", async () => {
    let cancelled = false;
    const source = helius(() => new Promise(resolve => {
      setTimeout(() => resolve({
        status: 200,
        headers: new Headers(),
        url: "",
        body: {
          getReader() {
            return {
              read: async () => ({done: true}),
              cancel() { cancelled = true; }
            };
          },
          cancel() { cancelled = true; }
        }
      }), 35);
    }), {limits: {requestTimeoutMs: 10, maxDurationMs: 100}});
    const result = await source.getTransactionsForAddress({address});
    assert.equal(result.reason, "REQUEST_TIMEOUT");
    await new Promise(resolve => setTimeout(resolve, 45));
    assert.equal(cancelled, true);
    assert.equal(result.receipts.length, 0);
  });
  await t.test("cumulative work limit", async () => {
    const source = helius(rpcTransport(async () => [
      syntheticTransaction(), syntheticTransaction({signature: "sig-2"})
    ]), {limits: {maxWorkUnits: 1}});
    const result = await source.getTransactionsForAddress({address, limit: 2});
    assert.equal(result.reason, "WORK_QUOTA_EXHAUSTED");
  });
  await t.test("overall deadline", async () => {
    const source = helius(() => new Promise(() => {}), {
      limits: {requestTimeoutMs: 20, maxDurationMs: 20}
    });
    const result = await source.getTransactionsForAddress({address});
    assert.equal(result.reason, "DEADLINE_EXCEEDED");
  });
  await t.test("per-response byte quota", async () => {
    const source = helius(rpcTransport(async () => [
      syntheticTransaction()
    ]), {limits: {maxBytesPerResponse: 32, maxBytesPerRun: 32}});
    const result = await source.getTransactionsForAddress({address});
    assert.equal(result.reason, "RESPONSE_BYTE_LIMIT");
  });
  await t.test("cumulative run byte quota", async () => {
    let calls = 0;
    const source = helius(rpcTransport(async () => {
      calls += 1;
      return {
        context: {slot: 90},
        accounts: [],
        paginationKey: calls === 1 ? "next" : null,
        ...(calls === 1 ? {padding: "x".repeat(200)} : {})
      };
    }), {limits: {maxBytesPerResponse: 350, maxBytesPerRun: 350}});
    const result = await source.getProgramAccountsV2({programId: SYNTHETIC_PROGRAM});
    assert.equal(result.reason, "RESPONSE_BYTE_LIMIT");
    assert.equal(calls, 2);
  });
});

test("synthetic Birdeye response requires an exact second-aligned USD observation without scaling", async t => {
  const atMs = SYNTHETIC_PROVIDER_TIME;
  const exact = birdeye(priceTransport(syntheticPriceResponse()));
  const observed = await exact.readObservation({
    mint: address,
    atMs,
    denomination: "USD",
    purpose: "MOMENTUM_START"
  });
  assert.equal(observed.status, "SOURCE_BOUND");
  assert.equal(observed.source, BIRDEYE_SOURCE);
  assert.deepEqual(observed.provider, {
    name: BIRDEYE_SOURCE,
    method: "historical_price_unix"
  });
  assert.equal(observed.sourceAtMs, atMs);
  assert.equal(observed.observedAt, atMs);
  assert.equal(observed.value, 0.00042);
  assert.equal(observed.data.updateUnixTime, atMs / 1_000);
  assert.equal(observed.receipts[0].responseSha256, observed.receipt.payloadSha256);
  assert.equal(observed.qualification.providerIdentity, BIRDEYE_SOURCE);
  assert.equal(observed.qualification.documentedScope, "historical_price_unix");
  assert.equal(observed.qualification.exactTimestampFidelity, "EXACT");
  assert.equal(observed.qualification.policyApproval, "NOT_APPROVED");
  assert.equal(observed.qualification.scaling, "PROVIDER_PRICE_PER_TOKEN_UNSCALED");
  assert.equal(observed.coverage.observedCompleteness, "UNKNOWN");
});

test("Birdeye rejects near, missing, future, nonaligned, and unsupported scaled observations", async t => {
  const atMs = SYNTHETIC_PROVIDER_TIME;
  await t.test("near requested time", async () => {
    const source = birdeye(priceTransport(syntheticPriceResponse({
      updateUnixTime: atMs / 1_000 - 1
    })));
    const result = await source.readObservation({
      mint: address, atMs, denomination: "USD", purpose: "TEST"
    });
    assert.equal(result.reason, "NONEXACT_OBSERVATION_TIME");
    assert.equal(result.sourceAtMs, undefined);
    assert.equal(result.data.updateUnixTime, atMs / 1_000 - 1);
  });
  await t.test("missing update time", async () => {
    const source = birdeye(priceTransport({data: {value: 1}}));
    const result = await source.readObservation({
      mint: address, atMs, denomination: "USD", purpose: "TEST"
    });
    assert.equal(result.reason, "MISSING_OBSERVATION_TIME");
    assert.equal(result.data.updateUnixTime, null);
  });
  await t.test("future requested time", async () => {
    const source = birdeye(priceTransport(syntheticPriceResponse()));
    const result = await source.readObservation({
      mint: address,
      atMs: clock() + 1_000,
      denomination: "USD",
      purpose: "TEST"
    });
    assert.equal(result.reason, "FUTURE_REQUEST_TIME");
    assert.equal(result.counters.requests, 0);
  });
  await t.test("future source observation", async () => {
    const source = birdeye(priceTransport(syntheticPriceResponse({
      updateUnixTime: Math.floor(clock() / 1_000) + 1
    })));
    const result = await source.readObservation({
      mint: address, atMs, denomination: "USD", purpose: "TEST"
    });
    assert.equal(result.reason, "FUTURE_OBSERVATION_TIME");
    assert.equal(result.data.updateUnixTime, Math.floor(clock() / 1_000) + 1);
  });
  await t.test("subsecond request", async () => {
    const source = birdeye(priceTransport(syntheticPriceResponse()));
    const result = await source.readObservation({
      mint: address, atMs: atMs + 1, denomination: "USD", purpose: "TEST"
    });
    assert.equal(result.reason, "REQUEST_TIME_NOT_SECOND_ALIGNED");
    assert.equal(result.counters.requests, 0);
  });
  await t.test("unsupported caller token scaling", async () => {
    const source = birdeye(priceTransport(syntheticPriceResponse()));
    const result = await source.readObservation({
      mint: address, atMs, denomination: "USD", purpose: "TEST", tokenScale: 9
    });
    assert.equal(result.reason, "UNSUPPORTED_TOKEN_SCALING");
    assert.equal(result.counters.requests, 0);
  });
});

test("real Analyst remains unavailable when provider evidence is unknown or unapproved", async () => {
  const disabledHistory = await createHeliusSource().getTransactionsForAddress({address});
  const disabledPrice = await createBirdeyeSource().readObservation({
    mint: address,
    atMs: SYNTHETIC_PROVIDER_TIME,
    denomination: "USD",
    purpose: "MOMENTUM_START"
  });
  const fixture = makeFixture();
  const filters = filterCandidate(fixture.candidate, {
    now: fixture.candidateT,
    holdUntil: fixture.candidateT + 8 * 60 * 60 * 1_000
  });
  assert.equal(filters.status, "PASS");
  const candidate = {
    ...fixture.candidate,
    analystEvidence: {...fixture.candidate.analystEvidence}
  };
  for (const key of ANALYST_WINDOW_METRICS) delete candidate.analystEvidence[key];
  const analysis = analyzeCandidate(candidate, {
    now: fixture.candidateT,
    filterResult: filters,
    smartWalletAllowlist: fixture.smartWalletAllowlist
  });
  assert.equal(disabledHistory.coverage.observedCompleteness, "UNKNOWN");
  assert.equal(disabledPrice.status, "UNAVAILABLE");
  assert.equal(analysis.status, "SCORE_UNAVAILABLE");
  assert.equal(analysis.score, null);
  assert.notEqual(analysis.executionAuthorized, true);
  assert.equal(PROPOSED_ANALYST_WINDOW_POLICY.historicalPriceTrust, null);
});

test("provider defaults remain small bounded and synthetic fixtures are clearly marked", () => {
  assert.equal(DEFAULT_PROVIDER_LIMITS.maxRequests, 20);
  assert.equal(DEFAULT_PROVIDER_LIMITS.maxBytesPerResponse, 1_048_576);
  assert.equal(DEFAULT_PROVIDER_LIMITS.maxDurationMs, 15_000);
  assert.ok(SYNTHETIC_PROGRAM.length >= 32);
  assert.equal(syntheticAccount().decoded.owner, SYNTHETIC_OWNER_A);
});
