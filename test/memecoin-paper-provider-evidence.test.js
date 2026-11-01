import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {assertAllowedSolanaRpcMethod} from "../scripts/memecoin-paper/adapters.mjs";
import {acquireProviderEvidence} from "../scripts/memecoin-paper/provider-evidence.mjs";
import {filterCandidate} from "../scripts/memecoin-paper/stages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(root, "test/fixtures/memecoin-paper-provider-evidence");
const NOW = Date.parse("2026-11-01T16:00:00Z");
const IDENTITY = Object.freeze({
  chainId: "solana",
  mint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  pool: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  quote: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
});
const ALT_IDENTITY = Object.freeze({
  chainId: "solana",
  mint: "HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH",
  pool: "JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ",
  quote: IDENTITY.quote
});
const DEFAULT_FRESHNESS = Object.freeze({
  maxAcquisitionDurationMs: 30_000,
  maxPairAgeMs: 72 * 60 * 60 * 1000,
  maxFutureSkewMs: 0
});

const fixture = async name => JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8"));

async function manifestFor({mints = [IDENTITY.mint], pools = [IDENTITY.pool], budget = {}} = {}) {
  const manifest = JSON.parse(await readFile(path.join(root, "scripts/memecoin-paper/run-manifest.json"), "utf8"));
  manifest.enabled = true;
  manifest.runId = "provider-evidence-generated-test";
  manifest.startAt = NOW;
  manifest.endAt = NOW + manifest.durationMs;
  manifest.stopSwitch.engaged = false;
  manifest.providers.forEach(provider => { provider.enabled = true; });
  manifest.allowedMints = mints;
  manifest.allowedPools = pools;
  Object.assign(manifest.pollBudget, budget);
  return manifest;
}

function response(payload, status = 200, headers = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Response(body, {
    status,
    headers: {"content-type": "application/json", ...headers}
  });
}

async function payloadFor(request) {
  if (request.provider === "dex") {
    const body = await fixture("dex-pair.json");
    body.pairs[0].baseToken.address = request.requested.mint;
    body.pairs[0].pairAddress = request.requested.pool;
    body.pairs[0].quoteToken.address = request.requested.quote;
    return body;
  }
  const filename = {
    getAccountInfo: "get-account-info.json",
    getTokenLargestAccounts: "get-largest-accounts.json",
    getTokenSupply: "get-token-supply.json"
  }[request.kind];
  const body = await fixture(filename);
  body.id = request.id;
  return body;
}

function setup({budget = {}, transport = async request => response(await payloadFor(request)),
  clock = () => NOW, freshnessPolicy = DEFAULT_FRESHNESS, ...options} = {}) {
  return {
    manifest: options.manifest,
    candidates: options.candidates ?? [IDENTITY],
    enabled: true,
    transport,
    clock,
    freshnessPolicy,
    ...options
  };
}

async function acquire(options = {}) {
  const manifest = options.manifest ?? await manifestFor({budget: options.budget});
  const {budget: _unused, ...adapterOptions} = options;
  return acquireProviderEvidence({...setup({...adapterOptions, manifest})});
}

test("disabled-by-default adapter performs no I/O and never needs a clock or transport", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "scripts/memecoin-paper/run-manifest.json"), "utf8"));
  let calls = 0;
  const result = await acquireProviderEvidence({
    manifest,
    candidates: [IDENTITY],
    transport: () => { calls += 1; },
    enabled: false
  });
  assert.equal(result.status, "DISABLED");
  assert.equal(result.networkAccessed, false);
  assert.equal(calls, 0);
  assert.deepEqual(result.counters, {requests: 0, bytes: 0, events: 0, reservedBytes: 0});
});

