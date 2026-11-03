import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {lstat, mkdir, mkdtemp, open, rm, symlink} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {buildAnalystWindowEvidence} from "../scripts/memecoin-paper/analyst-window-evidence.mjs";
import {
  EvidenceWarmupStore,
  acquireAndPublishOwnerCensus,
  createWarmupCensusSource,
  createWarmupPriceSource,
  warmupCoverage
} from "../scripts/memecoin-paper/evidence-warmup/index.mjs";
import {
  SYNTHETIC_MINT,
  SYNTHETIC_POOL,
  SYNTHETIC_QUOTE
} from "../scripts/memecoin-paper/synthetic-fixtures.mjs";
import {makeFixture} from "./fixtures/memecoin-paper-analyst-window-evidence/source-shaped.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");

async function temporaryStore(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "meridian-evidence-warmup-"));
  const root = path.join(parent, "store");
  t.after(() => rm(parent, {recursive: true, force: true}));
  return {parent, root};
}

function priceRecord(identity, atMs, {
  source = "price-source",
  trust = "REVIEWED",
  completeness = "COMPLETE",
  valueUsd = 1,
  methodologyVersion = "method-v1",
  receivedAt = atMs + 1
} = {}) {
  const payload = {
    status: "SOURCE_BOUND",
    source,
    mint: identity.mint,
    denomination: "USD",
    methodologyVersion,
    sourceAtMs: atMs,
    receivedAt,
    valueUsd,
    receipt: {status: "SOURCE_BOUND", id: `price-${atMs}`, source,
      payloadSha256: hash(`price-${atMs}`), receivedAt}
  };
  return {kind: "price", identity, mint: identity.mint, sourceAtMs: atMs,
    denomination: "USD", methodologyVersion, receivedAt, source, trust,
    completeness, payload};
}

test("warmup is disabled by default and publishes immutable digest-verified records", async t => {
  const {root} = await temporaryStore(t);
  const disabled = new EvidenceWarmupStore(root);
  assert.deepEqual(await disabled.publish({}), {status: "DISABLED"});

  const identity = {chainId: "solana", mint: "mint", pool: "pool", quote: "quote"};
  const record = priceRecord(identity, 100_000);
  const input = {datasetId: "immutable-1", identity, capturedAt: 100_010,
    records: [record], versions: {source: "v1"}};
  const store = new EvidenceWarmupStore(root, {enabled: true});
  const published = await store.publish(input);
  assert.equal(published.status, "PUBLISHED");
  assert.equal((await store.publish(input)).status, "DUPLICATE");

  const restarted = new EvidenceWarmupStore(root);
  const read = await restarted.read("immutable-1");
  assert.equal(read.status, "AVAILABLE");
  assert.equal(read.digest, published.digest);
  assert.equal(read.byteLength, published.byteLength);
  assert.equal(Object.isFrozen(read.document.records[0].payload), true);

  const changed = {...record, payload: {...record.payload, valueUsd: 2}};
  assert.equal((await store.publish({...input, records: [changed]})).status, "CONFLICT");

  const handle = await open(path.join(root, "evidence-warmup.json"), "r+");
  try {
    await handle.write(Buffer.from("tampered"), 0, 8, published.byteLength - 8);
  } finally {
    await handle.close();
  }
  assert.equal((await restarted.read("immutable-1")).status, "UNKNOWN");
});

