import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const helper = fileURLToPath(new URL('../scripts/native-copilot-task-dispatch.py', import.meta.url));

const runPython = String.raw`
import copy, hashlib, importlib.util, json
spec = importlib.util.spec_from_file_location('dispatcher', HELPER)
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)

body = 'approved fixed issue body'
base = 'a' * 40
run_id = 12345
issue_path = 'issues/717'
main_path = 'git/ref/heads/main'
claim_ref = None
repo_url = 'https://api.github.com/repos/' + d.REPOSITORY
config = {
    'repository': d.REPOSITORY,
    'issue_number': 717,
    'issue_body_sha256': hashlib.sha256(body.encode()).hexdigest(),
    'expected_main_sha': base,
    'release_run_id': run_id,
    'release_run_attempt': 2,
    'workflow_id': 987,
    'workflow_name': 'MERIDIAN Release Safety',
    'workflow_path': '.github/workflows/backend-safety.yml',
    'authorization_identity': 'approved-owner',
    'authorization_expires_at': 2000,
    'expected_assignees': [],
}

def fixtures():
    return {
        'actions/runs/' + str(run_id): {
            'id': run_id, 'run_attempt': 2, 'workflow_id': 987,
            'name': 'MERIDIAN Release Safety',
            'path': '.github/workflows/backend-safety.yml',
            'head_sha': base, 'head_branch': 'main', 'event': 'push',
            'status': 'completed', 'conclusion': 'success',
            'repository': {'full_name': d.REPOSITORY},
            'actor': {'login': 'approved-owner'},
        },
        issue_path: {
            'number': 717, 'state': 'open', 'repository_url': repo_url,
            'body': body, 'assignees': [],
        },
        main_path: {'object': {'sha': base}},
    }

class MockTransport:
    def __init__(self):
        self.data = fixtures()
        self.calls = []
        self.claimed = False
        self.competing = False
        self.assignment_timeout = False
        self.assignment_http_error = False
        self.changed_after_claim = None
        self.changed_before_claim = None
    def __call__(self, method, path, payload):
        self.calls.append((method, path, copy.deepcopy(payload)))
        if path == issue_path and method == 'GET':
            if self.changed_before_claim == 'issue' and not self.claimed:
                self.data[issue_path]['body'] = 'changed'
            if self.changed_after_claim == 'issue' and self.claimed:
                self.data[issue_path]['body'] = 'changed'
            return copy.deepcopy(self.data[issue_path])
        if path == main_path and method == 'GET':
            if self.changed_before_claim == 'main' and not self.claimed:
                self.data[main_path]['object']['sha'] = 'b' * 40
            if self.changed_after_claim == 'main' and self.claimed:
                self.data[main_path]['object']['sha'] = 'b' * 40
            return copy.deepcopy(self.data[main_path])
        if path == 'actions/runs/' + str(run_id) and method == 'GET':
            return copy.deepcopy(self.data[path])
        if path.startswith('git/ref/heads/native-copilot-claims/') and method == 'GET':
            if self.claimed or self.competing:
                return {'ref': path.removeprefix('git/'), 'object': {'sha': base}}
            raise d.APIError(404)
        if path == 'git/refs' and method == 'POST':
            if self.competing:
                raise d.APIError(422)
            self.claimed = True
            return {'ref': payload['ref'], 'object': {'sha': payload['sha']}}
        if path == 'issues/717/assignees' and method == 'POST':
            if self.assignment_timeout:
                raise TimeoutError('******')
            if self.assignment_http_error:
                raise d.APIError(500)
            return {'assignees': [{'login': d.ASSIGNEE}]}
        raise AssertionError('unexpected request')

def execute(mock, cfg=None, verified=True, now=1000):
    return d.execute(
        d.ApprovedTask.from_mapping(config if cfg is None else cfg),
        mock, verified_user_token_auth=verified, now=now)

def output(**values):
    print(json.dumps(values, separators=(',', ':')))
`;

