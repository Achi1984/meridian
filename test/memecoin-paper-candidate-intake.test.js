import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {
  readFile,
  mkdtemp,
  mkdir,
  writeFile,
  stat,
  lstat,
  rm,
  readdir,
  rename,
  symlink
} from "node:fs/promises";
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
    pairCreatedAt: NOW - FILTER_POLICY.minPairAgeMs,
    status: "PASS",
    verified: true,
    evidence: {marketCapUsd: {verified: true, status: "PASS"}}
  });
  const raw = snapshot(pair);
  const parsed = parseDexScreenerPair(pair, {sampledAt: NOW, observedAt: NOW});
  assert.equal(parsed.status, "PARTIAL");
  assert.equal(parsed.marketCapUsd, 1_000_000);
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
  assert.equal(requests[0].url,
    `https://api.dexscreener.com/latest/dex/pairs/solana/${IDENTITY.pool}`);
  assert.ok(requests.slice(1).every(request =>
    request.url === "https://api.mainnet-beta.solana.com" && request.method === "POST"));
  assert.equal(result.status, "ACQUISITION_FINISHED");
  assert.equal(result.events.length, 4);
  assert.equal(result.counters.requests, 4);
  assert.equal(result.events[0].observedAtBasis, "response-receipt-not-source-event-time");
  const candidate = result.candidates[0].candidate;
  assert.equal(candidate.evidence.marketCapUsd.value, 1_000_000);
  assert.equal(candidate.evidence.pairCreatedAt.value, pair.pairCreatedAt);
  for (const key of [
    "top10OwnerPct", "mintAuthorityRevoked", "freezeAuthorityRevoked",
    "lpProtection", "devAssociatedPct", "crediblePriorRug", "bundledLaunchPct",
    "tokenExtensions"
  ]) {
    assert.equal(candidate.evidence[key].value, null, `${key} remains unavailable`);
    assert.equal(candidate.evidence[key].verified, false, `${key} is not verified`);
  }
  const filters = filterCandidate(candidate, {now: NOW, holdUntil: NOW + 8 * 60 * 60 * 1000});
  assert.equal(filters.status, "UNKNOWN");
  assert.equal(filters.accepted, false);
  assert.equal(filters.checks.marketCap.status, "PASS");
  for (const key of [
    "top10Owners", "mintAuthority", "freezeAuthority", "lpProtection",
    "devHoldings", "priorRug", "bundledLaunch", "tokenExtensions"
  ]) {
    assert.equal(filters.checks[key].status, "UNKNOWN", `${key} remains UNKNOWN`);
  }
});

