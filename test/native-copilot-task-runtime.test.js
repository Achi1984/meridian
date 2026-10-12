import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const helper = fileURLToPath(new URL('../scripts/native-copilot-task-runtime.py', import.meta.url));

const runPython = String.raw`
import hashlib, importlib.util, json, os, tempfile, time
spec = importlib.util.spec_from_file_location('runtime', HELPER)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
d = r._dispatcher
body = 'approved fixed issue body'
base = 'a' * 40
run_id, attempt, workflow_id = 12345, 2, 987
repo_url = 'https://api.github.com/repos/' + d.REPOSITORY
config = {
    'repository': d.REPOSITORY,
    'issue_number': 717,
    'issue_body_sha256': hashlib.sha256(body.encode()).hexdigest(),
    'expected_main_sha': base,
    'release_run_id': run_id,
    'release_run_attempt': attempt,
    'workflow_id': workflow_id,
    'workflow_name': d.RELEASE_SAFETY_WORKFLOW_NAME,
    'workflow_path': d.RELEASE_SAFETY_WORKFLOW_PATH,
    'authorization_identity': 'approved-owner',
    'authorization_expires_at': int(time.time()) + 3600,
    'expected_assignees': [],
}
task = d.ApprovedTask.from_mapping(config)
event = {
    'run_id': run_id, 'run_attempt': attempt, 'workflow_id': workflow_id,
    'head_sha': base, 'repository': d.REPOSITORY,
}
def fixtures():
    return {
        'actions/runs/' + str(run_id): {
            'id': run_id, 'run_attempt': attempt, 'workflow_id': workflow_id,
            'name': d.RELEASE_SAFETY_WORKFLOW_NAME,
            'path': d.RELEASE_SAFETY_WORKFLOW_PATH,
            'head_sha': base, 'head_branch': 'main', 'event': 'push',
            'status': 'completed', 'conclusion': 'success',
            'repository': {'full_name': d.REPOSITORY},
            'actor': {'login': 'approved-owner'},
            'triggering_actor': {'login': 'approved-owner'},
        },
        'issues/717': {
            'number': 717, 'state': 'open', 'repository_url': repo_url,
            'body': body, 'assignees': [],
        },
        'git/ref/heads/main': {'object': {'sha': base}},
    }

class FakeResponse:
    instances = []
    def __init__(self, status, raw):
        self.status, self.raw, self.read_sizes = status, raw, []
        FakeResponse.instances.append(self)
    def read(self, size):
        self.read_sizes.append(size)
        return self.raw[:size]

class FakeHTTPS:
    instances = []
    data = fixtures()
    claimed = False
    calls = []
    raw_first = None
    status_first = None
    timeout_first = False
    claim_timeout_before_persist = False
    assignments = 0
    def __init__(self, host, timeout):
        assert host == 'api.github.com'
        assert timeout == r.TIMEOUT_SECONDS
        self.host, self.timeout = host, timeout
        self.request_data = None
        FakeHTTPS.instances.append(self)
    def request(self, method, target, body=None, headers=None):
        assert target.startswith('/repos/' + d.REPOSITORY + '/')
        assert 'Authorization' in headers and headers['Authorization'].startswith('Bearer ')
        assert 'proxy' not in headers and 'Host' not in headers
        self.request_data = (method, target.removeprefix('/repos/' + d.REPOSITORY + '/'), body, headers)
        FakeHTTPS.calls.append(self.request_data)
    def getresponse(self):
        method, path, body, headers = self.request_data
        if FakeHTTPS.timeout_first and len(FakeHTTPS.calls) == 1:
            raise TimeoutError('private timeout detail token-value')
        if len(FakeHTTPS.calls) == 1 and FakeHTTPS.status_first is not None:
            return FakeResponse(FakeHTTPS.status_first, b'')
        if len(FakeHTTPS.calls) == 1 and FakeHTTPS.raw_first is not None:
            return FakeResponse(200, FakeHTTPS.raw_first)
        if method == 'GET' and path in FakeHTTPS.data:
            raw = json.dumps(FakeHTTPS.data[path], separators=(',', ':')).encode()
            return FakeResponse(200, raw)
        if method == 'GET' and path.startswith('git/ref/heads/native-copilot-claims/'):
            if FakeHTTPS.claimed:
                return FakeResponse(200, json.dumps({
                    'ref': 'refs/' + path.removeprefix('git/'),
                    'object': {'sha': base},
                }).encode())
            return FakeResponse(404, b'not found')
        if method == 'POST' and path == 'git/refs':
            if FakeHTTPS.claim_timeout_before_persist:
                raise TimeoutError('private timeout detail token-value')
            if FakeHTTPS.claimed:
                return FakeResponse(409, b'')
            request = json.loads(body)
            FakeHTTPS.claimed = True
            return FakeResponse(201, json.dumps({
                'ref': request['ref'], 'object': {'sha': request['sha']},
            }).encode())
        if method == 'POST' and path == 'issues/717/assignees':
            FakeHTTPS.assignments += 1
            return FakeResponse(201, json.dumps({
                'number': 717, 'repository_url': repo_url,
                'assignees': [{'login': d.ASSIGNEE}],
            }).encode())
        raise AssertionError('unexpected fake request ' + method + ' ' + path)
    def close(self):
        pass

def setup():
    r._HTTPS_CONNECTION = FakeHTTPS
    FakeHTTPS.instances = []
    FakeHTTPS.data = fixtures()
    FakeHTTPS.claimed = False
    FakeHTTPS.calls = []
    FakeHTTPS.raw_first = None
    FakeHTTPS.status_first = None
    FakeHTTPS.timeout_first = False
    FakeHTTPS.claim_timeout_before_persist = False
    FakeHTTPS.assignments = 0
    FakeResponse.instances = []
    directory = tempfile.TemporaryDirectory()
    path = os.path.join(directory.name, 'attempts.sqlite3')
    journal = d.SQLiteAttemptJournal.provision(path, 'runtime-test-v1')
    return directory, path, journal

def invoke(task_value=task, event_value=event, token='token-value',
           capability=True, path=None, identity='runtime-test-v1',
           fence_mode='sqlite'):
    return r.run_once(
        task_value, event_value, token, verified_user_token_auth=capability,
        journal_path=path if fence_mode == 'sqlite' else None,
        journal_identity=identity if fence_mode == 'sqlite' else None,
        fence_mode=fence_mode,
    )

def output(**values):
    print(json.dumps(values, separators=(',', ':')))
`;

