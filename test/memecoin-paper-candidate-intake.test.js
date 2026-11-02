import assert from "node:assert/strict";
import {readFile, mkdtemp, mkdir, writeFile, stat, rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {acquireProviderEvidence} from "../scripts/memecoin-paper/provider-evidence.mjs";
import {parseDexScreenerPair} from "../scripts/memecoin-paper/adapters.mjs";
import {createRunConfig} from "../scripts/memecoin-paper/create-run-config.mjs";
import {FILTER_POLICY, filterCandidate} from "../scripts/memecoin-paper/stages.mjs";
import {canonicalJson} from "../scripts/memecoin-paper/pilot-online.mjs";
import {
  CALLER_SNAPSHOT_SOURCE,
  MAX_INPUT_BYTES,
  MAX_SNAPSHOTS,
  buildCandidateIntakePlan,
  readSnapshotFile,
  runCandidateIntake,
  writeExclusiveConfig
} from "../scripts/memecoin-paper/candidate-intake.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "test/fixtures/memecoin-paper-provider-evidence");
const NOW = Date.parse("2026-11-02T15:00:00Z");
const START_AT = NOW + 60_000;
const END_AT = START_AT + 8 * 60 * 60 * 1000;
const IDENTITY = Object.freeze({
  chainId: "solana",
  mint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  pool: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  quote: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
});

async function fixture(name) {
  return JSON.parse(await readFile(path.join(FIXTURES, name), "utf8"));
}

async function pairFixture(overrides = {}) {
  const pair = (await fixture("dex-pair.json")).pairs[0];
  return {...pair, ...overrides};
}

function snapshot(pair, overrides = {}) {
  return {sampledAt: NOW, pair, ...overrides};
}

function input(snapshots, overrides = {}) {
  return {originLabel: "operator-provided fixture", snapshots, ...overrides};
}

function plan(snapshots, overrides = {}) {
  return buildCandidateIntakePlan({
    input: input(snapshots),
    output: "/tmp/meridian-candidate-intake-config.json",
    runId: "candidate-intake-test",
    startAt: START_AT,
    now: NOW,
    ...overrides
  });
}

async function harness(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meridian-candidate-intake-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

function response(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {"content-type": "application/json"}
  });
}

test("offline intake normalizes caller snapshots and emits only a canonical observation config", async t => {
  const directory = await harness(t);
  const output = path.join(directory, "run-config.json");
  const pair = await pairFixture({
    pairCreatedAt: START_AT - FILTER_POLICY.minPairAgeMs,
    status: "PASS",
    verified: true,
    evidence: {marketCapUsd: {verified: true, status: "PASS"}}
  });
  const raw = snapshot(pair);
  const parsed = parseDexScreenerPair(pair, {sampledAt: NOW, observedAt: NOW});
  assert.equal(parsed.status, "PARTIAL");
  assert.equal(parsed.marketCapUsd, 1_000_000);

  const result = await runCandidateIntake({
    input: path.join(directory, "snapshots.json"),
    output,
    runId: "candidate-intake-test",
    startAt: START_AT,
    now: NOW
  }).catch(error => error);
  assert.equal(result.code, "ENOENT");
  await writeFile(path.join(directory, "snapshots.json"),
    JSON.stringify(input([raw])));
  const ready = await runCandidateIntake({
    input: path.join(directory, "snapshots.json"),
    output,
    runId: "candidate-intake-test",
    startAt: START_AT,
    now: NOW
  });
  assert.equal(ready.status, "OBSERVATION_PLAN_READY");
  assert.equal(ready.executionAuthorized, false);
  assert.equal(ready.provenance.source, CALLER_SNAPSHOT_SOURCE);
  assert.equal(ready.provenance.authenticated, false);
  assert.equal(ready.hardGateStatus, "UNKNOWN");
  assert.deepEqual(ready.identity, IDENTITY);
  assert.deepEqual(ready.window, {
    startAt: START_AT,
    endAt: END_AT,
    durationMs: 8 * 60 * 60 * 1000
  });
  const configText = await readFile(output, "utf8");
  const config = JSON.parse(configText);
  assert.deepEqual(config, createRunConfig({
    output,
    runId: "candidate-intake-test",
    startAt: START_AT,
    ...IDENTITY
  }));
  assert.equal(configText, canonicalJson(config));
  assert.equal(ready.configHash, createHash("sha256").update(configText).digest("hex"));
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  const filters = filterCandidate({
    chainId: "solana",
    mint: IDENTITY.mint,
    pool: IDENTITY.pool,
    quote: IDENTITY.quote,
    source: CALLER_SNAPSHOT_SOURCE,
    sampledAt: NOW,
    pairCreatedAt: pair.pairCreatedAt,
    marketCapUsd: pair.marketCap,
    decimals: null,
    evidence: Object.fromEntries(["pairCreatedAt", "marketCapUsd"].map(key => [key, {
      value: key === "marketCapUsd" ? pair.marketCap : pair.pairCreatedAt,
      source: CALLER_SNAPSHOT_SOURCE,
      observedAt: NOW,
      verified: false,
      coverage: {complete: false},
      binding: IDENTITY
    }]))
  }, {now: NOW, holdUntil: END_AT});
  assert.equal(filters.status, "UNKNOWN");
  assert.equal(filters.checks.marketCap.status, "UNKNOWN");
});

