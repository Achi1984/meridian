import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, symlink, rm, open, lstat,
  rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {exportProgress, MAX_JOURNAL_BYTES} from
  '../scripts/spot-paper-paired-progress/export.mjs';
import {validateProgress, validIdentity, canonicalJson} from
  '../scripts/spot-paper-paired-progress/contract.mjs';
import {progressJournalFixture, journalEnvelope} from
  './helpers/spot-paper-paired-progress-fixture.mjs';

async function fixture(t) {
  const source = progressJournalFixture();
  const runDirectory = await mkdtemp(join(tmpdir(), 'paired-progress-'));
  t.after(() => rm(runDirectory, {recursive: true, force: true}));
  const path = join(runDirectory, 'journal.json');
  await writeFile(path, journalEnvelope(source.journal));
  const options = {runDirectory, expectedIdentity: source.expectedIdentity,
    now: () => source.now};
  return {...source, path, options, runDirectory};
}

test('exports committed nonzero fees, negative/zero PnL and bounded validated fills without redecision', async t => {
  const f = await fixture(t);
  await writeFile(join(f.runDirectory, 'writer.lock'), 'not liveness');
  const before = await readFile(f.path);
  const result = await exportProgress(f.options);
  assert.equal(result.status, 'EXPORTED');
  const p = result.progress;
  assert.equal(p.classification, 'OBSERVED_CHECKPOINT');
  assert.deepEqual(p.terminal, {status: 'UNKNOWN', at: null});
  assert.equal(p.valuationAt, 121_000);
  assert.equal(p.exportedAt - p.valuationAt, 60_000);
  assert.equal(p.arms[0].bookedFeesCents, 40);
  assert.equal(p.arms[0].netEquityCents, 99_960);
  assert.equal(p.arms[0].netPnlCents, -40);
  assert.equal(p.arms[0].modeledSlippageCents, 20);
  assert.equal(p.arms[0].fillCount, 2);
  assert.equal(p.arms[0].completedRoundTripCount, 1);
  assert.equal(p.arms[0].recentFills[0].feeCents, 20);
  assert.equal(p.arms[2].netPnlCents, 0);
  assert.equal(p.arms[0].cashCents, null);
  assert.equal(p.arms[0].hypotheticalExitFeeCents, null);
  assert.equal(JSON.stringify(p).includes('responses/'), false);
  assert.equal(JSON.stringify(p).includes('riskStates'), false);
  assert.deepEqual(await readFile(f.path), before);
  assert.equal(await readFile(join(f.runDirectory, 'writer.lock'), 'utf8'), 'not liveness');
  assert.deepEqual(validateProgress(p, f.expectedIdentity), p);
});

test('later failure and terminal evidence never freshens last financial observation', async t => {
  const f = await fixture(t);
  await writeFile(join(f.runDirectory, 'writer.lock'), 'not terminal verification');
  f.journal.events.push({id: 'failure', type: 'shared_feed_failure', at: 150_000,
    reason: 'sensitive arbitrary error text'});
  const report = {...f.report, endedAt: 160_000, outcome: 'INTERRUPTED_OR_STOPPED'};
  f.journal.events.push({id: 'paired-terminal', type: 'terminal', at: 160_000, report});
  f.journal.sequence = f.journal.events.length;
  await writeFile(f.path, journalEnvelope(f.journal));
  const {progress, status} = await exportProgress(f.options);
  assert.equal(status, 'EXPORTED');
  assert.equal(progress.observedAt, 121_000);
  assert.equal(progress.latestEventAt, 160_000);
  assert.deepEqual(progress.terminal, {status: 'INTERRUPTED_RECORDED', at: 160_000});
  assert.equal(JSON.stringify(progress).includes('sensitive'), false);
});