test("price source serves only exact, complete reviewed records; UNKNOWN never upgrades", async t => {
  const {root} = await temporaryStore(t);
  const identity = {chainId: "solana", mint: "mint", pool: "pool", quote: "quote"};
  const exact = priceRecord(identity, 900_000);
  const unknown = priceRecord(identity, 1_000_000, {trust: "UNKNOWN"});
  const incomplete = priceRecord(identity, 1_100_000, {completeness: "UNKNOWN"});
  const store = new EvidenceWarmupStore(root, {enabled: true});
  assert.equal((await store.publish({datasetId: "exact-prices", identity, capturedAt: 1_200_000,
    records: [exact, unknown, incomplete]})).status, "PUBLISHED");
  const dataset = (await new EvidenceWarmupStore(root).read("exact-prices")).document;
  const source = createWarmupPriceSource(dataset);
  assert.equal((await source.readObservation({
    mint: identity.mint, atMs: exact.sourceAtMs, denomination: "USD"
  })).valueUsd, 1);
  assert.equal(await source.readObservation({
    mint: identity.mint, atMs: exact.sourceAtMs + 1, denomination: "USD"
  }), null);
  assert.equal(await source.readObservation({
    mint: identity.mint, atMs: unknown.sourceAtMs, denomination: "USD"
  }), null);
  assert.equal(await source.readObservation({
    mint: identity.mint, atMs: incomplete.sourceAtMs, denomination: "USD"
  }), null);
});

test("duplicate exact keys and mismatched payload bindings stay unavailable in readers and status", async t => {
  const {root} = await temporaryStore(t);
  const identity = {chainId: "solana", mint: "mint", pool: "pool", quote: "quote"};
  const duplicate = priceRecord(identity, 900_000);
  const store = new EvidenceWarmupStore(root, {enabled: true});
  assert.equal((await store.publish({datasetId: "duplicate-price", identity,
    capturedAt: 1_000_000, records: [duplicate, structuredClone(duplicate)]})).reason,
  "DUPLICATE_LOGICAL_RECORD");
  const mismatched = priceRecord(identity, 910_000);
  mismatched.payload.mint = "other-mint";
  assert.equal((await store.publish({datasetId: "mismatched-price", identity,
    capturedAt: 1_000_000, records: [mismatched]})).status, "UNKNOWN");
  const mismatchedDataset = {datasetId: "mismatched-memory", identity, capturedAt: 1_000_000,
    records: [mismatched]};
  assert.equal(await createWarmupPriceSource(mismatchedDataset).readObservation({
    mint: identity.mint, atMs: mismatched.sourceAtMs, denomination: "USD"
  }), null);
  assert.equal(warmupCoverage(mismatchedDataset, {
    identity,
    priceEndpoints: [{mint: identity.mint, atMs: mismatched.sourceAtMs, denomination: "USD"}]
  }).exactMissing.prices.length, 1);

  const censusFixture = makeFixture({buyCount: 1, sellCount: 1});
  const census = await censusFixture.censusSource.readSnapshots({
    identity: censusFixture.identity,
    startAtMs: censusFixture.candidateT - 3_600_000,
    endAtMs: censusFixture.candidateT,
    policy: censusFixture.policy.censusPolicy
  });
  const [snapshot] = census.snapshots;
  const censusRecord = {
    kind: "census", identity: censusFixture.identity, observedAt: snapshot.observedAt,
    policyVersion: censusFixture.policy.censusPolicy.version,
    receivedAt: snapshot.receivedAt, source: snapshot.source,
    trust: "SYNTHETIC_FIXTURE_ONLY", completeness: "COMPLETE", payload: snapshot
  };
  assert.equal((await store.publish({
    datasetId: "duplicate-census",
    identity: censusFixture.identity,
    capturedAt: censusFixture.assembledAt,
    records: [censusRecord, structuredClone(censusRecord)]
  })).reason, "DUPLICATE_LOGICAL_RECORD");

  const duplicatedDataset = {
    datasetId: "untrusted-memory",
    identity,
    capturedAt: 1_000_000,
    records: [duplicate, structuredClone(duplicate)]
  };
  const priceSource = createWarmupPriceSource(duplicatedDataset);
  assert.equal(await priceSource.readObservation({
    mint: identity.mint, atMs: duplicate.sourceAtMs, denomination: "USD"
  }), null);
  assert.deepEqual(warmupCoverage(duplicatedDataset, {
    identity,
    priceEndpoints: [{mint: identity.mint, atMs: duplicate.sourceAtMs, denomination: "USD"}]
  }).exactMissing.prices.length, 1);
});

