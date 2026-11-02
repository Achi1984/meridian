import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {collectCandidateDiscovery, REQUIRED_EVIDENCE_FIELDS} from
  "../scripts/memecoin-paper/evidence-sources/index.mjs";
import {filterCandidate, scout} from "../scripts/memecoin-paper/stages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(root, "test/fixtures/memecoin-paper-evidence-sources");
const NOW = 1_793_595_600_000;

const fixture = async name => JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8"));

function response(payload, status = 200, headers = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Response(body, {
    status,
    headers: {"content-type": "application/json", ...headers}
  });
}

function setup({profiles, pairs, ...options} = {}) {
  const requests = [];
  const transportOptions = [];
  return {
    requests,
    transportOptions,
    options: {
      enabled: true,
      clock: () => NOW,
      transport: async (request, requestOptions) => {
        requests.push(request);
        transportOptions.push(requestOptions);
        if (request.url === "https://api.dexscreener.com/token-profiles/latest/v1") {
          return response(profiles ?? await fixture("token-profiles-latest.json"));
        }
        if (request.url.startsWith("https://api.dexscreener.com/latest/dex/tokens/")) {
          return response(pairs ?? await fixture("token-pairs.json"));
        }
        throw new Error("unexpected request target");
      },
      ...options
    }
  };
}

test("collector is disabled by default and importing it performs no I/O", async () => {
  let calls = 0;
  const result = await collectCandidateDiscovery({
    transport: () => { calls += 1; },
    clock: () => { calls += 1; return NOW; }
  });
  assert.equal(result.status, "DISABLED");
  assert.equal(result.networkAccessed, false);
  assert.equal(calls, 0);
});

test("official profile and pair response shapes yield bounded identity hints only", async () => {
  const {options, requests, transportOptions} = setup();
  const result = await collectCandidateDiscovery(options);

  assert.equal(result.status, "DISCOVERY_HINTS_ACQUIRED");
  assert.equal(result.networkAccessed, true);
  assert.equal(result.counters.requests, 2);
  assert.deepEqual(requests.map(request => request.url), [
    "https://api.dexscreener.com/token-profiles/latest/v1",
    "https://api.dexscreener.com/latest/dex/tokens/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB,FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
  ]);
  assert.ok(requests.every(request => request.method === "GET" &&
    request.redirect === "error" && request.credentials === "omit" &&
    Object.keys(request).every(key => !["body", "authorization"].includes(key))));
  assert.ok(transportOptions.every(options =>
    options.redirect === "error" && options.credentials === "omit" &&
    options.signal instanceof AbortSignal));
  assert.deepEqual(result.candidates.map(({mint, pool, quote}) => ({mint, pool, quote})), [
    {
      mint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      pool: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      quote: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
    },
    {
      mint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      pool: "HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH",
      quote: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
    },
    {
      mint: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
      pool: "KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK",
      quote: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
    }
  ]);
  assert.ok(result.candidates.every(candidate =>
    candidate.sampledAt === NOW && candidate.discovery.slot === null &&
    candidate.discovery.coverage.complete === false &&
    candidate.requiredEvidence && REQUIRED_EVIDENCE_FIELDS.every(field =>
      candidate.requiredEvidence[field].status === "UNKNOWN")));
  assert.equal(result.discovery.exhaustive, false);
  assert.equal(result.sourceAuthentication, "NOT_ESTABLISHED");
  assert.equal(result.clockTrust, "INJECTED_LOCAL_CLOCK_UNVERIFIED");
  assert.ok(result.events.every(event =>
    event.sourceVersion === "UNVERSIONED_PUBLIC_API" &&
    (event.responseSha256 === null || /^[a-f0-9]{64}$/.test(event.responseSha256))));
  assert.ok(result.candidates.every(candidate =>
    /^[a-f0-9]{64}$/.test(candidate.discovery.profileResponseSha256) &&
    /^[a-f0-9]{64}$/.test(candidate.discovery.pairResponseSha256) &&
    candidate.discovery.sourceVersion === "UNVERSIONED_PUBLIC_API"));
  assert.equal(JSON.stringify(result).includes("untrusted.example"), false);

  const scouted = scout(result.candidates, {now: NOW, source: "bounded discovery fixture"});
  assert.equal(scouted.selected.length, 2);
  assert.equal(scouted.discovery.exhaustive, false);
  for (const candidate of scouted.selected) {
    const filtered = filterCandidate(candidate, {now: NOW});
    assert.equal(filtered.status, "UNKNOWN");
    assert.equal(filtered.accepted, false);
  }
});