test("enabled acquisition builds only fixed pair and read-only RPC requests", async () => {
  const requests = [];
  const manifest = await manifestFor();
  const result = await acquireProviderEvidence({
    ...setup({manifest, transport: async (request, options) => {
      requests.push({request, options});
      return response(await payloadFor(request));
    }})
  });
  assert.equal(result.status, "ACQUISITION_FINISHED");
  assert.equal(result.networkAccessed, true);
  assert.equal(requests.length, 4);
  const dex = requests[0];
  assert.equal(dex.request.url,
    `https://api.dexscreener.com/latest/dex/pairs/solana/${IDENTITY.pool}`);
  assert.equal(dex.request.method, "GET");
  assert.deepEqual(dex.request.headers, {accept: "application/json"});
  assert.equal(dex.request.redirect, "error");
  assert.equal(dex.request.credentials, "omit");
  assert.equal(dex.options.redirect, "error");
  assert.equal(dex.options.credentials, "omit");
  const rpc = requests.slice(1).map(item => JSON.parse(item.request.body));
  assert.deepEqual(rpc.map(item => item.method), [
    "getAccountInfo", "getTokenLargestAccounts", "getTokenSupply"
  ]);
  assert.ok(rpc.every(item => item.params[0] === IDENTITY.mint));
  assert.ok(rpc.every(item => item.params.at(-1).commitment === "finalized"));
  assert.ok(requests.every(({request}) =>
    request.url === "https://api.mainnet-beta.solana.com" || request.url.startsWith("https://api.dexscreener.com/")));
  assert.ok(requests.every(({options}) => !Object.hasOwn(options, "headers")));
  assert.deepEqual(result.events.map(event => event.endpointKind), [
    "pair", "getAccountInfo", "getTokenLargestAccounts", "getTokenSupply"
  ]);
  assert.ok(result.events.every(event =>
    event.observedAtBasis === "response-receipt-not-source-event-time"));
});

test("arbitrary URLs, RPC methods, credentials, and caller headers are rejected before transport", async () => {
  let calls = 0;
  const manifest = await manifestFor();
  const transport = async () => { calls += 1; return response({}); };
  await assert.rejects(acquireProviderEvidence({
    ...setup({manifest, candidates: [{...IDENTITY, pool: "https://attacker.example/pool"}], transport})
  }), /validated Solana address/);
  await assert.rejects(acquireProviderEvidence({
    ...setup({manifest, transport, headers: {authorization: "******"}})
  }), /caller headers and URLs are forbidden/);
  await assert.rejects(acquireProviderEvidence({
    ...setup({manifest, transport, credentials: "include"})
  }), /caller headers and URLs are forbidden/);
  assert.throws(() => assertAllowedSolanaRpcMethod("sendTransaction"), /read-only allowlist/);
  const credentialManifest = structuredClone(manifest);
  credentialManifest.http.credentials = true;
  await assert.rejects(acquireProviderEvidence({
    ...setup({manifest: credentialManifest, transport})
  }), /deny credentials/);
  assert.equal(calls, 0);

  const foreignResponse = await acquire({
    manifest,
    transport: async request => {
      const item = response(await payloadFor(request));
      Object.defineProperty(item, "url", {value: "https://unknown.example/response"});
      return item;
    }
  });
  assert.ok(foreignResponse.events.every(event => event.status === "INVALID_RESPONSE_URL"));
});

test("redirects are rejected and 429 responses are counted without reading or retrying bodies", async () => {
  const bodies = [];
  const results = await acquire({
    transport: async request => {
      const item = response("provider error body must not be read", request.kind === "pair" ? 302 : 429);
      bodies.push(item);
      return item;
    }
  });
  assert.deepEqual(results.events.map(event => event.status),
    ["REDIRECT_BLOCKED", "HTTP_429", "HTTP_429", "HTTP_429"]);
  assert.equal(results.counters.requests, 4);
  assert.ok(bodies.every(item => item.bodyUsed === false));
  assert.equal(results.events.filter(event => event.status === "HTTP_429").length, 3);
});

test("request and event budgets stop exactly at the boundary and one request beyond it", async () => {
  const identities = [IDENTITY, ALT_IDENTITY];
  const manifest = await manifestFor({
    mints: identities.map(item => item.mint),
    pools: identities.map(item => item.pool),
    budget: {maxRequestsPerRun: 4, maxRequestsPerProvider: 5, maxEvents: 5}
  });
  let calls = 0;
  const transport = async request => { calls += 1; return response(await payloadFor(request)); };
  const atLimit = await acquire({manifest, candidates: identities, transport});
  assert.equal(atLimit.counters.requests, 4);
  assert.equal(atLimit.counters.events, 4);
  assert.equal(calls, 4);
  assert.match(atLimit.stoppedReason, /budget exhausted/);

  const plusOneManifest = structuredClone(manifest);
  plusOneManifest.pollBudget.maxRequestsPerRun = 5;
  calls = 0;
  const onePast = await acquire({manifest: plusOneManifest, candidates: identities, transport});
  assert.equal(onePast.counters.requests, 5);
  assert.equal(onePast.counters.events, 5);
  assert.equal(calls, 5);

  const eventLimitedManifest = structuredClone(plusOneManifest);
  eventLimitedManifest.pollBudget.maxEvents = 2;
  calls = 0;
  const eventLimited = await acquire({manifest: eventLimitedManifest, candidates: identities, transport});
  assert.equal(eventLimited.counters.events, 2);
  assert.equal(calls, 2);
});