test("census reader requires both exact same-identity policy endpoints", async t => {
  const {root} = await temporaryStore(t);
  const fixture = makeFixture({buyCount: 1, sellCount: 1});
  const policy = fixture.policy.censusPolicy;
  const result = await fixture.censusSource.readSnapshots({
    identity: fixture.identity,
    startAtMs: fixture.candidateT - 3_600_000,
    endAtMs: fixture.candidateT,
    policy
  });
  const [start, end] = result.snapshots;
  const records = [start, end].map(snapshot => ({
    kind: "census",
    identity: fixture.identity,
    observedAt: snapshot.observedAt,
    policyVersion: policy.version,
    receivedAt: snapshot.receivedAt,
    source: snapshot.source,
    trust: "SYNTHETIC_FIXTURE_ONLY",
    completeness: "COMPLETE",
    payload: snapshot
  }));
  const store = new EvidenceWarmupStore(root, {enabled: true});
  assert.equal((await store.publish({datasetId: "census-pair", identity: fixture.identity,
    capturedAt: fixture.assembledAt, records})).status, "PUBLISHED");
  const dataset = (await new EvidenceWarmupStore(root).read("census-pair")).document;
  const source = createWarmupCensusSource(dataset);
  const exact = await source.readSnapshots({
    identity: fixture.identity,
    startAtMs: start.observedAt,
    endAtMs: end.observedAt,
    policy
  });
  assert.equal(exact.status, "COMPLETE");
  assert.equal(exact.synthetic, true);
  const missing = await source.readSnapshots({
    identity: fixture.identity,
    startAtMs: start.observedAt - 1,
    endAtMs: end.observedAt,
    policy
  });
  assert.equal(missing.status, "WARMUP");
  assert.deepEqual(missing.coverage.exactEndpoints.available, [end.observedAt]);
  assert.deepEqual(missing.coverage.exactEndpoints.missing, [start.observedAt - 1]);
  const wrongIdentity = await source.readSnapshots({
    identity: {...fixture.identity, pool: "different"},
    startAtMs: start.observedAt,
    endAtMs: end.observedAt,
    policy
  });
  assert.equal(wrongIdentity.status, "WARMUP");
  const mismatchedDataset = {...dataset, records: dataset.records.map((record, index) =>
    index === 0 ? {...record, payload: {...record.payload, identity: {
      ...record.payload.identity, pool: "wrong-pool"
    }}} : record)};
  assert.equal((await createWarmupCensusSource(mismatchedDataset).readSnapshots({
    identity: fixture.identity, startAtMs: start.observedAt, endAtMs: end.observedAt, policy
  })).status, "WARMUP");
  assert.equal(warmupCoverage(mismatchedDataset, {
    identity: fixture.identity,
    censusEndpoints: [
      {atMs: start.observedAt, policyVersion: policy.version},
      {atMs: end.observedAt, policyVersion: policy.version}
    ]
  }).exactMissing.census.length, 1);
  assert.equal(warmupCoverage({...dataset, records: dataset.records.map((record, index) =>
    index === 1 ? {...record, source: "changed-source", trust: "REVIEWED",
      payload: {...record.payload, source: "changed-source",
        receipt: {...record.payload.receipt, source: "changed-source"}}} : record)}, {
    identity: fixture.identity,
    censusEndpoints: [
      {atMs: start.observedAt, policyVersion: policy.version},
      {atMs: end.observedAt, policyVersion: policy.version}
    ]
  }).exactMissing.census.length, 2);
  assert.equal((await source.readSnapshots({
    identity: fixture.identity,
    startAtMs: start.observedAt,
    endAtMs: end.observedAt,
    policy: {...policy, version: "different-policy"}
  })).status, "WARMUP");
  const changedSource = createWarmupCensusSource({...dataset, records: dataset.records.map((record, index) =>
    index === 0 ? record : {...record, payload: {...record.payload, source: "changed-source"}})});
  assert.equal((await changedSource.readSnapshots({
    identity: fixture.identity, startAtMs: start.observedAt, endAtMs: end.observedAt, policy
  })).status, "WARMUP");
  assert.deepEqual(warmupCoverage(dataset, {
    identity: fixture.identity,
    censusEndpoints: [
      {atMs: start.observedAt, policyVersion: policy.version},
      {atMs: start.observedAt - 1, policyVersion: policy.version}
    ]
  }).exactMissing.census, [{atMs: start.observedAt - 1, policyVersion: policy.version}]);
});