test('recent fills are capped while total fills and round trips remain accurate', async t => {
  const f = await fixture(t);
  const template = f.journal.events[1];
  f.journal.events = [f.journal.events[0]];
  for (let index = 0; index < 7; index++) {
    const event = structuredClone(template);
    const at = 61_000 + index * 60_000;
    Object.assign(event, {id: `observation-${index}`, cycle: index + 1,
      observedAt: at, effectAt: at, decisionAt: at - 2});
    event.ticker.requestStartedAt = at - 1;
    event.ticker.receivedAt = at;
    event.fills[0].fills.forEach((fill, fillIndex) => Object.assign(fill, {
      id: `fill-${index}-${fillIndex}`, executionAt: at,
      signalAt: at - 2, quoteReceivedAt: at
    }));
    Object.assign(event.valuations[0], {feesCents: 40 * (index + 1),
      turnoverCents: 20_000 * (index + 1), slippageCents: 20 * (index + 1),
      modeledCostsCents: 60 * (index + 1), netEquityCents: null});
    f.journal.events.push(event);
  }
  f.journal.sequence = f.journal.events.length;
  await writeFile(f.path, journalEnvelope(f.journal));
  const result = await exportProgress({...f.options, now: () => 500_000});
  assert.equal(result.status, 'EXPORTED');
  const arm = result.progress.arms[0];
  assert.equal(arm.fillCount, 14);
  assert.equal(arm.completedRoundTripCount, 7);
  assert.equal(arm.recentFills.length, 12);
  assert.equal(arm.recentFills[0].executionAt, 121_000);
  assert.equal(arm.bookedFeesCents, 280);
  assert.equal(arm.netEquityCents, null);
  assert.equal(arm.netPnlCents, null);
});

test('pending state is BUSY and is never removed or interpreted as terminal', async t => {
  const f = await fixture(t);
  const pending = join(f.runDirectory, 'journal.pending');
  await writeFile(pending, '{"candidate":"uncommitted"}');
  assert.deepEqual(await exportProgress(f.options), {status: 'BUSY', progress: null});
  assert.equal(await readFile(pending, 'utf8'), '{"candidate":"uncommitted"}');
});

test('rejects truncation, corrupt digest, oversized, symlink and nonregular inputs', async t => {
  const f = await fixture(t);
  for (const bytes of ['{', '{"payload":{},"sha256":"wrong"}',
    Buffer.alloc(MAX_JOURNAL_BYTES + 1)]) {
    await writeFile(f.path, bytes);
    assert.equal((await exportProgress(f.options)).status, 'UNKNOWN');
  }
  await rm(f.path);
  await symlink('/etc/passwd', f.path);
  assert.equal((await exportProgress(f.options)).status, 'UNKNOWN');
  await rm(f.path);
  execFileSync('mkfifo', [f.path]);
  assert.equal((await exportProgress(f.options)).status, 'UNKNOWN');
  const alias = `${f.runDirectory}-alias`;
  await symlink(f.runDirectory, alias);
  t.after(() => rm(alias, {force: true}));
  assert.equal((await exportProgress({...f.options, runDirectory: alias})).status, 'UNKNOWN');
});

test('rejects wrong identity, sequence, role, fee/fill accounting and unknown currency', async t => {
  const f = await fixture(t);
  for (const key of ['runId', 'sourceSha256', 'configSha256',
    'researchSourceSha256', 'feedSourceId', 'comparisonEngineId']) {
    const identity = {...f.expectedIdentity, [key]: [f.expectedIdentity[key]]};
    assert.equal(validIdentity(identity), false);
  }
  const identity = structuredClone(f.expectedIdentity);
  identity.models[0].accountId = [identity.models[0].accountId];
  assert.equal(validIdentity(identity), false);
  const mutations = [
    j => { j.manifest.runId = 'other-run'; },
    j => { j.sequence++; },
    j => { j.events[1].valuations[1].role = 'cash'; },
    j => { j.events[2].valuations[0].feesCents = 0; },
    j => { j.events[1].fills[0].fills[0].feeCents = 0; },
    j => { j.events[1].fills[0].fills[0].side = 'SELL'; },
    j => { j.events[2].observedAt = 1; },
    j => { j.events.push(...Array(1025).fill({})); j.sequence = j.events.length; }
  ];
  for (const mutate of mutations) {
    const journal = structuredClone(f.journal);
    mutate(journal);
    await writeFile(f.path, journalEnvelope(journal));
    assert.equal((await exportProgress(f.options)).status, 'UNKNOWN');
  }
  await writeFile(f.path, journalEnvelope(f.journal));
  const {progress} = await exportProgress(f.options);
  for (const mutate of [
    p => { p.currency = 'USD'; },
    p => { p.identity.models[0].modelId = 'wrong'; },
    p => { p.arms[0].netPnlCents -= 40; },
    p => { p.arms[0].raw = 'secret'; }
  ]) {
    const p = structuredClone(progress);
    mutate(p);
    assert.equal(validateProgress(p, f.expectedIdentity), null);
  }
});

