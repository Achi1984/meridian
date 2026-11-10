import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Readable} from 'node:stream';
import test from 'node:test';
import {Pool} from 'pg';
import {
  handleSpotPaperPairedProgressGatewayRequest as handle,
  spotPaperPairedProgressGatewayConfig as configuration,
  writeSpotPaperPairedProgressRouteResponse
} from '../spot-paper-paired-progress-gateway.mjs';
import {
  createPrivatePairedProgressStore, PAIRED_PROGRESS_UPSERT_SQL
} from '../private-paired-progress-store.mjs';
import {
  canonicalJson, PROGRESS_PATH, PROGRESS_SCHEMA, MAX_PROGRESS_BYTES, validateProgress
} from '../scripts/spot-paper-paired-progress/contract.mjs';
import {syntheticExpectedPairedIdentity} from './helpers/spot-paper-paired-dashboard-fixture.mjs';
import {progressJournalFixture, journalEnvelope} from './helpers/spot-paper-paired-progress-fixture.mjs';
import {exportProgress} from '../scripts/spot-paper-paired-progress/export.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const reader = 'synthetic-progress-reader';
const uploader = 'synthetic-progress-uploader';
const writer = 'synthetic-progress-writer';
const legacy = 'synthetic-progress-legacy-uploader';
const identity = syntheticExpectedPairedIdentity({modelPair: true});
const env = () => ({
  MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_ENABLED: 'true',
  MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_DEPLOYMENT_VERIFIED: 'true',
  MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY_JSON: JSON.stringify(identity),
  MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_UPLOAD_TOKEN_SHA256: digest(uploader),
  MERIDIAN_READ_TOKEN_SHA256: digest(reader),
  MERIDIAN_WRITE_TOKEN_SHA256: digest(writer),
  MERIDIAN_PAPER_REPORT_UPLOAD_TOKEN_SHA256: digest(legacy),
  MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_TOKEN_SHA256: digest(legacy)
});
function progress(sequence = 2, status = 'UNKNOWN') {
  return {
    schemaVersion: PROGRESS_SCHEMA, identity: structuredClone(identity),
    journalSequence: sequence, journalSha256: digest(`checkpoint-${sequence}`),
    classification: 'OBSERVED_CHECKPOINT',
    observedAt: 1_000, valuationAt: 1_000, exportedAt: 2_000,
    latestEventAt: status === 'UNKNOWN' ? 1_000 : 1_500,
    terminal: {status, at: status === 'UNKNOWN' ? null : 1_500},
    currency: 'EUR', monetaryUnit: 'CENTS',
    assumptions: {
      feeBpsPerSide: 20, slippageBpsPerSide: 10, ratesVerified: false,
      feeBasis: 'EEA_SPOT_ONLY_TAKER_ASSUMPTION', netEquityIncludesCosts: true
    },
    arms: identity.models.map(({role, modelId}) => ({
      role, modelId, startingCapitalCents: 100_000, netEquityCents: 100_000,
      netPnlCents: 0, cashCents: 100_000, bookedFeesCents: 0,
      modeledSlippageCents: 0, hypotheticalExitFeeCents: 0,
      hypotheticalExitSlippageCents: 0, turnoverCents: 0, exposureCents: 0,
      sampledDrawdownCents: 0, unresolvedObservations: 0, inventoryStatus: 'FLAT',
      stopReason: null, tradingStoppedAt: null, fillCount: 0,
      completedRoundTripCount: 0, recentFills: []
    }))
  };
}
function request(method = 'GET', token = reader, value = progress()) {
  const req = Readable.from(method === 'POST' ? [Buffer.from(JSON.stringify(value))] : []);
  req.method = method;
  req.url = PROGRESS_PATH;
  req.headers = {
    authorization: ['Bearer', token].join(' '),
    ...(method === 'POST' ? {'content-type': 'application/json'} : {})
  };
  return req;
}
function options(extra = {}) {
  return {
    config: configuration(env()),
    authorizedRead: req => req.headers.authorization === ['Bearer', reader].join(' '),
    getStore: () => ({get: async () => progress(), put: async () => ({status: 'STORED'})}),
    ...extra
  };
}
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('shared journal fixture exports, uploads, reads and repeats without changing valuation time', async () => {
  const fixture = progressJournalFixture();
  const bytes = Buffer.from(journalEnvelope(fixture.journal));
  let descriptor = 10;
  const io = {
    async lstat() { throw Object.assign(Error('no pending journal'), {code: 'ENOENT'}); },
    async open(path) {
      const file = path.endsWith('/journal.json');
      let position = 0;
      return {
        fd: descriptor++,
        async stat() {
          return {
            dev: 1n, ino: file ? 2n : 1n, size: BigInt(file ? bytes.length : 0),
            mtimeNs: 1n, ctimeNs: 1n, nlink: 1n, isFile: () => file
          };
        },
        async read(buffer) {
          const bytesRead = bytes.copy(buffer, 0, position);
          position += bytesRead;
          return {bytesRead};
        },
        async close() {}
      };
    }
  };
  const exported = await exportProgress({
    runDirectory: resolve('paired-progress-virtual-fixture'),
    expectedIdentity: fixture.expectedIdentity, now: () => fixture.now, io
  });
  assert.equal(exported.status, 'EXPORTED');
  let persisted;
  const store = createPrivatePairedProgressStore({
    query: async (sql, values) => {
      if (sql.includes('INSERT INTO')) {
        if (persisted) return {rows: []};
        persisted = JSON.parse(values[5]);
      }
      return {rows: persisted ? [{payload: structuredClone(persisted)}] : []};
    }
  });
  const settings = options({
    config: configuration({
      ...env(), MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY_JSON:
        JSON.stringify(fixture.expectedIdentity)
    }),
    getStore: () => store
  });
  const result = await handle(request('POST', uploader, exported.progress), settings);
  assert.deepEqual(result, {status: 200, body: {
    schemaVersion: 'SPOT_PAPER_PAIRED_PROGRESS_RECEIPT_V1', status: 'ACCEPTED',
    journalSequence: fixture.journal.sequence,
    journalSha256: JSON.parse(journalEnvelope(fixture.journal)).sha256
  }});
  const read = await handle(request(), settings);
  assert.deepEqual(read.body, exported.progress);
  assert.equal(read.body.valuationAt, fixture.journal.events.at(-1).effectAt);
  assert.notEqual(read.body.valuationAt, fixture.now);
  const repeated = {...exported.progress, exportedAt: fixture.now + 5_000};
  assert.deepEqual(await handle(request('POST', uploader, repeated), settings), result);
  assert.deepEqual((await handle(request(), settings)).body, exported.progress);
});