test("explicit synthetic warmup records hand exact endpoints to the actual Analyst builder", async t => {
  const {root} = await temporaryStore(t);
  const fixture = makeFixture({buyCount: 2, sellCount: 1, includeBoundaryRows: false});
  const records = [];
  const timestamps = new Set([
    fixture.candidateT - fixture.policy.windowsMs.momentum15m,
    fixture.candidateT,
    ...fixture.transactions.map(row => row.blockTime * 1000)
  ]);
  for (const atMs of timestamps) {
    for (const mint of [fixture.identity.mint, fixture.identity.quote]) {
      if (mint === fixture.identity.quote && !fixture.transactions.some(row => row.blockTime * 1000 === atMs)) {
        continue;
      }
      const payload = await fixture.priceSource.readObservation({
        mint, atMs, denomination: "USD", purpose: "SYNTHETIC_TEST"
      });
      records.push({
        kind: "price", identity: fixture.identity, mint, sourceAtMs: atMs,
        denomination: "USD", methodologyVersion: payload.methodologyVersion,
        receivedAt: payload.receivedAt, source: payload.source,
        trust: "SYNTHETIC_FIXTURE_ONLY", completeness: "COMPLETE", payload
      });
    }
  }
  const census = await fixture.censusSource.readSnapshots({
    identity: fixture.identity,
    startAtMs: fixture.candidateT - fixture.policy.windowsMs.holders1h,
    endAtMs: fixture.candidateT,
    policy: fixture.policy.censusPolicy
  });
  for (const snapshot of census.snapshots) {
    records.push({
      kind: "census", identity: fixture.identity, observedAt: snapshot.observedAt,
      policyVersion: fixture.policy.censusPolicy.version,
      receivedAt: snapshot.receivedAt, source: snapshot.source,
      trust: "SYNTHETIC_FIXTURE_ONLY", completeness: "COMPLETE", payload: snapshot
    });
  }
  const store = new EvidenceWarmupStore(root, {enabled: true});
  const publication = await store.publish({datasetId: "analyst-handoff", identity: fixture.identity,
    capturedAt: fixture.assembledAt, records});
  assert.equal(publication.status, "PUBLISHED", JSON.stringify(publication));
  const dataset = (await new EvidenceWarmupStore(root).read("analyst-handoff")).document;
  const evidence = await buildAnalystWindowEvidence({
    candidate: fixture.candidate,
    candidateT: fixture.candidateT,
    assembledAt: fixture.assembledAt,
    decisionAt: fixture.decisionAt,
    policy: fixture.policy,
    poolProof: fixture.poolProof,
    historySource: fixture.historySource,
    censusSource: createWarmupCensusSource(dataset),
    priceSource: createWarmupPriceSource(dataset),
    marketPairEvidence: fixture.marketPairEvidence,
    smartWalletAllowlist: fixture.smartWalletAllowlist
  });
  assert.equal(evidence.status, "COMPLETE");
  assert.equal(evidence.metrics.momentum15m.coverage.exactEndpoints, true);
  assert.equal(evidence.metrics.holderGrowthPct1h.coverage.exactEndpoints, true);
  assert.equal(evidence.executionAuthorized, false);
  assert.equal(evidence.authorizationEligible, false);

  const unknownDataset = {...structuredClone(dataset), records: dataset.records.map(record =>
    ({...record, trust: "UNKNOWN"}))};
  const unknownEvidence = await buildAnalystWindowEvidence({
    candidate: fixture.candidate,
    candidateT: fixture.candidateT,
    assembledAt: fixture.assembledAt,
    decisionAt: fixture.decisionAt,
    policy: fixture.policy,
    poolProof: fixture.poolProof,
    historySource: fixture.historySource,
    censusSource: createWarmupCensusSource(unknownDataset),
    priceSource: createWarmupPriceSource(unknownDataset),
    marketPairEvidence: fixture.marketPairEvidence,
    smartWalletAllowlist: fixture.smartWalletAllowlist
  });
  assert.equal(unknownEvidence.status, "INCOMPLETE");
  assert.equal(unknownEvidence.metrics.momentum15m, undefined);
  assert.equal(unknownEvidence.metrics.holderGrowthPct1h, undefined);
  assert.equal(unknownEvidence.unavailableMetrics.momentum15m.status, "UNAVAILABLE");
  assert.equal(unknownEvidence.unavailableMetrics.holderGrowthPct1h.status, "UNAVAILABLE");
});

