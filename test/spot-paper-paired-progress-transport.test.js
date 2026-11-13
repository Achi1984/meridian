import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {constants} from 'node:fs';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {exportProgress} from '../scripts/spot-paper-paired-progress/export.mjs';
import {
  progressJournalFixture, journalEnvelope
} from './helpers/spot-paper-paired-progress-fixture.mjs';
import {
  handleSpotPaperPairedProgressGatewayRequest,
  spotPaperPairedProgressGatewayConfig
} from '../spot-paper-paired-progress-gateway.mjs';
import {
  createPrivatePairedProgressStore, PAIRED_PROGRESS_UPSERT_SQL
} from '../private-paired-progress-store.mjs';
import {createAppAccess} from '../v11/app-access.js';
import {
  MAX_PROGRESS_BYTES, PROGRESS_ENDPOINT, validateProgress
} from '../scripts/spot-paper-paired-progress/contract.mjs';
import {
  publishProgress, readProgressJsonFile, main, PROGRESS_RECEIPT_SCHEMA,
  MAX_RECEIPT_BYTES, PUBLISH_TOKEN_ENV
} from '../scripts/spot-paper-paired-progress/publish.mjs';
import {
  createSpotPaperPairedProgressConnector
} from '../v11/spot-paper-paired-progress-connector.js';
import {mountPaperBotReportWorkspace} from '../v11/paper-bot-report-bootstrap.js';
import {SPOT_PAPER_PAIRED_REPORT_ENDPOINT} from
  '../v11/spot-paper-paired-report-connector.js';
import {
  createSpotPaperPairedNextRunConfig, nextRunResearchSourceDigest
} from '../scripts/spot-paper-paired/next-run-composition.mjs';
import {
  runSpotPaperPairedSynthetic, SPOT_PAPER_PAIRED_SYNTHETIC_SOURCE_ID,
  SPOT_PAPER_PAIRED_NEXT_RUN_ACCEPTED_RESEARCH_SOURCE_SHA256
} from '../scripts/spot-paper-paired/forward.mjs';
import * as confirmationExports from '../scripts/spot-paper-research/entry-confirmation.mjs';
import * as trendExports from '../scripts/spot-paper-research/five-minute-trend.mjs';

let exportedFixture;
function memoryFile(bytes, {regular = true, size = bytes.length, fd = 99} = {}) {
  let cursor = 0;
  return {
    fd,
    stat: async ({bigint = false} = {}) => ({
      isFile: () => regular,
      size: bigint ? BigInt(size) : size,
      dev: 1n, ino: regular ? 2n : 3n, mtimeNs: 1n, ctimeNs: 1n, nlink: 1n
    }),
    read: async (target, offset, length) => {
      const bytesRead = bytes.copy(target, offset, cursor, cursor + length);
      cursor += bytesRead;
      return {bytesRead};
    },
    close: async () => {}
  };
}

before(async () => {
  const source = progressJournalFixture();
  const bytes = Buffer.from(journalEnvelope(source.journal));
  let fd = 10;
  const result = await exportProgress({
    runDirectory: '/offline-progress-fixture', expectedIdentity: source.expectedIdentity,
    now: () => source.now,
    io: {
      open: async (path, flags) => {
        assert.ok(flags & constants.O_NOFOLLOW);
        assert.ok(flags & constants.O_NONBLOCK);
        if (flags & constants.O_DIRECTORY) {
          return memoryFile(Buffer.alloc(0), {regular: false, fd: fd++});
        }
        assert.ok(path.endsWith('/journal.json'));
        return memoryFile(bytes, {fd: fd++});
      },
      lstat: async () => { throw Object.assign(new Error('absent'), {code: 'ENOENT'}); }
    }
  });
  assert.equal(result.status, 'EXPORTED');
  exportedFixture = {identity: source.expectedIdentity, payload: result.progress};
});

function fixture() {
  const {identity, payload} = structuredClone(exportedFixture);
  assert.ok(validateProgress(payload, identity), 'fixture must satisfy full contract');
  return {identity, payload};
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {status,
    headers: {'content-type': 'application/json', ...headers}});
}

function receipt(payload) {
  return {schemaVersion: PROGRESS_RECEIPT_SCHEMA, status: 'ACCEPTED',
    journalSequence: payload.journalSequence, journalSha256: payload.journalSha256};
}

function connector(options = {}) {
  const {identity, payload} = fixture();
  return createSpotPaperPairedProgressConnector({
    expectedIdentity: identity, now: () => 182_000, staleAfterMs: 61_000,
    enabled: true, transport: async () => jsonResponse(payload), ...options
  });
}

async function drainUntil(predicate) {
  for (let attempt = 0; attempt < 30 && !predicate(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.ok(predicate(), 'underlying cleanup must settle');
}

test('publisher defaults to dry-run and connector defaults disabled without network', async () => {
  const {identity, payload} = fixture();
  let calls = 0;
  const fetchImpl = () => { calls++; throw new Error('must not fetch'); };
  assert.deepEqual(await publishProgress(payload, {expectedIdentity: identity, fetchImpl}),
    {status: 'DRY_RUN'});
  const disabled = connector({enabled: false, transport: fetchImpl});
  assert.equal((await disabled.read()).status, 'DISABLED');
  assert.equal(calls, 0);
  disabled.dispose();
});

test('publisher posts once only to approved HTTPS endpoint with redirect refusal', async () => {
  const {identity, payload} = fixture();
  let calls = 0;
  const result = await publishProgress(payload, {
    expectedIdentity: identity, enabled: true, token: 'test-publish-credential',
    endpoint: 'https://not-approved.invalid',
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, PROGRESS_ENDPOINT);
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers.authorization, 'Bearer ' + 'test-publish-credential');
      assert.deepEqual(JSON.parse(options.body), payload);
      return jsonResponse(receipt(payload));
    }
  });
  assert.deepEqual(result, {status: 'PUBLISHED'});
  assert.equal(calls, 1);
});