test('default disabled, exact flags, verified full identity and role-separated credentials fail closed', async () => {
  const off = configuration({});
  assert.equal(off.enabled, false);
  const unavailable = () => { throw Error('disabled route accessed database'); };
  assert.equal((await handle(request(), options({config: off, getStore: unavailable}))).status, 503);
  for (const flag of ['ENABLED', 'DEPLOYMENT_VERIFIED']) {
    for (const value of ['TRUE', '1', 'false', undefined]) {
      assert.equal(configuration({
        ...env(), [`MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_${flag}`]: value
      }).enabled, false);
    }
  }
  for (const value of ['{}', '{', 'x'.repeat(16_385)]) {
    assert.equal(configuration({
      ...env(), MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY_JSON: value
    }).enabled, false);
  }
  const noModelPair = structuredClone(identity);
  delete noModelPair.modelPairId;
  const historical = {...identity, runId: 'btc-eur-paired-host8h-20261108-001'};
  for (const value of [noModelPair, historical]) {
    assert.equal(configuration({
      ...env(), MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY_JSON: JSON.stringify(value)
    }).enabled, false);
  }
  for (const role of [reader, writer, legacy]) {
    assert.equal(configuration({
      ...env(), MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_UPLOAD_TOKEN_SHA256: digest(role)
    }).enabled, false);
    assert.equal((await handle(request('POST', role), options({getStore: unavailable}))).status, 401);
  }
  for (const role of ['', uploader, writer, legacy]) {
    assert.equal((await handle(request('GET', role), options({getStore: unavailable}))).status, 401);
  }
  assert.equal((await handle(request('POST', ''), options({getStore: unavailable}))).status, 401);
  assert.equal((await handle(request('GET'), options({authorizedRead: undefined}))).status, 401);
});

