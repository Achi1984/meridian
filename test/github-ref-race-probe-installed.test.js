import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/github-ref-race-probe-once-20261012.yml', import.meta.url), 'utf8');
const probe = readFileSync(new URL('../scripts/github-ref-race-probe.py', import.meta.url), 'utf8');

function validateGate(source) {
  const gate = source.match(/^    if: >-\n([\s\S]*?)(?=^    permissions:)/m)?.[1];
  assert.ok(gate, 'the write job must have its own condition');
  const conditions = gate.trim().split(/\s*&&\s*/).sort();
  assert.deepEqual(conditions, [
    "github.repository == 'Achi1984/meridian'",
    "github.event.repository.owner.type == 'User'",
    "github.repository_owner == 'Achi1984'",
    "github.actor == 'Achi1984'",
    "github.triggering_actor == 'Achi1984'",
    "github.event_name == 'workflow_dispatch'",
    "github.ref == 'refs/heads/main'",
    'github.run_number == 1',
    'github.run_attempt == 1',
  ].sort());
}

test('installed probe permits only the approved owner, main, first manual run and attempt', () => {
  validateGate(workflow);
  for (const [before, after] of [
    ["github.actor == 'Achi1984'", 'true'],
    ["github.triggering_actor == 'Achi1984'", 'true'],
    ['github.run_number == 1', 'github.run_number >= 1'],
    ['github.run_attempt == 1', 'github.run_attempt >= 1'],
    ["github.ref == 'refs/heads/main'", 'true'],
    [' &&', ' ||'],
  ]) assert.throws(() => validateGate(workflow.replace(before, after)));
});

test('installed workflow exposes only manual dispatch and one scoped write job', () => {
  const eventBlock = workflow.match(/^on:\n([\s\S]*?)(?=^permissions:)/m)?.[1];
  assert.ok(eventBlock);
  assert.deepEqual([...eventBlock.matchAll(/^  ([a-z_]+):/gm)].map(m => m[1]), ['workflow_dispatch']);
  assert.match(workflow, /^permissions: \{\}$/m);
  const jobs = workflow.split(/^jobs:\n/m)[1];
  assert.ok(jobs);
  assert.deepEqual([...jobs.matchAll(/^  ([a-z_]+):/gm)].map(m => m[1]), ['experiment']);
  assert.equal((workflow.match(/^    permissions:\n      contents: write$/gm) || []).length, 1);
  assert.equal((workflow.match(/contents: write/g) || []).length, 1);
  assert.match(workflow, /^    timeout-minutes: 2$/m);
  assert.match(workflow, /^  cancel-in-progress: false$/m);
});

test('installed identity step accepts only the approved probe ID before script retrieval', () => {
  const programs = [...workflow.matchAll(/          python3 - <<'PY'\n([\s\S]*?)          PY/g)].map(m => m[1].replace(/^          /gm, ''));
  assert.equal(programs.length, 2);
  assert.match(programs[0], /approved = 'meridian20261012race01'/);
  for (const [id, accepted] of [['meridian20261012race01', true], ['meridian20261012race02', false], ['../main', false], ['', false]]) {
    const result = spawnSync('python3', ['-B', '-c', programs[0]], {encoding:'utf8', env:{...process.env, REQUESTED_PROBE_ID:id}, timeout:5000});
    assert.equal(result.status === 0, accepted, `probe identity ${JSON.stringify(id)}`);
  }
  assert.match(programs[1], /sha = 'd5090798b23e5e19ea984d5391d65152732b2cc6'/);
  assert.match(programs[1], /HTTPSConnection\('api\.github\.com', timeout=10\)/);
  assert.match(programs[1], /c\.request\('GET', '\/repos\/Achi1984\/meridian\/contents\/scripts\/github-ref-race-probe\.py\?ref=' \+ sha/);
  assert.match(programs[1], /raw = r\.read\(32769\)\nassert len\(raw\) <= 32768/);
  assert.equal((programs[1].match(/c\.request\(/g) || []).length, 1);
});

test('installed launch keeps the approved request, timeout and permanent-ref bounds', () => {
  assert.equal((workflow.match(/run: python3 -B github-ref-race-probe\.py/g) || []).length, 1);
  assert.match(workflow, /MERIDIAN_REF_PROBE_ACK: CREATE_THREE_ATTEMPTS_KEEP_REF_FOREVER/);
  assert.match(workflow, /MERIDIAN_REF_PROBE_ID: \$\{\{ inputs\.probe_id \}\}/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow, /secrets\.|repository_dispatch|schedule:/);
  assert.match(probe, /^MAX_REQUESTS = 3$/m);
  assert.match(probe, /^MAX_RESPONSE_BYTES = 8192$/m);
  assert.match(probe, /^TIMEOUT_SECONDS = 10$/m);
  assert.match(probe, /capture_output=True, timeout=35, check=False/);
  assert.match(probe, /PINNED_SHA = '078c20f14a44ae21f81ea7eae0aabd06cb038031'/);
  assert.match(probe, /PREFIX = 'refs\/heads\/meridian-integration-tests\/ref-race-'/);
  assert.doesNotMatch(probe, /connection\.request\(['"](?:DELETE|PATCH)|\/assignees/);
});
