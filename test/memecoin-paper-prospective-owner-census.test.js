import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, rm, open} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  captureProspectiveOwnerCensus,
  PROSPECTIVE_CENSUS_BOUNDS
} from "../scripts/memecoin-paper/owner-census.mjs";
import {
  EvidenceWarmupStore,
  acquireAndPublishProspectiveOwnerCensus,
  createWarmupCensusSource,
  warmupCoverage
} from "../scripts/memecoin-paper/evidence-warmup/index.mjs";
import {filterCandidate} from "../scripts/memecoin-paper/stages.mjs";
import {syntheticCandidate} from "../scripts/memecoin-paper/synthetic-fixtures.mjs";

const PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const NOW = 1_793_448_000_000;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function encodeBase58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let text = "";
  while (value) {
    text = ALPHABET[Number(value % 58n)] + text;
    value /= 58n;
  }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return "1".repeat(zeroes) + text;
}
const key = seed => encodeBase58(Buffer.alloc(32, seed));
const IDENTITY = {chainId: "solana", mint: key(1), pool: key(2), quote: key(3)};
function token({address = 20, owner = 8, amount = 100n, length = 165,
  program = PROGRAM, native = 0, state = 1, mint = 1, option = 0} = {}) {
  const bytes = Buffer.alloc(length);
  Buffer.alloc(32, mint).copy(bytes, 0);
  Buffer.alloc(32, owner).copy(bytes, 32);
  bytes.writeBigUInt64LE(amount, 64);
  bytes[108] = state;
  bytes.writeUInt32LE(option, 72);
  bytes.writeUInt32LE(native, 109);
  return {pubkey: key(address), account: {
    owner: program, executable: false, data: [bytes.toString("base64"), "base64"]
  }};
}
function mint({supply = 100n, program = PROGRAM, length = 82, initialized = 1,
  authority = 0, executable = false} = {}) {
  const bytes = Buffer.alloc(length);
  bytes.writeUInt32LE(authority, 0);
  bytes.writeBigUInt64LE(supply, 36);
  bytes[45] = initialized;
  return {owner: program, executable, data: [bytes.toString("base64"), "base64"]};
}
function rpc(value, slot = 100) {
  return {jsonrpc: "2.0", id: 1, result: {context: {slot}, value}};
}
function offline({accounts = [token()], mintAccount = mint(), slots = [100, 100],
  responseFor} = {}) {
  const requests = [];
  const bodies = [];
  const transport = async (request, options) => {
    const payload = JSON.parse(request.body);
    const index = requests.length;
    requests.push({request, options, payload});
    const body = JSON.stringify(rpc(
      payload.method === "getProgramAccounts" ? accounts : mintAccount,
      slots[index] ?? slots.at(-1)
    ));
    bodies.push(body);
    return responseFor ? responseFor(index, body, options) : new Response(body);
  };
  return {transport, requests, bodies};
}
function capture(fixture, options = {}) {
  return captureProspectiveOwnerCensus({
    enabled: true, identity: IDENTITY, clock: () => NOW, transport: fixture.transport,
    ...options
  });
}
function diagnostic(result) {
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.capture.status, "RECONCILED_DIAGNOSTIC_ONLY");
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.cryptographicCompleteness, false);
  assert.equal(result.coverage.sourceCompletenessAuthenticated, false);
  assert.equal(result.filterEvidence.verified, false);
  assert.equal(result.filterEvidence.value, null);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.authorizationEligible, false);
  assert.equal(result.hardGateEligible, false);
  assert.equal(result.exclusionAssessment.status, "UNKNOWN");
  assert.equal(result.developerAssociation.status, "UNKNOWN");
}