test("quotas and cancellation fail closed; local owner census time is not a historical endpoint", async t => {
  const {root} = await temporaryStore(t);
  const identity = {chainId: "solana", mint: "mint", pool: "pool", quote: "quote"};
  const store = new EvidenceWarmupStore(root, {enabled: true, limits: {maxRecords: 1}});
  const first = priceRecord(identity, 10_000);
  assert.equal((await store.publish({datasetId: "too-many", identity, capturedAt: 20_000,
    records: [first, priceRecord(identity, 11_000)]})).status, "UNKNOWN");
  const controller = new AbortController();
  controller.abort();
  assert.equal((await store.publish({datasetId: "cancelled", identity, capturedAt: 20_000,
    records: [first]}, {signal: controller.signal})).reason, "CANCELLED");
  assert.throws(() => new EvidenceWarmupStore(root, {
    enabled: true, limits: {maxFiles: 2}
  }), /maxFiles/);
  const byteStore = new EvidenceWarmupStore(root, {enabled: true, limits: {maxBytes: 128}});
  assert.equal((await byteStore.publish({datasetId: "too-large", identity, capturedAt: 20_000,
    records: [first]})).reason, "BYTE_LIMIT");
  const workStore = new EvidenceWarmupStore(root, {enabled: true, limits: {maxWorkUnits: 1}});
  assert.equal((await workStore.publish({datasetId: "too-much-work", identity, capturedAt: 20_000,
    records: [first]})).reason, "WORK_LIMIT");
  assert.deepEqual(await acquireAndPublishOwnerCensus({
    enabled: true,
    store: new EvidenceWarmupStore(root),
    identity,
    clock: () => 20_000
  }), {status: "DISABLED"});
});

test("explicit owner census capture persists its UNKNOWN local receipt without historical promotion", async t => {
  const {root} = await temporaryStore(t);
  const identity = {
    chainId: "solana", mint: SYNTHETIC_MINT, pool: SYNTHETIC_POOL, quote: SYNTHETIC_QUOTE
  };
  const now = Date.parse("2026-10-30T12:00:00Z");
  const bounds = {
    maxRequests: 1,
    maxResponseBytes: 1024,
    maxAccounts: 10,
    maxDecodeWork: 100,
    maxElapsedMs: 1_000,
    maxSlotSkew: 10,
    maxTimeSkewMs: 1_000,
    maxEvidenceAgeMs: 60_000
  };
  const mintEvidence = {
    status: "DECODED_UNVERIFIED",
    sourceStatus: "CALLER_INJECTED_RPC_DATA_NOT_AUTHENTICATED",
    authorizationEligible: false,
    hardGateEligible: false,
    binding: {
      expectedMint: identity.mint,
      requestedMint: identity.mint,
      accountPubkey: identity.mint,
      ownerProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      slot: "100",
      observedAt: now
    },
    mint: {supplyAtoms: "0", initialized: true, decimals: 0},
    extensions: {state: "ABSENT"}
  };
  const store = new EvidenceWarmupStore(root, {enabled: true});
  const capture = await acquireAndPublishOwnerCensus({
    enabled: true,
    store,
    datasetId: "local-census",
    identity,
    manifest: {bounds},
    transport: async () => new Response(JSON.stringify({
      jsonrpc: "2.0", id: 1, result: {context: {slot: 100}, value: []}
    }), {status: 200}),
    clock: () => now,
    mintEvidence
  });
  assert.equal(capture.status, "PUBLISHED");
  assert.equal(capture.censusStatus, "UNKNOWN");
  assert.equal(capture.censusTrust, "UNAUTHENTICATED_RPC_RESPONSE");
  assert.equal(capture.observedAtBasis, "LOCAL_ACQUISITION_TIME");
  const dataset = (await new EvidenceWarmupStore(root).read("local-census")).document;
  assert.equal(dataset.records[0].observedAtBasis, "LOCAL_ACQUISITION_TIME");
  const warmup = await createWarmupCensusSource(dataset).readSnapshots({
    identity,
    startAtMs: now - 3_600_000,
    endAtMs: now,
    policy: {version: "unreviewed-policy"}
  });
  assert.equal(warmup.status, "WARMUP");
  assert.equal(warmup.coverage.complete, false);
});

