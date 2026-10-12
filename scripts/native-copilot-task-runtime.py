"""Inactive-by-default, single-invocation HTTPS adapter for native task dispatch.

Activation is a separate owner decision. A caller must supply one immutable
ApprovedTask, matching event pins, an externally verified user-to-server token
capability, and the path plus independently retained identity of an already
provisioned SQLiteAttemptJournal. This adapter never provisions credentials or
journal storage. A durable host and separately retained journal identity are
deployment prerequisites; temporary Actions storage, caches, and artifacts are
not durable journals. No same-identity snapshot rollback detection is claimed.
Eligible tokens are PAT, OAuth, or GitHub App user-to-server tokens, never an
App installation token or Actions GITHUB_TOKEN. The capability is not inferred
from token text.

The CLI is intentionally inert. The transport uses only fixed api.github.com
targets, never follows redirects or retries, and bounds response reads to the
dispatcher contract.
"""

import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import sys


API_HOST = 'api.github.com'
TIMEOUT_SECONDS = 10
MAX_EVENT_BYTES = 4096
MAX_TOKEN_BYTES = 8192
MAX_REQUEST_BYTES = 4096
MAX_SIGNED_64_BIT_PIN = (1 << 63) - 1
_HTTPS_CONNECTION = http.client.HTTPSConnection
SHA_RE = re.compile(r'[0-9a-f]{40}\Z')
CLAIM_PATH_RE = re.compile(
    r'git/ref/heads/native-copilot-claims/issue-([1-9][0-9]{0,18})-([0-9a-f]{24})\Z')


def _load_dispatcher():
    path = Path(__file__).with_name('native-copilot-task-dispatch.py')
    spec = importlib.util.spec_from_file_location(
        '_native_copilot_task_dispatch_for_runtime', path)
    if spec is None or spec.loader is None:
        raise RuntimeError('dispatcher unavailable')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_dispatcher = _load_dispatcher()


def _valid_positive_pin(value):
    return (type(value) is int and 0 < value <= MAX_SIGNED_64_BIT_PIN)


def _allowed_path(method, path):
    if type(method) is not str or type(path) is not str or len(path) > 256:
        return False
    if method == 'GET':
        if path == 'git/ref/heads/main':
            return True
        if re.fullmatch(r'actions/runs/[1-9][0-9]{0,18}', path):
            return _valid_positive_pin(int(path.rsplit('/', 1)[1]))
        if re.fullmatch(r'issues/[1-9][0-9]{0,18}', path):
            return _valid_positive_pin(int(path.rsplit('/', 1)[1]))
        match = CLAIM_PATH_RE.fullmatch(path)
        return bool(match and _valid_positive_pin(int(match.group(1))))
    if method == 'POST':
        return (path == 'git/refs'
                or bool(re.fullmatch(r'issues/[1-9][0-9]{0,18}/assignees', path)
                        and _valid_positive_pin(int(path.split('/')[1]))))
    return False


def _request_body(method, path, payload):
    if method == 'GET':
        if payload is not None:
            raise ValueError('invalid request')
        return None
    if type(payload) is not dict or len(payload) > 2:
        raise ValueError('invalid request')
    if path == 'git/refs':
        if set(payload) != {'ref', 'sha'}:
            raise ValueError('invalid request')
        claim = payload['ref']
        if (type(claim) is not str or not claim.startswith('refs/')
                or not CLAIM_PATH_RE.fullmatch(
                    'git/ref/' + claim.removeprefix('refs/'))
                or type(payload['sha']) is not str
                or not SHA_RE.fullmatch(payload['sha'])):
            raise ValueError('invalid request')
    else:
        if set(payload) != {'assignees', 'agent_assignment'}:
            raise ValueError('invalid request')
        if (type(payload['assignees']) is not list
                or len(payload['assignees']) != 1
                or payload['assignees'] != [_dispatcher.ASSIGNEE]
                or type(payload['agent_assignment']) is not dict
                or len(payload['agent_assignment']) != 2
                or payload['agent_assignment'] != {
                    'target_repo': _dispatcher.REPOSITORY,
                    'base_branch': 'main',
                }):
            raise ValueError('invalid request')
    try:
        body = json.dumps(payload, separators=(',', ':'), ensure_ascii=True).encode('ascii')
    except (TypeError, ValueError, UnicodeError):
        raise ValueError('invalid request') from None
    if len(body) > MAX_REQUEST_BYTES:
        raise ValueError('invalid request')
    return body