test("concurrent byte reservations cannot over-dispatch the shared run budget", async () => {
  const maxBytesPerResponse = 4096;
  const manifest = await manifestFor({
    budget: {maxBytesPerResponse, maxBytesPerRun: maxBytesPerResponse * 2}
  });
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  let releasePair;
  const bothStarted = new Promise(resolve => { releasePair = resolve; });
  const resultPromise = acquireProviderEvidence({
    ...setup({manifest, transport: async request => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (calls === 2) releasePair();
      await bothStarted;
      active -= 1;
      return response(await payloadFor(request));
    }})
  });
  const result = await resultPromise;
  assert.equal(calls, 2);
  assert.equal(maxActive, 2);
  assert.equal(result.counters.reservedBytes, 0);
  assert.ok(result.counters.bytes <= maxBytesPerResponse * 2);
  assert.match(result.stoppedReason, /byte budget exhausted/);
});

test("response byte cap accepts its exact boundary and rejects boundary plus one before parsing", async () => {
  const responseLimit = 64;
  const manifest = await manifestFor({
    budget: {maxRequestsPerRun: 1, maxRequestsPerProvider: 1,
      maxBytesPerResponse: responseLimit, maxBytesPerRun: responseLimit}
  });
  const exactBody = `null${" ".repeat(responseLimit - 4)}`;
  const exact = await acquire({manifest, transport: async () => response(exactBody)});
  assert.equal(exact.events[0].bytes, responseLimit);
  assert.equal(exact.events[0].status, "INVALID_DEX_SCHEMA");
  assert.equal(exact.counters.bytes, responseLimit);

  const plusOne = await acquire({manifest, transport: async () =>
    response(`${exactBody} `)});
  assert.equal(plusOne.events[0].status, "RESPONSE_TOO_LARGE");
  assert.equal(plusOne.counters.bytes, responseLimit + 1);
  assert.equal(plusOne.counters.requests, 1);
});

test("request deadlines cover slow headers and slow streamed bodies and clean caller listeners", async () => {
  const manifest = await manifestFor({budget: {maxRequestsPerRun: 1, maxRequestsPerProvider: 1}});
  const delayedHeaders = await acquire({
    manifest,
    requestTimeoutMs: 20,
    transport: (_request, {signal}) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {once: true});
    })
  });
  assert.equal(delayedHeaders.events[0].status, "TIMEOUT");
  assert.equal(delayedHeaders.counters.requests, 1);

  const delayedBody = await acquire({
    manifest,
    requestTimeoutMs: 20,
    transport: async () => new Response(new ReadableStream({pull() {return new Promise(() => {});}}), {
      headers: {"content-type": "application/json"}
    })
  });
  assert.equal(delayedBody.events[0].status, "TIMEOUT");

  const caller = new AbortController();
  let added = 0;
  let removed = 0;
  const add = caller.signal.addEventListener.bind(caller.signal);
  const remove = caller.signal.removeEventListener.bind(caller.signal);
  caller.signal.addEventListener = (...args) => {
    if (args[0] === "abort") added += 1;
    return add(...args);
  };
  caller.signal.removeEventListener = (...args) => {
    if (args[0] === "abort") removed += 1;
    return remove(...args);
  };
  const completed = await acquire({
    manifest, signal: caller.signal,
    transport: async request => response(await payloadFor(request))
  });
  assert.equal(completed.events[0].status, "RECEIVED");
  assert.equal(added, 1);
  assert.equal(removed, 1);
});

