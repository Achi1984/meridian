import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createPrivateReportStore} from '../private-report-store.mjs';
import {
  handleSpotPaperPairedReportGatewayRequest,
  SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
  SPOT_PAPER_PAIRED_REPORT_PATH,
  spotPaperPairedReportGatewayConfig
} from '../spot-paper-paired-report-gateway.mjs';
import {
  syntheticExpectedPairedIdentity,
  syntheticPairedDashboard
} from './helpers/spot-paper-paired-dashboard-fixture.mjs';

const READ_TOKEN = 'synthetic-paired-read-token';
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = syntheticExpectedPairedIdentity();
const env = () => ({
  MERIDIAN_SPOT_PAPER_PAIRED_REPORT_ENABLED: 'true',
  MERIDIAN_SPOT_PAPER_PAIRED_REPORT_DEPLOYMENT_VERIFIED: 'true',
  MERIDIAN_SPOT_PAPER_PAIRED_REPORT_EXPECTED_IDENTITY_JSON: JSON.stringify(identity)
});
const config = () => spotPaperPairedReportGatewayConfig(env());
const request = (method = 'GET', url = SPOT_PAPER_PAIRED_REPORT_PATH, token = READ_TOKEN) => ({
  method, url, headers: token ? {authorization: ['Bearer', token].join(' ')} : {}
});
const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};
const envelope = report => ({
  schema: SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
  runId: identity.runId,
  report
});
const row = report => {
  const value = envelope(report);
  return {
    run_id: identity.runId,
    config_hash: identity.configSha256,
    content_sha256: hash(canonical(value)),
    envelope: value
  };
};
const get = (requestValue, options = {}) => handleSpotPaperPairedReportGatewayRequest(
  requestValue, {
    config: config(),
    authorizedRead: req => req.headers.authorization === ['Bearer', READ_TOKEN].join(' '),
    getStore: () => ({get: async () => options.row ?? null}),
    ...options
  }
);

test('paired read route is bounded, authenticated, read-only and config-gated', async () => {
  const missingConfig = spotPaperPairedReportGatewayConfig({});
  const absent = await handleSpotPaperPairedReportGatewayRequest(request(), {
    config: missingConfig,
    authorizedRead: () => true,
    getStore() { throw Error('unprovisioned transport must not access the store'); }
  });
  assert.equal(absent.status, 503);
  assert.equal(absent.body.error, 'spot_paper_paired_transport_not_provisioned');

  assert.equal((await get(request('GET', SPOT_PAPER_PAIRED_REPORT_PATH, ''))).status, 401);
  assert.equal((await get(request('GET', `${SPOT_PAPER_PAIRED_REPORT_PATH}?runId=x`))).status, 400);
  assert.equal((await get(request('POST'))).status, 405);
  assert.equal(await get(request('POST', `${SPOT_PAPER_PAIRED_REPORT_PATH}/upload`)), null);

  const unsupportedIdentity = structuredClone(identity);
  unsupportedIdentity.models[1].modelId =
    'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1';
  const identityConfig = spotPaperPairedReportGatewayConfig({
    ...env(),
    MERIDIAN_SPOT_PAPER_PAIRED_REPORT_EXPECTED_IDENTITY_JSON:
      JSON.stringify(unsupportedIdentity)
  });
  const unsupported = await handleSpotPaperPairedReportGatewayRequest(request(), {
    config: identityConfig,
    authorizedRead: () => true,
    getStore() { throw Error('unsupported identity must not read a report row'); }
  });
  assert.equal(unsupported.status, 422);
  assert.equal(unsupported.body.error, 'spot_paper_paired_identity_unsupported');
});

test('returns only the identity-bound sanitized canonical paired DTO', async () => {
  const report = syntheticPairedDashboard(identity);
  assert.equal(report.syntheticFixture, true);
  const result = await get(request(), {row: row(report)});
  assert.equal(result.status, 200);
  assert.equal(result.body.report.schemaVersion, 'SPOT_PAPER_PAIRED_DASHBOARD_V1');
  assert.equal(result.body.report.identity.runId, identity.runId);
  assert.equal(result.body.report.syntheticFixture, true);
  assert.equal(result.body.report.arms.baseline.netPnlCents, null);
  assert.equal(result.body.report.arms.challenger.netPnlCents, null);
  assert.equal(result.body.report.arms.cash.netPnlCents, null);
  assert.deepEqual(result.body.report, report);
});

test('distinguishes no publication, identity mismatch, unsupported schema and corrupt row', async () => {
  const absent = await get(request());
  assert.equal(absent.status, 404);
  assert.equal(absent.body.error, 'spot_paper_paired_report_not_found');

  const wrongIdentity = syntheticPairedDashboard(identity);
  wrongIdentity.identity.models[1].modelId = 'UNEXPECTED_MODEL';
  wrongIdentity.arms.challenger.modelId = 'UNEXPECTED_MODEL';
  const mismatch = await get(request(), {row: row(wrongIdentity)});
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.error, 'spot_paper_paired_identity_mismatch');

  const unsupported = syntheticPairedDashboard(identity);
  unsupported.schemaVersion = 'SPOT_PAPER_PAIRED_DASHBOARD_V2';
  const unknownSchema = await get(request(), {row: row(unsupported)});
  assert.equal(unknownSchema.status, 422);
  assert.equal(unknownSchema.body.error, 'spot_paper_paired_schema_unsupported');

  const corrupt = row(syntheticPairedDashboard(identity));
  corrupt.content_sha256 = 'f'.repeat(64);
  const invalidDigest = await get(request(), {row: corrupt});
  assert.equal(invalidDigest.status, 503);
  assert.equal(invalidDigest.body.error, 'spot_paper_paired_report_corrupt');
});

test('paired table migration is private and enforces bounded rows', async () => {
  const migration = await readFile(new URL(
    '../migrations/20261109_meridian_spot_paper_paired_reports.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS meridian_spot_paper_paired_reports/);
  assert.match(migration, /octet_length\(envelope::text\) <= 262144/);
  assert.match(migration, /REVOKE ALL ON TABLE meridian_spot_paper_paired_reports FROM PUBLIC/);
  const gateway = await readFile(new URL('../server-gateway.js', import.meta.url), 'utf8');
  const store = await readFile(new URL('../private-report-store.mjs', import.meta.url), 'utf8');
  assert.match(gateway, /handleSpotPaperPairedReportGatewayRequest/);
  assert.match(gateway, /meridian_spot_paper_paired_reports/);
  assert.match(store, /"meridian_spot_paper_paired_reports"/);
  const privateStore = createPrivateReportStore({
    connect() {},
    query() {}
  }, {tableName: 'meridian_spot_paper_paired_reports'});
  assert.equal(typeof privateStore.get, 'function');
  assert.throws(() => createPrivateReportStore({
    connect() {},
    query() {}
  }, {tableName: 'meridian_spot_paper_unreviewed_reports'}), /invalid private report table/);
});