test("opt-in only; same-slot finalized raw capture reconciles BigInt and positive owners", async () => {
  let calls = 0;
  assert.equal((await captureProspectiveOwnerCensus({
    transport: () => { calls += 1; }
  })).status, "DISABLED");
  assert.equal(calls, 0);
  const large = (1n << 53n) + 7n;
  const fixture = offline({
    accounts: [token({amount: large}), token({address: 21, amount: 5n}),
      token({address: 22, owner: 9, amount: 0n}),
      token({address: 23, owner: 8, amount: 0n})],
    mintAccount: mint({supply: large + 5n})
  });
  let clock = NOW;
  const result = await capture(fixture, {clock: () => clock++});
  diagnostic(result);
  assert.equal(result.rawCensus.observedAmountAtoms, String(large + 5n));
  assert.equal(result.rawCensus.positiveOwnerCount, 1);
  assert.equal(result.rawCensus.distinctOwnerCount, 2);
  assert.equal(result.rawCensus.zeroBalanceAccountCount, 2);
  assert.equal(result.rawCensus.accountCount, 4);
  assert.equal(result.capture.slot, "100");
  assert.ok(result.capture.acquisitionEndedAt > result.capture.acquisitionStartedAt);
  assert.equal(result.capture.consumed.acquisitionWallElapsedMs,
    result.capture.acquisitionEndedAt - result.capture.acquisitionStartedAt);
  assert.ok(result.capture.consumed.elapsedMs > 0);
  assert.deepEqual(fixture.requests.map(item => item.payload), [
    {jsonrpc: "2.0", id: 1, method: "getProgramAccounts", params: [PROGRAM, {
      commitment: "finalized", encoding: "base64", withContext: true,
      filters: [{memcmp: {offset: 0, bytes: IDENTITY.mint}}]
    }]},
    {jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [IDENTITY.mint, {
      commitment: "finalized", encoding: "base64", minContextSlot: 100
    }]}
  ]);
  let responseBytes = 0;
  let requestBytes = 0;
  for (const [index, exchange] of result.capture.exchanges.entries()) {
    for (const [body, original] of [
      [exchange.request.body, fixture.requests[index].request.body],
      [exchange.response.body, fixture.bodies[index]]
    ]) {
      const bytes = Buffer.from(body.bytes, "base64");
      assert.equal(bytes.toString(), original);
      assert.equal(body.byteLength, bytes.length);
      assert.equal(body.sha256, hash(bytes));
    }
    requestBytes += exchange.request.body.byteLength;
    responseBytes += exchange.response.body.byteLength;
    assert.equal(fixture.requests[index].options.credentials, "omit");
    assert.equal(fixture.requests[index].options.redirect, "error");
  }
  assert.equal(result.capture.consumed.requests, 2);
  assert.equal(result.capture.consumed.requestBytes, requestBytes);
  assert.equal(result.capture.consumed.responseBytes, responseBytes);
  const candidate = syntheticCandidate(NOW);
  candidate.evidence.top10OwnerPct = result.filterEvidence;
  const filtered = filterCandidate(candidate, {now: NOW});
  assert.equal(filtered.checks.top10Owners.status, "UNKNOWN");
  assert.equal(filtered.accepted, false);
});

test("slot race discards pairs and retries full census; exhausted races stop at six requests", async () => {
  const fixture = offline({slots: [100, 101, 102, 102]});
  const result = await capture(fixture);
  diagnostic(result);
  assert.equal(result.capture.slot, "102");
  assert.deepEqual(result.capture.pairs.map(pair => pair.sameSlot), [false, true]);
  assert.equal(result.capture.consumed.attempts, 2);
  assert.equal(result.capture.exchanges.length, 4);
  assert.equal(fixture.requests[3].payload.params[1].minContextSlot, 102);
  const exhausted = offline({slots: [100, 101, 102, 103, 104, 105]});
  const failure = await capture(exhausted);
  assert.equal(failure.reason, "SLOT_RACE_EXHAUSTED");
  assert.equal(failure.rawCensus, null);
  assert.equal(exhausted.requests.length, 6);
  assert.equal(failure.capture.consumed.attempts, 3);
  const backwards = await capture(offline({slots: [100, 99, 101, 101]}));
  diagnostic(backwards);
  assert.equal(backwards.capture.pairs[0].sameSlot, false);
});

test("zero supply with zero accounts or zero balances is diagnostic, not positive ownership", async () => {
  for (const accounts of [[], [token({amount: 0n})]]) {
    const result = await capture(offline({accounts, mintAccount: mint({supply: 0n})}));
    diagnostic(result);
    assert.equal(result.rawCensus.positiveOwnerCount, 0);
    assert.equal(result.rawCensus.zeroBalanceAccountCount, accounts.length);
  }
});

