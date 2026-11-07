import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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

function config() {
  return spotPaperReportGatewayConfig({
    MERIDIAN_SPOT_PAPER_REPORT_ENABLED: 'true',
    MERIDIAN_SPOT_PAPER_REPORT_DEPLOYMENT_VERIFIED: 'true',
    MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_APPROVED: 'true',
    MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_TOKEN_SHA256: hash(UPLOAD_TOKEN),
    MERIDIAN_READ_TOKEN_SHA256: hash(READ_TOKEN)
  });
}

function dto() {
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
      elapsedMs: 3_542_902,
      requestedMs: 3_600_000,
      coverage: 3_542_902 / 3_600_000,
      status: 'PARTIAL_BOUNDED_DURATION'
    },
    coverage: {observations: 60, acceptedObservations: 60, dataGaps: 0, requests: 120},
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
  row = null;
  async insertImmutable(input) {
    if (this.row) return this.row.content_sha256 === input.digest ? 'IDENTICAL' : 'CONFLICT';
    this.row = {
      run_id: input.runId,
      config_hash: input.configHash,
      content_sha256: input.digest,
      envelope: structuredClone(input.envelope)
    };
    return 'INSERTED';
  }
  async get() { return this.row; }
}

const authorizedRead = req => req.headers.authorization === 'Bearer ' + READ_TOKEN;

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
