import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {createPrivateReportStore} from '../private-report-store.mjs';
import {
  handleSpotPaperPairedReportGatewayRequest,
  SPOT_PAPER_PAIRED_REPORT_PATH,
  spotPaperPairedReportGatewayConfig
} from '../spot-paper-paired-report-gateway.mjs';
import {evaluatePairedPaperEvidence} from
  '../scripts/spot-paper-paired-report/evaluate.mjs';
import {
  ingestSpotPaperPairedReport,
  main,
  prepareSpotPaperPairedReport,
  readBoundedJsonFile
} from '../scripts/spot-paper-paired-report/ingest.mjs';
import {SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
  spotPaperPairedReportDigest} from '../scripts/spot-paper-paired-report/envelope.mjs';
import {syntheticPairedEvaluatorFixture} from
  './helpers/spot-paper-paired-evaluator-fixture.mjs';
import {createSpotPaperPairedReportConnector} from
  '../v11/spot-paper-paired-report-connector.js';

function verifiedFixture() {
  const evidence = syntheticPairedEvaluatorFixture();
  return {
    expectedIdentity: evidence.expectedIdentity,
    dashboard: evaluatePairedPaperEvidence(evidence)
  };
}

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
  const fixture = verifiedFixture();
  const prepared = prepareSpotPaperPairedReport(
    fixture.expectedIdentity, fixture.dashboard
  );
  assert.equal(prepared.runId, fixture.expectedIdentity.runId);
  assert.equal(prepared.configHash, fixture.expectedIdentity.configSha256);
  assert.deepEqual(Object.keys(prepared.envelope).sort(), ['report', 'runId', 'schema']);
  assert.equal(prepared.envelope.schema, SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA);
  assert.equal(prepared.digest, spotPaperPairedReportDigest(prepared.envelope));

  let storeCalls = 0;
  const dryRun = await ingestSpotPaperPairedReport({
    ...fixture,
    getStore() { storeCalls++; }
  });
  assert.equal(dryRun.status, 'DRY_RUN');
  assert.equal(storeCalls, 0);
});