class TestElement {
  constructor(document, tag) {
    this.ownerDocument = document;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = new Map();
    this.parentNode = null;
    this.text = '';
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw Error('Paper workspace must use text nodes'); }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.text = '';
    this.children = [];
    this.append(...nodes);
  }
  insertBefore(node, before) {
    const index = this.children.indexOf(before);
    if (index < 0) return this.append(node);
    node.parentNode = this;
    this.children.splice(index, 0, node);
  }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentNode = null;
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
}

async function workspaceCheckpoint(payload, identity, pipeline, now) {
  const document = {createElement: tag => new TestElement(document, tag)};
  const parent = new TestElement(document, 'section');
  const overviewRoot = new TestElement(document, 'section');
  const pairedRoot = new TestElement(document, 'section');
  parent.append(overviewRoot, pairedRoot);
  const readers = new Set();
  const subscribers = new Set();
  let token = null;
  const access = {
    isUnlocked: () => token !== null,
    getToken: () => token,
    registerReader(clear) { readers.add(clear); return () => readers.delete(clear); },
    subscribe(listener) { subscribers.add(listener); listener({status: 'locked'});
      return () => subscribers.delete(listener); },
    unlock() { token = pipeline.reader;
      for (const listener of subscribers) listener({status: 'unlocked'}); },
    lock() { token = null; for (const clear of readers) clear();
      for (const listener of subscribers) listener({status: 'locked'}); }
  };
  let progressReads = 0;
  const workspace = mountPaperBotReportWorkspace(overviewRoot, pairedRoot, document, {
    access,
    progressEnabled: true,
    progressExpectedIdentity: identity,
    progressStaleAfterMs: 61_000,
    now: () => now,
    fetchImpl: async (url, options) => {
      if (url === SPOT_PAPER_PAIRED_REPORT_ENDPOINT) return jsonResponse({}, 404);
      assert.equal(url, PROGRESS_ENDPOINT);
      progressReads++;
      return pipeline.fetchImpl(url, {
        method: options.method, headers: options.headers, signal: options.signal
      });
    }
  });
  workspace.setActive(true);
  access.unlock();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(progressReads, 1);
  assert.match(pairedRoot.textContent, /Beobachteter Checkpoint/);
  assert.match(pairedRoot.textContent, /STALE/);
  assert.match(pairedRoot.textContent, new RegExp(payload.terminal.status));
  assert.match(pairedRoot.textContent, /NO_FINAL_REPORT/);
  assert.doesNotMatch(pairedRoot.textContent, /RUNNING/);
  assert.equal(overviewRoot.textContent.includes('Gemeldeter LaufstatusUnbekannt'), true);
  for (const arm of payload.arms) {
    assert.ok(pairedRoot.textContent.includes(arm.modelId));
    assert.ok(pairedRoot.textContent.includes(`Fills${arm.fillCount}`));
    assert.ok(pairedRoot.textContent.includes(arm.inventoryStatus === 'OPEN' ?
      'Position offen' : arm.inventoryStatus === 'FLAT' ?
        'Keine offene Position' : 'Unbekannt'));
    for (const cents of [arm.netPnlCents, arm.netEquityCents,
      arm.bookedFeesCents, arm.modeledSlippageCents]) {
      if (cents !== null) assert.ok(pairedRoot.textContent.includes(
        new Intl.NumberFormat('de-DE', {minimumFractionDigits: 2,
          maximumFractionDigits: 2}).format(Math.abs(cents / 100))));
    }
    if (arm.recentFills.length > 0) {
      assert.match(pairedRoot.textContent, /Letzte geprüfte Füllungen/);
      assert.ok(pairedRoot.textContent.includes(arm.recentFills[0].side));
    }
  }
  assert.ok(pairedRoot.textContent.includes(
    new Intl.DateTimeFormat('de-AT', {
      dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Vienna'
    }).format(payload.valuationAt)));
  if (payload.arms.some(arm => arm.completedRoundTripCount > 0)) {
    assert.match(pairedRoot.textContent, /Abgeschlossene Handelsrunden[1-9]/);
  }
  if (payload.terminal.status === 'UNKNOWN' &&
      payload.arms.some(arm => arm.inventoryStatus === 'OPEN')) {
    assert.match(pairedRoot.textContent, /BestandPosition offen/);
  }
  assert.match(overviewRoot.textContent, /Bewertung:/);
  assert.match(overviewRoot.textContent, new RegExp(
    new Intl.NumberFormat('de-DE', {minimumFractionDigits: 2,
      maximumFractionDigits: 2}).format(Math.abs(payload.arms[1].netPnlCents / 100))));
  await workspace.refreshProgress();
  assert.equal(progressReads, 2);
  workspace.dispose();
}

