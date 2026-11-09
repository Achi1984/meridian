import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createPrivateReportStore} from '../private-report-store.mjs';
import {
  handleSpotPaperPairedReportGatewayRequest,
  SPOT_PAPER_PAIRED_REPORT_PATH,
  spotPaperPairedReportGatewayConfig
} from '../spot-paper-paired-report-gateway.mjs';
import {
  ingestSpotPaperPairedReport,
  main,
  prepareSpotPaperPairedReport,
  readBoundedJsonFile
} from '../scripts/spot-paper-paired-report/ingest.mjs';
import {SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
  spotPaperPairedReportDigest} from '../scripts/spot-paper-paired-report/envelope.mjs';
import {
  syntheticExpectedPairedIdentity,
  syntheticPairedDashboard
} from './helpers/spot-paper-paired-dashboard-fixture.mjs';

const expectedIdentity = syntheticExpectedPairedIdentity();
const dashboard = () => syntheticPairedDashboard(expectedIdentity);

function memoryStore() {
  const rows = new Map();
  const db = {
    async connect() {
      return {
        async query(sql, values = []) {
          if (sql.startsWith('INSERT INTO meridian_spot_paper_paired_reports')) {
            const [runId, configHash, contentSha256, json] = values;
            if (rows.has(runId)) return {rowCount: 0, rows: []};
            rows.set(runId, {
              config_hash: configHash,
              content_sha256: contentSha256,
              envelope: JSON.parse(json)
            });
            return {rowCount: 1, rows: [{run_id: runId}]};
          }
          if (sql.startsWith('SELECT config_hash')) {
            const row = rows.get(values[0]);
            return {rows: row ? [row] : []};
          }
          if (sql.startsWith('SELECT run_id')) {
            const row = rows.get(values[0]);
            return {rows: row ? [{
              run_id: values[0],
              config_hash: row.config_hash,
              content_sha256: row.content_sha256,
              envelope: row.envelope
            }] : []};
          }
          return {rowCount: 0, rows: []};
        },
        release() {}
      };
    },
    async query() {
      return {rows: []};
    }
  };
  return createPrivateReportStore(db, {
    tableName: 'meridian_spot_paper_paired_reports'
  });
}

test('paired ingestion validates and builds the exact authenticated-read envelope', async () => {
  const prepared = prepareSpotPaperPairedReport(expectedIdentity, dashboard());
  assert.equal(prepared.runId, expectedIdentity.runId);
  assert.equal(prepared.configHash, expectedIdentity.configSha256);
  assert.deepEqual(Object.keys(prepared.envelope).sort(), ['report', 'runId', 'schema']);
  assert.equal(prepared.envelope.schema, SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA);
  assert.equal(prepared.digest, spotPaperPairedReportDigest(prepared.envelope));

  let storeCalls = 0;
  const dryRun = await ingestSpotPaperPairedReport({
    expectedIdentity,
    dashboard: dashboard(),
    getStore() { storeCalls++; }
  });
  assert.equal(dryRun.status, 'DRY_RUN');
  assert.equal(storeCalls, 0);
});

test('paired insertion is immutable, idempotent for identical data, and rejects conflicts', async () => {
  const store = memoryStore();
  const input = {
    expectedIdentity,
    dashboard: dashboard(),
    write: true,
    getStore: () => store
  };
  assert.equal((await ingestSpotPaperPairedReport(input)).status, 'INSERTED');
  assert.equal((await ingestSpotPaperPairedReport(input)).status, 'IDENTICAL');

  const config = spotPaperPairedReportGatewayConfig({
    MERIDIAN_SPOT_PAPER_PAIRED_REPORT_ENABLED: 'true',
    MERIDIAN_SPOT_PAPER_PAIRED_REPORT_DEPLOYMENT_VERIFIED: 'true',
    MERIDIAN_SPOT_PAPER_PAIRED_REPORT_EXPECTED_IDENTITY_JSON:
      JSON.stringify(expectedIdentity)
  });
  const readResult = await handleSpotPaperPairedReportGatewayRequest({
    method: 'GET',
    url: SPOT_PAPER_PAIRED_REPORT_PATH,
    headers: {}
  }, {
    config,
    authorizedRead: () => true,
    getStore: () => store
  });
  assert.equal(readResult.status, 200);
  assert.deepEqual(readResult.body.report, dashboard());

  const changed = dashboard();
  changed.arms.baseline.cashCents += 1;
  assert.equal((await ingestSpotPaperPairedReport({
    ...input,
    dashboard: changed
  })).status, 'CONFLICT');
});

test('invalid DTO and independently supplied identity fail before database access', async () => {
  let storeCalls = 0;
  const options = {
    write: true,
    getStore() { storeCalls++; return memoryStore(); }
  };
  await assert.rejects(ingestSpotPaperPairedReport({
    ...options,
    expectedIdentity,
    dashboard: {...dashboard(), evidenceStatus: 'UNRECOGNIZED'}
  }), error => error.code === 'PAIRED_DASHBOARD_INVALID');

  const wrongIdentity = structuredClone(expectedIdentity);
  wrongIdentity.runId = 'different-run';
  await assert.rejects(ingestSpotPaperPairedReport({
    ...options,
    expectedIdentity: wrongIdentity,
    dashboard: dashboard()
  }), error => error.code === 'PAIRED_IDENTITY_MISMATCH');
  assert.equal(storeCalls, 0);
});

test('unknown database write outcome is returned without an implicit retry', async () => {
  let calls = 0;
  const result = await ingestSpotPaperPairedReport({
    expectedIdentity,
    dashboard: dashboard(),
    write: true,
    getStore: () => ({
      async insertImmutable() {
        calls++;
        const error = new Error('do not expose database detail');
        error.code = 'PAPER_REPORT_OUTCOME_UNKNOWN';
        throw error;
      }
    })
  });
  assert.equal(result.status, 'OUTCOME_UNKNOWN');
  assert.equal(calls, 1);
});

test('operator CLI defaults to dry-run and bounds input files before database access', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'paired-report-ingest-'));
  try {
    const identityPath = join(dir, 'identity.json');
    const dashboardPath = join(dir, 'dashboard.json');
    await writeFile(identityPath, JSON.stringify(expectedIdentity));
    await writeFile(dashboardPath, JSON.stringify(dashboard()));
    let output = '';
    let storeCalls = 0;
    const exitCode = await main([identityPath, dashboardPath], {
      stdout: {write: value => { output += value; }},
      stderr: {write() { assert.fail('dry-run unexpectedly wrote an error'); }},
      getStore() { storeCalls++; }
    });
    assert.equal(exitCode, 0);
    assert.equal(JSON.parse(output).status, 'DRY_RUN');
    assert.equal(storeCalls, 0);

    output = '';
    const writeExitCode = await main([identityPath, dashboardPath, '--write'], {
      stdout: {write: value => { output += value; }},
      stderr: {write() { assert.fail('write unexpectedly wrote an error'); }},
      getStore: () => ({
        async insertImmutable() {
          storeCalls++;
          return 'INSERTED';
        }
      })
    });
    assert.equal(writeExitCode, 0);
    assert.equal(JSON.parse(output).status, 'INSERTED');
    assert.equal(storeCalls, 1);

    await writeFile(dashboardPath, 'x'.repeat(32));
    await assert.rejects(readBoundedJsonFile(dashboardPath, 16),
      error => error.code === 'INPUT_TOO_LARGE_OR_NOT_FILE');
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
