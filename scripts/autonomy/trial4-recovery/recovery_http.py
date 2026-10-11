"""Fixed GitHub adapter: no redirects/retries, scoped credential boundary, bounded reads."""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

DEADLINE = 1791741600
ROOT = 'https://api.github.com/repos/Achi1984/meridian/'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('DUPLICATE_JSON_FIELD')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('INVALID_JSON_NUMBER')))


def deadline():
    if time.time() >= DEADLINE:
        raise ValueError('RECOVERY_EXPIRED')


def response_bytes(response, limit):
    data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('RESPONSE_BOUND')
    return data


class GitHub:
    def __init__(self, job_token, core):
        if type(job_token) is not str or not job_token or any(c.isspace() for c in job_token):
            raise ValueError('JOB_CREDENTIAL_REQUIRED')
        self._job_token = job_token
        self.core = core

    def __call__(self, path, method='GET', payload=None, expected=200, *, publisher_token=None):
        deadline()
        if type(path) is not str or path.startswith('/') or '..' in path or '#' in path or '\\' in path:
            raise ValueError('INVALID_REPOSITORY_PATH')
        if not re.fullmatch(r'[A-Za-z0-9_./:?=&%+-]+', path):
            raise ValueError('INVALID_REPOSITORY_PATH')
        if publisher_token is not None:
            if not (path == 'pulls' and method == 'POST' and expected == 201 and payload == self.core.draft_payload()
                    and type(publisher_token) is str and publisher_token.startswith('ghs_')
                    and publisher_token != self._job_token and 4 < len(publisher_token) <= 4096
                    and not any(c.isspace() for c in publisher_token)):
                raise ValueError('PUBLISHER_CREDENTIAL_BOUNDARY')
            credential = publisher_token
        else:
            credential = self._job_token
            if path == 'pulls' and method != 'GET':
                raise ValueError('APP_CREDENTIAL_REQUIRED')
            allowed = (method == 'GET' or (method == 'POST' and path in {'git/commits', 'git/trees', 'git/refs'})
                       or (method == 'PATCH' and path == 'git/refs/heads/' + self.core.BRANCH))
            if not allowed:
                raise ValueError('ORDINARY_MUTATION_BOUNDARY')
            if path == 'git/refs' and method == 'POST' and payload.get('ref') != 'refs/heads/' + self.core.BRANCH:
                raise ValueError('CLAIM_BRANCH_BOUNDARY')
            if method == 'PATCH' and payload.get('force') is not False:
                raise ValueError('FORCE_FORBIDDEN')
        request = urllib.request.Request(ROOT + path, method=method,
            data=None if payload is None else json.dumps(payload, separators=(',', ':'), allow_nan=False).encode(),
            headers={'Authorization': 'Bearer ' + credential, 'Accept': 'application/vnd.github+json',
                     'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'})
        try:
            deadline()
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
                if response.status != expected:
                    raise ValueError('HTTP_STATUS')
                raw = response_bytes(response, 1048576)
            return strict_json(raw)
        except urllib.error.HTTPError as error:
            raise self.core.ApiFailure(error.code) from None
        except self.core.ApiFailure:
            raise
        except Exception:
            raise ValueError('HTTP_OPERATION_UNCONFIRMED') from None

    def signed_download(self, path, limit):
        if path not in {'actions/artifacts/11705462075/zip', 'actions/jobs/114492680461/logs'}:
            raise ValueError('DOWNLOAD_PATH_BOUNDARY')
        deadline()
        request = urllib.request.Request(ROOT + path, headers={'Authorization': 'Bearer ' + self._job_token,
                                        'Accept': 'application/vnd.github+json'})
        try:
            urllib.request.build_opener(NoRedirect()).open(request, timeout=15)
        except urllib.error.HTTPError as response:
            if response.code != 302:
                raise ValueError('DOWNLOAD_REDIRECT_REQUIRED') from None
            target = response.headers.get('Location', '')
        else:
            raise ValueError('DOWNLOAD_REDIRECT_REQUIRED')
        parsed = urllib.parse.urlsplit(target)
        if not (parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password
                and parsed.port in (None, 443) and not parsed.fragment
                and any(parsed.hostname.endswith(suffix) for suffix in ('.blob.core.windows.net', '.githubusercontent.com'))):
            raise ValueError('STORAGE_ORIGIN_REJECTED')
        # Fresh request carries no GitHub/App credentials; further redirects are refused.
        deadline()
        try:
            with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(target), timeout=15) as response:
                if response.status != 200:
                    raise ValueError('STORAGE_STATUS')
                return response_bytes(response, limit)
        except Exception:
            raise ValueError('DOWNLOAD_UNCONFIRMED') from None