test("duplicates, omissions, invalid layouts, native and Token-2022 fail closed without retry", async t => {
  const cases = [
    ["DUPLICATE_TOKEN_ACCOUNT", {accounts: [token(), token()]}],
    ["SUPPLY_MISMATCH", {accounts: []}],
    ["SUPPLY_MISMATCH", {mintAccount: mint({supply: 101n})}],
    ["UNSUPPORTED_ACCOUNT_LAYOUT", {accounts: [token({length: 166})]}],
    ["MALFORMED_PROGRAM_ACCOUNT", {accounts: [token({program: TOKEN_2022})]}],
    ["ACCOUNT_MINT_MISMATCH", {accounts: [token({mint: 2})]}],
    ["MALFORMED_TOKEN_ACCOUNT", {accounts: [token({state: 0})]}],
    ["MALFORMED_TOKEN_ACCOUNT", {accounts: [token({option: 2})]}],
    ["NATIVE_TOKEN_ACCOUNT_EXCLUDED", {accounts: [token({native: 1})]}],
    ["UNSUPPORTED_TOKEN_PROGRAM", {mintAccount: mint({program: TOKEN_2022})}],
    ["UNSUPPORTED_MINT_LAYOUT", {mintAccount: mint({length: 83})}],
    ["UNSUPPORTED_TOKEN_PROGRAM", {mintAccount: null}],
    ["MINT_EVIDENCE_INVALID", {mintAccount: mint({initialized: 0})}],
    ["MINT_EVIDENCE_INVALID", {mintAccount: mint({authority: 2})}],
    ["MALFORMED_MINT_ACCOUNT", {mintAccount: mint({executable: true})}],
    ["AMOUNT_OVERFLOW", {accounts: [token({amount: (1n << 64n) - 1n}),
      token({address: 21, amount: 1n})]}]
  ];
  for (const [reason, input] of cases) {
    await t.test(reason, async () => {
      const fixture = offline(input);
      const result = await capture(fixture);
      assert.equal(result.reason, reason);
      assert.equal(result.rawCensus, null);
      assert.equal(result.capture.status, "FAILED");
      assert.ok(fixture.requests.length <= 2);
    });
  }
  for (const native of ["So11111111111111111111111111111111111111112",
    "So11111111111111111111111111111111111111111",
    "11111111111111111111111111111111"]) {
    const fixture = offline();
    assert.equal((await capture(fixture, {identity: {...IDENTITY, mint: native}})).reason,
      "NATIVE_MINT_EXCLUDED");
    assert.equal(fixture.requests.length, 0);
  }
  const frozen = await capture(offline({accounts: [token({state: 2})]}));
  diagnostic(frozen);
  assert.equal(frozen.rawCensus.observedAmountAtoms, "100");
  const sliced = token();
  sliced.account.data = [Buffer.alloc(64).toString("base64"), "base64"];
  assert.equal((await capture(offline({accounts: [sliced]}))).reason, "UNSUPPORTED_ACCOUNT_LAYOUT");
  const malformedMint = mint();
  malformedMint.data[0] = "!".repeat(112);
  assert.equal((await capture(offline({mintAccount: malformedMint}))).reason,
    "UNSUPPORTED_MINT_LAYOUT");
});

test("HTTP errors, truncated bodies and provider pagination markers cannot reconcile or retry", async t => {
  const cases = [
    ["RATE_LIMITED", () => new Response("rate limited", {status: 429})],
    ["HTTP_ERROR", () => new Response("error", {status: 503})],
    ["INVALID_JSON", (_, body) => new Response(body.slice(0, -1))],
    ["TRUNCATED_RESPONSE", (_, body) => new Response(body, {
      headers: {"content-length": String(Buffer.byteLength(body) + 1)}
    })],
    ["INVALID_RPC_RESPONSE", (_, body) => {
      const payload = JSON.parse(body);
      payload.result.cursor = "next";
      return new Response(JSON.stringify(payload));
    }],
    ["INVALID_RPC_RESPONSE", (_, body) => {
      const payload = JSON.parse(body);
      payload.result.context.slot = Number.MAX_SAFE_INTEGER + 1;
      return new Response(JSON.stringify(payload));
    }]
  ];
  for (const [reason, responseFor] of cases) {
    await t.test(reason, async () => {
      const fixture = offline({responseFor});
      assert.equal((await capture(fixture)).reason, reason);
      assert.equal(fixture.requests.length, 1);
    });
  }
});