function publicationFixture(identity) {
  const token = 'progress-roundtrip-test';
  const reader = 'progress-roundtrip-reader';
  const config = spotPaperPairedProgressGatewayConfig({
    MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_ENABLED: 'true',
    MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_DEPLOYMENT_VERIFIED: 'true',
    MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY_JSON: JSON.stringify(identity),
    MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_UPLOAD_TOKEN_SHA256:
      createHash('sha256').update(token).digest('hex'),
    MERIDIAN_READ_TOKEN_SHA256: createHash('sha256').update(reader).digest('hex')
  });
  assert.equal(config.enabled, true);
  let stored = null;
  let writes = 0;
  const store = createPrivatePairedProgressStore({
    query: async (sql, values) => {
      assert.equal(values[0], identity.runId);
      assert.deepEqual(JSON.parse(values[1]), identity);
      if (sql === PAIRED_PROGRESS_UPSERT_SQL) {
        writes++;
        const next = JSON.parse(values[5]);
        if (stored && !(stored.journalSequence < next.journalSequence &&
            stored.terminal.status === 'UNKNOWN' &&
            ['observedAt', 'valuationAt', 'latestEventAt'].every(key =>
              stored[key] <= next[key]))) return {rows: []};
        assert.equal(values[2], next.journalSequence);
        assert.equal(values[3], next.journalSha256);
        assert.equal(values[4], next.terminal.status);
        stored = next;
      }
      return {rows: stored ? [{payload: structuredClone(stored)}] : []};
    }
  });
  const receipts = [];
  const fetchImpl = async (url, options) => {
    const request = Readable.from(options.body ? [Buffer.from(options.body)] : []);
    Object.assign(request, {url, method: options.method, headers: options.headers});
    const reply = await handleSpotPaperPairedProgressGatewayRequest(request, {
      config, getStore: () => store,
      authorizedRead: req => req.headers.authorization === 'Bearer ' + reader,
      signal: options.signal
    });
    if (options.method === 'POST') receipts.push(reply.body);
    return jsonResponse(reply.body, reply.status);
  };
  return {token, reader, fetchImpl, receipts, get writes() { return writes; }};
}

test('real journal export, publisher, authenticated gateway/store and browser preserve financial evidence', async () => {
  const {identity, payload} = fixture();
  const pipeline = publicationFixture(identity);
  const {token, reader, fetchImpl, receipts} = pipeline;
  assert.deepEqual(await publishProgress(payload, {
    expectedIdentity: identity, enabled: true, token, fetchImpl
  }), {status: 'PUBLISHED'});
  assert.deepEqual(await publishProgress({...payload, exportedAt: payload.exportedAt + 5_000}, {
    expectedIdentity: identity, enabled: true, token, fetchImpl
  }), {status: 'PUBLISHED'});
  assert.deepEqual(receipts[0], receipt(payload));
  assert.deepEqual(receipts[1], receipt(payload));
  assert.equal(pipeline.writes, 2, 'each explicit publish makes one store attempt with no retry');
  assert.equal((await fetchImpl(PROGRESS_ENDPOINT, {
    method: 'GET', headers: {authorization: 'Bearer ' + token}
  })).status, 401, 'publisher credential cannot read private progress');
  const instance = connector({transport: ({signal}) => fetchImpl(PROGRESS_ENDPOINT, {
    method: 'GET', headers: {authorization: 'Bearer ' + reader}, signal
  })});
  const read = await instance.read();
  assert.equal(read.status, 'AVAILABLE');
  assert.deepEqual(read.progress, payload);
  assert.equal(read.ageMs, 61_000);
  assert.equal(read.progress.valuationAt, 121_000);
  assert.equal(read.progress.exportedAt, 181_000);
  assert.equal(read.progress.arms[0].bookedFeesCents, 40);
  assert.equal(read.progress.arms[0].modeledSlippageCents, 20);
  assert.equal(read.progress.arms[0].netEquityCents, 99_960);
  assert.equal(read.progress.arms[0].netPnlCents, -40, 'booked costs are not subtracted twice');
  assert.equal(read.progress.arms[1].netPnlCents, -500);
  assert.equal(read.progress.arms[2].netPnlCents, 0);
  assert.deepEqual(read.progress.arms[0].recentFills.map(fill => fill.feeCents), [20, 20]);
  assert.equal(read.progress.arms[0].completedRoundTripCount, 1);
  instance.dispose();
});