class GitHubHTTPS:
    """Fixed-host HTTPS transport; the caller supplies auth capability out-of-band."""

    def __init__(self, token):
        if (type(token) is not str or not token or len(token) > MAX_TOKEN_BYTES
                or not token.isascii()
                or any(ord(char) < 33 or ord(char) > 126 for char in token)):
            raise ValueError('invalid transport capability')
        self._token = token

    def __call__(self, method, path, payload, max_response_bytes):
        if (not _allowed_path(method, path)
                or type(max_response_bytes) is not int
                or max_response_bytes != _dispatcher.MAX_RESPONSE_BYTES + 1):
            raise ValueError('invalid request')
        body = _request_body(method, path, payload)
        connection = None
        try:
            connection = _HTTPS_CONNECTION(API_HOST, timeout=TIMEOUT_SECONDS)
            connection.request(
                method,
                '/repos/{}/{}'.format(_dispatcher.REPOSITORY, path),
                body=body,
                headers={
                    'Accept': 'application/vnd.github+json',
                    'Authorization': 'Bearer ' + self._token,
                    'Content-Type': 'application/json',
                    'User-Agent': 'meridian-native-task-runtime',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
            )
            response = connection.getresponse()
            status = response.status
            if type(status) is not int or not 100 <= status <= 599:
                raise RuntimeError('invalid HTTP response')
            if not 200 <= status <= 299:
                raise _dispatcher.APIError(status)
            raw = response.read(max_response_bytes)
            if type(raw) is not bytes or len(raw) > max_response_bytes:
                raise RuntimeError('invalid HTTP response')
            return raw
        except _dispatcher.APIError:
            raise
        except Exception:
            raise RuntimeError('transport failure') from None
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass


def _validate_event(task, event):
    required = {'run_id', 'run_attempt', 'workflow_id', 'head_sha', 'repository'}
    if type(event) is not dict or set(event) != required:
        raise ValueError('invalid event')
    if (not _valid_positive_pin(event['run_id'])
            or not _valid_positive_pin(event['run_attempt'])
            or not _valid_positive_pin(event['workflow_id'])
            or type(event['head_sha']) is not str
            or not SHA_RE.fullmatch(event['head_sha'])
            or type(event['repository']) is not str
            or event['run_id'] != task.release_run_id
            or event['run_attempt'] != task.release_run_attempt
            or event['workflow_id'] != task.workflow_id
            or event['head_sha'] != task.expected_main_sha
            or event['repository'] != task.repository):
        raise ValueError('event does not match approved task')
    try:
        encoded = json.dumps(event, separators=(',', ':'), allow_nan=False).encode('utf-8')
    except (TypeError, ValueError, UnicodeError):
        raise ValueError('invalid event') from None
    if len(encoded) > MAX_EVENT_BYTES:
        raise ValueError('invalid event')


def run_once(approved_task, event, user_token=None, *,
             verified_user_token_auth=False, journal_path=None,
             journal_identity=None):
    """Validate one trigger, then invoke the existing dispatcher exactly once.

    `verified_user_token_auth` is an externally verified capability assertion;
    token syntax is not used to infer it. `event` must contain exactly
    run_id/run_attempt/workflow_id/head_sha/repository and is never authority.
    """
    try:
        _dispatcher._validate_task(approved_task)
        _validate_event(approved_task, event)
        operation_id = _dispatcher._operation_id(approved_task)
    except Exception:
        return _dispatcher._response('BLOCKED', None)
    if type(verified_user_token_auth) is not bool:
        return _dispatcher._response('BLOCKED', operation_id)
    if not verified_user_token_auth:
        return _dispatcher._response('INACTIVE', operation_id)
    try:
        if (type(journal_path) is not str or len(journal_path) > 4096
                or not os.path.isabs(journal_path) or os.path.islink(journal_path)
                or not os.path.isfile(journal_path)):
            raise ValueError('invalid journal')
        journal = _dispatcher.SQLiteAttemptJournal(journal_path, journal_identity)
        transport = GitHubHTTPS(user_token)
    except Exception:
        return _dispatcher._response('BLOCKED', operation_id)
    return _dispatcher.execute(
        approved_task, transport,
        verified_user_token_auth=True,
        attempt_journal=journal,
    )


def main():
    print(json.dumps(
        _dispatcher._response('INACTIVE', None), separators=(',', ':')))
    return 2


if __name__ == '__main__':
    sys.exit(main())
