import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const helper = fileURLToPath(new URL('../scripts/native-copilot-task-dispatch.py', import.meta.url));

const runPython = String.raw`
import copy, hashlib, importlib.util, json, os, tempfile
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
        self.post_conflict = False
        self.claim_timeout = False
        self.claim_timeout_before_persist = False
        self.assignment_timeout = False
        self.assignment_http_error = False
        self.assignment_response = None
        self.changed_after_claim = None
        self.changed_before_claim = None
        self.changed_run_after_claim = None
        self.advance_before_claim_post = False
        self.advance_on_claim = False
        self.now = 1000
        self.journal_dir = tempfile.TemporaryDirectory()
        self.journal_path = os.path.join(self.journal_dir.name, 'attempts.sqlite3')
        self.journal = d.SQLiteAttemptJournal(self.journal_path)
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
            if self.claimed and self.changed_run_after_claim:
                key, value = self.changed_run_after_claim
                self.data[path][key] = value
            return copy.deepcopy(self.data[path])
        if path.startswith('git/ref/heads/native-copilot-claims/') and method == 'GET':
            if self.advance_before_claim_post:
                self.now = 3000
            if self.claimed or self.competing:
                return {'ref': path.removeprefix('git/'), 'object': {'sha': base}}
            raise d.APIError(404)
        if path == 'git/refs' and method == 'POST':
            if self.post_conflict:
                raise d.APIError(422)
            if self.claim_timeout_before_persist:
                raise TimeoutError('transport detail must stay private')
            self.claimed = True
            if self.advance_on_claim:
                self.now = 3000
            if self.claim_timeout:
                raise TimeoutError('transport detail must stay private')
            return {'ref': payload['ref'], 'object': {'sha': payload['sha']}}
        if path == 'issues/717/assignees' and method == 'POST':
            if self.assignment_timeout:
                raise TimeoutError('******')
            if self.assignment_http_error:
                raise d.APIError(500)
            return self.assignment_response or {
                'number': 717, 'repository_url': repo_url,
                'assignees': [{'login': d.ASSIGNEE}],
            }
        raise AssertionError('unexpected request')

def execute(mock, cfg=None, verified=True, now=1000, journal=None):
    if now is not None:
        mock.now = now
    return d.execute(
        d.ApprovedTask.from_mapping(config if cfg is None else cfg),
        mock, verified_user_token_auth=verified, clock=lambda: mock.now,
        attempt_journal=mock.journal if journal is None else journal)

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
assert len(posts) == 1 and posts[0][2] == {
    'assignees': [d.ASSIGNEE],
    'agent_assignment': {'target_repo': d.REPOSITORY, 'base_branch': 'main'},
}
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

test('expiry is rechecked before claim and assignment using the live injected clock', () => {
  const result = python(runPython + String.raw`
out = {}
m = MockTransport(); m.advance_before_claim_post = True
out['before_claim'] = execute(m, now=None)
assert out['before_claim']['status'] == 'EXPIRED'
assert not m.claimed and not any(c[1] == 'git/refs' for c in m.calls)
m = MockTransport(); m.advance_on_claim = True
out['after_claim'] = execute(m)
assert out['after_claim']['status'] == 'BLOCKED_CLAIMED'
assert m.claimed and not any(c[1] == 'issues/717/assignees' for c in m.calls)
output(**out)
`);
  assert.equal(result.before_claim.status, 'EXPIRED');
  assert.equal(result.after_claim.status, 'BLOCKED_CLAIMED');
});

test('expiry during durable consume keeps the local fence and prevents the claim POST', () => {
  const result = python(runPython + String.raw`
m = MockTransport()
consume = d.SQLiteAttemptJournal.consume
def slow_consume(journal, operation_id):
    consumed = consume(journal, operation_id)
    m.now = 3000
    return consumed
d.SQLiteAttemptJournal.consume = slow_consume
try:
    first = execute(m)
finally:
    d.SQLiteAttemptJournal.consume = consume