test('actual next-run producer checkpoints and terminal journal traverse the private progress pipeline',
  {timeout: 20_000}, async t => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'paired-progress-producer-'));
    const paused = deferred();
    const resume = deferred();
    const abort = new AbortController();
    const deadline = setTimeout(() => {
      abort.abort(new Error('PRODUCER_TEST_DEADLINE'));
      resume.resolve();
    }, 10_000);
    const bounded = async promise => {
      let timer;
      try {
        return await Promise.race([promise, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('PRODUCER_GATE_DEADLINE')), 5_000);
        })]);
      } finally {
        clearTimeout(timer);
      }
    };
    const minute = 60_000;
    const base = Date.UTC(2025, 0, 1);
    let wall = base + 105 * minute + 1_000;
    let monotonic = 100;
    let cycles = 0;
    const counters = {requests: 0, bytes: 0};
    const candle = index => index < 105 ? 100 :
      index === 105 ? 120 : index === 106 ? 130 : 80;
    const row = index => {
      const close = `${candle(index)}.00000000`;
      return [(base + index * minute) / 1000,
        close, close, close, close, close, '1.00000000', 1];
    };
    const response = data => {
      counters.requests++;
      const requestStartedAt = wall + 1;
      const receivedAt = requestStartedAt + 1;
      const raw = JSON.stringify(data);
      const bytes = Buffer.byteLength(raw);
      counters.bytes += bytes;
      wall = receivedAt;
      return {data, raw, bytes, requestStartedAt, receivedAt,
        sha256: createHash('sha256').update(raw).digest('hex')};
    };
    const provider = {
      sourceId: SPOT_PAPER_PAIRED_SYNTHETIC_SOURCE_ID,
      async fetchOhlc() {
        cycles++;
        const rows = Array.from({length: 105 + cycles}, (_, index) => row(index));
        return response({error: [], result: {XXBTZEUR: rows, last: rows.at(-1)[0]}});
      },
      async fetchTicker() {
        return response({error: [], result: {XXBTZEUR: {
          a: [cycles === 4 ? '29001.00000000' : '30001.00000000', '1', '1.00000000'],
          b: [cycles === 4 ? '29000.00000000' : '29999.00000000', '1', '1.00000000']
        }}});
      },
      counters: () => ({...counters})
    };
    let producer;
    let browser;
    try {
      const [comparisonBytes, entryConfirmationBytes, fiveMinuteTrendBytes] =
        await Promise.all(['comparison', 'entry-confirmation', 'five-minute-trend'].map(name =>
          readFile(new URL(`../scripts/spot-paper-research/${name}.mjs`, import.meta.url))));
      const researchSourceSha256 = nextRunResearchSourceDigest({
        comparisonBytes, entryConfirmationBytes, fiveMinuteTrendBytes
      });
      assert.equal(researchSourceSha256,
        SPOT_PAPER_PAIRED_NEXT_RUN_ACCEPTED_RESEARCH_SOURCE_SHA256);
      const config = createSpotPaperPairedNextRunConfig({
        runId: 'progress-real-next-run', dataRoot, sourceSha256: 'a'.repeat(64),
        researchSourceSha256, provider, confirmationExports, trendExports,
        accountIds: {baseline: 'progress-confirm2', challenger: 'progress-trend',
          cash: 'progress-cash'},
        maxCycles: 4, maxRequests: 8, maxDurationMs: 4 * minute,
        pollIntervalMs: minute, signal: abort.signal,
        now: () => wall++, monotonicNow: () => monotonic,
        sleep: async duration => {
          if (cycles === 3) {
            paused.resolve();
            await bounded(resume.promise);
          }
          wall += duration;
          monotonic += duration;
        }
      });
      const identity = {
        schemaVersion: 'SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_V1',
        runId: config.runId, pair: 'BTC/EUR', sourceSha256: config.sourceSha256,
        configSha256: config.configSha256,
        researchSourceSha256: config.researchSourceSha256,
        feedSourceId: provider.sourceId, comparisonEngineId: config.comparisonEngine.id,
        modelPairId: config.modelPair.id,
        models: config.arms.map(({role, modelId, accountId}) => ({role, modelId, accountId}))
      };
      const runDirectory = join(dataRoot, config.runId);
      const journalPath = join(runDirectory, 'journal.json');
      const pipeline = publicationFixture(identity);
      let browserNow;
      browser = createSpotPaperPairedProgressConnector({
        enabled: true, expectedIdentity: identity, now: () => browserNow,
        staleAfterMs: 61_000,
        transport: ({signal}) => pipeline.fetchImpl(PROGRESS_ENDPOINT, {
          method: 'GET', headers: {authorization: 'Bearer ' + pipeline.reader}, signal
        })
      });
      const exportAndPublish = async terminal => {
        const lockPath = join(runDirectory, 'writer.lock');
        if (terminal) await assert.rejects(stat(lockPath), {code: 'ENOENT'});
        else assert.ok((await stat(lockPath)).isFile(),
          'acknowledged checkpoint remains exportable while its producer owns the writer lock');
        const bytes = await readFile(journalPath);
        const journal = JSON.parse(bytes).payload;
        const observations = journal.events.filter(event => event.type === 'shared_observation');
        const last = observations.at(-1);
        assert.equal(observations.length, terminal ? 4 : 3);
        assert.equal(journal.events.at(-1).type, terminal ? 'terminal' : 'shared_observation');
        const exportedAt = wall + minute;
        const exported = await exportProgress({
          runDirectory, expectedIdentity: identity, now: () => exportedAt
        });
        assert.equal(exported.status, 'EXPORTED');
        const payload = exported.progress;
        assert.equal(payload.classification, 'OBSERVED_CHECKPOINT');
        assert.equal(payload.terminal.status, terminal ? 'TERMINAL_RECORDED' : 'UNKNOWN');
        assert.equal(payload.journalSequence, journal.sequence);
        assert.equal(payload.journalSha256, createHash('sha256')
          .update(JSON.stringify(journal)).digest('hex'));
        assert.equal(payload.valuationAt, last.effectAt);
        assert.equal(payload.observedAt, last.observedAt);
        assert.ok(exportedAt > payload.latestEventAt);
        browserNow = exportedAt + 1_000;
        assert.deepEqual(await publishProgress(payload, {
          expectedIdentity: identity, enabled: true,
          token: pipeline.token, fetchImpl: pipeline.fetchImpl
        }), {status: 'PUBLISHED'});
        const read = await browser.read();
        assert.equal(read.status, 'STALE');
        assert.deepEqual(read.progress, payload);
        assert.equal(read.ageMs, browserNow - last.effectAt);
        assert.equal(read.ageMs, terminal ? 61_002 : 61_001);
        assert.ok(read.ageMs > browserNow - payload.exportedAt);
        await workspaceCheckpoint(payload, identity, pipeline, browserNow);
        if (terminal) {
          assert.ok(payload.terminal.at > last.effectAt);
          assert.equal(payload.latestEventAt, payload.terminal.at);
          assert.ok(read.ageMs > browserNow - payload.terminal.at);
        }
        for (const [index, arm] of payload.arms.entries()) {
          const valuation = last.valuations[index];
          const fills = observations.flatMap(event => event.fills[index].fills);
          assert.equal(arm.netEquityCents, valuation.netEquityCents);
          assert.equal(arm.netPnlCents, valuation.netEquityCents - arm.startingCapitalCents);
          assert.equal(arm.bookedFeesCents, valuation.feesCents);
          assert.equal(arm.modeledSlippageCents, valuation.slippageCents);
          assert.equal(arm.bookedFeesCents + arm.modeledSlippageCents,
            valuation.modeledCostsCents);
          assert.equal(arm.fillCount, fills.length);
          assert.equal(arm.completedRoundTripCount, Math.floor(fills.length / 2));
          assert.deepEqual(arm.recentFills, observations.flatMap(event =>
            event.fills[index].fills.map(fill => ({
              side: fill.side, grossCents: fill.grossCents, feeCents: fill.feeCents,
              executionAt: event.effectAt
            }))));
        }
        const baseline = payload.arms[0];
        assert.ok(baseline.bookedFeesCents > 0);
        assert.ok(baseline.modeledSlippageCents > 0);
        assert.equal(baseline.bookedFeesCents, terminal ? 39 : 20);
        assert.equal(baseline.modeledSlippageCents, terminal ? 20 : 10);
        assert.equal(baseline.netEquityCents, terminal ? 99_609 : 99_940);
        assert.equal(baseline.netPnlCents, terminal ? -391 : -60);
        assert.equal(baseline.fillCount, terminal ? 2 : 1);
        assert.equal(baseline.completedRoundTripCount, terminal ? 1 : 0);
        assert.equal(baseline.recentFills.length, terminal ? 2 : 1);
        assert.notEqual(baseline.netPnlCents, baseline.netEquityCents -
          baseline.startingCapitalCents - baseline.bookedFeesCents -
          baseline.modeledSlippageCents);
        assert.deepEqual(await readFile(journalPath), bytes,
          'export, upload, store and browser read must leave actual journal bytes untouched');
        if (terminal) await assert.rejects(stat(lockPath), {code: 'ENOENT'});
        else assert.ok((await stat(lockPath)).isFile());
        t.diagnostic(JSON.stringify({terminal: payload.terminal.status,
          classification: payload.classification, browserStatus: read.status, ageMs: read.ageMs,
          valuationAt: payload.valuationAt, terminalAt: payload.terminal.at,
          exportedAt, baseline: {bookedFeesCents: baseline.bookedFeesCents,
            modeledSlippageCents: baseline.modeledSlippageCents,
            netEquityCents: baseline.netEquityCents, netPnlCents: baseline.netPnlCents,
            fillCount: baseline.fillCount,
            completedRoundTripCount: baseline.completedRoundTripCount}}));
        return payload;
      };
      producer = runSpotPaperPairedSynthetic(config);
      await bounded(Promise.race([paused.promise, producer.then(() => {
        throw new Error('PRODUCER_DID_NOT_PAUSE');
      })]));
      const checkpoint = await exportAndPublish(false);
      assert.equal((await pipeline.fetchImpl(PROGRESS_ENDPOINT, {
        method: 'GET', headers: {authorization: 'Bearer ' + pipeline.token}
      })).status, 401, 'upload credential cannot read the real producer checkpoint');
      resume.resolve();
      const report = await bounded(producer);
      assert.equal(report.outcome, 'COMPLETED_BOUNDED');
      assert.equal(report.cycles, 4);
      const terminal = await exportAndPublish(true);
      assert.ok(terminal.journalSequence > checkpoint.journalSequence);
      assert.notEqual(terminal.journalSha256, checkpoint.journalSha256);
      assert.equal(pipeline.writes, 2, 'terminal advances the same identity through real store.put');
      assert.deepEqual(pipeline.receipts, [receipt(checkpoint), receipt(terminal)]);
    } finally {
      resume.resolve();
      abort.abort(new Error('PRODUCER_TEST_CLEANUP'));
      if (producer) await producer.catch(() => {});
      browser?.dispose();
      clearTimeout(deadline);
      await rm(dataRoot, {recursive: true, force: true});
    }
  });