test("incomplete pending publication is UNKNOWN and is never overwritten or retried", async t => {
  const {root} = await temporaryStore(t);
  await mkdir(root, {mode: 0o700});
  const pending = await open(path.join(root, ".evidence-warmup-pending"), "wx", 0o600);
  await pending.writeFile("partial");
  await pending.close();
  const store = new EvidenceWarmupStore(root, {enabled: true});
  const input = {
    datasetId: "partial",
    identity: {chainId: "solana", mint: "mint", pool: "pool", quote: "quote"},
    capturedAt: 20_000,
    records: []
  };
  assert.equal((await store.publish(input)).status, "UNKNOWN");
  assert.equal((await store.publish(input)).status, "UNKNOWN");
});

test("read and publish filesystem waits obey one deadline and late work cannot advance", async t => {
  const {root} = await temporaryStore(t);
  const identity = {chainId: "solana", mint: "mint", pool: "pool", quote: "quote"};
  const record = priceRecord(identity, 10_000);
  const base = new EvidenceWarmupStore(root, {enabled: true});
  const bundle = {datasetId: "delay-read", identity, capturedAt: 20_000, records: [record]};
  assert.equal((await base.publish(bundle)).status, "PUBLISHED");

  const defaultOpen = open;
  const delayedRead = new EvidenceWarmupStore(root, {
    limits: {maxElapsedMs: 15},
    fsOps: {
      open: async (filename, ...args) => {
        if (filename.endsWith("evidence-warmup.json")) {
          await new Promise(resolve => setTimeout(resolve, 60));
        }
        return defaultOpen(filename, ...args);
      }
    }
  });
  assert.equal((await delayedRead.read("delay-read")).reason, "DEADLINE");
  const readController = new AbortController();
  setTimeout(() => readController.abort(), 5);
  assert.equal((await delayedRead.read("delay-read", {signal: readController.signal})).reason,
    "CANCELLED");
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal((await base.read("delay-read")).status, "AVAILABLE");

  for (const delayedMethod of ["writeFile", "sync"]) {
    const delayRoot = path.join(root, `delayed-${delayedMethod}`);
    const linkCalls = [];
    const delayed = new EvidenceWarmupStore(delayRoot, {
      enabled: true,
      limits: {maxElapsedMs: 15},
      fsOps: {
        open: async (filename, ...args) => {
          const handle = await defaultOpen(filename, ...args);
          if (!filename.endsWith(".evidence-warmup-pending")) return handle;
          return new Proxy(handle, {
            get(target, key) {
              const value = Reflect.get(target, key, target);
              if (key === delayedMethod) {
                return async (...methodArgs) => {
                  await new Promise(resolve => setTimeout(resolve, 60));
                  return value.apply(target, methodArgs);
                };
              }
              return typeof value === "function" ? value.bind(target) : value;
            }
          });
        },
        link: async (...args) => {
          linkCalls.push(args);
          const {link: actualLink} = await import("node:fs/promises");
          return actualLink(...args);
        }
      }
    });
    const result = await delayed.publish({...bundle, datasetId: delayedMethod});
    assert.equal(result.reason, "DEADLINE");
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(linkCalls.length, 0);
    await assert.rejects(lstat(path.join(delayRoot, "evidence-warmup.json")), {code: "ENOENT"});
  }
});