function python(body) {
  const source = body.replace('HELPER', JSON.stringify(helper));
  const result = spawnSync('python3', ['-B', '-c', source], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const returned = JSON.parse(result.stdout);
  for (const sentinel of ['token-value', 'private timeout detail']) {
    assert.ok(!JSON.stringify(returned).includes(sentinel));
    assert.ok(!result.stdout.includes(sentinel));
    assert.ok(!result.stderr.includes(sentinel));
  }
  return returned;
}

test('real runtime performs one bounded fixed-host assignment and fences a second invocation', () => {
  const result = python(runPython + String.raw`
directory, path, journal = setup()
first = invoke(path=path)
second = invoke(path=path)
assert first['status'] == 'ASSIGNED'
assert second['status'] == 'CLAIMED'
assert FakeHTTPS.assignments == 1
assert len([c for c in FakeHTTPS.calls if c[0] == 'POST' and c[1] == 'git/refs']) == 1
assert all(c[3]['Authorization'].startswith('Bearer ') for c in FakeHTTPS.calls)
assert all(instance.host == 'api.github.com' and instance.timeout == r.TIMEOUT_SECONDS
           for instance in FakeHTTPS.instances)
assert all(instance.request_data[1].startswith('actions/runs/') or
           instance.request_data[1].startswith('issues/') or
           instance.request_data[1].startswith('git/') for instance in FakeHTTPS.instances)
output(first=first, second=second, requests=len(FakeHTTPS.calls))
`);
  assert.equal(result.first.status, 'ASSIGNED');
  assert.equal(result.second.status, 'CLAIMED');
});

test('runtime GitHub-ref lane requires its explicit mode and a verified user token', () => {
  const result = python(runPython + String.raw`
directory, path, journal = setup()
first = invoke(fence_mode='github_ref')
second = invoke(fence_mode='github_ref')
assert first['status'] == 'ASSIGNED'
assert second['status'] == 'CLAIM_EXISTS'
assert FakeHTTPS.assignments == 1
claims = [call for call in FakeHTTPS.calls if call[0] == 'POST' and call[1] == 'git/refs']
assert len(claims) == 2
assert all(call[1] != 'git/ref/heads/native-copilot-claims/github-only-issue-717'
           for call in FakeHTTPS.calls)
setup()
inactive = invoke(fence_mode='github_ref', capability=False)
assert inactive['status'] == 'INACTIVE' and not FakeHTTPS.calls
setup()
bad_mode = invoke(fence_mode='unknown')
assert bad_mode['status'] == 'BLOCKED' and not FakeHTTPS.calls
output(first=first, second=second, inactive=inactive, badMode=bad_mode)
`);
  assert.equal(result.first.status, 'ASSIGNED');
  assert.equal(result.second.status, 'CLAIM_EXISTS');
  assert.equal(result.inactive.status, 'INACTIVE');
});

test('event mismatch, absent capability, and missing journal fail before HTTPS', () => {
  const result = python(runPython + String.raw`
directory, path, journal = setup()
out = {}
for key, value in (('run_id', 9), ('run_attempt', 3), ('workflow_id', 8),
                   ('head_sha', 'b' * 40), ('repository', 'other/repo')):
    changed = dict(event); changed[key] = value
    out[key] = invoke(event_value=changed, path=path)
    assert out[key]['status'] == 'BLOCKED'
    assert not FakeHTTPS.calls
for changed in (
    {**event, 'run_id': True},
    {**event, 'run_attempt': 2.0},
    {**event, 'extra': 'not allowed'},
    {**event, 'repository': 'x' * (r.MAX_EVENT_BYTES + 1)},
):
    out['malformed_' + str(len(out))] = invoke(event_value=changed, path=path)
    assert out[list(out)[-1]]['status'] == 'BLOCKED'
    assert not FakeHTTPS.calls
out['inactive'] = invoke(path=path, capability=False)
assert out['inactive']['status'] == 'INACTIVE' and not FakeHTTPS.calls
out['missing_journal'] = invoke(path=path + '.missing')
assert out['missing_journal']['status'] == 'BLOCKED' and not FakeHTTPS.calls
out['missing_token'] = invoke(path=path, token=None)
assert out['missing_token']['status'] == 'BLOCKED' and not FakeHTTPS.calls
setup()
out['wrong_journal_identity'] = invoke(path=path, identity='different-runtime-test-v1')
assert out['wrong_journal_identity']['status'] == 'BLOCKED'
assert not any(call[0] == 'POST' for call in FakeHTTPS.calls)
output(**out)
`);
  assert.ok(Object.values(result).every((value) => ['BLOCKED', 'INACTIVE'].includes(value.status)));
});

test('expired authorization cannot mutate remotely and runtime rejects a supplied clock', () => {
  const result = python(runPython + String.raw`
directory, path, journal = setup()
expired_config = dict(config)
expired_config['authorization_expires_at'] = 1
expired_task = d.ApprovedTask.from_mapping(expired_config)
expired = invoke(task_value=expired_task, path=path)
assert expired['status'] == 'EXPIRED'
assert not FakeHTTPS.calls
try:
    r.run_once(
        task, event, 'token-value', verified_user_token_auth=True,
        journal_path=path, journal_identity='runtime-test-v1', clock=lambda: 0,
    )
except TypeError:
    rejected_clock = True
else:
    rejected_clock = False
assert rejected_clock and not FakeHTTPS.calls
output(expired=expired, rejectedClock=rejected_clock)
`);
  assert.equal(result.expired.status, 'EXPIRED');
  assert.equal(result.rejectedClock, true);
});

test('duplicate and nonfinite API JSON are rejected before any POST', () => {
  const result = python(runPython + String.raw`
directory, path, journal = setup()
raw_valid = json.dumps(fixtures()['actions/runs/' + str(run_id)], separators=(',', ':'))
raw_values = [
    raw_valid.replace('"conclusion":"success"',
                     '"conclusion":"failure","conclusion":"success"').encode(),
    raw_valid.replace('"name":"MERIDIAN Release Safety"',
                      '"name":"MERIDIAN Release Safety","extra":NaN').encode(),
    raw_valid.replace('"name":"MERIDIAN Release Safety"',
                      '"name":"MERIDIAN Release Safety","extra":Infinity').encode(),
]
statuses = []
for raw in raw_values:
    setup()
    FakeHTTPS.raw_first = raw
    response = invoke(path=path)
    statuses.append(response['status'])
    assert response['status'] == 'BLOCKED'
    assert not any(call[0] == 'POST' for call in FakeHTTPS.calls)
output(statuses=statuses)
`);
  assert.deepEqual(result.statuses, ['BLOCKED', 'BLOCKED', 'BLOCKED']);
});

test('HTTPS redirects, timeout, and oversized response never retry or leak details', () => {
  const result = python(runPython + String.raw`
directory, path, journal = setup()
out = {}
FakeHTTPS.status_first = 302
out['redirect'] = invoke(path=path)
assert out['redirect']['status'] == 'BLOCKED'
assert len(FakeHTTPS.calls) == 1
setup()
FakeHTTPS.timeout_first = True
out['timeout'] = invoke(path=path)
assert out['timeout']['status'] == 'BLOCKED'
assert len(FakeHTTPS.calls) == 1
setup()
FakeHTTPS.raw_first = b'{' * (d.MAX_RESPONSE_BYTES + 1)
out['oversized'] = invoke(path=path)
assert out['oversized']['status'] == 'BLOCKED'
assert len(FakeHTTPS.calls) == 1
assert FakeResponse.instances[0].read_sizes == [d.MAX_RESPONSE_BYTES + 1]
output(**out)
`);
  assert.deepEqual(Object.values(result).map((value) => value.status), ['BLOCKED', 'BLOCKED', 'BLOCKED']);
});

test('unknown claim result consumes the durable fence and is never replayed', () => {
  const result = python(runPython + String.raw`
directory, path, journal = setup()
FakeHTTPS.claim_timeout_before_persist = True
first = invoke(path=path)
second = invoke(path=path)
claim_posts = [call for call in FakeHTTPS.calls if call[0] == 'POST' and call[1] == 'git/refs']
assignment_posts = [call for call in FakeHTTPS.calls if call[0] == 'POST' and call[1] == 'issues/717/assignees']
assert first['status'] == 'UNKNOWN'
assert second['status'] == 'FENCED'
assert len(claim_posts) == 1 and not assignment_posts
output(first=first, second=second, claimPosts=len(claim_posts))
`);
  assert.equal(result.first.status, 'UNKNOWN');
  assert.equal(result.second.status, 'FENCED');
  assert.equal(result.claimPosts, 1);
});

test('transport rejects unknown targets before constructing HTTPS connections', () => {
  const result = python(runPython + String.raw`
connections = []
def factory(*args, **kwargs):
    connections.append((args, kwargs))
    raise AssertionError('connection should not be constructed')
r._HTTPS_CONNECTION = factory
transport = r.GitHubHTTPS('token-value')
rejected = 0
for method, path in (
    ('GET', 'https://attacker.invalid/'),
    ('GET', '../issues/717'),
    ('DELETE', 'issues/717'),
    ('GET', 'issues/717?per_page=100'),
):
    try:
        transport(method, path, None, d.MAX_RESPONSE_BYTES + 1)
    except ValueError:
        rejected += 1
    else:
        raise AssertionError('accepted non-allowlisted target')
assert rejected == 4 and not connections
output(rejected=rejected)
`);
  assert.equal(result.rejected, 4);
});

test('runtime CLI remains inactive', () => {
  const result = spawnSync('python3', ['-B', helper], {encoding: 'utf8'});
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), {status: 'INACTIVE', operationId: null});
  assert.equal(result.stderr, '');
});