test('publisher accepts only the exact four-key versioned ACCEPTED receipt', async () => {
  const {identity, payload} = fixture();
  for (const status of ['STORED', 'IDEMPOTENT', 'ACCEPTED', 'UNKNOWN']) {
    const result = await publishProgress(payload, {
      expectedIdentity: identity, enabled: true, token: 'test',
      fetchImpl: async () => jsonResponse({...receipt(payload), status})
    });
    assert.equal(result.status, status === 'ACCEPTED' ? 'PUBLISHED' : 'UNKNOWN');
  }
});

test('publisher refuses missing credentials and invalid payloads before fetch', async () => {
  const {identity, payload} = fixture();
  let calls = 0;
  const options = {enabled: true, expectedIdentity: identity,
    fetchImpl: () => { calls++; }};
  for (const token of [undefined, '', 'bad\nvalue']) {
    assert.equal((await publishProgress(payload, {...options, token})).status, 'AUTH_REQUIRED');
  }
  payload.identity.runId = 'wrong-run';
  assert.equal((await publishProgress(payload, {...options, token: 'test'})).status, 'REJECTED');
  assert.equal(calls, 0);
});

test('publisher auth failures clean up bodies and never expose server text', async () => {
  const {identity, payload} = fixture();
  for (const status of [401, 403, 302, 500]) {
    let cancelled = 0;
    const response = {status, ok: false,
      body: {cancel: async () => { cancelled++; }},
      text: () => { throw new Error('SECRET server error'); }};
    const result = await publishProgress(payload, {
      expectedIdentity: identity, enabled: true, token: 'test',
      fetchImpl: async () => response
    });
    assert.deepEqual(result, {status: [401, 403].includes(status) ? 'AUTH_REQUIRED' : 'UNKNOWN'});
    assert.equal(cancelled, 1);
  }
});

test('publisher rejects redirects, oversized and mismatched receipts without retry', async () => {
  const {identity, payload} = fixture();
  const redirected = jsonResponse(receipt(payload));
  Object.defineProperty(redirected, 'redirected', {value: true});
  const otherUrl = jsonResponse(receipt(payload));
  Object.defineProperty(otherUrl, 'url', {value: 'https://other.invalid'});
  for (const response of [
    redirected, otherUrl,
    jsonResponse(receipt(payload), 200, {'content-length': String(MAX_RECEIPT_BYTES + 1)}),
    jsonResponse('x'.repeat(MAX_RECEIPT_BYTES + 1)),
    jsonResponse({...receipt(payload), journalSequence: 999}),
    jsonResponse({...receipt(payload), arbitrary: 'untrusted'}),
    jsonResponse({...receipt(payload), schemaVersion: 'OTHER'}),
    jsonResponse({status: 'ACCEPTED', journalSequence: payload.journalSequence,
      journalSha256: payload.journalSha256}),
    jsonResponse(receipt(payload), 201),
    new Response('bad json', {headers: {'content-type': 'application/json'}})
  ]) {
    let calls = 0;
    assert.deepEqual(await publishProgress(payload, {
      expectedIdentity: identity, enabled: true, token: 'test',
      fetchImpl: async () => { calls++; return response; }
    }), {status: 'UNKNOWN'});
    assert.equal(calls, 1);
    assert.equal(response.body.locked, false);
  }
});

