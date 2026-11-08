import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {
  getAcceptedSpotPaperIdentity,
  SPOT_PAPER_REPORT_MAX_BYTES,
  SPOT_PAPER_REPORT_TRANSFER_SCHEMA
} from '../scripts/spot-paper-report-bridge/contract.mjs';
import {
  handleSpotPaperReportGatewayRequest,
  spotPaperReportGatewayConfig
} from '../spot-paper-report-gateway.mjs';

const READ_TOKEN = 'fixture-read-token';
const UPLOAD_TOKEN = 'fixture-upload-token';
const hash = value => createHash('sha256').update(value).digest('hex');
const accepted = getAcceptedSpotPaperIdentity();
const now = Date.parse('2026-11-07T19:00:00.000Z');

function config(runId) {
  return spotPaperReportGatewayConfig({
    MERIDIAN_SPOT_PAPER_REPORT_ENABLED: 'true',
    MERIDIAN_SPOT_PAPER_REPORT_DEPLOYMENT_VERIFIED: 'true',
    MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_APPROVED: 'true',
    MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_TOKEN_SHA256: hash(UPLOAD_TOKEN),
    MERIDIAN_READ_TOKEN_SHA256: hash(READ_TOKEN),
    MERIDIAN_SPOT_PAPER_REPORT_RUN_ID: runId
  });
}

function dto(accepted = getAcceptedSpotPaperIdentity()) {
  return {
    schemaVersion: 'BTC_EUR_SPOT_PAPER_DASHBOARD_V1',
    identity: {
      runId: accepted.runId,
      sourceSha: accepted.sourceSha,
      workflowSha: accepted.workflowSha,
      workflowRunId: accepted.workflowRunId,
      workflowRunNumber: 1,
      workflowRunAttempt: 1,
      profileId: accepted.profileId,
      model: accepted.model,
      pair: accepted.pair
    },
    acceptedDispatchContext: {
      status: 'PASS',
      workflowRunId: accepted.workflowRunId,
      workflowRunNumber: 1,
      workflowRunAttempt: 1
    },
    snapshot: {
      status: 'COMPLETED_BOUNDED',
      completedAt: '2026-11-07T18:16:08.581Z',
      stopReason: 'CYCLE_LIMIT'
    },
    startingBalanceCents: '100000',
    cashCents: '89643',
    equityCents: '99525',
    realizedPnlCents: '-357',
    unrealizedPnlCents: '-118',
    feesCents: '350',
    buyCount: 4,
    sellCount: 3,
    fillCount: 7,
    openInventory: {status: 'OPEN_UNRESOLVED_AT_TERMINAL', quantitySat: '146122'},
    duration: {
      elapsedMs: accepted.maxDurationMs - 57_098,
      requestedMs: accepted.maxDurationMs,
      coverage: (accepted.maxDurationMs - 57_098) / accepted.maxDurationMs,
      status: 'PARTIAL_BOUNDED_DURATION'
    },
    coverage: {
      observations: accepted.maxCycles, acceptedObservations: accepted.maxCycles,
      dataGaps: 0, requests: accepted.maxRequests
    },
    verification: {
      terminalReadback: 'PASS',
      assessment: 'COMPLETED',
      assessmentSignalReplay: 'NOT_PERFORMED',
      signalReplay: 'PASS',
      profitability: 'NOT_ASSESSED'
    }
  };
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function request(method, url, token, body) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const bytes = body === undefined ? null : Buffer.from(body);
  if (bytes) headers['content-length'] = String(bytes.byteLength);
  return {
    method, url, headers,
    ...(bytes ? {[Symbol.asyncIterator]: async function* () { yield bytes; }} : {})
  };
}

class Store {
  rows = new Map();
  async insertImmutable(input) {
    const row = this.rows.get(input.runId);
    if (row) return row.content_sha256 === input.digest &&
      row.config_hash === input.configHash ? 'IDENTICAL' : 'CONFLICT';
    this.rows.set(input.runId, {
      run_id: input.runId,
      config_hash: input.configHash,
      content_sha256: input.digest,
      envelope: structuredClone(input.envelope)
    });
    return 'INSERTED';
  }
  async get(runId) { return this.rows.get(runId); }
}

const authorizedRead = req => req.headers.authorization === 'Bearer ' + READ_TOKEN;

