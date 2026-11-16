import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY as diagnosticIdentity}
  from '../v11/spot-paper-paired-progress-config.js';
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
const envelope = (report, expected = identity) => ({
  schema: SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
  runId: expected.runId,
  report
});
const row = (report, expected = identity) => {
  const value = envelope(report, expected);
  return {
    run_id: expected.runId,
    config_hash: expected.configSha256,
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

  const trendIdentity = syntheticExpectedPairedIdentity({modelPair: true});
  const trendConfig = spotPaperPairedReportGatewayConfig({
    ...env(),
    MERIDIAN_SPOT_PAPER_PAIRED_REPORT_EXPECTED_IDENTITY_JSON:
      JSON.stringify(trendIdentity)
  });
  assert.equal(trendConfig.enabled, true);
  const trendMissing = await handleSpotPaperPairedReportGatewayRequest(request(), {
    config: trendConfig,
    authorizedRead: () => true,
    getStore: () => ({get: async () => null})
  });
  assert.equal(trendMissing.status, 404);
  assert.equal(trendMissing.body.error, 'spot_paper_paired_report_not_found');
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

test('interrupted selection falls back only to the verified diagnostic report', async () => {
  const interrupted = {...syntheticExpectedPairedIdentity({modelPair: true}),
    runId: 'btc-eur-trend-host-8h-002'};
  const fallbackEnv = {...env(),
    MERIDIAN_SPOT_PAPER_PAIRED_REPORT_EXPECTED_IDENTITY_JSON: JSON.stringify(interrupted)};
  const options = {config: spotPaperPairedReportGatewayConfig(fallbackEnv)};
  const diagnostic = syntheticPairedDashboard(diagnosticIdentity);
  diagnostic.evidenceStatus = 'VERIFIED_COMPLETE';
  diagnostic.syntheticFixture = false;
  diagnostic.timing.actualElapsedMs = 60_000;
  diagnostic.trendActivityDiagnostic = {
    schemaVersion: 'BTC_EUR_5M_TREND_ACTIVITY_DIAGNOSTIC_V1',
    status: 'PARTIAL_COVERAGE',
    completedRoundTripCount: 0,
    requiredCompletedRoundTrips: 5,
    observedCoverageMs: 60_000,
    requiredCoverageMs: 86_400_000,
    completeWindow: false,
    forcedTrades: false,
    deadlineExtensionAllowed: false,
    profitability: 'NOT_ASSESSED'
  };
  const published = row(diagnostic, diagnosticIdentity);
  const selected = row(syntheticPairedDashboard(interrupted), interrupted);
  const calls = [];
  const lookup = (primary, fallback, req = request(), config = options.config) =>
    get(req, {config, getStore: () => ({get: async (id, {signal}) => {
      calls.push({id, signal});
      if (id !== interrupted.runId) return fallback;
      if (primary instanceof Error) throw primary;
      return primary;
    }})});

  const result = await lookup(null, published);
  assert.equal(result.status, 200);
  assert.equal(result.body.runId, diagnosticIdentity.runId);
  assert.equal(result.body.report.evidenceStatus, 'VERIFIED_COMPLETE');
  assert.deepEqual(calls.map(({id}) => id), [interrupted.runId, diagnosticIdentity.runId]);
  assert.equal(calls[0].signal, calls[1].signal);

  calls.length = 0;
  assert.equal((await lookup(selected, published)).body.runId, interrupted.runId);
  assert.equal((await lookup({...selected, content_sha256: '0'.repeat(64)}, published)).status, 503);
  assert.equal((await lookup(new Error('unavailable'), published)).status, 503);
  assert.deepEqual(calls.map(({id}) => id), Array(3).fill(interrupted.runId));

  assert.equal((await lookup(null, null)).status, 404);
  assert.equal((await lookup(null, {...published, config_hash: '0'.repeat(64)})).status, 409);
  assert.equal((await lookup(null, row({...diagnostic, syntheticFixture: true}, diagnosticIdentity))).status, 422);
  assert.equal((await lookup(null, row({...diagnostic, evidenceStatus: 'RUNNING_SNAPSHOT'}, diagnosticIdentity))).status, 422);

  calls.length = 0;
  assert.equal((await lookup(null, published, request('GET', undefined, 'wrong'))).status, 401);
  assert.equal((await lookup(null, published, request(), {
    ...options.config, enabled: false
  })).status, 503);
  assert.deepEqual(calls, []);
});