claim_posts = [c for c in m.calls if c[0] == 'POST' and c[1] == 'git/refs']
assert first['status'] == 'EXPIRED'
assert not claim_posts
assert not any(c[0] == 'POST' and c[1] == 'issues/717/assignees' for c in m.calls)
m.now = 1000
second = execute(m, journal=d.SQLiteAttemptJournal(m.journal_path))
assert second['status'] == 'FENCED'
assert len([c for c in m.calls if c[0] == 'POST' and c[1] == 'git/refs']) == 0
assert not any(c[0] == 'POST' and c[1] == 'issues/717/assignees' for c in m.calls)
output(first=first, second=second)
`);
  assert.equal(result.first.status, 'EXPIRED');
  assert.equal(result.second.status, 'FENCED');
});

test('source run is reread after claim and any changed run binding blocks assignment', () => {
  const result = python(runPython + String.raw`
out = {}
for key, value in (
    ('run_attempt', 3), ('status', 'in_progress'), ('conclusion', 'failure'),
    ('head_sha', 'b' * 40), ('workflow_id', 999), ('actor', {'login': 'other'}),
):
    m = MockTransport(); m.changed_run_after_claim = (key, value)
    out[key] = execute(m)
    assert m.claimed
    assert not any(c[1] == 'issues/717/assignees' for c in m.calls)
output(**out)
`);
  for (const status of Object.values(result)) assert.equal(status.status, 'BLOCKED_CLAIMED');
});

test('assignment response must bind the requested issue and repository', () => {
  const result = python(runPython + String.raw`
out = {}
for key, value in (
    ('number', 999), ('repository_url', 'https://api.github.com/repos/other/repo'),
    ('pull_request', {'url': 'https://api.github.com/repos/Achi1984/meridian/pulls/717'}),
    ('assignees', [{'login': d.ASSIGNEE}, {'login': d.ASSIGNEE}]),
    ('assignees', [{'login': 'someone-else'}]),
):
    m = MockTransport()
    m.assignment_response = {
        'number': 717, 'repository_url': repo_url,
        'assignees': [{'login': d.ASSIGNEE}],
    }
    if value is None:
        m.assignment_response.pop(key)
    else:
        m.assignment_response[key] = value
    out[key + str(value)] = execute(m)
    assert out[key + str(value)]['status'] == 'UNKNOWN' and m.claimed
    assert execute(m)['status'] == 'CLAIMED'
    assert len([c for c in m.calls if c[1] == 'issues/717/assignees']) == 1
output(**out)
`);
  assert.ok(Object.values(result).every((status) => status.status === 'UNKNOWN'));
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
m = MockTransport(); out['missing_journal'] = d.execute(
    d.ApprovedTask.from_mapping(config), m, verified_user_token_auth=True,
    clock=lambda: m.now)
assert out['missing_journal']['status'] == 'BLOCKED' and not m.calls
m = MockTransport(); m.post_conflict = True; out['competing'] = execute(m)
assert len([c for c in m.calls if c[1] == 'git/refs' and c[0] == 'POST']) == 1
assert any(c[1].startswith('git/ref/heads/native-copilot-claims/') and c[0] == 'GET' for c in m.calls)
assert not any(c[1] == 'issues/717/assignees' for c in m.calls)
m = MockTransport(); m.claim_timeout = True; out['claim_timeout'] = execute(m)
assert m.claimed and out['claim_timeout']['status'] == 'UNKNOWN'
assert execute(m)['status'] == 'CLAIMED'
assert len([c for c in m.calls if c[1] == 'git/refs' and c[0] == 'POST']) == 1
assert not any(c[1] == 'issues/717/assignees' for c in m.calls)
m = MockTransport(); m.claim_timeout_before_persist = True
out['claim_timeout_before_persist'] = execute(m)
assert out['claim_timeout_before_persist']['status'] == 'UNKNOWN' and not m.claimed
reopened_journal = d.SQLiteAttemptJournal(m.journal_path)
assert execute(m, journal=reopened_journal)['status'] == 'FENCED'
assert len([c for c in m.calls if c[1] == 'git/refs' and c[0] == 'POST']) == 1
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
  assert.equal(result.missing_journal.status, 'BLOCKED');
  assert.equal(result.claim_timeout_before_persist.status, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(result), /SECRET|Bearer|TimeoutError/);
});

test('CLI reports inactive without a transport or live execution', () => {
  const result = spawnSync('python3', ['-B', helper], {encoding: 'utf8'});
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), {status: 'INACTIVE', operationId: null});
  assert.equal(result.stderr, '');
});
