"""Manually authorized, create-only GitHub experiment; never assigns an agent."""
import concurrent.futures
import http.client
import json
import os
import re
import subprocess
import sys
import threading

REPOSITORY = 'Achi1984/meridian'
PINNED_SHA = '078c20f14a44ae21f81ea7eae0aabd06cb038031'
PREFIX = 'refs/heads/meridian-integration-tests/ref-race-'
MAX_RESPONSE_BYTES = 8192
TIMEOUT_SECONDS = 10
MAX_REQUESTS = 3
ACK = 'CREATE_THREE_ATTEMPTS_KEEP_REF_FOREVER'


def claim_ref(probe_id):
    if type(probe_id) is not str or not re.fullmatch(r'[a-z0-9]{16,32}', probe_id):
        raise ValueError('invalid probe identity')
    return PREFIX + probe_id


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate JSON key')
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError('invalid JSON constant')


class GitHubCreateOnly:
    def __init__(self, token, ref):
        if (type(token) is not str or not token or len(token) > 8192
                or not token.isascii() or any(ord(c) < 33 or ord(c) > 126 for c in token)):
            raise ValueError('invalid credential')
        if not ref.startswith(PREFIX) or claim_ref(ref[len(PREFIX):]) != ref:
            raise ValueError('invalid reference')
        self._token = token
        self._ref = ref
        self._lock = threading.Lock()
        self._count = 0

    def __call__(self):
        with self._lock:
            if self._count >= MAX_REQUESTS:
                return 'BUDGET_EXCEEDED'
            self._count += 1
        connection = None
        try:
            connection = http.client.HTTPSConnection('api.github.com', timeout=TIMEOUT_SECONDS)
            connection.request('POST', '/repos/' + REPOSITORY + '/git/refs',
                body=json.dumps({'ref': self._ref, 'sha': PINNED_SHA}).encode('ascii'),
                headers={'Authorization': 'Bearer ' + self._token,
                         'Accept': 'application/vnd.github+json',
                         'Content-Type': 'application/json',
                         'X-GitHub-Api-Version': '2022-11-28',
                         'User-Agent': 'meridian-create-only-ref-probe'})
            response = connection.getresponse()
            status = response.status
            if type(status) is not int:
                return 'UNKNOWN'
            if status in (409, 422):
                return 'REJECTED_' + str(status)
            if status != 201:
                return 'UNEXPECTED_STATUS'
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if type(raw) is not bytes or len(raw) > MAX_RESPONSE_BYTES:
                return 'INVALID_201'
            result = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object,
                                parse_constant=reject_constant)
            if (type(result) is not dict or result.get('ref') != self._ref
                    or type(result.get('object')) is not dict
                    or result['object'].get('sha') != PINNED_SHA):
                return 'INVALID_201'
            return 'CREATED_201'
        except Exception:
            return 'UNKNOWN'
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass


def probe(transport, restart_transport=None):
    barrier = threading.Barrier(2)
    def contender():
        try:
            barrier.wait(timeout=TIMEOUT_SECONDS)
            return transport()
        except Exception:
            return 'UNKNOWN'
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(contender) for _ in range(2)]
        outcomes = [future.result() for future in futures]
    rejected = {'REJECTED_409', 'REJECTED_422'}
    if outcomes.count('CREATED_201') != 1 or not any(v in rejected for v in outcomes):
        return {'status': 'INCONCLUSIVE', 'race': outcomes, 'restart': 'NOT_ATTEMPTED'}
    # Production caller supplies a fresh-process restart; tests may use a fake.
    try:
        restart = (restart_transport or transport)()
    except Exception:
        restart = 'UNKNOWN'
    return {'status': 'OBSERVED_PASS' if restart in rejected else 'INCONCLUSIVE',
            'race': outcomes, 'restart': restart}


def restart_process():
    """One child invocation, one request; no response/ownership state passed."""
    try:
        result = subprocess.run(
            [sys.executable, '-B', os.path.abspath(__file__), '--single-attempt'],
            stdin=subprocess.DEVNULL, capture_output=True, timeout=35, check=False)
        if result.returncode != 0 or len(result.stdout) > 128 or result.stderr:
            return 'UNKNOWN'
        value = json.loads(result.stdout)
        if type(value) is not dict or set(value) != {'outcome'}:
            return 'UNKNOWN'
        outcome = value['outcome']
        return outcome if outcome in {'CREATED_201', 'REJECTED_409', 'REJECTED_422',
                                       'UNKNOWN', 'UNEXPECTED_STATUS', 'INVALID_201'} else 'UNKNOWN'
    except Exception:
        return 'UNKNOWN'


def main():
    if os.environ.get('MERIDIAN_REF_PROBE_ACK') != ACK:
        print('{"status":"INACTIVE"}')
        return 2
    try:
        ref = claim_ref(os.environ.get('MERIDIAN_REF_PROBE_ID'))
        transport = GitHubCreateOnly(os.environ.get('GITHUB_TOKEN'), ref)
        if sys.argv[1:] == ['--single-attempt']:
            print(json.dumps({'outcome': transport()}, separators=(',', ':')))
            return 0
        if sys.argv[1:]:
            raise ValueError('invalid arguments')
        result = probe(transport, restart_process)
    except Exception:
        result = {'status': 'BLOCKED'}
    print(json.dumps(result, separators=(',', ':')))
    return 0 if result['status'] == 'OBSERVED_PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