test("cancelled or expired link and directory-sync waits stay UNKNOWN and block republish", async t => {
  const {root} = await temporaryStore(t);
  const identity = {chainId: "solana", mint: "mint", pool: "pool", quote: "quote"};
  const bundle = {datasetId: "late-link", identity, capturedAt: 20_000,
    records: [priceRecord(identity, 10_000)]};
  const actualLink = (await import("node:fs/promises")).link;
  let linkCalls = 0;
  const lateLink = new EvidenceWarmupStore(root, {
    enabled: true,
    limits: {maxElapsedMs: 15},
    fsOps: {
      link: async (...args) => {
        linkCalls += 1;
        await actualLink(...args);
        await new Promise(resolve => setTimeout(resolve, 60));
      }
    }
  });
  assert.equal((await lateLink.publish(bundle)).reason, "DEADLINE");
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal((await lateLink.publish(bundle)).status, "UNKNOWN");
  assert.equal((await lateLink.read(bundle.datasetId)).status, "UNKNOWN");
  assert.equal(linkCalls, 1);

  const syncRoot = path.join(root, "late-sync");
  const controller = new AbortController();
  let syncCalls = 0;
  const actualOpen = open;
  const lateSync = new EvidenceWarmupStore(syncRoot, {
    enabled: true,
    limits: {maxElapsedMs: 1_000},
    fsOps: {
      open: async (filename, ...args) => {
        const handle = await actualOpen(filename, ...args);
        if (filename !== syncRoot) return handle;
        return new Proxy(handle, {
          get(target, key) {
            const value = Reflect.get(target, key, target);
            if (key === "sync") {
              return async (...methodArgs) => {
                syncCalls += 1;
                await value.apply(target, methodArgs);
                await new Promise(resolve => setTimeout(resolve, 60));
              };
            }
            return typeof value === "function" ? value.bind(target) : value;
          }
        });
      }
    }
  });
  setTimeout(() => controller.abort(), 20);
  assert.equal((await lateSync.publish({...bundle, datasetId: "late-sync"},
    {signal: controller.signal})).reason, "CANCELLED");
  assert.equal(syncCalls, 1);
  assert.equal((await lateSync.publish({...bundle, datasetId: "late-sync"})).status, "UNKNOWN");

  const cancelRoot = path.join(root, "cancel-link");
  const cancelController = new AbortController();
  let cancelLinkCalls = 0;
  const cancelLink = new EvidenceWarmupStore(cancelRoot, {
    enabled: true,
    limits: {maxElapsedMs: 1_000},
    fsOps: {
      link: async (...args) => {
        cancelLinkCalls += 1;
        await actualLink(...args);
        await new Promise(resolve => setTimeout(resolve, 60));
      }
    }
  });
  setTimeout(() => cancelController.abort(), 20);
  assert.equal((await cancelLink.publish({...bundle, datasetId: "cancel-link"},
    {signal: cancelController.signal})).reason, "CANCELLED");
  assert.equal(cancelLinkCalls, 1);
  assert.equal((await cancelLink.publish({...bundle, datasetId: "cancel-link"})).status, "UNKNOWN");
});

test("symlinked ancestry is rejected before creating any target directories", async t => {
  const {parent} = await temporaryStore(t);
  const outside = path.join(parent, "outside");
  const symlinked = path.join(parent, "symlinked");
  await mkdir(outside, {mode: 0o700});
  await symlink(outside, symlinked);
  const target = path.join(symlinked, "new", "nested", "store");
  const store = new EvidenceWarmupStore(target, {enabled: true});
  const result = await store.publish({
    datasetId: "symlink-escape",
    identity: {chainId: "solana", mint: "mint", pool: "pool", quote: "quote"},
    capturedAt: 20_000,
    records: []
  });
  assert.equal(result.status, "UNKNOWN");
  await assert.rejects(lstat(path.join(outside, "new")), {code: "ENOENT"});
});