test("the actual fixed four-request provider path normalizes data but missing risk evidence stays UNKNOWN", async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, "scripts/memecoin-paper/run-manifest.json"), "utf8"));
  manifest.enabled = true;
  manifest.runId = "candidate-intake-provider-test";
  manifest.startAt = NOW;
  manifest.endAt = NOW + 8 * 60 * 60 * 1000;
  manifest.stopSwitch.engaged = false;
  manifest.providers.forEach(provider => { provider.enabled = true; });
  manifest.allowedMints = [IDENTITY.mint];
  manifest.allowedPools = [IDENTITY.pool];
  const pair = await pairFixture({pairCreatedAt: NOW - 60 * 60 * 1000});
  const requests = [];
  const result = await acquireProviderEvidence({
    manifest,
    candidates: [IDENTITY],
    enabled: true,
    clock: () => NOW,
    freshnessPolicy: {
      maxAcquisitionDurationMs: 30_000,
      maxPairAgeMs: 72 * 60 * 60 * 1000,
      maxFutureSkewMs: 0
    },
    transport: async request => {
      requests.push(request);
      if (request.provider === "dex") return response({pairs: [pair]});
      const fixtureName = {
        getAccountInfo: "get-account-info.json",
        getTokenLargestAccounts: "get-largest-accounts.json",
        getTokenSupply: "get-token-supply.json"
      }[request.kind];
      const rpc = await fixture(fixtureName);
      rpc.id = request.id;
      return response(rpc);
    }
  });
  assert.equal(requests.length, 4);
  assert.deepEqual(requests.map(request => request.kind), [
    "pair", "getAccountInfo", "getTokenLargestAccounts", "getTokenSupply"
  ]);
  assert.equal(result.status, "ACQUISITION_FINISHED");
  assert.equal(result.events.length, 4);
  assert.equal(result.events[0].observedAtBasis, "response-receipt-not-source-event-time");
  const candidate = result.candidates[0].candidate;
  assert.equal(candidate.evidence.marketCapUsd.value, 1_000_000);
  assert.equal(candidate.evidence.pairCreatedAt.value, pair.pairCreatedAt);
  assert.equal(candidate.evidence.top10OwnerPct.verified, false);
  assert.equal(candidate.evidence.mintAuthorityRevoked.verified, false);
  const filters = filterCandidate(candidate, {now: NOW, holdUntil: NOW + 8 * 60 * 60 * 1000});
  assert.equal(filters.status, "UNKNOWN");
  assert.equal(filters.accepted, false);
  assert.equal(filters.checks.marketCap.status, "PASS");
  assert.equal(filters.checks.top10Owners.status, "UNKNOWN");
  assert.equal(filters.checks.mintAuthority.status, "UNKNOWN");
});