test("caller abort and stale or future source times fail closed without follow-up requests", async () => {
  const manifest = await manifestFor({
    mints: [IDENTITY.mint, ALT_IDENTITY.mint],
    pools: [IDENTITY.pool, ALT_IDENTITY.pool]
  });
  const caller = new AbortController();
  let calls = 0;
  const abortedPromise = acquireProviderEvidence({
    ...setup({manifest, candidates: [IDENTITY, ALT_IDENTITY], signal: caller.signal,
      transport: (_request, {signal}) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {once: true});
      });
    }})
  });
  setTimeout(() => caller.abort(new Error("test abort")), 10);
  const aborted = await abortedPromise;
  assert.equal(calls, 4);
  assert.ok(aborted.events.every(event => event.status === "ABORTED"));
  assert.match(aborted.stoppedReason, /aborted/);

  const immediateCaller = new AbortController();
  calls = 0;
  const immediateAbort = await acquire({
    manifest,
    candidates: [IDENTITY, ALT_IDENTITY],
    signal: immediateCaller.signal,
    transport: async request => {
      calls += 1;
      immediateCaller.abort(new Error("abort during dispatch"));
      return response(await payloadFor(request));
    }
  });
  assert.equal(calls, 1);
  assert.equal(immediateAbort.events[0].status, "ABORTED");

  const basePair = await fixture("dex-pair.json");
  for (const pairCreatedAt of [NOW + 1, NOW - DEFAULT_FRESHNESS.maxPairAgeMs - 1]) {
    const changedManifest = await manifestFor();
    const stale = await acquire({
      manifest: changedManifest,
      transport: async request => {
        if (request.provider !== "dex") return response(await payloadFor(request));
        const body = structuredClone(basePair);
        body.pairs[0].pairCreatedAt = pairCreatedAt;
        return response(body);
      }
    });
    assert.equal(stale.events[0].status, "SOURCE_TIME_OUTSIDE_POLICY");
    assert.equal(stale.candidates[0].candidate.evidence.marketCapUsd.coverage.complete, false);
  }

  let timeRead = 0;
  const staleReceipt = await acquire({
    freshnessPolicy: {...DEFAULT_FRESHNESS, maxAcquisitionDurationMs: 1},
    clock: () => NOW + timeRead++ * 1000
  });
  assert.ok(staleReceipt.events.every(event => event.status === "STALE_ACQUISITION"));
});

test("malformed schemas, decimal strings, and oversized payloads are rejected", async () => {
  const badSupply = await acquire({
    transport: async request => {
      const body = await payloadFor(request);
      if (request.kind === "getTokenSupply") body.result.value.amount = "1e9";
      return response(body);
    }
  });
  assert.ok(badSupply.events.some(event => event.status === "INVALID_TOKEN_SUPPLY"));

  const badLargestAmount = await acquire({
    transport: async request => {
      const body = await payloadFor(request);
      if (request.kind === "getTokenLargestAccounts") body.result.value[0].amount = "1e9";
      return response(body);
    }
  });
  assert.ok(badLargestAmount.events.some(event => event.status === "INVALID_LARGEST_ACCOUNTS"));

  const badAccountData = await acquire({
    transport: async request => {
      const body = await payloadFor(request);
      if (request.kind === "getAccountInfo") body.result.value.data[0] = "not-base64";
      return response(body);
    }
  });
  assert.ok(badAccountData.events.some(event => event.status === "INVALID_ACCOUNT_INFO"));

  const malformedJson = await acquire({
    transport: async request => request.kind === "pair"
      ? response("{not-json")
      : response(await payloadFor(request))
  });
  assert.equal(malformedJson.events[0].status, "INVALID_JSON");

  const manifest = await manifestFor({budget: {
    maxBytesPerResponse: 128, maxBytesPerRun: 128,
    maxRequestsPerRun: 1, maxRequestsPerProvider: 1
  }});
  const oversized = await acquire({manifest, transport: async () => response(" ".repeat(129))});
  assert.equal(oversized.events[0].status, "RESPONSE_TOO_LARGE");
  assert.equal(oversized.counters.bytes, 129);
});

test("mismatched pool or quote identity cannot be mixed into candidate evidence", async () => {
  for (const [field, value] of [
    ["poolAddress", ALT_IDENTITY.pool],
    ["quoteAddress", ALT_IDENTITY.mint],
    ["mintAddress", ALT_IDENTITY.mint],
    ["chainId", "ethereum"]
  ]) {
    const result = await acquire({
      transport: async request => {
        const body = await payloadFor(request);
        if (request.provider === "dex") {
          if (field === "poolAddress") body.pairs[0].pairAddress = value;
          if (field === "quoteAddress") body.pairs[0].quoteToken.address = value;
          if (field === "mintAddress") body.pairs[0].baseToken.address = value;
          if (field === "chainId") body.pairs[0].chainId = value;
        }
        return response(body);
      }
    });
    assert.equal(result.events[0].status, "IDENTITY_MISMATCH");
    assert.equal(result.candidates[0].identityStatus, "UNKNOWN");
    assert.equal(result.candidates[0].candidate.evidence.marketCapUsd.coverage.complete, false);
    if (field === "quoteAddress") assert.equal(result.events[0].returned.quote, value);
  }
});