test("pair identity mismatches and invalid chains do not become candidates", async () => {
  const {options} = setup({
    pairs: {pairs: [
      {
        chainId: "ethereum",
        pairAddress: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        baseToken: {address: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"},
        quoteToken: {address: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"}
      },
      {
        chainId: "solana",
        pairAddress: "bad",
        baseToken: {address: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"},
        quoteToken: {address: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"}
      },
      {
        chainId: "solana",
        pairAddress: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        baseToken: {address: "JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ"},
        quoteToken: {address: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"}
      }
    ]}
  });
  const result = await collectCandidateDiscovery(options);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.discovery.exhaustive, false);
});

test("missing pair creation time is retained only as an unverified identity hint", async () => {
  const pairData = await fixture("token-pairs.json");
  pairData.pairs = [pairData.pairs[0]];
  delete pairData.pairs[0].pairCreatedAt;
  const {options} = setup({pairs: pairData});
  const result = await collectCandidateDiscovery(options);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].pairCreatedAt, null);
  assert.equal(result.candidates[0].requiredEvidence.pairCreatedAt.status, "UNKNOWN");
});

test("per-response byte limits stop a streamed profile response before parsing", async () => {
  const {options, requests} = setup({
    limits: {maxBytesPerResponse: 32, maxBytesPerRun: 4096}
  });
  const result = await collectCandidateDiscovery({
    ...options,
    transport: async request => {
      requests.push(request);
      return response(await fixture("token-profiles-latest.json"));
    }
  });
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.counters.requests, 1);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.events[0].status, "RESPONSE_TOO_LARGE");
});

test("stream work and empty-chunk limits stop endless provider bodies", async t => {
  await t.test("endless empty chunks yield to scheduled macrotasks", async () => {
    let pulls = 0;
    let cancelled = false;
    let macrotaskRan = false;
    const body = new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(0));
      },
      cancel() { cancelled = true; }
    });
    const {options} = setup({
      limits: {requestTimeoutMs: 50},
      transport: async () => {
        setTimeout(() => { macrotaskRan = true; }, 0);
        return new Response(body, {headers: {"content-type": "application/json"}});
      }
    });
    const result = await collectCandidateDiscovery(options);
    assert.equal(result.status, "PARTIAL");
    assert.equal(result.events[0].status, "EMPTY_STREAM_LIMIT");
    assert.ok(pulls > 0);
    assert.equal(macrotaskRan, true);
    assert.equal(cancelled, true);
  });
  await t.test("endless one-byte chunks stop at the response byte cap", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array([0x20]));
      },
      cancel() { cancelled = true; }
    });
    const {options} = setup({
      limits: {maxBytesPerResponse: 32, maxBytesPerRun: 4096},
      transport: async () => new Response(body, {
        headers: {"content-type": "application/json"}
      })
    });
    const result = await collectCandidateDiscovery(options);
    assert.equal(result.status, "PARTIAL");
    assert.equal(result.events[0].status, "RESPONSE_TOO_LARGE");
    assert.equal(result.counters.bytes, 32);
    assert.ok(pulls >= 33);
    assert.equal(cancelled, true);
  });
  await t.test("total stream-read work is capped before the response byte maximum", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array([0x20]));
      },
      cancel() { cancelled = true; }
    });
    const {options} = setup({
      transport: async () => new Response(body, {
        headers: {"content-type": "application/json"}
      })
    });
    const result = await collectCandidateDiscovery(options);
    assert.equal(result.status, "PARTIAL");
    assert.equal(result.events[0].status, "STREAM_READ_LIMIT");
    assert.equal(result.counters.bytes, 65_536);
    assert.ok(pulls >= 65_536);
    assert.equal(cancelled, true);
  });
});

test("request budgets cap address batches and mark discovery partial", async () => {
  const profiles = Array.from({length: 61}, (_, index) => ({
    chainId: "solana",
    tokenAddress: `${String(index + 1).padStart(32, "B")}`
  }));
  const {options, requests} = setup({
    profiles,
    limits: {maxCandidates: 61, maxProfiles: 100, maxRequests: 2}
  });
  const result = await collectCandidateDiscovery(options);
  assert.equal(requests.length, 2);
  assert.equal(result.counters.requests, 2);
  assert.equal(result.discovery.profileRecordsTruncated, true);
  assert.equal(result.discovery.pairRecordsTruncated, true);
  assert.notEqual(result.status, "DISCOVERY_HINTS_ACQUIRED");
});