test("deterministic selection deduplicates mints without combining pool identities", async () => {
  const preferred = await pairFixture({
    pairAddress: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    pairCreatedAt: START_AT - FILTER_POLICY.minPairAgeMs
  });
  const otherPool = await pairFixture({
    pairAddress: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
    pairCreatedAt: START_AT - FILTER_POLICY.minPairAgeMs
  });
  const otherMint = await pairFixture({
    baseToken: {address: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"},
    pairAddress: "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
    pairCreatedAt: START_AT - FILTER_POLICY.minPairAgeMs
  });
  const first = plan([snapshot(otherPool), snapshot(otherMint), snapshot(preferred)]);
  const second = plan([snapshot(preferred), snapshot(otherMint), snapshot(otherPool)]);
  assert.equal(first.status, "OBSERVATION_PLAN_READY");
  assert.deepEqual(first.identity, second.identity);
  assert.equal(first.identity.pool, preferred.pairAddress);
  assert.equal(first.rejections.items.filter(item =>
    item.code === "DUPLICATE_MINT_POOL_NOT_MIXED").length, 1);
  const explicit = plan([snapshot(otherPool), snapshot(preferred)], {
    selection: {mint: IDENTITY.mint, pool: otherPool.pairAddress, quote: IDENTITY.quote}
  });
  assert.equal(explicit.identity.pool, otherPool.pairAddress);
});

test("pair age boundaries reserve the complete eight-hour window and enforce the minimum age", async () => {
  const atMinimum = await pairFixture({
    pairCreatedAt: START_AT - FILTER_POLICY.minPairAgeMs
  });
  assert.equal(plan([snapshot(atMinimum)]).status, "OBSERVATION_PLAN_READY");
  const tooYoung = await pairFixture({
    pairCreatedAt: START_AT - FILTER_POLICY.minPairAgeMs + 1
  });
  assert.ok(plan([snapshot(tooYoung)]).rejections.items
    .some(item => item.code === "PAIR_YOUNGER_THAN_MINIMUM_AT_START"));

  const atMaximum = await pairFixture({
    pairCreatedAt: END_AT - FILTER_POLICY.maxPairAgeMs
  });
  assert.equal(plan([snapshot(atMaximum)]).status, "OBSERVATION_PLAN_READY");
  const tooOld = await pairFixture({
    pairCreatedAt: END_AT - FILTER_POLICY.maxPairAgeMs - 1
  });
  assert.ok(plan([snapshot(tooOld)]).rejections.items
    .some(item => item.code === "PAIR_EXPIRES_BEFORE_WINDOW_END"));
});

test("missing and future times, wrong chains, identity mismatch, FDV-only and invalid numbers block intake", async () => {
  const base = await pairFixture({pairCreatedAt: START_AT - FILTER_POLICY.minPairAgeMs});
  const missingSample = {...snapshot(base)};
  delete missingSample.sampledAt;
  const futureSample = snapshot(base, {sampledAt: NOW + 1});
  const missingCreatedAt = await pairFixture();
  delete missingCreatedAt.pairCreatedAt;
  const wrongChain = await pairFixture({chainId: "ethereum"});
  const fdvOnly = await pairFixture({marketCap: undefined, fdv: 99_000_000});
  const invalidNumber = await pairFixture({marketCap: Number.POSITIVE_INFINITY});
  const cases = [
    [missingSample, "MISSING_OR_INVALID_SAMPLE_TIME"],
    [futureSample, "FUTURE_SAMPLE_TIME"],
    [snapshot(missingCreatedAt), "MISSING_OR_INVALID_PAIR_TIME"],
    [snapshot(wrongChain), "WRONG_CHAIN"],
    [snapshot(fdvOnly), "MISSING_MARKET_CAP"],
    [snapshot(invalidNumber), "INVALID_MARKET_CAP"]
  ];
  for (const [candidate, code] of cases) {
    const result = plan([candidate]);
    assert.equal(result.status, "OBSERVATION_PLAN_BLOCKED", code);
    assert.ok(result.rejections.items.some(item => item.code === code), code);
    assert.equal(result.configHash, null);
  }
  const wrongPoolOrQuote = plan([snapshot(base)], {
    selection: {
      mint: IDENTITY.mint,
      pool: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
      quote: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
    }
  });
  assert.equal(wrongPoolOrQuote.status, "OBSERVATION_PLAN_BLOCKED");
  assert.ok(wrongPoolOrQuote.rejections.items
    .some(item => item.code === "EXPLICIT_IDENTITY_NOT_ELIGIBLE"));
});

test("planning revalidates snapshot freshness and refuses stale timestamps", async () => {
  const pair = await pairFixture({pairCreatedAt: START_AT - FILTER_POLICY.minPairAgeMs});
  const freshBoundary = snapshot(pair, {
    sampledAt: NOW - FILTER_POLICY.maxEvidenceAgeMs
  });
  assert.equal(plan([freshBoundary]).status, "OBSERVATION_PLAN_READY");
  const stale = snapshot(pair, {
    sampledAt: NOW - FILTER_POLICY.maxEvidenceAgeMs - 1
  });
  assert.ok(plan([stale]).rejections.items.some(item => item.code === "STALE_SAMPLE"));
});

test("input byte and row limits are enforced, and rejection output remains bounded", async t => {
  const directory = await harness(t);
  const oversized = path.join(directory, "oversized.json");
  await writeFile(oversized, Buffer.alloc(MAX_INPUT_BYTES + 1, 0x20));
  await assert.rejects(readSnapshotFile(oversized), /byte limit/);
  assert.throws(() => plan(Array.from({length: MAX_SNAPSHOTS + 1}, () => ({}))),
    /at most 300/);
  const bounded = plan(Array.from({length: MAX_SNAPSHOTS}, () => ({})));
  assert.equal(bounded.rejections.items.length, 40);
  assert.equal(bounded.rejections.totalRecorded, MAX_SNAPSHOTS);
  assert.equal(bounded.rejections.truncated, true);
});

test("exclusive output preserves existing files, cleans partial failures, and rejects unsafe directories", async t => {
  const directory = await harness(t);
  const existing = path.join(directory, "existing.json");
  const original = Buffer.from("keep this file");
  await writeFile(existing, original);
  await assert.rejects(writeExclusiveConfig(existing, Buffer.from("replace me")), {code: "EEXIST"});
  assert.deepEqual(await readFile(existing), original);

  const failed = path.join(directory, "failed.json");
  await assert.rejects(writeExclusiveConfig(failed, Buffer.from("partial"), {
    write: async () => { throw new Error("injected write failure"); }
  }), /injected write failure/);
  await assert.rejects(readFile(failed), {code: "ENOENT"});

  const symlink = path.join(directory, "linked");
  await mkdir(path.join(directory, "real"));
  await (await import("node:fs/promises")).symlink(path.join(directory, "real"), symlink);
  await assert.rejects(writeExclusiveConfig(path.join(symlink, "unsafe.json"), Buffer.from("x")),
    /real directories/);
});

test("no eligible candidate creates no config, and bounded rejection metadata stays caller-only", async t => {
  const directory = await harness(t);
  const output = path.join(directory, "never-created.json");
  const pair = await pairFixture({
    pairCreatedAt: START_AT - FILTER_POLICY.minPairAgeMs,
    marketCap: null,
    fdv: 50_000_000
  });
  const result = plan([snapshot(pair)], {output});
  assert.equal(result.status, "OBSERVATION_PLAN_BLOCKED");
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.provenance.source, CALLER_SNAPSHOT_SOURCE);
  assert.ok(result.rejections.items.some(item => item.code === "MISSING_MARKET_CAP"));
  await assert.rejects(readFile(output), {code: "ENOENT"});
});
