"""Bounded, opt-in native Copilot issue assignment component.

The CLI is intentionally inert. Activation requires an owner-approved immutable
task pin, authoritative API reads, and an externally verified user-to-server
token capability (PAT, OAuth, or GitHub App user access token). GitHub documents
that this assignment API does not accept an App installation token or Actions
GITHUB_TOKEN. This module neither obtains credentials nor infers auth capability
from token text; there is no fallback to publisher App credentials.

The injected transport is a trust boundary: its caller must provide the verified
user-token authentication prerequisite. This source adds no permissions and
does not install or schedule any automation.
"""

from dataclasses import dataclass
import hashlib
import json
import math
import re
import sys


REPOSITORY = 'Achi1984/meridian'
ASSIGNEE = 'copilot-swe-agent[bot]'
MAX_REQUESTS = 12
MAX_RESPONSE_BYTES = 65536
MAX_ASSIGNEES = 20
LOGIN_RE = re.compile(
    r'(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?'
    r'|[A-Za-z0-9](?:[A-Za-z0-9-]{0,31}[A-Za-z0-9])?\[bot\])\Z')
SHA_RE = re.compile(r'[0-9a-f]{40}\Z')
BODY_DIGEST_RE = re.compile(r'[0-9a-f]{64}\Z')


class APIError(Exception):
    """Transport error carrying only an HTTP status code."""

    def __init__(self, status):
        self.status = status


@dataclass(frozen=True)
class ApprovedTask:
    repository: str
    issue_number: int
    issue_body_sha256: str
    expected_main_sha: str
    release_run_id: int
    release_run_attempt: int
    workflow_id: int
    workflow_name: str
    workflow_path: str
    authorization_identity: str
    authorization_expires_at: int
    expected_assignees: tuple

    @classmethod
    def from_mapping(cls, value):
        keys = {
            'repository', 'issue_number', 'issue_body_sha256', 'expected_main_sha',
            'release_run_id', 'release_run_attempt', 'workflow_id', 'workflow_name',
            'workflow_path', 'authorization_identity', 'authorization_expires_at',
            'expected_assignees',
        }
        if type(value) is not dict or set(value) != keys:
            raise ValueError('invalid configuration')
        if type(value['expected_assignees']) is not list:
            raise ValueError('invalid configuration')
        task = cls(**{
            **{key: item for key, item in value.items() if key != 'expected_assignees'},
            'expected_assignees': tuple(value['expected_assignees']),
        })
        _validate_task(task)
        return task


def _validate_task(task):
    if (type(task) is not ApprovedTask or type(task.repository) is not str
            or task.repository != REPOSITORY):
        raise ValueError('invalid configuration')
    if type(task.issue_number) is not int or task.issue_number <= 0:
        raise ValueError('invalid configuration')
    if type(task.issue_body_sha256) is not str or not BODY_DIGEST_RE.fullmatch(task.issue_body_sha256):
        raise ValueError('invalid configuration')
    if type(task.expected_main_sha) is not str or not SHA_RE.fullmatch(task.expected_main_sha):
        raise ValueError('invalid configuration')
    for number in (task.release_run_id, task.release_run_attempt, task.workflow_id):
        if type(number) is not int or number <= 0:
            raise ValueError('invalid configuration')
    if (type(task.workflow_name) is not str or not task.workflow_name
            or len(task.workflow_name) > 200):
        raise ValueError('invalid configuration')
    if (type(task.workflow_path) is not str or not re.fullmatch(
            r'\.github/workflows/[A-Za-z0-9._/-]{1,180}\.ya?ml', task.workflow_path)
            or '..' in task.workflow_path.split('/')
            or '//' in task.workflow_path):
        raise ValueError('invalid configuration')
    if (type(task.authorization_identity) is not str
            or not LOGIN_RE.fullmatch(task.authorization_identity)):
        raise ValueError('invalid configuration')
    if (type(task.authorization_expires_at) is not int
            or task.authorization_expires_at <= 0):
        raise ValueError('invalid configuration')
    if (type(task.expected_assignees) is not tuple
            or len(task.expected_assignees) > MAX_ASSIGNEES
            or any(type(login) is not str or not LOGIN_RE.fullmatch(login)
                   for login in task.expected_assignees)
            or len(set(task.expected_assignees)) != len(task.expected_assignees)
            or ASSIGNEE in task.expected_assignees):
        raise ValueError('invalid configuration')


def _operation_id(task):
    stable_identity = json.dumps(
        [task.repository, task.issue_number, task.issue_body_sha256],
        separators=(',', ':'), ensure_ascii=True,
    )
    return hashlib.sha256(stable_identity.encode('ascii')).hexdigest()[:24]


def _claim_ref(task):
    return 'refs/heads/native-copilot-claims/issue-{}-{}'.format(
        task.issue_number, _operation_id(task))


def _check_response(value):
    if type(value) is not dict:
        raise ValueError('invalid response')
    encoded = json.dumps(value, ensure_ascii=True, allow_nan=False,
                         separators=(',', ':')).encode('ascii')
    if len(encoded) > MAX_RESPONSE_BYTES:
        raise ValueError('oversized response')
    return value


class _Client:
    def __init__(self, transport):
        if not callable(transport):
            raise ValueError('invalid transport')
        self.transport = transport
        self.count = 0

    def request(self, method, path, payload=None):
        self.count += 1
        if self.count > MAX_REQUESTS:
            raise ValueError('request limit')
        try:
            result = self.transport(method, path, payload)
        except APIError as error:
            if type(error.status) is int and 100 <= error.status <= 599:
                raise
            raise RuntimeError('transport failure') from None
        except Exception:
            raise RuntimeError('transport failure') from None
        return _check_response(result)