test('server selection defaults to first-hour, rejects invalid selectors and binds the config hash', async () => {
  assert.equal(config().expectedRunId, accepted.runId);
  assert.equal(config().expectedConfigHash,
    '1254884f534fa0c1026b7ae6ce882884b4dc047c3462813fb3e7adfe7a029206');
  assert.notEqual(config('spot-paper-42404743386-1').expectedConfigHash, config().expectedConfigHash);
  for (const runId of ['', '42404743386', 'spot-paper-42404743386-2', 'toString', '__proto__', null]) {
    assert.throws(() => config(runId), /invalid spot-paper report run selection/);
  }
  for (const settings of [
    {...config(), expectedRunId: 'other'},
    {...config(), expectedConfigHash: 'a'.repeat(64)},
    {...config('spot-paper-42404743386-1'), expectedConfigHash: config().expectedConfigHash}
  ]) {
    const result = await handleSpotPaperReportGatewayRequest(
      request('GET', '/api/private/spot-paper-report', READ_TOKEN),
      {config: settings, getStore: () => { throw Error('must not read'); }, authorizedRead}
    );
    assert.equal(result.status, 503);
  }
});

test('explicit run selection keeps both rows immutable and never automatically selects the newer report', async () => {
  const store = new Store();
  const first = config();
  const four = config('spot-paper-42404743386-1');
  const dependencies = settings => ({
    config: settings, getStore: () => store, authorizedRead, now: () => now
  });
  const upload = (settings, report) => handleSpotPaperReportGatewayRequest(
    request('POST', '/api/private/spot-paper-report/upload', UPLOAD_TOKEN, canonical({
      schema: SPOT_PAPER_REPORT_TRANSFER_SCHEMA, runId: report.identity.runId, report
    })), dependencies(settings));
  const read = settings => handleSpotPaperReportGatewayRequest(
    request('GET', '/api/private/spot-paper-report', READ_TOKEN), dependencies(settings));
  assert.equal((await read(four)).status, 404);
  assert.equal((await upload(first, dto())).status, 201);
  const original = structuredClone(await store.get(first.expectedRunId));
  const fourDto = dto(getAcceptedSpotPaperIdentity(four.expectedRunId));
  assert.equal((await upload(first, fourDto)).status, 400);
  assert.equal((await upload(four, dto())).status, 400);
  assert.equal((await upload(four, fourDto)).status, 201);
  for (const settings of [first, four]) {
    const report = dto(getAcceptedSpotPaperIdentity(settings.expectedRunId));
    assert.equal((await upload(settings, report)).status, 200);
    report.cashCents = '89644';
    assert.equal((await upload(settings, report)).status, 409);
    assert.equal((await read(settings)).body.runId, settings.expectedRunId);
  }
  assert.deepEqual(await store.get(first.expectedRunId), original);
  assert.equal((await read(config())).body.runId, first.expectedRunId);
  store.rows.set(four.expectedRunId, original);
  assert.equal((await read(four)).body.error, 'spot_paper_report_corrupt');
});

test('forward migration retains existing rows, integrity checks and PUBLIC revocation without DML', async () => {
  const original = await readFile(new URL(
    '../migrations/20261107_meridian_spot_paper_reports.sql', import.meta.url), 'utf8');
  const forward = await readFile(new URL(
    '../migrations/20261108_meridian_spot_paper_reports_two_runs.sql', import.meta.url), 'utf8');
  assert.match(original, /run_id text PRIMARY KEY CHECK \(run_id = 'spot-paper-42395522899-1'\)/);
  assert.match(original, /config_hash text NOT NULL CHECK/);
  assert.match(original, /content_sha256 text NOT NULL CHECK/);
  assert.match(forward, /^BEGIN;/);
  assert.match(forward, /COMMIT;\s*$/);
  assert.match(forward, /DROP CONSTRAINT meridian_spot_paper_reports_run_id_check,/);
  assert.match(forward, /CHECK \(run_id IN \('spot-paper-42395522899-1', 'spot-paper-42404743386-1'\)\)/);
  assert.match(forward, /REVOKE ALL ON TABLE meridian_spot_paper_reports FROM PUBLIC;/);
  assert.doesNotMatch(forward, /\b(?:DELETE|UPDATE|INSERT|TRUNCATE|GRANT)\b|DROP TABLE|PRIMARY KEY|config_hash|content_sha256/i);
});