function python(body) {
  const source = body.replace('HELPER', JSON.stringify(helper));
  const result = spawnSync('python3', ['-B', '-c', source], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('dispatches the fixed approved issue once and preserves the durable claim', () => {
  const result = python(runPython + String.raw`
m = MockTransport()
first = execute(m)
first_count = len(m.calls)
second = execute(m)
posts = [call for call in m.calls if call[0] == 'POST' and call[1] == 'issues/717/assignees']
claim_posts = [call for call in m.calls if call[0] == 'POST' and call[1] == 'git/refs']
assert first['status'] == 'ASSIGNED'
assert second['status'] == 'CLAIMED'
assert len(posts) == 1 and posts[0][2] == {'assignees': [d.ASSIGNEE]}
assert len(claim_posts) == 1 and m.claimed
assert first_count <= d.MAX_REQUESTS
assert len(m.calls) - first_count <= d.MAX_REQUESTS
output(first=first, second=second)
`);
  assert.equal(result.first.status, 'ASSIGNED');
  assert.equal(result.second.status, 'CLAIMED');
});

test('changed issue or main before claim, and after claim, never assigns', () => {
  const result = python(runPython + String.raw`
out = {}
for when in ('before', 'after'):
    for changed in ('issue', 'main'):
        m = MockTransport()
        setattr(m, 'changed_' + when + '_claim', changed)
        out[when + '_' + changed] = execute(m)
        assert not any(c[1] == 'issues/717/assignees' for c in m.calls)
        assert m.claimed == (when == 'after')
output(**out)
`);
  for (const status of Object.values(result)) {
    assert.ok(['BLOCKED', 'BLOCKED_CLAIMED'].includes(status.status));
  }
});

test('strictly rejects malformed configuration, wrong run bindings, expiry, and assigned issues', () => {
  const result = python(runPython + String.raw`
out = {}
for key, value in (
    ('issue_number', True), ('issue_number', 1.5),
    ('issue_body_sha256', 'A' * 64), ('expected_main_sha', 'z' * 40),
    ('release_run_id', False), ('release_run_attempt', 0),
    ('workflow_id', True), ('authorization_expires_at', False),
    ('expected_assignees', ['copilot-swe-agent[bot]']),
):
    bad = copy.deepcopy(config); bad[key] = value
    try: d.ApprovedTask.from_mapping(bad)
    except ValueError: pass
    else: raise AssertionError('accepted malformed ' + key)
for key, value in (
    ('id', 999), ('run_attempt', 1), ('workflow_id', 999),
    ('name', 'wrong'), ('path', '.github/workflows/other.yml'),
    ('head_sha', 'b' * 40), ('head_branch', 'other'),
    ('event', 'workflow_dispatch'), ('status', 'queued'),
    ('conclusion', 'failure'),
):
    m = MockTransport(); m.data['actions/runs/' + str(run_id)][key] = value
    out['run_' + key] = execute(m)
    assert not m.claimed
m = MockTransport(); m.data['actions/runs/' + str(run_id)]['actor']['login'] = 'other'
out['actor'] = execute(m); assert not m.claimed
m = MockTransport(); out['expired'] = execute(m, now=2000); assert not m.calls
m = MockTransport(); m.data[issue_path]['assignees'] = [{'login': d.ASSIGNEE}]
out['copilot_assigned'] = execute(m); assert not m.claimed
m = MockTransport(); m.data[issue_path]['assignees'] = [{'login': 'someone-else'}]
out['assignees_changed'] = execute(m); assert not m.claimed
output(**out)
`);
  assert.equal(result.expired.status, 'EXPIRED');
  assert.equal(result.actor.status, 'BLOCKED');
  assert.equal(result.copilot_assigned.status, 'BLOCKED');
});

test('missing verified auth capability, competing claims, and uncertain assignment fail closed', () => {
  const result = python(runPython + String.raw`
out = {}
m = MockTransport(); out['inactive'] = execute(m, verified=False); assert not m.calls
m = MockTransport(); m.competing = True; out['competing'] = execute(m)
assert not any(c[1] == 'issues/717/assignees' for c in m.calls)
m = MockTransport(); m.assignment_timeout = True; out['timeout'] = execute(m)
assert m.claimed
assert execute(m)['status'] == 'CLAIMED'
assert len([c for c in m.calls if c[1] == 'issues/717/assignees']) == 1
m = MockTransport(); m.assignment_http_error = True; out['http_error'] = execute(m)
assert out['http_error']['status'] == 'UNKNOWN' and m.claimed
assert execute(m)['status'] == 'CLAIMED'
assert len([c for c in m.calls if c[1] == 'issues/717/assignees']) == 1
out['leak_check'] = {'status': out['timeout']['status'],
                     'operationId': out['timeout']['operationId']}
output(**out)
`);
  assert.equal(result.inactive.status, 'INACTIVE');
  assert.equal(result.competing.status, 'CLAIMED');
  assert.equal(result.timeout.status, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(result), /SECRET|Bearer|TimeoutError/);
});

test('CLI reports inactive without a transport or live execution', () => {
  const result = spawnSync('python3', ['-B', helper], {encoding: 'utf8'});
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), {status: 'INACTIVE', operationId: null});
  assert.equal(result.stderr, '');
});
