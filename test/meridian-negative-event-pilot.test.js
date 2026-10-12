import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Delete this temporary installation contract together with the listener in
// the reviewed cleanup patch. A missing listener must not silently skip it.
const workflow = readFileSync(new URL('../.github/workflows/meridian-negative-event-pilot.yml', import.meta.url), 'utf8');
const text = workflow.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
const block = (start, end) => text.slice(text.indexOf(start), text.indexOf(end)).trimEnd();

test('negative pilot has exactly one native completion trigger and read-only scope', () => {
  assert.deepEqual([...text.matchAll(/^([\w-]+):/gm)].map(m => m[1]), ['name', 'on', 'permissions', 'jobs']);
  assert.equal(block('on:\n', 'permissions:\n'), 'on:\n  workflow_run:\n    workflows: [MERIDIAN Release Safety]\n    types: [completed]');
  assert.equal(block('permissions:\n', 'jobs:\n'), 'permissions:\n  contents: read\n  actions: read\n  issues: read\n  pull-requests: read');
  assert.equal((text.match(/\bpermissions:/g) || []).length, 1);
  assert.deepEqual([...text.slice(text.indexOf('jobs:\n')).matchAll(/^  ([\w-]+):/gm)].map(m => m[1]), ['reconcile']);
  assert.doesNotMatch(text, /\buses:|\bsecrets\.|\bwrite-all\b|:\s*write\b|\bworkflow_dispatch:|\bschedule:/);
});

test('negative pilot gates exactly the approved run, head and attempts', () => {
  const guard = block('    if: >-\n', '    runs-on:').replace(/^    if: >-\n/, '').trim().split(/\s*&&\s*/);
  assert.deepEqual(guard, [
    "github.repository == 'Achi1984/meridian'",
    "github.event_name == 'workflow_run'",
    'github.run_attempt == 1',
    "github.event.workflow_run.repository.full_name == 'Achi1984/meridian'",
    "github.event.workflow_run.head_repository.full_name == 'Achi1984/meridian'",
    'github.event.workflow_run.id == 38210241542',
    "github.event.workflow_run.head_sha == '514819aeb5d97afe00263ed433550e8788f4761e'",
    "github.event.workflow_run.event == 'pull_request'",
    'github.event.workflow_run.run_attempt == 2'
  ]);
  assert.deepEqual([...text.slice(text.indexOf('jobs:\n')).matchAll(/^    ([\w-]+):/gm)].map(m => m[1]), ['if', 'runs-on', 'timeout-minutes', 'steps']);
  assert.equal(block('    runs-on:', '    steps:'), '    runs-on: ubuntu-24.04\n    timeout-minutes: 4');
});

test('negative pilot executes only runtime check and current-main collector; no checkout, model, upload or writes', () => {
  // Exact command allowlist also prevents an extra shell command hiding behind
  // otherwise-correct permission and pin assertions. Local temp writes only.
  const commands = [...text.matchAll(/^        run: (.*)\n((?:          .*\n)*)/gm)]
    .map(m => m[1] === '|' ? m[2].replace(/^          /gm, '').trimEnd() : m[1]);
  assert.deepEqual(commands, [
    'python3 -I -B -c "import sys, ssl; assert sys.version_info >= (3, 12); print(\'Python collector runtime available\')"',
    [
      'set -euo pipefail',
      'umask 077',
      '[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]',
      'test "$(gh api repos/Achi1984/meridian/commits/main --jq .sha)" = "$GITHUB_SHA"',
      'gh api "repos/Achi1984/meridian/contents/docs/autonomy/event-receiver/collector.py?ref=$GITHUB_SHA" -H \'Accept:application/vnd.github.raw+json\' > "$RUNNER_TEMP/collector.py"',
      'test "$(wc -c < "$RUNNER_TEMP/collector.py")" -le 262144'
    ].join('\n'),
    'python3 -I -B "$RUNNER_TEMP/collector.py"'
  ]);
  assert.equal((text.match(/^      - name:/gm) || []).length, 3);
  assert.deepEqual([...text.matchAll(/^        ([\w-]+):/gm)].map(m => m[1]), ['run', 'env', 'shell', 'run', 'env', 'run']);
  assert.deepEqual([...text.matchAll(/^          ([A-Z_]+): (.*)$/gm)].map(m => m.slice(1)), [
    ['GH_TOKEN', '${{ github.token }}'], ['GH_TOKEN', '${{ github.token }}'],
    ['RECEIPT_PATH', '${{ runner.temp }}/meridian-event-receipt.json'], ['PYTHONDONTWRITEBYTECODE', "'1'"]
  ]);
  assert.doesNotMatch(text, /checkout@|upload-artifact|download-artifact|\bcopilot\b|\bclaude\b|\bopenai\b|\bdispatch\b|continue-on-error:/);
});