test('publisher deadline covers uncooperative fetch, late completion and cleanup', async () => {
  const {identity, payload} = fixture();
  const late = deferred();
  let signal;
  let calls = 0;
  const result = await publishProgress(payload, {
    expectedIdentity: identity, enabled: true, token: 'test', timeoutMs: 15,
    fetchImpl: (_url, options) => { signal = options.signal; calls++; return late.promise; }
  });
  assert.deepEqual(result, {status: 'UNKNOWN'});
  assert.equal(signal.aborted, true);
  let cancelled = false;
  late.resolve({status: 201, ok: true, body: {cancel: async () => { cancelled = true; }}});
  await drainUntil(() => cancelled);
  assert.equal(calls, 1);
  assert.equal(result.status, 'UNKNOWN');
});

test('publisher never starts a deferred fetch after its monotonic deadline', async () => {
  const {identity, payload} = fixture();
  let calls = 0;
  const pending = publishProgress(payload, {
    expectedIdentity: identity, enabled: true, token: 'test', timeoutMs: 10,
    fetchImpl: async () => { calls++; return jsonResponse(receipt(payload)); }
  });
  const unblockAt = performance.now() + 20;
  while (performance.now() < unblockAt) {}
  assert.deepEqual(await pending, {status: 'UNKNOWN'});
  assert.equal(calls, 0, 'expired queued work must never upload');
});

test('publisher deadline covers stalled receipt reads and cancellation', async () => {
  const {identity, payload} = fixture();
  for (const phase of ['read', 'cancel']) {
    const readSettlement = deferred();
    const cancelSettlement = deferred();
    let released = false;
    let cancelled = false;
    const result = await publishProgress(payload, {
      expectedIdentity: identity, enabled: true, token: 'test', timeoutMs: 15,
      fetchImpl: async () => ({
        status: 200, ok: true, headers: new Headers({'content-type': 'application/json'}),
        body: {getReader: () => ({
          read: () => phase === 'read' ? readSettlement.promise : Promise.resolve({done: true}),
          cancel: () => { cancelled = true; return cancelSettlement.promise; },
          releaseLock: () => { released = true; }
        })}
      })
    });
    assert.deepEqual(result, {status: 'UNKNOWN'});
    await drainUntil(() => cancelled);
    readSettlement.resolve({done: true});
    cancelSettlement.resolve();
    await drainUntil(() => released);
    assert.equal(result.status, 'UNKNOWN');
  }
});

for (const mode of ['timer', 'monotonic']) {
  test(`file reader closes late-open handles before stat/read after ${mode} expiry`, async () => {
    const opened = deferred();
    let closed = 0;
    let stats = 0;
    let reads = 0;
    const handle = {
      stat: async () => { stats++; throw new Error('must not stat expired handle'); },
      read: async () => { reads++; throw new Error('must not read expired handle'); },
      close: async () => { closed++; }
    };
    const pending = readProgressJsonFile('test/unused-late-open', {
      timeoutMs: 10,
      openImpl: (path, flags) => {
        assert.equal(path, 'test/unused-late-open');
        assert.equal(flags & constants.O_NOFOLLOW, constants.O_NOFOLLOW);
        assert.equal(flags & constants.O_NONBLOCK, constants.O_NONBLOCK);
        return opened.promise;
      }
    });
    if (mode === 'timer') {
      await assert.rejects(pending, {message: 'INVALID_INPUT'});
      opened.resolve(handle);
    } else {
      opened.resolve(handle);
      const unblockAt = performance.now() + 20;
      while (performance.now() < unblockAt) {}
      await assert.rejects(pending, {message: 'INVALID_INPUT'});
    }
    await drainUntil(() => closed === 1);
    assert.equal(stats, 0);
    assert.equal(reads, 0);
  });
}

test('connector requires pinned identity, clock and finite freshness configuration', () => {
  for (const options of [{now: undefined}, {staleAfterMs: undefined},
    {staleAfterMs: Infinity}, {staleAfterMs: -1}, {timeoutMs: 0},
    {expectedIdentity: {}}, {transport: undefined}]) {
    assert.throws(() => connector(options), TypeError);
  }
});

test('connector preserves negative/zero metrics and computes freshness only from valuation', async () => {
  const fresh = connector();
  const result = await fresh.read();
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.ageMs, 61_000);
  assert.equal(result.progress.arms[0].netPnlCents, -40);
  assert.equal(result.progress.arms[0].cashCents, null);
  assert.equal(result.progress.arms[1].netPnlCents, -500);
  assert.equal(result.progress.arms[2].netPnlCents, 0);
  assert.equal(result.progress.arms[2].bookedFeesCents, 0);
  const stale = connector({staleAfterMs: 60_999});
  const old = await stale.read();
  assert.equal(old.status, 'STALE');
  assert.equal(old.ageMs, 61_000);
  assert.ok(old.progress, 'stale results retain the validated snapshot');
  assert.equal(old.progress.exportedAt, 181_000, 'recent export does not refresh valuation');
  const zero = connector({now: () => 181_000, staleAfterMs: 0});
  assert.equal((await zero.read()).status, 'STALE');
});