test('exact allowlist, strict payload and read validation preserve original valuation timestamp', async () => {
  const value = progress();
  assert.ok(validateProgress(value, identity));
  const read = await handle(request(), options());
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, value);
  assert.equal(read.body.valuationAt, 1_000);
  assert.equal(read.body.exportedAt, 2_000);
  let saved;
  const upload = await handle(request('POST', uploader), options({
    getStore: () => ({put: async input => { saved = input; return {status: 'STORED'}; }})
  }));
  assert.equal(upload.status, 200);
  assert.deepEqual(upload.body, {
    schemaVersion: 'SPOT_PAPER_PAIRED_PROGRESS_RECEIPT_V1', status: 'ACCEPTED',
    journalSequence: value.journalSequence, journalSha256: value.journalSha256
  });
  assert.ok(Buffer.byteLength(JSON.stringify(upload.body)) < 4096);
  assert.deepEqual(saved, value);
  assert.notEqual(saved, value);
  for (const field of ['runId', 'sourceSha256', 'configSha256', 'researchSourceSha256',
    'feedSourceId', 'comparisonEngineId', 'modelPairId', 'pair', 'schemaVersion']) {
    const changed = progress();
    changed.identity[field] = field.endsWith('Sha256') ? 'a'.repeat(64) : 'OTHER';
    assert.equal((await handle(request('POST', uploader, changed), options())).status, 400, field);
  }
  for (const index of [0, 1, 2]) {
    for (const field of ['role', 'modelId', 'accountId']) {
      const changed = progress();
      changed.identity.models[index][field] = 'OTHER';
      assert.equal((await handle(request('POST', uploader, changed), options())).status, 400);
    }
  }
  const invalid = {...progress(), secret: 'not-allowed'};
  assert.equal((await handle(request('POST', uploader, invalid), options())).status, 400);
  assert.equal((await handle(request(), options({
    getStore: () => ({get: async () => invalid})
  }))).status, 503);
  assert.equal((await handle(request(), options({
    getStore: () => ({get: async () => null})
  }))).status, 404);
  const req = request();
  req.url += '?runId=other';
  assert.equal((await handle(req, options())).status, 400);
  assert.equal((await handle(request('DELETE'), options())).status, 405);
  req.url = `${PROGRESS_PATH}/other`;
  assert.equal(await handle(req, options()), null);
});

test('body byte, content type, declared length and body deadline caps are enforced', async () => {
  const oversized = request('POST', uploader);
  oversized.headers['content-length'] = String(MAX_PROGRESS_BYTES + 1);
  assert.equal((await handle(oversized, options())).status, 413);
  for (const length of ['-1', '1.2', '00', 'x']) {
    const req = request('POST', uploader);
    req.headers['content-length'] = length;
    assert.equal((await handle(req, options())).status, 400);
  }
  const mismatch = request('POST', uploader);
  mismatch.headers['content-length'] = '1';
  assert.equal((await handle(mismatch, options())).status, 400);
  const contentType = request('POST', uploader);
  contentType.headers['content-type'] = 'text/plain';
  assert.equal((await handle(contentType, options())).status, 415);
  assert.equal((await handle(request('POST', uploader), options({
    readBody: async () => Buffer.alloc(MAX_PROGRESS_BYTES + 1)
  }))).status, 413);
  const stream = request('POST', uploader);
  const bigStream = Readable.from([Buffer.alloc(MAX_PROGRESS_BYTES + 1)]);
  Object.assign(bigStream, {method: stream.method, url: stream.url, headers: stream.headers});
  assert.equal((await handle(bigStream, options())).status, 413);
  assert.equal((await handle(request('POST', uploader), options({
    readBody: async (_req, limits) => {
      assert.equal(limits.maxBytes, MAX_PROGRESS_BYTES);
      assert.equal(limits.timeoutMs, 5_000);
      throw Object.assign(Error('deadline'), {code: 'BODY_TIMEOUT'});
    }
  }))).status, 408);
  assert.equal((await handle(request('POST', uploader), options({
    readBody: async () => Buffer.from('{')
  }))).status, 400);
});