test("time, byte, decode and request budgets are shared across all attempts", async () => {
  assert.equal((await capture(offline(), {bounds: {maxAttempts: 4}})).reason, "INVALID_BOUNDS");
  assert.equal((await capture(offline(), {bounds: {maxRequests: 7}})).reason, "INVALID_BOUNDS");
  const sizing = await capture(offline());
  const byteLimit = sizing.capture.consumed.responseBytes;
  const bytes = offline({slots: [100, 101, 102, 102]});
  const byteFailure = await capture(bytes, {bounds: {maxResponseBytes: byteLimit}});
  assert.equal(byteFailure.reason, "RESPONSE_BYTE_LIMIT");
  assert.equal(bytes.requests.length, 3);
  assert.ok(byteFailure.capture.consumed.responseBytes > byteLimit);
  const decode = offline({slots: [100, 101, 102, 102]});
  assert.equal((await capture(decode, {
    bounds: {maxDecodeWork: sizing.capture.consumed.decodeWork}
  })).reason, "DECODE_WORK_LIMIT");
  assert.equal(decode.requests.length, 3);
  const attempts = offline({slots: [100, 101]});
  assert.equal((await capture(attempts, {bounds: {maxAttempts: 1}})).reason, "SLOT_RACE_EXHAUSTED");
  assert.equal(attempts.requests.length, 2);
  const requests = offline({slots: [100, 101]});
  assert.equal((await capture(requests, {bounds: {maxRequests: 3}})).reason, "REQUEST_LIMIT");
  assert.equal(requests.requests.length, 2);
  let now = NOW;
  const timed = offline({slots: [100, 101], responseFor: (_, body) => {
    now += 6;
    return new Response(body);
  }});
  const timedResult = await capture(timed, {clock: () => now, bounds: {maxElapsedMs: 10}});
  assert.equal(timedResult.reason, "TIMEOUT");
  assert.equal(timed.requests.length, 2);
  assert.equal(timedResult.capture.consumed.acquisitionWallElapsedMs, 12);
  assert.equal(PROSPECTIVE_CENSUS_BOUNDS.maxRequests, 6);
  const limited = offline({accounts: [token(), token({address: 21})]});
  assert.equal((await capture(limited, {bounds: {maxAccounts: 1}})).reason, "ACCOUNT_COUNT_LIMIT");
  assert.equal(limited.requests.length, 1);
});

test("monotonic processing overrun rejects and cancels a late response despite fixed wall clock", async t => {
  const original = Object.getOwnPropertyDescriptor(performance, "now");
  let elapsed = 0;
  Object.defineProperty(performance, "now", {configurable: true, value: () => elapsed});
  t.after(() => {
    if (original) Object.defineProperty(performance, "now", original);
    else delete performance.now;
  });
  let cancelled = 0;
  const fixture = offline({responseFor: () => {
    elapsed = 100;
    return {status: 200, body: {cancel: () => { cancelled += 1; }}};
  }});
  const result = await capture(fixture, {bounds: {maxElapsedMs: 100}});
  assert.equal(result.reason, "TIMEOUT");
  assert.equal(result.capture.consumed.elapsedMs, 100);
  assert.equal(result.capture.consumed.acquisitionWallElapsedMs, 0);
  assert.equal(cancelled, 1);
  assert.equal(fixture.requests.length, 1);
});