test('paired insertion is immutable, idempotent for identical data, and rejects conflicts', async () => {
  const fixture = verifiedFixture();
  const store = memoryStore();
  const input = {
    ...fixture,
    write: true,
    getStore: () => store
  };
  assert.equal((await ingestSpotPaperPairedReport(input)).status, 'INSERTED');
  assert.equal((await ingestSpotPaperPairedReport(input)).status, 'IDENTICAL');

  const config = spotPaperPairedReportGatewayConfig({
    MERIDIAN_SPOT_PAPER_PAIRED_REPORT_ENABLED: 'true',
    MERIDIAN_SPOT_PAPER_PAIRED_REPORT_DEPLOYMENT_VERIFIED: 'true',
    MERIDIAN_SPOT_PAPER_PAIRED_REPORT_EXPECTED_IDENTITY_JSON:
      JSON.stringify(fixture.expectedIdentity)
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
  assert.deepEqual(readResult.body.report, fixture.dashboard);

  const changed = structuredClone(fixture.dashboard);
  changed.arms.baseline.cashCents += 1;
  assert.equal((await ingestSpotPaperPairedReport({
    ...input,
    dashboard: changed
  })).status, 'CONFLICT');
});

test('invalid DTO and independently supplied identity fail before database access', async () => {
  const fixture = verifiedFixture();
  let storeCalls = 0;
  const options = {
    write: true,
    getStore() { storeCalls++; return memoryStore(); }
  };
  await assert.rejects(ingestSpotPaperPairedReport({
    ...options,
    ...fixture,
    dashboard: {...fixture.dashboard, evidenceStatus: 'UNRECOGNIZED'}
  }), error => error.code === 'PAIRED_DASHBOARD_INVALID');

  const wrongIdentity = structuredClone(fixture.expectedIdentity);
  wrongIdentity.runId = 'different-run';
  await assert.rejects(ingestSpotPaperPairedReport({
    ...options,
    expectedIdentity: wrongIdentity,
    dashboard: fixture.dashboard
  }), error => error.code === 'PAIRED_IDENTITY_MISMATCH');
  assert.equal(storeCalls, 0);
});

test('only verified complete evidence can pass ingestion validation', async () => {
  const fixture = verifiedFixture();
  let storeCalls = 0;
  for (const evidenceStatus of [
    'INTERRUPTED', 'RUNNING_SNAPSHOT', 'CORRUPT_UNKNOWN'
  ]) {
    for (const write of [false, true]) {
      await assert.rejects(ingestSpotPaperPairedReport({
        expectedIdentity: fixture.expectedIdentity,
        dashboard: {...fixture.dashboard, evidenceStatus},
        write,
        getStore() { storeCalls++; return memoryStore(); }
      }), error => error.code === (evidenceStatus === 'CORRUPT_UNKNOWN' ?
        'PAIRED_DASHBOARD_INVALID' : 'PAIRED_EVIDENCE_NOT_FINALIZABLE'));
    }
  }
  assert.equal(storeCalls, 0);
});

test('unknown database write outcome is returned without an implicit retry', async () => {
  const fixture = verifiedFixture();
  let calls = 0;
  const result = await ingestSpotPaperPairedReport({
    ...fixture,
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

test('legacy and canonical trend evaluator DTOs survive ingestion, gateway GET, and connector', async () => {
  for (const modelPair of [false, true]) {
    const evidence = syntheticPairedEvaluatorFixture({modelPair});
    const dto = evaluatePairedPaperEvidence(evidence);
    assert.equal(dto.evidenceStatus, 'VERIFIED_COMPLETE');
    assert.equal(dto.identity.modelPairId ?? null,
      evidence.expectedIdentity.modelPairId ?? null);
    if (modelPair) {
      const countMismatch = structuredClone(evidence);
      countMismatch.report.trendActivityDiagnostic.completedRoundTripCount = 1;
      countMismatch.journal.events.at(-1).report =
        structuredClone(countMismatch.report);
      const rejected = evaluatePairedPaperEvidence(countMismatch);
      assert.equal(rejected.evidenceStatus, 'CORRUPT_UNKNOWN');
      assert.equal(rejected.reasonCode, 'INVALID_TREND_ACTIVITY_DIAGNOSTIC');
    }

    const store = memoryStore();
    const write = await ingestSpotPaperPairedReport({
      expectedIdentity: evidence.expectedIdentity,
      dashboard: dto,
      write: true,
      getStore: () => store
    });
    assert.equal(write.status, 'INSERTED');

    const config = spotPaperPairedReportGatewayConfig({
      MERIDIAN_SPOT_PAPER_PAIRED_REPORT_ENABLED: 'true',
      MERIDIAN_SPOT_PAPER_PAIRED_REPORT_DEPLOYMENT_VERIFIED: 'true',
      MERIDIAN_SPOT_PAPER_PAIRED_REPORT_EXPECTED_IDENTITY_JSON:
        JSON.stringify(evidence.expectedIdentity)
    });
    const gateway = await handleSpotPaperPairedReportGatewayRequest({
      method: 'GET',
      url: SPOT_PAPER_PAIRED_REPORT_PATH,
      headers: {}
    }, {config, authorizedRead: () => true, getStore: () => store});
    assert.equal(gateway.status, 200);

    const connector = createSpotPaperPairedReportConnector({
      enabled: true,
      transport: async () => new Response(JSON.stringify(gateway.body), {
        status: gateway.status,
        headers: {'content-type': 'application/json'}
      })
    });
    const connected = await connector.read();
    assert.equal(connected.status, 'AVAILABLE');
    assert.equal(connected.report.identity.modelPairId ?? null,
      evidence.expectedIdentity.modelPairId ?? null);
    assert.deepEqual(connected.report, dto);
    connector.dispose();
  }
});

test('operator CLI defaults to dry-run and bounds input files before database access', async () => {
  const fixture = verifiedFixture();
  const dir = await mkdtemp(join(tmpdir(), 'paired-report-ingest-'));
  try {
    const identityPath = join(dir, 'identity.json');
    const dashboardPath = join(dir, 'dashboard.json');
    await writeFile(identityPath, JSON.stringify(fixture.expectedIdentity));
    await writeFile(dashboardPath, JSON.stringify(fixture.dashboard));
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

test('bounded input reader rejects FIFOs, symlinks, nonregular files, and invalid UTF-8', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'paired-report-files-'));
  const fifoPath = join(dir, 'input.fifo');
  const regularPath = join(dir, 'regular.json');
  const symlinkPath = join(dir, 'symlink.json');
  const readerPath = fileURLToPath(new URL(
    '../scripts/spot-paper-paired-report/ingest.mjs', import.meta.url
  ));
  try {
    execFileSync('mkfifo', [fifoPath]);
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {readBoundedJsonFile} from ${JSON.stringify(
        pathToFileURL(readerPath).href
      )}; try { await readBoundedJsonFile(process.argv[1], 16); } catch (error) {
        process.stdout.write(error.code || 'NO_CODE');
      }`, fifoPath], {encoding: 'utf8', timeout: 1_000});
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0);
    assert.equal(child.stdout, 'INPUT_TOO_LARGE_OR_NOT_FILE');

    await writeFile(regularPath, JSON.stringify({ok: true}));
    await symlink(regularPath, symlinkPath);
    await assert.rejects(readBoundedJsonFile(symlinkPath, 128),
      error => error.code === 'INPUT_SYMLINK_REJECTED');
    await assert.rejects(readBoundedJsonFile(dir, 128),
      error => error.code === 'INPUT_TOO_LARGE_OR_NOT_FILE');

    await writeFile(regularPath, Buffer.from([0xc3, 0x28]));
    await assert.rejects(readBoundedJsonFile(regularPath, 128),
      error => error.code === 'INPUT_INVALID_UTF8');
    await assert.rejects(readBoundedJsonFile('relative.json', 128),
      error => error.code === 'INPUT_PATH_INVALID');
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