test('atomic CAS compares whole identity including every account/model and freezes terminal checkpoints', async () => {
  assert.match(PAIRED_PROGRESS_UPSERT_SQL, /ON CONFLICT \(run_id\) DO UPDATE/);
  assert.match(PAIRED_PROGRESS_UPSERT_SQL, /current\.identity = EXCLUDED\.identity/);
  assert.match(PAIRED_PROGRESS_UPSERT_SQL, /current\.journal_sequence < EXCLUDED\.journal_sequence/);
  assert.match(PAIRED_PROGRESS_UPSERT_SQL, /current\.terminal_status = 'UNKNOWN'/);
  for (const field of ['observedAt', 'valuationAt', 'latestEventAt']) {
    assert.ok(PAIRED_PROGRESS_UPSERT_SQL.includes(
      `(current.payload->>'${field}')::bigint <= (EXCLUDED.payload->>'${field}')::bigint`));
  }
  assert.doesNotMatch(PAIRED_PROGRESS_UPSERT_SQL, /SET\s+identity\s*=/);
  let parameters;
  const store = createPrivatePairedProgressStore({
    query: async (_sql, values) => { parameters = values; return {rows: [{payload: progress()}]}; }
  });
  assert.deepEqual(await store.put(progress()), {status: 'STORED'});
  assert.deepEqual(JSON.parse(parameters[1]), identity);
  assert.deepEqual(JSON.parse(parameters[5]), progress());
  for (const change of [
    value => { value.arms[0].cashCents++; },
    value => { value.journalSha256 = 'f'.repeat(64); },
    value => { value.journalSequence--; },
    value => { value.terminal = {status: 'TERMINAL_RECORDED', at: 1_000}; }
  ]) {
    const changed = progress(3);
    change(changed);
    const conflictStore = createPrivatePairedProgressStore({
      query: async sql => ({rows: sql.includes('INSERT INTO') ? [] : [{payload: progress(3)}]})
    });
    assert.deepEqual(await conflictStore.put(changed), {status: 'CONFLICT'});
  }
  const repeated = progress();
  repeated.exportedAt++;
  const repeatStore = createPrivatePairedProgressStore({
    query: async sql => ({rows: sql.includes('INSERT INTO') ? [] : [{payload: progress()}]})
  });
  assert.deepEqual(await repeatStore.put(repeated), {status: 'IDEMPOTENT'});
});

test('store write deadline remains UNKNOWN after late commit and capacity is held to real settle', async () => {
  const late = deferred();
  let expire;
  const store = createPrivatePairedProgressStore({query: () => late.promise}, {
    maxConcurrent: 1, schedule: callback => { expire = callback; return 1; },
    cancelSchedule() {}
  });
  const pending = store.put(progress());
  await tick();
  expire();
  await assert.rejects(pending, {code: 'PAIRED_PROGRESS_OUTCOME_UNKNOWN'});
  await assert.rejects(store.put(progress(3)), {code: 'STORE_BUSY'});
  late.resolve({rows: [{payload: progress()}]});
  await tick();
  const next = store.put(progress());
  assert.deepEqual(await next, {status: 'STORED'});

  const failed = createPrivatePairedProgressStore({
    query: async () => { throw Error('connection lost'); }
  });
  await assert.rejects(failed.put(progress()), {code: 'PAIRED_PROGRESS_OUTCOME_UNKNOWN'});
});

