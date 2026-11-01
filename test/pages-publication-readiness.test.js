import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {publicationContext, checkPublication, githubReader} from '../scripts/pages-publication-readiness.mjs';

const current = 'a'.repeat(40), prior = 'b'.repeat(40);
const response = (status, data) => ({status, data});
function scenario({currentStates = ['absent'], priorStates = ['succeed'], main = current,
  ancestry = prior} = {}) {
  const calls = []; let clock = 0;
  const next = states => states.length > 1 ? states.shift() : states[0];
  return {calls, options: {expectedSha: current, previousSha: prior,
    now: () => clock, sleep: async ms => { clock += ms; }, intervalMs: 10, deadlineMs: 100,
    get: async (path, timeout) => {
      calls.push({path, timeout});
      if (path.endsWith('/heads/main')) return response(200, {object: {sha: main}});
      if (path.includes('/compare/')) return response(200, {status: 'ahead', merge_base_commit: {sha: ancestry}});
      const value = next(path.endsWith(current) ? currentStates : priorStates);
      if (typeof value === 'number') return response(value, {});
      return value === 'absent' ? response(404, {}) : response(200, {status: value});
    }}};
}

test('push context rejects forced, wrong-ref, new-branch and invalid predecessor events', () => {
  const event = {ref: 'refs/heads/main', before: prior, after: current};
  assert.deepEqual(publicationContext({eventName: 'push', event, workflowSha: current}),
    {expectedSha: current, previousSha: prior});
  for (const change of [{forced: true}, {created: true}, {deleted: true},
    {ref: 'refs/heads/other'}, {after: prior}, {before: '0'.repeat(40)}, {before: current}]) {
    assert.throws(() => publicationContext({eventName: 'push', event: {...event, ...change}, workflowSha: current}));
  }
  assert.throws(() => publicationContext({eventName: 'pull_request', event, workflowSha: current}));
  assert.throws(() => publicationContext({eventName: 'workflow_dispatch', event, workflowSha: current,
    expectedSha: prior, previousSha: current}));
  assert.deepEqual(publicationContext({eventName: 'workflow_dispatch', event, workflowSha: current,
    expectedSha: current, previousSha: prior}), {expectedSha: current, previousSha: prior});
});

test('current 404 is safe absence; prior must positively succeed', async () => {
  const s = scenario();
  assert.equal(await checkPublication(s.options), 'READY');
  assert.equal(s.calls.filter(c => c.path.endsWith(current)).length, 3); // compare plus two status reads
  for (const bad of ['absent', 401, 403, 500, undefined, 'unknown_status', 'deployment_failed', 'deployment_cancelled', null]) {
    await assert.rejects(checkPublication(scenario({priorStates: [bad]}).options));
  }
});

test('observed empty status is absence only for current SHA before publication', async () => {
  assert.equal(await checkPublication(scenario({currentStates: ['']}).options), 'READY');
  await assert.rejects(checkPublication(scenario({priorStates: ['']}).options), /DEPLOYMENT_NOT_SUCCESSFUL/);
  for (const bad of [undefined, null, 'unknown_status', 'deployment_failed', 'deployment_cancelled']) {
    await assert.rejects(checkPublication(scenario({currentStates: [bad]}).options));
  }
  await assert.rejects(checkPublication({...scenario({currentStates: ['']}).options, phase: 'after'}),
    /DEPLOYMENT_NOT_SUCCESSFUL/);
  const malformed = scenario(); const read = malformed.options.get;
  malformed.options.get = async (path, timeout) => path.endsWith(`/pages/deployments/${current}`)
    ? response(200, null) : read(path, timeout);
  await assert.rejects(checkPublication(malformed.options), /DEPLOYMENT_STATUS_UNKNOWN/);
});

test('existing current deployment is reconciled, never authorized for duplicate creation', async () => {
  assert.equal(await checkPublication(scenario({currentStates: ['succeed']}).options), 'ALREADY_DEPLOYED');
  assert.equal(await checkPublication(scenario({currentStates: ['deployment_queued', 'succeed']}).options), 'ALREADY_DEPLOYED');
  assert.equal(await checkPublication(scenario({currentStates: ['absent', 'succeed']}).options), 'ALREADY_DEPLOYED');
  for (const state of ['deployment_failed', 'unknown_status', 403]) {
    await assert.rejects(checkPublication(scenario({currentStates: [state]}).options));
  }
});

test('prior pending waits within budget; pending forever stops without deployment', async () => {
  assert.equal(await checkPublication(scenario({priorStates: ['deployment_in_progress', 'succeed']}).options), 'READY');
  const s = scenario({priorStates: ['deployment_queued']});
  await assert.rejects(checkPublication(s.options), /READINESS_TIMEOUT/);
  assert.ok(s.calls.length < 50);
  assert.ok(s.calls.every(c => c.timeout > 0 && c.timeout <= 100));
});

test('superseded heads, nonancestor predecessor and stale postchecks fail closed', async () => {
  await assert.rejects(checkPublication(scenario({main: prior}).options), /MAIN_SUPERSEDED/);
  await assert.rejects(checkPublication(scenario({ancestry: current}).options), /PREVIOUS_NOT_ANCESTOR/);
  const s = scenario(); const read = s.options.get; let mainReads = 0;
  s.options.get = async (...args) => {
    if (args[0].endsWith('/heads/main') && ++mainReads === 3) return response(200, {object: {sha: prior}});
    return read(...args);
  };
  await assert.rejects(checkPublication(s.options), /MAIN_SUPERSEDED/);
  await assert.rejects(checkPublication({...scenario().options, phase: 'after'}));
  assert.equal(await checkPublication({...scenario({currentStates: ['succeed']}).options, phase: 'after'}), 'VERIFIED');
});

test('transport errors remain blocking', async () => {
  const s = scenario();
  const read = s.options.get;
  s.options.get = async (path, timeout) => {
    if (path.includes('/pages/deployments/')) throw new Error('transport failed');
    return read(path, timeout);
  };
  await assert.rejects(checkPublication(s.options), /transport failed/);
});

test('reader uses only authenticated same-origin GET with bounded request and no redirect', async () => {
  const calls = [];
  const get = githubReader('synthetic-token', async (url, options) => {
    calls.push({url, options}); return {status: 200, json: async () => ({status: 'succeed'})};
  });
  await get(`/repos/Achi1984/meridian/pages/deployments/${prior}`, 100);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer ' + 'synthetic-token');
  await assert.rejects(get('/repos/someone/else/pages', 100));
  assert.throws(() => githubReader(''));
});

test('proposal stays inert and preserves Jekyll output, exact pins and noncancelling queue', async () => {
  const source = await readFile(new URL('../docs/operations/pages-publication.yml.disabled', import.meta.url), 'utf8');
  assert.match(source, /queue: max/);
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /source: \.\n\s+destination: \.\/_site/);
  assert.match(source, /path: \.\/_site/);
  const pins = [...source.matchAll(/uses: [\w/-]+@([^\s]+)/g)].map(m => m[1]);
  assert.equal(pins.length, 5);
  assert.ok(pins.every(pin => /^[a-f0-9]{40}$/.test(pin)));
  assert.doesNotMatch(source, /continue-on-error|schedule:|secrets\.|\/cancel|actions: write|contents: write/);
});