test("market cap never falls back to FDV and source time stays distinct from receipt time", async () => {
  const baseline = await acquire();
  const candidate = baseline.candidates[0].candidate;
  assert.equal(candidate.evidence.marketCapUsd.value, 1_000_000);
  assert.equal(candidate.evidence.marketCapUsd.sourceTime, null);
  assert.equal(candidate.evidence.pairCreatedAt.value, 1_793_545_200_000);
  assert.equal(candidate.evidence.pairCreatedAt.sourceTimeKind, "pairCreatedAt");
  assert.equal(candidate.evidence.pairCreatedAt.sourceTime, 1_793_545_200_000);
  assert.equal(candidate.evidence.volume1hUsd.observedAt, NOW);
  assert.equal(candidate.evidence.top10OwnerPct.slot, 350000002);
  assert.equal(baseline.events[0].observedAtBasis, "response-receipt-not-source-event-time");

  const withoutMarketCap = await acquire({
    transport: async request => {
      const body = await payloadFor(request);
      if (request.provider === "dex") {
        delete body.pairs[0].marketCap;
        body.pairs[0].fdv = 99_000_000;
      }
      return response(body);
    }
  });
  assert.equal(withoutMarketCap.candidates[0].candidate.evidence.marketCapUsd.value, null);
  assert.match(withoutMarketCap.candidates[0].candidate.evidence.marketCapUsd.coverage.reason, /fdv is not a substitute/);

  const negativeChange = await acquire({
    transport: async request => {
      const body = await payloadFor(request);
      if (request.provider === "dex") body.pairs[0].priceChange.h1 = -25;
      return response(body);
    }
  });
  const filters = filterCandidate(negativeChange.candidates[0].candidate, {now: NOW});
  assert.equal(negativeChange.candidates[0].candidate.evidence.priceChange1hPct.value, -25);
  assert.equal(filters.checks.priceRunup.status, "PASS");
});

test("generated adapter evidence feeds the existing filter into a stable, attributable no-trade result", async () => {
  const first = await acquire();
  const second = await acquire();
  assert.deepEqual(first, second);
  const candidate = first.candidates[0].candidate;
  assert.equal(candidate.tokenSupplyAtoms, "100000000000000000003");
  assert.equal(candidate.largestTokenAccounts[0].amount, "90000000000000000001");
  assert.deepEqual(candidate.transactionCounts1h, {buys: 8, sells: 3});
  assert.equal(candidate.evidence.top10OwnerPct.value, null);
  assert.equal(candidate.evidence.top10OwnerPct.coverage.complete, false);
  assert.equal(candidate.evidence.mintAuthorityRevoked.value, null);
  assert.equal(candidate.evidence.freezeAuthorityRevoked.value, null);
  assert.equal(candidate.evidence.tokenExtensions.value, null);

  const filters = filterCandidate(candidate, {now: NOW, holdUntil: NOW + 8 * 60 * 60 * 1000});
  assert.equal(filters.status, "UNKNOWN");
  assert.equal(filters.accepted, false);
  assert.equal(filters.checks.top10Owners.status, "UNKNOWN");
  assert.equal(filters.checks.top10Owners.source, "Solana JSON-RPC getTokenLargestAccounts");
  assert.equal(filters.checks.mintAuthority.status, "UNKNOWN");
  assert.equal(filters.checks.mintAuthority.source, "Solana JSON-RPC getAccountInfo");
  assert.equal(filters.checks.tokenExtensions.status, "UNKNOWN");
  assert.equal(filters.checks.marketCap.status, "PASS");
  assert.equal(filters.checks.pairAge.status, "PASS");
});

test("freshness policy and candidate count are explicit and bounded before I/O", async () => {
  const manifest = await manifestFor({budget: {maxCandidates: 1}});
  let calls = 0;
  await assert.rejects(acquireProviderEvidence({
    ...setup({manifest, candidates: [IDENTITY, ALT_IDENTITY], transport: () => {
      calls += 1;
    }})
  }), /candidate count exceeded/);
  await assert.rejects(acquireProviderEvidence({
    manifest,
    candidates: [IDENTITY],
    enabled: true,
    transport: () => { calls += 1; },
    clock: () => NOW
  }), /freshness policy/);
  assert.equal(calls, 0);

  const outsideWindow = await acquire({
    manifest,
    clock: () => NOW + manifest.durationMs,
    transport: () => { calls += 1; }
  });
  assert.equal(outsideWindow.events[0].status, "OUTSIDE_RUN_WINDOW");
  assert.equal(calls, 0);

  const invalidWindow = structuredClone(manifest);
  invalidWindow.endAt = NOW + 1;
  await assert.rejects(acquireProviderEvidence({
    ...setup({manifest: invalidWindow, transport: () => { calls += 1; }})
  }), /exact eight-hour window/);
  assert.equal(calls, 0);
});