test('connector rejects wrong run/model/currency/schema, extra fields and future timestamps', async () => {
  const mutations = [
    p => { p.identity.runId = 'wrong-run'; },
    p => { p.identity.sourceSha256 = 'f'.repeat(64); },
    p => { p.identity.models[0].accountId = 'other-account'; },
    p => { p.arms[0].modelId = 'other-model'; },
    p => { p.currency = 'USD'; },
    p => { p.schemaVersion = 'OTHER'; },
    p => { p.secretServerError = 'do not expose'; },
    p => { p.exportedAt = 182_001; },
    p => { p.observedAt = p.valuationAt = p.latestEventAt = p.exportedAt = 182_001; },
    p => { p.arms[0].netEquityCents = 1.1; }
  ];
  for (const mutate of mutations) {
    const {payload} = fixture();
    mutate(payload);
    const instance = connector({transport: async () => jsonResponse(payload)});
    assert.deepEqual(await instance.read(), {status: 'REJECTED', progress: null, ageMs: null});
    assert.equal(instance.isBusy(), false);
  }
  const invalidClock = connector({now: () => NaN});
  assert.equal((await invalidClock.read()).status, 'REJECTED');
});

test('connector pins an immutable copy of expected identity', async () => {
  const {identity} = fixture();
  const instance = connector({expectedIdentity: identity});
  identity.runId = 'mutated-after-creation';
  assert.equal((await instance.read()).status, 'AVAILABLE');
});

