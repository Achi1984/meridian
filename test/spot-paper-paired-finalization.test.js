import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {main as exportPairedHost} from
  '../scripts/spot-paper-paired/host.mjs';
import {main as ingestMain} from
  '../scripts/spot-paper-paired-report/ingest.mjs';
import {createRunJournal} from
  '../scripts/spot-paper-pilot/journal.mjs';
import {syntheticPairedEvaluatorFixture} from
  './helpers/spot-paper-paired-evaluator-fixture.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const evaluatorPath = fileURLToPath(new URL(
  '../scripts/spot-paper-paired-report/cli.mjs', import.meta.url
));

test('480-observation synthetic producer export evaluates and passes no-write validation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'paired-finalization-'));
  t.after(() => rm(directory, {recursive: true, force: true}));

  const evidence = syntheticPairedEvaluatorFixture({modelPair: true});
  const {expectedIdentity, report, journal: journalFixture} = evidence;
  const dataRoot = join(directory, 'private-data');
  const expectedIdentityPath = join(directory, 'expected-identity.json');
  const hostExportPath = join(directory, 'host-export.json');
  const dashboardPath = join(directory, 'paired-dashboard.json');
  const output = {value: '', write(value) { this.value += value; }};
  const journal = await createRunJournal({
    dataRoot,
    runId: expectedIdentity.runId,
    manifest: journalFixture.manifest,
    deadlineAt: performance.now() + 120_000
  });
  const responseBodies = {
    ohlc: '{"syntheticFixture":true,"kind":"ohlc"}',
    ticker: '{"syntheticFixture":true,"kind":"ticker"}'
  };
  const responseHashes = Object.fromEntries(Object.entries(responseBodies).map(
    ([kind, body]) => [kind, createHash('sha256').update(body).digest('hex')]
  ));
  const start = journalFixture.events[0];
  await journal.append(start, {
    states: [], counters: {requests: 0, bytes: 0}, cycle: 0
  });

  for (const sourceEvent of journalFixture.events.slice(1, -1)) {
    const event = structuredClone(sourceEvent);
    for (const kind of ['ohlc', 'ticker']) {
      const sourceResponse = event[kind];
      event[kind] = await journal.persistResponse({
        raw: responseBodies[kind],
        sha256: responseHashes[kind],
        bytes: Buffer.byteLength(responseBodies[kind]),
        requestStartedAt: sourceResponse.requestStartedAt,
        receivedAt: sourceResponse.receivedAt
      });
    }
    event.id = `shared:${event.cycle}:${event.ticker.sha256}`;
    await journal.append(event, {
      states: [],
      counters: {
        requests: event.cycle * 2,
        bytes: Math.round(report.deliveredBytes * event.cycle / report.cycles)
      },
      cycle: event.cycle
    });
  }
  await journal.append(journalFixture.events.at(-1), {
    states: [],
    counters: {requests: report.requests, bytes: report.deliveredBytes},
    cycle: report.cycles,
    stopReason: report.stopReason
  });
  await journal.close({deadlineAt: performance.now() + 10_000});

  await writeFile(expectedIdentityPath, JSON.stringify(expectedIdentity));
  await exportPairedHost([
    'export', '--data-root', dataRoot, '--run-id', expectedIdentity.runId
  ], {output});
  const hostExport = JSON.parse(output.value);
  assert.equal(hostExport.schemaVersion, 'SPOT_PAPER_PAIRED_HOST_EXPORT_V1');
  assert.equal(hostExport.status, 'TERMINAL_JOURNAL_VERIFIED');
  assert.equal(hostExport.journal.events.filter(
    event => event.type === 'shared_observation'
  ).length, 480);
  await writeFile(hostExportPath, output.value);

  const evaluated = spawnSync(process.execPath, [
    evaluatorPath, expectedIdentityPath, hostExportPath
  ], {cwd: repoRoot, encoding: 'utf8', timeout: 60_000});
  assert.equal(evaluated.status, 0, evaluated.stderr || evaluated.stdout);
  const dashboard = JSON.parse(evaluated.stdout);
  assert.equal(dashboard.evidenceStatus, 'VERIFIED_COMPLETE');
  assert.equal(dashboard.syntheticFixture, true);
  assert.equal(dashboard.timing.completedCycles, 480);
  assert.equal(dashboard.arms.baseline.netPnlCents, -40);
  assert.equal(dashboard.arms.baseline.bookedFeesCents, 40);
  assert.equal(dashboard.arms.baseline.modeledSlippageCents, 20);
  assert.equal(dashboard.arms.baseline.fillCount, 2);
  assert.equal(dashboard.arms.baseline.sampledDrawdownCents, 200);
  assert.equal(dashboard.arms.baseline.unresolvedObservations, 0);
  assert.equal(dashboard.trendActivityDiagnostic.status, 'PARTIAL_COVERAGE');
  assert.equal(dashboard.decision, 'NO_WINNER_OR_PROMOTION');
  await writeFile(dashboardPath, evaluated.stdout);

  let storeCalls = 0;
  let dryRunOutput = '';
  const exitCode = await ingestMain([
    expectedIdentityPath, dashboardPath
  ], {
    stdout: {write: value => { dryRunOutput += value; }},
    stderr: {write: value => assert.fail(value)},
    getStore() { storeCalls++; }
  });
  assert.equal(exitCode, 0);
  assert.equal(JSON.parse(dryRunOutput).status, 'DRY_RUN');
  assert.equal(storeCalls, 0);
});