test("pairs returned for a profile omitted by the request budget are ignored", async () => {
  const {options} = setup({
    limits: {maxCandidates: 1, maxProfiles: 10, maxRequests: 2}
  });
  const result = await collectCandidateDiscovery(options);
  assert.deepEqual(result.candidates.map(candidate => candidate.mint), [
    "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
  ]);
  assert.equal(result.discovery.profileRecordsTruncated, true);
});

test("run-wide byte accounting stops the next streamed response at its boundary", async t => {
  const profile = [{chainId: "solana", tokenAddress: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"}];
  const pairPayload = {pairs: []};
  const profileBytes = new TextEncoder().encode(JSON.stringify(profile)).byteLength;
  const pairBytes = new TextEncoder().encode(JSON.stringify(pairPayload)).byteLength;
  await t.test("exact aggregate limit", async () => {
    const {options} = setup({
      profiles: profile,
      pairs: pairPayload,
      limits: {maxBytesPerResponse: 4096, maxBytesPerRun: profileBytes + pairBytes}
    });
    const result = await collectCandidateDiscovery(options);
    assert.equal(result.status, "DISCOVERY_HINTS_ACQUIRED");
    assert.equal(result.counters.bytes, profileBytes + pairBytes);
  });
  await t.test("one byte below aggregate limit", async () => {
    const {options} = setup({
      profiles: profile,
      pairs: pairPayload,
      limits: {maxBytesPerResponse: 4096, maxBytesPerRun: profileBytes + pairBytes - 1}
    });
    const result = await collectCandidateDiscovery(options);
    assert.equal(result.status, "PARTIAL");
    assert.equal(result.counters.bytes, profileBytes);
    assert.equal(result.events[1].status, "RESPONSE_TOO_LARGE");
  });
});

test("HTTP errors are not retried and their bodies are cancelled", async () => {
  let calls = 0;
  let limitedResponse;
  const {options} = setup({
    transport: async () => {
      calls += 1;
      limitedResponse = response("rate limited body is not read", 429);
      return limitedResponse;
    }
  });
  const result = await collectCandidateDiscovery(options);
  assert.equal(calls, 1);
  assert.equal(limitedResponse.bodyUsed, true);
  assert.equal(result.events[0].status, "HTTP_429");
  assert.match(result.events[0].reason, /no retry/);
  assert.equal(result.status, "PARTIAL");
});

test("redirects and foreign response URLs are rejected", async t => {
  await t.test("redirect flag", async () => {
    const {options} = setup({
      transport: async () => {
        const item = response([]);
        Object.defineProperty(item, "redirected", {value: true});
        return item;
      }
    });
    const result = await collectCandidateDiscovery(options);
    assert.equal(result.events[0].status, "REDIRECT_BLOCKED");
    assert.equal(result.candidates.length, 0);
  });
  await t.test("foreign URL", async () => {
    const {options} = setup({
      transport: async () => {
        const item = response([]);
        Object.defineProperty(item, "url", {value: "https://other.example/token-profiles/latest/v1"});
        return item;
      }
    });
    const result = await collectCandidateDiscovery(options);
    assert.equal(result.events[0].status, "INVALID_RESPONSE_URL");
    assert.equal(result.candidates.length, 0);
  });
});

test("cancellation and request deadlines stop without retry", async t => {
  await t.test("pre-cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const {options} = setup({transport: () => { calls += 1; }});
    const result = await collectCandidateDiscovery({...options, signal: controller.signal});
    assert.equal(calls, 0);
    assert.equal(result.status, "PARTIAL");
    assert.equal(result.events[0].status, "CANCELLED");
  });
  await t.test("timeout", async () => {
    let calls = 0;
    const {options} = setup({
      limits: {requestTimeoutMs: 5},
      transport: (_request, {signal}) => {
        calls += 1;
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {once: true});
        });
      }
    });
    const result = await collectCandidateDiscovery(options);
    assert.equal(calls, 1);
    assert.equal(result.events[0].status, "TIMEOUT");
    assert.equal(result.status, "PARTIAL");
  });
  await t.test("whole-run deadline bounds a longer request timeout", async () => {
    let calls = 0;
    const {options} = setup({
      limits: {maxDurationMs: 5, requestTimeoutMs: 100},
      transport: (_request, {signal}) => {
        calls += 1;
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {once: true});
        });
      }
    });
    const result = await collectCandidateDiscovery(options);
    assert.equal(calls, 1);
    assert.equal(result.events[0].status, "TIMEOUT");
    assert.equal(result.status, "PARTIAL");
  });
});