test('only structurally valid, complete identity differences produce sanitized conflict', async t => {
  const f = await fixture(t);
  const mutations = [
    j => { j.runId = j.manifest.runId = 'different-run'; },
    ...['sourceSha256', 'configSha256', 'researchSourceSha256'].map(key =>
      j => { j.manifest[key] = 'a'.repeat(64); }),
    ...['feedSourceId', 'comparisonEngineId', 'modelPairId'].map(key =>
      j => { j.manifest[key] = 'different'; }),
    j => { j.manifest.models[1].modelId = 'different'; },
    j => { j.manifest.models[1].accountId = 'different'; },
    j => { j.manifest.pair = 'BTC/USD'; }
  ];
  for (const mutate of mutations) {
    const journal = structuredClone(f.journal);
    mutate(journal);
    await writeFile(f.path, journalEnvelope(journal));
    assert.deepEqual(await exportProgress(f.options), {status: 'IDENTITY_CONFLICT', progress: null});
    journal.events[2].valuations[0].feesCents = 0;
    await writeFile(f.path, journalEnvelope(journal));
    assert.deepEqual(await exportProgress(f.options), {status: 'IDENTITY_CONFLICT', progress: null});
  }
  const foreignWithDifferentAccounting = structuredClone(f.journal);
  foreignWithDifferentAccounting.runId = foreignWithDifferentAccounting.manifest.runId = 'different-run';
  foreignWithDifferentAccounting.manifest.assumptions.feeBpsPerSide = 99;
  await writeFile(f.path, journalEnvelope(foreignWithDifferentAccounting));
  assert.deepEqual(await exportProgress(f.options), {status: 'IDENTITY_CONFLICT', progress: null});

  for (const mutate of [
    j => { delete j.manifest.models[0].modelId; },
    j => { j.manifest.sourceSha256 = 'invalid'; },
    j => { j.manifest.runId = 'different'; },
    j => { j.manifest.models[0].modelId = ['different']; }
  ]) {
    const journal = structuredClone(f.journal);
    mutate(journal);
    await writeFile(f.path, journalEnvelope(journal));
    assert.equal((await exportProgress(f.options)).status, 'UNKNOWN');
  }
  const corrupt = JSON.parse(journalEnvelope(f.journal));
  corrupt.payload.manifest.feedSourceId = 'different';
  await writeFile(f.path, JSON.stringify(corrupt));
  assert.equal((await exportProgress(f.options)).status, 'UNKNOWN');
});

test('concurrent snapshot replacement and pending rewrite are BUSY', async t => {
  for (const mutation of ['replace', 'pending']) {
    const f = await fixture(t);
    let reads = 0;
    const io = {lstat, open: async (...args) => {
      const handle = await open(...args);
      if (!String(args[0]).endsWith('/journal.json')) return handle;
      reads++;
      if (reads === 2) {
        if (mutation === 'replace') {
          const next = join(f.runDirectory, 'candidate');
          await writeFile(next, journalEnvelope({...f.journal, checkpoint: {changed: true}}));
          await rename(next, f.path);
        } else {
          const pending = join(f.runDirectory, 'journal.pending');
          await writeFile(pending, '{}');
          await rm(pending);
        }
      }
      return handle;
    }};
    assert.equal((await exportProgress({...f.options, io})).status, 'BUSY');
  }
});

test('deadline and cancellation fail closed and late open handles are closed', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  assert.equal((await exportProgress({...f.options, signal: controller.signal})).status, 'UNKNOWN');
  let resolveOpen;
  let closed = 0;
  const result = await exportProgress({...f.options, timeoutMs: 5,
    io: {lstat, open: () => new Promise(resolve => { resolveOpen = resolve; })}});
  assert.equal(result.status, 'UNKNOWN');
  resolveOpen({close: async () => { closed++; }});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, 1);
  assert.equal(canonicalJson(result), '{"progress":null,"status":"UNKNOWN"}');
});
