import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {observe, main} from '../scripts/spot-paper-paired-progress/observe.mjs';
import {exportProgress} from '../scripts/spot-paper-paired-progress/export.mjs';
import {publishProgress, PROGRESS_RECEIPT_SCHEMA} from '../scripts/spot-paper-paired-progress/publish.mjs';
import {progressJournalFixture, journalEnvelope} from './helpers/spot-paper-paired-progress-fixture.mjs';

async function fixture(t) {
  const f = progressJournalFixture();
  const dir = await mkdtemp(join(tmpdir(), 'paired-observe-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await writeFile(join(dir, 'journal.json'), journalEnvelope(f.journal));
  const exported = await exportProgress({runDirectory: dir, expectedIdentity: f.expectedIdentity,
    now: () => f.now});
  assert.equal(exported.status, 'EXPORTED');
  let time = 0;
  const starts = [];
  const sent = [];
  const options = {
    runDirectory: dir, expectedIdentity: f.expectedIdentity, endAt: 600_000, maxTicks: 3,
    token: 'synthetic-only', now: () => time, monotonic: () => time,
    sleep: async ms => { time += ms; },
    exportImpl: async () => { starts.push(time); return exported; },
    publishImpl: async p => { sent.push(p); return {status: 'PUBLISHED'}; }
  };
  return {...f, dir, exported, options, starts, sent,
    advance: ms => { time += ms; }, time: () => time};
}

test('advancing snapshots publish once, unchanged digest skips POST and preserves valuation and costs', async t => {
  const f = await fixture(t);
  const next = structuredClone(f.exported);
  next.progress.journalSequence++;
  next.progress.journalSha256 = 'f'.repeat(64);
  let n = 0;
  f.options.exportImpl = async () => [f.exported, f.exported, next][n++];
  assert.deepEqual(await observe(f.options), {status: 'MAX_TICKS', ticks: 3});
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0].valuationAt, 121_000);
  assert.equal(f.sent[0].arms[0].bookedFeesCents, 40);
  assert.equal(f.sent[0].arms[0].modeledSlippageCents, 20);
  assert.equal(f.sent[0].arms[0].netEquityCents, 99_960);
});

test('BUSY and UNKNOWN defer; identity conflicts and sequence regressions stop without POST', async t => {
  const f = await fixture(t);
  let n = 0;
  f.options.exportImpl = async () => [{status: 'BUSY'}, {status: 'UNKNOWN'}, f.exported][n++];
  assert.deepEqual(await observe(f.options), {status: 'MAX_TICKS', ticks: 3});
  assert.equal(f.sent.length, 1);
  for (const second of [
    {status: 'IDENTITY_CONFLICT'},
    {status: 'EXPORTED', progress: {...f.exported.progress, journalSha256: 'f'.repeat(64)}},
    {status: 'EXPORTED', progress: {...f.exported.progress, journalSequence: 2}},
    {status: 'EXPORTED', progress: {...f.exported.progress, identity: {...f.expectedIdentity, runId: 'other'}}}
  ]) {
    const sent = [];
    n = 0;
    const outcome = await observe({...f.options, maxTicks: 3,
      exportImpl: async () => n++ ? second : f.exported,
      publishImpl: async p => { sent.push(p); return {status: 'PUBLISHED'}; }});
    assert.ok(['IDENTITY_CONFLICT', 'SEQUENCE_CONFLICT'].includes(outcome.status));
    assert.equal(outcome.ticks, 2);
    assert.equal(sent.length, 1);
  }
});

test('ambiguous and authentication upload outcomes never retry', async t => {
  for (const status of ['UNKNOWN', 'AUTH_REQUIRED', 'REJECTED']) {
    const f = await fixture(t);
    let calls = 0;
    f.options.publishImpl = async () => { calls++; return {status}; };
    const result = await observe(f.options);
    assert.equal(result.status, status === 'AUTH_REQUIRED' ? status : 'UPLOAD_UNKNOWN');
    assert.equal(result.ticks, 1);
    assert.equal(calls, 1);
  }
});

test('real publisher treats lost response and 401 as stop without retries or leaking token', async t => {
  for (const code of ['lost', 401, 403]) {
    const f = await fixture(t);
    let calls = 0;
    f.options.publishImpl = (progress, options) => publishProgress(progress, {...options,
      fetchImpl: async () => {
        calls++;
        if (code === 'lost') throw new Error(options.token);
        return new Response(null, {status: code});
      }});
    const outcome = await observe(f.options);
    assert.equal(outcome.status, code === 'lost' ? 'UPLOAD_UNKNOWN' : 'AUTH_REQUIRED');
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(outcome).includes(f.options.token), false);
  }
});