test("deterministic selection deduplicates mints without combining pool identities", async () => {
  const preferred = await pairFixture({
    pairAddress: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    pairCreatedAt: NOW - FILTER_POLICY.minPairAgeMs
  });
  const otherPool = await pairFixture({
    pairAddress: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
    pairCreatedAt: NOW - FILTER_POLICY.minPairAgeMs
  });
  const otherMint = await pairFixture({
    baseToken: {address: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"},
    pairAddress: "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
    pairCreatedAt: NOW - FILTER_POLICY.minPairAgeMs
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
    pairCreatedAt: NOW - FILTER_POLICY.minPairAgeMs
  });
  assert.equal(plan([snapshot(atMinimum)]).status, "OBSERVATION_PLAN_READY");
  const tooYoung = await pairFixture({
    pairCreatedAt: NOW - FILTER_POLICY.minPairAgeMs + 1
  });
  assert.ok(plan([snapshot(tooYoung)]).rejections.items
    .some(item => item.code === "PAIR_YOUNGER_THAN_MINIMUM_AT_SAMPLE"));

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
  const base = await pairFixture({pairCreatedAt: NOW - FILTER_POLICY.minPairAgeMs});
  const missingSample = {...snapshot(base)};
  delete missingSample.sampledAt;
  const futureSample = snapshot(base, {sampledAt: NOW + 1});
  const missingCreatedAt = await pairFixture();
  delete missingCreatedAt.pairCreatedAt;
  const futurePairTime = await pairFixture({pairCreatedAt: NOW + 1});
  const wrongChain = await pairFixture({chainId: "ethereum"});
  const fdvOnly = await pairFixture({marketCap: undefined, fdv: 99_000_000});
  const invalidNumber = await pairFixture({marketCap: Number.POSITIVE_INFINITY});
  const nonNumeric = await pairFixture({marketCap: "1000000"});
  const cases = [
    [missingSample, "MISSING_OR_INVALID_SAMPLE_TIME"],
    [futureSample, "FUTURE_SAMPLE_TIME"],
    [snapshot(missingCreatedAt), "MISSING_OR_INVALID_PAIR_TIME"],
    [snapshot(futurePairTime), "FUTURE_PAIR_TIME"],
    [snapshot(wrongChain), "WRONG_CHAIN"],
    [snapshot(fdvOnly), "MISSING_MARKET_CAP"],
    [snapshot(invalidNumber), "INVALID_MARKET_CAP"],
    [snapshot(nonNumeric), "INVALID_MARKET_CAP"]
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

test("malformed address values are rejected without aborting eligible rows", async () => {
  const valid = await pairFixture({
    pairCreatedAt: NOW - FILTER_POLICY.minPairAgeMs
  });
  const wrongChain = await pairFixture({
    chainId: "ethereum",
    baseToken: {address: {toString: null}}
  });
  const malformedAddresses = [
    await pairFixture({baseToken: {address: [IDENTITY.mint]}}),
    await pairFixture({pairAddress: [IDENTITY.pool]}),
    await pairFixture({quoteToken: {address: [IDENTITY.quote]}})
  ];
  const result = plan([
    snapshot(wrongChain),
    ...malformedAddresses.map(snapshot),
    snapshot(valid)
  ]);
  assert.equal(result.status, "OBSERVATION_PLAN_READY");
  assert.deepEqual(result.identity, IDENTITY);
  const wrongChainRejection = result.rejections.items.find(item => item.code === "WRONG_CHAIN");
  assert.ok(wrongChainRejection);
  assert.equal(Object.hasOwn(wrongChainRejection, "mint"), false);
  assert.equal(result.rejections.items.filter(item => item.code === "INVALID_IDENTITY").length, 3);
});

test("planning revalidates snapshot freshness and refuses stale timestamps", async () => {
  const pair = await pairFixture({pairCreatedAt: NOW - 60 * 60 * 1000});
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

test("FIFO input is rejected promptly before reading", async t => {
  if (process.platform !== "linux") return t.skip("FIFO regression uses Linux file descriptors");
  const directory = await harness(t);
  const fifo = path.join(directory, "snapshots.fifo");
  const created = spawnSync("mkfifo", [fifo], {encoding: "utf8"});
  assert.equal(created.status, 0, created.stderr);
  const moduleUrl = new URL("../scripts/memecoin-paper/candidate-intake.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    `import(${JSON.stringify(moduleUrl)}).then(({readSnapshotFile}) => readSnapshotFile(process.argv[1]))`,
    fifo
  ], {encoding: "utf8", timeout: 1_000});
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /input must be a regular file/);
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

  const raced = path.join(directory, "raced.json");
  const replacement = Buffer.from("replacement from another process");
  await assert.rejects(writeExclusiveConfig(raced, Buffer.from("partial"), {
    sync: async handle => {
      await handle.sync();
      await writeFile(raced, replacement, {flag: "wx"});
      throw new Error("injected sync failure");
    }
  }), /injected sync failure/);
  assert.deepEqual(await readFile(raced), replacement);

  const symlink = path.join(directory, "linked");
  await mkdir(path.join(directory, "real"));
  await (await import("node:fs/promises")).symlink(path.join(directory, "real"), symlink);
  await assert.rejects(writeExclusiveConfig(path.join(symlink, "unsafe.json"), Buffer.from("x")),
    /real directories/);
});

test("directory swaps cannot redirect staged publication or cleanup", async t => {
  const directory = await harness(t);
  const outputDirectory = path.join(directory, "output");
  const movedDirectory = path.join(directory, "moved-output");
  const replacementDirectory = path.join(directory, "replacement");
  await mkdir(outputDirectory);
  await mkdir(replacementDirectory);
  const replacementSentinel = path.join(replacementDirectory, "keep.txt");
  await writeFile(replacementSentinel, "preserve replacement directory");
  const output = path.join(outputDirectory, "run-config.json");
  const intended = Buffer.from("intended config bytes");
  const substitute = Buffer.from("substituted staging bytes");

  await assert.rejects(writeExclusiveConfig(output, intended, {
    write: async (handle, data) => {
      const stagingName = (await readdir(outputDirectory))
        .find(name => name.startsWith(".candidate-intake-"));
      assert.ok(stagingName);
      await rename(outputDirectory, movedDirectory);
      await symlink(replacementDirectory, outputDirectory);
      const replacementStaging = path.join(replacementDirectory, stagingName);
      await mkdir(replacementStaging);
      await writeFile(path.join(replacementStaging, "config"), substitute, {mode: 0o644});
      await handle.writeFile(data);
    }
  }), /real directories/);

  await assert.rejects(readFile(output), {code: "ENOENT"});
  assert.deepEqual(await readFile(replacementSentinel), Buffer.from("preserve replacement directory"));
  const replacementStageName = (await readdir(replacementDirectory))
    .find(name => name.startsWith(".candidate-intake-"));
  assert.ok(replacementStageName);
  assert.deepEqual(await readFile(path.join(replacementDirectory, replacementStageName, "config")),
    substitute);
  assert.equal((await stat(path.join(replacementDirectory, replacementStageName, "config"))).mode & 0o777,
    0o644);
  assert.deepEqual(await readdir(movedDirectory), []);
});

test("staging replacement and failed exclusive open preserve unowned files and directories", async t => {
  const directory = await harness(t);

  const privateDirectory = path.join(directory, "private-target");
  await mkdir(privateDirectory, {mode: 0o700});
  const privateConfig = path.join(privateDirectory, "config");
  await writeFile(privateConfig, "pre-existing private config");
  const symlinkOutput = path.join(directory, "symlink-replacement.json");
  const symlinkStage = path.join(directory, "moved-symlink-stage");
  let symlinkStageName;
  await assert.rejects(writeExclusiveConfig(symlinkOutput, Buffer.from("intended"), {
    beforeOpenStagingDirectory: async stagingPath => {
      symlinkStageName = path.basename(stagingPath);
      await rename(stagingPath, symlinkStage);
      await symlink(privateDirectory, stagingPath);
    }
  }), /ELOOP|ENOTDIR/);
  assert.deepEqual(await readFile(privateConfig), Buffer.from("pre-existing private config"));
  assert.ok((await lstat(path.join(directory, symlinkStageName))).isSymbolicLink());

  const realOutput = path.join(directory, "real-replacement.json");
  const realStage = path.join(directory, "moved-real-stage");
  let realStageName;
  await assert.rejects(writeExclusiveConfig(realOutput, Buffer.from("intended"), {
    beforeOpenStagingDirectory: async stagingPath => {
      realStageName = path.basename(stagingPath);
      await rename(stagingPath, realStage);
      await mkdir(stagingPath, {mode: 0o700});
      await writeFile(path.join(stagingPath, "config"), "unowned replacement config");
      await writeFile(path.join(stagingPath, "sentinel"), "unowned replacement contents");
    }
  }), /identity changed/);
  assert.deepEqual(await readFile(path.join(directory, realStageName, "config")),
    Buffer.from("unowned replacement config"));
  assert.deepEqual(await readFile(path.join(directory, realStageName, "sentinel")),
    Buffer.from("unowned replacement contents"));

  const failedOutput = path.join(directory, "exclusive-open-failure.json");
  let failedStageName;
  await assert.rejects(writeExclusiveConfig(failedOutput, Buffer.from("intended"), {
    beforeOpenStagedConfig: async (stagedOutput, stagingDirectory) => {
      failedStageName = path.basename(stagingDirectory);
      await writeFile(stagedOutput, "pre-existing staged config");
    }
  }), {code: "EEXIST"});
  assert.deepEqual(await readFile(path.join(directory, failedStageName, "config")),
    Buffer.from("pre-existing staged config"));
});

test("post-publication directory open and sync failures report verified uncertain durability", async t => {
  const directory = await harness(t);
  const inputPath = path.join(directory, "snapshots.json");
  const pair = await pairFixture({pairCreatedAt: NOW - 60 * 60 * 1000});
  await writeFile(inputPath, JSON.stringify(input([snapshot(pair)])));

  const failures = [
    ["parent open", {openDirectory: async () => { throw new Error("injected parent open failure"); }}],
    ["parent sync", {
      syncDirectory: async handle => {
        await handle.sync();
        throw new Error("injected parent sync failure");
      }
    }]
  ];
  for (const [label, publicationOptions] of failures) {
    const output = path.join(directory, `${label.replace(" ", "-")}.json`);
    const result = await runCandidateIntake({
      input: inputPath,
      output,
      runId: "uncertain-durability-test",
      startAt: START_AT,
      now: NOW
    }, publicationOptions);

    assert.equal(result.status, "OBSERVATION_PLAN_PUBLISHED_DURABILITY_UNCERTAIN");
    assert.equal(result.publicationStatus, "PUBLISHED_DURABILITY_UNCERTAIN");
    assert.deepEqual(result.identity, IDENTITY);
    assert.equal(result.executionAuthorized, false);
    const publishedBytes = await readFile(output);
    assert.equal(createHash("sha256").update(publishedBytes).digest("hex"), result.configHash);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
  }
});

test("FIFO and oversized replacements after publication remain bounded and uncertain", async t => {
  if (process.platform !== "linux") return t.skip("publication regression uses Linux file descriptors");
  const directory = await harness(t);
  const inputPath = path.join(directory, "snapshots.json");
  const pair = await pairFixture({pairCreatedAt: NOW - 60 * 60 * 1000});
  await writeFile(inputPath, JSON.stringify(input([snapshot(pair)])));
  const moduleUrl = new URL("../scripts/memecoin-paper/candidate-intake.mjs", import.meta.url).href;
  const program = `
    import {unlink, writeFile} from "node:fs/promises";
    import {spawnSync} from "node:child_process";
    import {runCandidateIntake} from ${JSON.stringify(moduleUrl)};
    const [input, output, startAt, mode] = process.argv.slice(1);
    const result = await runCandidateIntake({
      input, output, runId: "replacement-durability-test",
      startAt: Number(startAt), now: ${NOW}
    }, {
      openDirectory: async directory => {
        await unlink(output);
        if (mode === "fifo") {
          const created = spawnSync("mkfifo", [output]);
          if (created.status !== 0) throw new Error("could not create replacement FIFO");
        } else {
          await writeFile(output, Buffer.alloc(16 * 1024 * 1024, 0x78), {mode: 0o600});
        }
        throw new Error("injected post-publication directory-open failure");
      }
    });
    console.log(JSON.stringify(result));
  `;

  for (const mode of ["fifo", "large"]) {
    const output = path.join(directory, `${mode}-replacement.json`);
    const child = spawnSync(process.execPath, [
      "--input-type=module", "-e", program, inputPath, output, String(START_AT), mode
    ], {encoding: "utf8", timeout: 3_000});
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, "OBSERVATION_PLAN_PUBLISHED_DURABILITY_UNCERTAIN");
    assert.equal(result.publicationStatus, "PUBLISHED_DURABILITY_UNCERTAIN");
    assert.deepEqual(result.identity, IDENTITY);
    assert.equal(result.hardGateStatus, "UNKNOWN");
    assert.equal(result.executionAuthorized, false);
    assert.match(result.configHash, /^[a-f0-9]{64}$/);

    const replacement = await stat(output);
    if (mode === "fifo") {
      assert.ok(replacement.isFIFO());
    } else {
      assert.equal(replacement.size, 16 * 1024 * 1024);
    }
  }
});

test("no eligible candidate creates no config, and bounded rejection metadata stays caller-only", async t => {
  const directory = await harness(t);
  const output = path.join(directory, "never-created.json");
  const inputPath = path.join(directory, "snapshots.json");
  const pair = await pairFixture({
    pairCreatedAt: NOW - FILTER_POLICY.minPairAgeMs,
    marketCap: null,
    fdv: 50_000_000
  });
  await writeFile(inputPath, JSON.stringify(input([snapshot(pair)])));
  const result = plan([snapshot(pair)], {output});
  assert.equal(result.status, "OBSERVATION_PLAN_BLOCKED");
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.provenance.source, CALLER_SNAPSHOT_SOURCE);
  assert.ok(result.rejections.items.some(item => item.code === "MISSING_MARKET_CAP"));
  const run = await runCandidateIntake({
    input: inputPath,
    output,
    runId: "blocked-intake-test",
    startAt: START_AT,
    now: NOW
  });
  assert.equal(run.status, "OBSERVATION_PLAN_BLOCKED");
  await assert.rejects(readFile(output), {code: "ENOENT"});
});

test("the documented executable CLI writes the config and returns bounded plan metadata", async t => {
  const directory = await harness(t);
  const inputPath = path.join(directory, "snapshots.json");
  const output = path.join(directory, "run-config.json");
  const now = Date.now();
  const startAt = now + 60_000;
  const pair = await pairFixture({
    pairCreatedAt: now - 60 * 60 * 1000
  });
  await writeFile(inputPath, JSON.stringify(input([snapshot(pair, {sampledAt: now})])));
  const cli = path.join(ROOT, "scripts/memecoin-paper/candidate-intake.mjs");
  const result = spawnSync(process.execPath, [
    cli, "--input", inputPath, "--output", output,
    "--run-id", "candidate-intake-cli-test", "--start-at", String(startAt)
  ], {encoding: "utf8", timeout: 5_000});
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "OBSERVATION_PLAN_READY");
  assert.equal(report.publicationStatus, "PUBLISHED_DURABLE");
  assert.equal(report.executionAuthorized, false);
  assert.equal(report.hardGateStatus, "UNKNOWN");
  assert.equal(report.configHash, createHash("sha256")
    .update(await readFile(output)).digest("hex"));
  assert.deepEqual(report.identity, IDENTITY);
});