test('gateway bounds hung stores, preserves UNKNOWN and holds both request slots after deadlines', async () => {
  const late = deferred();
  const settings = options({
    storeTimeoutMs: 5,
    getStore: () => ({put: () => late.promise})
  });
  const results = await Promise.all([
    handle(request('POST', uploader), settings),
    handle(request('POST', uploader), settings)
  ]);
  for (const result of results) {
    assert.equal(result.status, 503);
    assert.equal(result.body.status, 'UNKNOWN');
  }
  assert.equal((await handle(request('POST', uploader), options())).body.error,
    'spot_paper_paired_progress_busy');
  late.resolve({status: 'STORED'});
  await tick();
  assert.equal((await handle(request('POST', uploader), options())).status, 200);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await handle(request('POST', uploader), options({
    signal: controller.signal, readBody: async () => Buffer.from(JSON.stringify(progress()))
  }));
  assert.equal(cancelled.status, 503);
  assert.equal(cancelled.body.status, 'UNKNOWN');
});

test('migration is additive UNAPPLIED private progress storage and server registers isolated route', async () => {
  const migration = await readFile(new URL(
    '../migrations/20261110_meridian_spot_paper_paired_progress.sql', import.meta.url), 'utf8');
  assert.match(migration, /UNAPPLIED/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS meridian_spot_paper_paired_progress/);
  assert.match(migration, /octet_length\(payload::text\) <= 65536/);
  assert.match(migration, /REVOKE ALL ON TABLE meridian_spot_paper_paired_progress FROM PUBLIC/);
  assert.doesNotMatch(migration, /\b(?:DROP|ALTER|DELETE|TRUNCATE)\b/i);
  assert.doesNotMatch(migration, /meridian_spot_paper_paired_reports\b/);
  const gateway = await readFile(new URL('../server-gateway.js', import.meta.url), 'utf8');
  assert.match(gateway, /handleSpotPaperPairedProgressGatewayRequest\(req/);
  assert.match(gateway, /createPrivatePairedProgressStore\(paperReportPool\(\)\)/);
  const events = {};
  const res = {once: (name, callback) => { events[name] = callback; }};
  let destroyed = false;
  const req = {complete: false, destroy() { destroyed = true; }};
  writeSpotPaperPairedProgressRouteResponse(req, res, {status: 401, body: {}}, '', () => {});
  assert.equal(res.shouldKeepAlive, false);
  events.finish();
  assert.equal(destroyed, true);
});

const connectionString = process.env.MERIDIAN_TEST_PAPER_REPORT_DATABASE_URL;
(connectionString ? test : test.skip)('real PostgreSQL CAS: concurrency, full identities, idempotency, terminal freeze', async t => {
  const admin = new Pool({connectionString, max: 1});
  const schema = `paired_progress_test_${process.pid}_${randomBytes(4).toString('hex')}`;
  let database;
  let created = false;
  t.after(async () => {
    await database?.end();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });
  const target = (await admin.query(
    'SELECT current_database() AS database, inet_server_addr() AS address')).rows[0];
  assert.match(target.database, /^meridian_paper_report_test_[a-z0-9_]+$/);
  assert.equal(target.address, null);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  database = new Pool({connectionString, max: 2, options: `-c search_path=${schema}`});
  await database.query(await readFile(new URL(
    '../migrations/20261110_meridian_spot_paper_paired_progress.sql', import.meta.url), 'utf8'));
  const store = createPrivatePairedProgressStore(database);
  const result = await Promise.all([store.put(progress()), store.put(progress())]);
  assert.deepEqual(result.map(value => value.status).sort(), ['IDEMPOTENT', 'STORED']);
  const repeated = progress();
  repeated.exportedAt += 5_000;
  assert.equal((await store.put(repeated)).status, 'IDEMPOTENT');
  assert.equal((await store.get(identity)).exportedAt, 2_000);
  const changed = progress();
  changed.arms[0].cashCents--;
  assert.equal((await store.put(changed)).status, 'CONFLICT');
  const changedDigest = progress();
  changedDigest.journalSha256 = 'f'.repeat(64);
  assert.equal((await store.put(changedDigest)).status, 'CONFLICT');
  const competingCheckpoint = progress(3);
  competingCheckpoint.arms[0].cashCents--;
  const conflictResults = await Promise.all([
    store.put(progress(3)), store.put(competingCheckpoint)
  ]);
  assert.deepEqual(conflictResults.map(value => value.status).sort(), ['CONFLICT', 'STORED']);
  assert.equal((await store.put(progress(4))).status, 'STORED');
  assert.equal((await store.put(progress(3))).status, 'CONFLICT');
  for (const key of ['sourceSha256', 'configSha256', 'researchSourceSha256',
    'feedSourceId', 'comparisonEngineId']) {
    const value = progress(5);
    value.identity[key] = key.endsWith('Sha256') ? 'a'.repeat(64) : 'other';
    assert.equal((await store.put(value)).status, 'CONFLICT', key);
  }
  for (const index of [0, 1, 2]) {
    const value = progress(5);
    value.identity.models[index].accountId += '-other';
    assert.equal((await store.put(value)).status, 'CONFLICT');
  }
  const competing = await Promise.all([store.put(progress(5)), store.put(progress(6))]);
  assert.ok(competing.some(value => value.status === 'STORED'));
  assert.equal((await store.get(identity)).journalSequence, 6);
  assert.equal((await store.put(progress(7, 'TERMINAL_RECORDED'))).status, 'STORED');
  for (const status of ['UNKNOWN', 'TERMINAL_RECORDED', 'INTERRUPTED_RECORDED']) {
    assert.equal((await store.put(progress(8, status))).status, 'CONFLICT', status);
  }
  assert.equal((await store.put(progress(7, 'INTERRUPTED_RECORDED'))).status, 'CONFLICT');
  assert.equal((await store.put(progress(7, 'TERMINAL_RECORDED'))).status, 'IDEMPOTENT');
  const terminal = await store.get(identity);
  assert.equal(terminal.valuationAt, 1_000);
  assert.equal(terminal.terminal.status, 'TERMINAL_RECORDED');
  assert.equal(canonicalJson(terminal), canonicalJson(progress(7, 'TERMINAL_RECORDED')));

  const timestamped = progress(2);
  timestamped.identity.runId += '-timestamps';
  timestamped.latestEventAt = 1_500;
  assert.equal((await store.put(timestamped)).status, 'STORED');
  for (const change of [
    value => { value.observedAt = value.valuationAt = 999; },
    value => { value.latestEventAt = 1_499; }
  ]) {
    const stale = {...structuredClone(timestamped), journalSequence: 3};
    change(stale);
    assert.ok(validateProgress(stale, stale.identity));
    assert.equal((await store.put(stale)).status, 'CONFLICT');
  }
  assert.deepEqual(await store.get(timestamped.identity), timestamped);
  const fresher = {...structuredClone(timestamped), journalSequence: 3,
    observedAt: 1_100, valuationAt: 1_100, latestEventAt: 1_500};
  assert.equal((await store.put(fresher)).status, 'STORED');

  const interrupted = progress(2, 'INTERRUPTED_RECORDED');
  interrupted.identity.runId += '-interrupted';
  assert.equal((await store.put(interrupted)).status, 'STORED');
  for (const status of ['UNKNOWN', 'TERMINAL_RECORDED', 'INTERRUPTED_RECORDED']) {
    const later = progress(3, status);
    later.identity = structuredClone(interrupted.identity);
    assert.equal((await store.put(later)).status, 'CONFLICT');
  }

  const late = progress();
  late.identity.runId += '-late';
  const timeoutStore = createPrivatePairedProgressStore(database, {
    maxConcurrent: 1, operationTimeoutMs: 30
  });
  await admin.query('BEGIN');
  try {
    await admin.query(`LOCK TABLE "${schema}".meridian_spot_paper_paired_progress IN ACCESS EXCLUSIVE MODE`);
    await assert.rejects(timeoutStore.put(late), {code: 'PAIRED_PROGRESS_OUTCOME_UNKNOWN'});
    await assert.rejects(timeoutStore.put(late), {code: 'STORE_BUSY'});
  } finally {
    await admin.query('ROLLBACK');
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await store.get(late.identity)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(await store.get(late.identity), late);
  await tick();
  assert.equal((await timeoutStore.put(late)).status, 'IDEMPOTENT');
});