test('serial ticks skip missed cadence without overlap or catch-up', async t => {
  const f = await fixture(t);
  let active = false;
  f.options.exportImpl = async () => {
    assert.equal(active, false);
    active = true;
    f.starts.push(f.time());
    f.advance(125_000);
    active = false;
    return {status: 'BUSY'};
  };
  assert.equal((await observe(f.options)).status, 'MAX_TICKS');
  assert.deepEqual(f.starts, [0, 180_000, 360_000]);
});

test('delayed timer wake skips missed slots without closely spaced catch-up ticks', async t => {
  const f = await fixture(t);
  let first = true;
  f.options.sleep = async ms => {
    f.advance(first ? ms + 119_000 : ms);
    first = false;
  };
  assert.equal((await observe(f.options)).status, 'MAX_TICKS');
  assert.deepEqual(f.starts, [0, 180_000, 240_000]);
});

test('absolute end and max tick bounds and terminal stop', async t => {
  const f = await fixture(t);
  assert.deepEqual(await observe({...f.options, endAt: 60_000}), {status: 'END_REACHED', ticks: 1});
  assert.deepEqual(await observe({...f.options, endAt: f.time()}), {status: 'REJECTED', ticks: 0});
  assert.equal((await observe({...f.options, endAt: f.time() + 1_000, maxTicks: Infinity})).status, 'REJECTED');
  const terminal = structuredClone(f.exported);
  terminal.progress.terminal = {status: 'TERMINAL_RECORDED', at: terminal.progress.latestEventAt};
  assert.deepEqual(await observe({...f.options, endAt: f.time() + 100_000,
    exportImpl: async () => terminal}), {status: 'TERMINAL', ticks: 1});
});

test('end reached during export prevents a new upload', async t => {
  const f = await fixture(t);
  const outcome = await observe({...f.options, endAt: 1,
    exportImpl: async () => { f.advance(1); return f.exported; }});
  assert.deepEqual(outcome, {status: 'END_REACHED', ticks: 1});
  assert.equal(f.sent.length, 0);
});

test('real exporter and publisher pass original financial snapshot into a bounded mock transport', async t => {
  const f = await fixture(t);
  let posts = 0;
  let body;
  f.options.maxTicks = 2;
  f.options.exportImpl = () => exportProgress({runDirectory: f.dir,
    expectedIdentity: f.expectedIdentity, now: () => f.now});
  f.options.publishImpl = (progress, options) => publishProgress(progress, {...options,
    fetchImpl: async (_url, request) => {
      posts++;
      body = JSON.parse(request.body);
      return new Response(JSON.stringify({schemaVersion: PROGRESS_RECEIPT_SCHEMA,
        status: 'ACCEPTED', journalSequence: body.journalSequence, journalSha256: body.journalSha256}),
      {status: 200, headers: {'content-type': 'application/json'}});
    }});
  assert.equal((await observe(f.options)).status, 'MAX_TICKS');
  assert.equal(posts, 1);
  assert.equal(body.valuationAt, 121_000);
  assert.equal(body.arms[0].bookedFeesCents, 40);
  assert.equal(body.arms[0].modeledSlippageCents, 20);
});

test('CLI rejects secret arguments and sanitizes errors; importing is inert', async () => {
  const secret = 'synthetic-secret-never-print';
  assert.deepEqual(await main(['--token', secret], {}), {status: 'REJECTED', ticks: 0});
  assert.deepEqual(await main(['--run-directory', '/fake', '--expected-identity', '/fake',
    '--end-at', '2027-02-30T12:00:00Z', '--max-ticks', '1'], {}), {status: 'REJECTED', ticks: 0});
  const output = execFileSync(process.execPath, ['-e',
    "import('./scripts/spot-paper-paired-progress/observe.mjs')"], {cwd: process.cwd(), encoding: 'utf8'});
  assert.equal(output, '');
  const f = progressJournalFixture();
  const outcome = await observe({runDirectory: '/fake', expectedIdentity: f.expectedIdentity,
    endAt: Date.now() + 1_000, maxTicks: 1, token: secret,
    exportImpl: async () => { throw new Error(secret); }});
  assert.equal(JSON.stringify(outcome).includes(secret), false);
});