test("cancellation and late responses are fenced; stream reads are cancelled", async () => {
  const already = new AbortController();
  already.abort();
  const fixture = offline();
  assert.equal((await capture(fixture, {signal: already.signal})).reason, "CANCELLED");
  assert.equal(fixture.requests.length, 0);
  for (const stop of ["cancel", "timeout"]) {
    const controller = new AbortController();
    let release;
    let dispatched;
    const entered = new Promise(resolve => { dispatched = resolve; });
    const response = new Promise(resolve => { release = resolve; });
    const pending = captureProspectiveOwnerCensus({
      enabled: true, identity: IDENTITY, clock: () => NOW,
      signal: controller.signal, bounds: {maxElapsedMs: stop === "timeout" ? 100 : 1000},
      transport: () => { dispatched(); return response; }
    });
    await entered;
    if (stop === "cancel") controller.abort();
    const result = await pending;
    assert.equal(result.reason, stop === "cancel" ? "CANCELLED" : "TIMEOUT");
    let cancelled = 0;
    release({body: {cancel: () => { cancelled += 1; }}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, 1);
    assert.equal(result.capture.exchanges.length, 0);
  }
  const controller = new AbortController();
  let cancelled = 0;
  const stream = offline({responseFor: () => ({
    status: 200, body: {getReader: () => ({
      read: () => { controller.abort(); return Promise.resolve({
        done: false, value: Buffer.from("partial")
      }); },
      cancel: () => { cancelled += 1; }, releaseLock() {}
    })}
  })});
  assert.equal((await capture(stream, {signal: controller.signal})).reason, "CANCELLED");
  assert.equal(cancelled, 1);
  const decoding = new AbortController();
  const batch = offline({
    accounts: Array.from({length: 257}, (_, index) => {
      const bytes = Buffer.alloc(32, 20);
      bytes.writeUInt32LE(index, 0);
      return {...token({amount: 0n}), pubkey: encodeBase58(bytes)};
    }),
    responseFor: (_, body) => {
      setTimeout(() => decoding.abort(), 0);
      return new Response(body);
    }
  });
  const cancelledDecode = await capture(batch, {signal: decoding.signal});
  assert.equal(cancelledDecode.reason, "CANCELLED");
  assert.equal(batch.requests.length, 1);
});

async function temporary(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "meridian-prospective-census-"));
  t.after(() => rm(parent, {recursive: true, force: true}));
  return parent;
}
function publish(store, fixture, options = {}) {
  return acquireAndPublishProspectiveOwnerCensus({
    enabled: true, store, datasetId: "census-T0", phase: "T0", identity: IDENTITY,
    clock: () => NOW, transport: fixture.transport, ...options
  });
}
test("immutable raw evidence readback, T0/T1 separate roots, and unchanged exact-reader UNKNOWN", async t => {
  const parent = await temporary(t);
  const root = path.join(parent, "T0");
  const store = new EvidenceWarmupStore(root, {enabled: true});
  const fixture = offline();
  assert.equal((await publish(store, fixture, {enabled: false})).status, "DISABLED");
  assert.equal(fixture.requests.length, 0);
  assert.equal((await publish(store, fixture, {phase: "historical"})).reason,
    "INVALID_PROSPECTIVE_PUBLICATION");
  assert.equal(fixture.requests.length, 0);
  const result = await publish(store, fixture);
  assert.equal(result.status, "PUBLISHED");
  assert.equal(result.realDataEntryEligible, false);
  const firstBytes = await readFile(path.join(root, "evidence-warmup.json"));
  const readback = await new EvidenceWarmupStore(root).read("census-T0");
  assert.equal(readback.status, "AVAILABLE");
  const record = readback.document.records[0];
  diagnostic(record.payload);
  assert.equal(record.payload.capture.phase, "T0");
  assert.equal(record.observedAtBasis, "LOCAL_ACQUISITION_TIME");
  assert.equal(record.completeness, "UNKNOWN");
  assert.equal(record.trust, "UNKNOWN");
  assert.equal(Object.isFrozen(record.payload.capture.exchanges), true);
  for (const exchange of record.payload.capture.exchanges) {
    assert.equal(hash(Buffer.from(exchange.response.body.bytes, "base64")),
      exchange.response.body.sha256);
  }
  assert.equal((await store.publish(readback.document)).status, "DUPLICATE");
  assert.equal((await publish(store, offline())).status, "CONFLICT");
  const changed = offline({slots: [101, 101]});
  assert.equal((await publish(store, changed, {phase: "T1", datasetId: "census-T1"})).status,
    "CONFLICT");
  assert.deepEqual(await readFile(path.join(root, "evidence-warmup.json")), firstBytes);
  const end = new EvidenceWarmupStore(path.join(parent, "T1"), {enabled: true});
  assert.equal((await publish(end, offline({slots: [101, 101]}), {
    phase: "T1", datasetId: "census-T1"
  })).status, "PUBLISHED");
  const query = {identity: IDENTITY, atMs: NOW, policyVersion: "prospective"};
  assert.equal((await createWarmupCensusSource(readback.document).readSnapshots({
    identity: IDENTITY, startAtMs: NOW, endAtMs: NOW + 1, policy: {version: "prospective"}
  })).status, "WARMUP");
  const coverage = warmupCoverage(readback.document, {
    identity: IDENTITY, censusEndpoints: [query]
  });
  assert.equal(coverage.exactAvailable.census.length, 0);
  assert.equal(coverage.realDataEntryEligible, false);
});

test("failed acquisition never publishes; partial storage writes and readback failures fail closed", async t => {
  const parent = await temporary(t);
  let publications = 0;
  const failed = await publish({enabled: true, read() {}, publish() { publications += 1; }},
    offline({accounts: []}));
  assert.equal(failed.status, "UNKNOWN");
  assert.equal(failed.publication, null);
  assert.equal(publications, 0);
  const root = path.join(parent, "partial");
  const store = new EvidenceWarmupStore(root, {enabled: true, fsOps: {
    open: async (...args) => {
      const handle = await open(...args);
      if (args[1] !== "wx") return handle;
      return {
        stat: () => handle.stat(), sync: () => handle.sync(), close: () => handle.close(),
        writeFile: async bytes => {
          await handle.writeFile(bytes.subarray(0, 20));
          throw new Error("injected partial write");
        }
      };
    }
  }});
  assert.equal((await publish(store, offline())).status, "UNKNOWN");
  assert.equal((await store.read("census-T0")).status, "ABSENT");
  await assert.rejects(readFile(path.join(root, "evidence-warmup.json")), {code: "ENOENT"});
  const failedReadback = await publish({
    enabled: true, publish: async () => ({status: "PUBLISHED", digest: "a".repeat(64)}),
    read: async () => ({status: "UNKNOWN"})
  }, offline());
  assert.equal(failedReadback.reason, "PROSPECTIVE_READBACK_FAILED");
});