test('spot-paper gateway is disabled unless deployment evidence and upload approval are explicit', async () => {
  const disabled = spotPaperReportGatewayConfig({});
  assert.equal(disabled.enabled, false);
  const result = await handleSpotPaperReportGatewayRequest(
    request('GET', '/api/private/spot-paper-report', READ_TOKEN),
    {config: disabled, getStore: () => { throw Error('must not read'); }, authorizedRead, now: () => now}
  );
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'spot_paper_report_disabled');
});

test('spot-paper gateway uses distinct upload contract and authenticated immutable readback', async () => {
  const store = new Store();
  const settings = config();
  const body = canonical({
    schema: SPOT_PAPER_REPORT_TRANSFER_SCHEMA,
    runId: accepted.runId,
    report: dto()
  });
  const upload = await handleSpotPaperReportGatewayRequest(
    request('POST', '/api/private/spot-paper-report/upload', UPLOAD_TOKEN, body),
    {config: settings, getStore: () => store, authorizedRead, now: () => now}
  );
  assert.equal(upload.status, 201);

  const rejectedUpload = await handleSpotPaperReportGatewayRequest(
    request('POST', '/api/private/spot-paper-report/upload', READ_TOKEN, body),
    {config: settings, getStore: () => store, authorizedRead, now: () => now}
  );
  assert.equal(rejectedUpload.status, 401);

  const unauthorizedRead = await handleSpotPaperReportGatewayRequest(
    request('GET', '/api/private/spot-paper-report', ''),
    {config: settings, getStore: () => store, authorizedRead, now: () => now}
  );
  assert.equal(unauthorizedRead.status, 401);

  const read = await handleSpotPaperReportGatewayRequest(
    request('GET', '/api/private/spot-paper-report', READ_TOKEN),
    {config: settings, getStore: () => store, authorizedRead, now: () => now}
  );
  assert.equal(read.status, 200);
  assert.equal(read.body.schema, 'BTC_EUR_SPOT_PAPER_REPORT_ENVELOPE_V1');
  assert.equal(read.body.report.openInventory.quantitySat, '146122');
  assert.equal(read.body.report.equityCents, '99525');

  const query = await handleSpotPaperReportGatewayRequest(
    request('GET', '/api/private/spot-paper-report?runId=other', READ_TOKEN),
    {config: settings, getStore: () => store, authorizedRead, now: () => now}
  );
  assert.equal(query.status, 400);
});

test('spot-paper upload rejects identity masquerading and bounded-body violations', async () => {
  const settings = config();
  const wrongIdentity = dto();
  wrongIdentity.identity.workflowSha = 'a'.repeat(40);
  const body = canonical({
    schema: SPOT_PAPER_REPORT_TRANSFER_SCHEMA,
    runId: accepted.runId,
    report: wrongIdentity
  });
  const invalid = await handleSpotPaperReportGatewayRequest(
    request('POST', '/api/private/spot-paper-report/upload', UPLOAD_TOKEN, body),
    {config: settings, getStore: () => new Store(), authorizedRead, now: () => now}
  );
  assert.equal(invalid.status, 400);

  const tooLarge = await handleSpotPaperReportGatewayRequest(
    request('POST', '/api/private/spot-paper-report/upload', UPLOAD_TOKEN, '{}'),
    {
      config: settings,
      getStore: () => new Store(),
      authorizedRead,
      now: () => now,
      readBody: async (_req, options) => {
        assert.equal(options.maxBytes, SPOT_PAPER_REPORT_MAX_BYTES);
        const error = new Error('too large');
        error.code = 'BODY_TOO_LARGE';
        throw error;
      }
    }
  );
  assert.equal(tooLarge.status, 413);

  const cancelled = await handleSpotPaperReportGatewayRequest(
    request('POST', '/api/private/spot-paper-report/upload', UPLOAD_TOKEN, '{}'),
    {
      config: settings,
      getStore: () => new Store(),
      authorizedRead,
      now: () => now,
      signal: new AbortController().signal,
      readBody: async (_req, options) => {
        assert.ok(options.signal);
        const error = new Error('cancelled');
        error.code = 'REQUEST_CANCELLED';
        throw error;
      }
    }
  );
  assert.equal(cancelled.status, 408);
});