test('connector handles auth and transport failures without leaking arbitrary errors', async () => {
  for (const status of [401, 403, 404, 500]) {
    let cancelled = false;
    const instance = connector({transport: async () => ({
      status, ok: false, body: {cancel: async () => { cancelled = true; }},
      text: () => { throw new Error('PRIVATE SERVER ERROR'); }
    })});
    const result = await instance.read();
    assert.equal(result.status, [401, 403].includes(status) ? 'AUTH_REQUIRED' :
      status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE');
    assert.equal(cancelled, true);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
  for (const code of ['AUTH_REQUIRED', 'OTHER']) {
    const instance = connector({transport: async () => {
      throw Object.assign(new Error('PRIVATE ERROR'), {code});
    }});
    assert.deepEqual(await instance.read(), {
      status: code === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'REJECTED',
      progress: null, ageMs: null
    });
  }
});

test('connector bounds actual bytes, announced bytes, content type and redirects', async () => {
  const {payload} = fixture();
  const redirected = jsonResponse(payload);
  Object.defineProperty(redirected, 'redirected', {value: true});
  const otherUrl = jsonResponse(payload);
  Object.defineProperty(otherUrl, 'url', {value: 'https://not-approved.invalid'});
  for (const response of [
    redirected, otherUrl,
    jsonResponse(payload, 200, {'content-length': String(MAX_PROGRESS_BYTES + 1)}),
    jsonResponse('x'.repeat(MAX_PROGRESS_BYTES + 1)),
    new Response(JSON.stringify(payload), {headers: {'content-type': 'text/html'}}),
    new Response(new Uint8Array([0xff]), {headers: {'content-type': 'application/json'}})
  ]) {
    const instance = connector({transport: async () => response});
    assert.deepEqual(await instance.read(), {status: 'REJECTED', progress: null, ageMs: null});
    assert.equal(response.body.locked, false);
  }
});

test('connector retains busy reservation after fetch timeout until late response cancellation', async () => {
  const late = deferred();
  const cancellation = deferred();
  let cancelled = false;
  let calls = 0;
  const instance = connector({timeoutMs: 15, transport: () => { calls++; return late.promise; }});
  const result = await instance.read();
  assert.equal(result.status, 'TIMEOUT');
  assert.equal(instance.isBusy(), true);
  assert.equal((await instance.read()).status, 'BUSY');
  late.resolve({status: 200, ok: true, body: {
    cancel: () => { cancelled = true; return cancellation.promise; }
  }});
  await drainUntil(() => cancelled);
  assert.equal(instance.isBusy(), true);
  cancellation.resolve();
  await drainUntil(() => !instance.isBusy());
  assert.equal(calls, 1);
  assert.equal(result.progress, null);
});

test('connector immediate disposal and timer failures cannot start a transport', async () => {
  let calls = 0;
  const instance = connector({transport: () => { calls++; }});
  const pending = instance.read();
  instance.dispose();
  assert.equal((await pending).status, 'DISPOSED');
  await drainUntil(() => !instance.isBusy());
  const timerFailure = connector({
    transport: () => { calls++; },
    schedule: () => { throw new Error('PRIVATE TIMER ERROR'); }
  });
  assert.equal((await timerFailure.read()).status, 'UNAVAILABLE');
  await drainUntil(() => !timerFailure.isBusy());
  assert.equal(calls, 0);
});

test('transport-triggered auth lock disposal still cancels the returned response', async () => {
  const cancelled = deferred();
  let instance;
  instance = connector({transport: async () => {
    instance.dispose();
    return {status: 401, ok: false, body: {cancel: () => { cancelled.resolve(); }}};
  }});
  assert.equal((await instance.read()).status, 'DISPOSED');
  await cancelled.promise;
  await drainUntil(() => !instance.isBusy());
  assert.equal(instance.isDisposed(), true);
});

test('real v11 app access locks and clears its registered reader on gateway auth failure', async () => {
  const {identity} = fixture();
  const token = 'progress-access-reader';
  const access = createAppAccess({fetchImpl: async (url, options) => {
    assert.ok(url.endsWith('/api/private/portfolio-history?range=1w'));
    assert.equal(options.headers.authorization, 'Bearer ' + token);
    return jsonResponse({});
  }});
  let unregister;
  const cancellation = deferred();
  const cancelStarted = deferred();
  let response;
  let instance;
  try {
    assert.equal(await access.verify(token), 'unlocked');
    instance = connector({transport: async ({signal}) => {
      const ownerToken = access.getToken();
      const request = Readable.from([]);
      Object.assign(request, {
        url: PROGRESS_ENDPOINT, method: 'GET',
        headers: {authorization: 'Bearer ' + ownerToken}
      });
      const reply = await handleSpotPaperPairedProgressGatewayRequest(request, {
        config: {enabled: true, expectedIdentity: identity},
        authorizedRead: () => false,
        getStore: () => { throw new Error('unauthorized read must not touch storage'); }
      });
      response = new Response(new ReadableStream({
        cancel() { cancelStarted.resolve(); return cancellation.promise; }
      }), {status: reply.status});
      if ((response.status === 401 || response.status === 403) &&
          !signal.aborted && access.getToken() === ownerToken) access.lock();
      return response;
    }});
    unregister = access.registerReader(() => instance.dispose());
    const result = await instance.read();
    assert.equal(result.status, 'DISPOSED');
    assert.equal(access.isUnlocked(), false);
    assert.equal(access.getToken(), null);
    assert.equal(instance.isDisposed(), true);
    assert.equal(result.progress, null);
    await cancelStarted.promise;
    assert.equal(instance.isBusy(), true, 'auth lock does not release an unfinished cancellation');
    cancellation.resolve();
    await drainUntil(() => !instance.isBusy());
    assert.equal(response.body.locked, false);
  } finally {
    cancellation.resolve();
    unregister?.();
    instance?.dispose();
    access.dispose();
  }
});

for (const phase of ['read', 'cancel', 'auth-cancel']) {
  for (const stop of ['timeout', 'dispose']) {
    test(`connector holds busy through ${phase} after ${stop} and releases all locks`, async () => {
      const started = deferred();
      const readSettlement = deferred();
      const cancelSettlement = deferred();
      let released = phase === 'auth-cancel';
      let cancelCalls = 0;
      let fireTimeout;
      const cancel = () => {
        cancelCalls++;
        if (phase !== 'read') started.resolve();
        return cancelSettlement.promise;
      };
      const instance = connector({
        timeoutMs: 10_000,
        schedule: callback => { fireTimeout = callback; return 1; },
        cancelSchedule: () => {},
        transport: async () => ({
        status: phase === 'auth-cancel' ? 403 : 200,
        ok: phase !== 'auth-cancel',
        headers: new Headers({'content-type': 'application/json'}),
        body: {
          cancel,
          getReader: () => ({
            read: () => {
              if (phase === 'read') { started.resolve(); return readSettlement.promise; }
              return Promise.resolve({done: true});
            },
            cancel, releaseLock: () => { released = true; }
          })
        }
      })});
      const pending = instance.read();
      await started.promise;
      if (stop === 'dispose') instance.dispose();
      else fireTimeout();
      const result = await pending;
      assert.equal(result.status, stop === 'dispose' ? 'DISPOSED' : 'TIMEOUT');
      assert.equal(instance.isBusy(), true);
      assert.equal((await instance.read()).status, stop === 'dispose' ? 'DISPOSED' : 'BUSY');
      readSettlement.resolve({done: true});
      cancelSettlement.resolve();
      await drainUntil(() => !instance.isBusy());
      assert.equal(cancelCalls, 1);
      assert.equal(released, true);
      assert.equal(result.progress, null);
      instance.dispose();
      assert.equal((await instance.read()).status, 'DISPOSED');
    });
  }
}

test('bounded input reader validates regular files, bytes and safe open flags without artifacts', async () => {
  const {payload} = fixture();
  const bytes = Buffer.from(JSON.stringify(payload));
  const openImpl = async (_path, flags) => {
    assert.ok(flags & constants.O_NOFOLLOW);
    assert.ok(flags & constants.O_NONBLOCK);
    return memoryFile(bytes);
  };
  assert.deepEqual(await readProgressJsonFile('memory-snapshot', {openImpl}), payload);
  for (const handle of [
    memoryFile(bytes, {regular: false}),
    memoryFile(bytes, {size: MAX_PROGRESS_BYTES + 1}),
    memoryFile(Buffer.alloc(MAX_PROGRESS_BYTES + 1)),
    memoryFile(Buffer.from([0xff]))
  ]) {
    await assert.rejects(readProgressJsonFile('memory-invalid', {
      openImpl: async () => handle
    }), {message: 'INVALID_INPUT'});
  }
  for (const path of ['test', '/proc/self/fd/0', 'test/nonexistent-progress-input']) {
    await assert.rejects(readProgressJsonFile(path), {message: 'INVALID_INPUT'});
  }
  const packageJson = await readProgressJsonFile('package.json');
  assert.equal(packageJson.private, true);
});

test('CLI only accepts explicit one-shot options and prints fixed safe outcomes', async () => {
  const args = ['--snapshot', 'package.json', '--expected-identity', 'package.json'];
  for (const extra of [['--endpoint', 'https://other.invalid'], ['--token', 'secret'],
    ['--publish', '--publish'], ['--snapshot', 'package.json'], ['--watch']]) {
    assert.deepEqual(await main([...args, ...extra], {}), {status: 'REJECTED'});
  }
  const cli = spawnSync(process.execPath, [
    'scripts/spot-paper-paired-progress/publish.mjs', ...args
  ], {encoding: 'utf8', env: {...process.env, [PUBLISH_TOKEN_ENV]: 'never-print-this'}});
  assert.equal(cli.status, 1);
  assert.equal(cli.stdout, '{"status":"REJECTED"}\n');
  assert.equal(cli.stderr, '');
  assert.equal((await main(['--snapshot'], {})).status, 'REJECTED');
});
