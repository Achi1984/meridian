import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
// Remove with the temporary installed listener during reviewed cleanup.
const workflow = readFileSync(new URL('../.github/workflows/meridian-positive-event-pilot.yml', import.meta.url), 'utf8');
const text = workflow.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
const expiry = '2026-10-12T09:15:00Z';
test('installed listener has only approved native trigger and read-only scope', () => {
  assert.deepEqual([...text.matchAll(/^([\w-]+):/gm)].map(m => m[1]), ['name', 'on', 'permissions', 'jobs']);
  assert.equal(text.slice(text.indexOf('on:\n'), text.indexOf('jobs:\n')),
    'on:\n  workflow_run:\n    workflows: [MERIDIAN Release Safety]\n    types: [completed]\npermissions:\n  contents: read\n  actions: read\n  issues: read\n  pull-requests: read\n');
  assert.equal((text.match(/permissions:/g) || []).length, 1);
  assert.deepEqual([...text.slice(text.indexOf('jobs:\n')).matchAll(/^  ([\w-]+):/gm)].map(m => m[1]), ['reconcile']);
  assert.doesNotMatch(text, /\buses:|\bsecrets\.|:\s*write\b|\bworkflow_dispatch:|\bschedule:|checkout@|upload-artifact|\bcopilot\b|\bclaude\b|continue-on-error:/);
});

test('installed listener requires exact source identity, successful push and bounded attempts', () => {
  const guard = text.split('    if: >-\n')[1].split('    runs-on:')[0].trim().split(/\s*&&\s*/);
  assert.deepEqual(guard, [
    "github.repository == 'Achi1984/meridian'", "github.event_name == 'workflow_run'", 'github.run_attempt == 1',
    "github.event.workflow_run.repository.full_name == 'Achi1984/meridian'",
    "github.event.workflow_run.head_repository.full_name == 'Achi1984/meridian'",
    "github.event.workflow_run.event == 'push'", "github.event.workflow_run.head_branch == 'main'",
    'github.event.workflow_run.head_sha == github.sha', 'github.event.workflow_run.workflow_id == 347821227',
    "github.event.workflow_run.path == '.github/workflows/backend-safety.yml'",
    "github.event.workflow_run.status == 'completed'", "github.event.workflow_run.conclusion == 'success'",
    'github.event.workflow_run.run_attempt == 2'
  ]);
  assert.deepEqual([...text.slice(text.indexOf('jobs:\n')).matchAll(/^    ([\w-]+):/gm)].map(m => m[1]), ['if', 'runs-on', 'timeout-minutes', 'env', 'steps']);
  assert.ok(text.includes("    runs-on: ubuntu-24.04\n    timeout-minutes: 4\n    env:\n      PILOT_EXPIRES_AT: '" + expiry + "'\n    steps:"));
  assert.equal((text.match(/PILOT_EXPIRES_AT:/g) || []).length, 1);
  assert.equal((text.match(/^      - name:/gm) || []).length, 4);
  assert.ok(text.indexOf("python3 -I -B - <<'PY'") < text.indexOf('gh api'));
  assert.ok(text.includes('test "$(gh api repos/Achi1984/meridian/commits/main --jq .sha)" = "$GITHUB_SHA"'));
  assert.ok(text.includes('for script in collector.py receipt_summary.py; do'));
  assert.ok(text.includes('$script?ref=$GITHUB_SHA'));
  assert.ok(text.includes('run: python3 -I -B "$RUNNER_TEMP/collector.py"'));
  assert.ok(text.includes('run: python3 -I -B "$RUNNER_TEMP/receipt_summary.py"'));
});

test('actual installed expiry code accepts window and rejects early, deadline, late and malformed times', () => {
  const source = text.split("python3 -I -B - <<'PY'\n")[1].split('\n          PY')[0].replace(/^          /gm, '');
  const harness = `source=${JSON.stringify(source)}\nexpiry=${JSON.stringify(expiry)}\n` + String.raw`
import datetime, os
from unittest.mock import patch
RealDateTime = datetime.datetime
def trial(now, value, accepted):
    fixed = RealDateTime.fromisoformat(now).replace(tzinfo=datetime.timezone.utc)
    class Clock(RealDateTime):
        @classmethod
        def now(cls, tz=None): return fixed
    with patch.object(datetime, 'datetime', Clock), patch.dict(os.environ, {'PILOT_EXPIRES_AT':value}, clear=True):
        try: exec(compile(source, '<installed-expiry>', 'exec'), {})
        except (AssertionError, ValueError):
            assert not accepted, 'approved window rejected'
        else:
            assert accepted, 'unsafe time accepted'
trial('2026-10-12T07:45:00', expiry, True)
trial('2026-10-12T09:14:59', expiry, True)
trial('2026-10-12T07:44:59', expiry, False)
trial('2026-10-12T09:15:00', expiry, False)
trial('2026-10-12T09:15:01', expiry, False)
trial('2026-10-12T08:00:00', 'YYYY-MM-DDTHH:MM:SSZ', False)
trial('2026-10-12T08:00:00', '2026-99-12T08:15:00Z', False)
print('7 installed expiry scenarios passed')
`;
  const result = spawnSync('python3', ['-I', '-B', '-c', harness], {encoding: 'utf8', timeout: 10000});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), '7 installed expiry scenarios passed');
});