class _Blocked(Exception):
    pass


def _verified_run(client, task):
    run = client.request('GET', 'actions/runs/{}'.format(task.release_run_id))
    repository = run.get('repository')
    actor = run.get('actor')
    if (type(run.get('id')) is not int or run['id'] != task.release_run_id
            or type(run.get('run_attempt')) is not int
            or run['run_attempt'] != task.release_run_attempt
            or type(run.get('workflow_id')) is not int
            or run['workflow_id'] != task.workflow_id
            or run.get('name') != task.workflow_name
            or run.get('path') != task.workflow_path
            or run.get('head_sha') != task.expected_main_sha
            or run.get('head_branch') != 'main'
            or run.get('event') != 'push'
            or run.get('status') != 'completed'
            or run.get('conclusion') != 'success'
            or type(repository) is not dict
            or repository.get('full_name') != task.repository
            or type(actor) is not dict
            or actor.get('login') != task.authorization_identity):
        raise _Blocked()


def _verified_issue(client, task):
    issue = client.request('GET', 'issues/{}'.format(task.issue_number))
    if (type(issue.get('number')) is not int
            or issue['number'] != task.issue_number
            or issue.get('state') != 'open'
            or 'pull_request' in issue
            or issue.get('repository_url') != 'https://api.github.com/repos/' + task.repository
            or type(issue.get('body')) is not str
            or hashlib.sha256(issue['body'].encode('utf-8')).hexdigest()
            != task.issue_body_sha256):
        raise _Blocked()
    assignees = issue.get('assignees')
    if type(assignees) is not list or len(assignees) > MAX_ASSIGNEES:
        raise _Blocked()
    logins = []
    for assignee in assignees:
        if type(assignee) is not dict or type(assignee.get('login')) is not str:
            raise _Blocked()
        logins.append(assignee['login'])
    if (ASSIGNEE in logins
            or len(set(logins)) != len(logins)
            or sorted(logins) != sorted(task.expected_assignees)):
        raise _Blocked()


def _verified_main(client, task):
    ref = client.request('GET', 'git/ref/heads/main')
    obj = ref.get('object')
    if type(obj) is not dict or obj.get('sha') != task.expected_main_sha:
        raise _Blocked()


def _response(status, operation_id):
    return {'status': status, 'operationId': operation_id}


def execute(task, transport, *, verified_user_token_auth=False, now=None):
    """Execute at most one assignment; never retry an ambiguous operation.

    `verified_user_token_auth` is an activation assertion supplied only after an
    external owner verifies that `transport` uses an eligible user-to-server
    token. Token syntax is neither checked nor accepted by this component.
    """
    operation_id = None
    claimed = False
    assigning = False
    try:
        _validate_task(task)
        operation_id = _operation_id(task)
        if type(verified_user_token_auth) is not bool or not verified_user_token_auth:
            return _response('INACTIVE', operation_id)
        if now is None:
            import time
            now = time.time()
        if (type(now) not in (int, float) or type(now) is bool
                or not math.isfinite(now)):
            raise _Blocked()
        if now >= task.authorization_expires_at:
            return _response('EXPIRED', operation_id)

        client = _Client(transport)
        _verified_run(client, task)
        _verified_issue(client, task)
        _verified_main(client, task)

        claim_ref = _claim_ref(task)
        try:
            client.request('GET', 'git/ref/heads/' + claim_ref.removeprefix('refs/heads/'))
        except APIError as error:
            if error.status != 404:
                raise
        else:
            return _response('CLAIMED', operation_id)

        try:
            created = client.request('POST', 'git/refs', {
                'ref': claim_ref, 'sha': task.expected_main_sha,
            })
        except APIError as error:
            if error.status in (409, 422):
                return _response('CLAIMED', operation_id)
            return _response('UNKNOWN', operation_id)
        except Exception:
            return _response('UNKNOWN', operation_id)
        claimed = True
        if (created.get('ref') != claim_ref or type(created.get('object')) is not dict
                or created['object'].get('sha') != task.expected_main_sha):
            return _response('UNKNOWN', operation_id)

        try:
            _verified_issue(client, task)
            _verified_main(client, task)
        except Exception:
            return _response('BLOCKED_CLAIMED', operation_id)

        assigning = True
        result = client.request('POST', 'issues/{}/assignees'.format(task.issue_number), {
            'assignees': [ASSIGNEE],
        })
        result_assignees = result.get('assignees')
        if type(result_assignees) is not list or not any(
                type(item) is dict and item.get('login') == ASSIGNEE
                for item in result_assignees):
            return _response('UNKNOWN', operation_id)
        return _response('ASSIGNED', operation_id)
    except APIError:
        if assigning:
            return _response('UNKNOWN', operation_id)
        return _response('BLOCKED_CLAIMED' if claimed else 'BLOCKED', operation_id)
    except Exception:
        if assigning:
            return _response('UNKNOWN', operation_id)
        return _response('BLOCKED_CLAIMED' if claimed else 'BLOCKED', operation_id)


def main():
    print(json.dumps(_response('INACTIVE', None), separators=(',', ':')))
    return 2


if __name__ == '__main__':
    sys.exit(main())
