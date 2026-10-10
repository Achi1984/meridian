"""Inert App-token broker; trusted caller must inject signing and HTTPS transport.

No CLI entry point, environment reads, subprocesses, logging or network on import.
Transport contract: (method, absolute_url, credential, payload) -> (status, JSON).
It must use GitHub HTTPS only, refuse redirects, bound responses and never retry.
"""
import base64
import contextlib
import datetime
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

PINS = None  # Reviewed actual installation configuration required; no live defaults.
API = 'https://api.github.com'
ACCOUNT_ID = 319562141
REPOSITORY_ID = 1342084551


class BrokerError(RuntimeError):
    """Only static stage/error text; never API payloads, credentials or signer errors."""


def require(condition):
    if not condition:
        raise BrokerError('Publisher credential validation failed')


def config(pins):
    keys = {'app_id', 'app_slug', 'bot_login', 'installation_id', 'account_id',
            'account_login', 'repository_id', 'repository_full_name'}
    require(type(pins) is dict and set(pins) == keys)
    result = dict(pins)
    for key in ('app_id', 'installation_id', 'account_id', 'repository_id'):
        require(type(result[key]) is int and result[key] > 0)
    require(type(result['app_slug']) is str and re.fullmatch(r'[a-z0-9-]+', result['app_slug']))
    require(result['app_slug'] != 'github-actions')
    require(result['bot_login'] == result['app_slug'] + '[bot]')
    require(result['account_login'] == 'Achi1984' and result['repository_full_name'] == 'Achi1984/meridian')
    require(result['account_id'] == ACCOUNT_ID and result['repository_id'] == REPOSITORY_ID)
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def github_http(method, url, credential, payload):
    """Optional trusted transport; bounded, no redirects/retries, no raw error text."""
    try:
        parsed = urllib.parse.urlsplit(url)
        require(parsed.scheme == 'https' and parsed.netloc == 'api.github.com'
                and not parsed.fragment and method in ('GET', 'POST', 'DELETE'))
        request = urllib.request.Request(url, method=method,
            data=None if payload is None else json.dumps(payload).encode(),
            headers={'Authorization':'Bearer ' + credential, 'Accept':'application/vnd.github+json',
                     'Content-Type':'application/json'})
        try:
            response = urllib.request.build_opener(NoRedirect()).open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error  # Preserve any received mint token for revocation, even on error status.
        with response:
            status = response.status
            raw = response.read(262145)
        require(len(raw) <= 262144 and not 300 <= status < 400)
        if status == 204:
            require(not raw)
            return status, None
        def pairs(items):
            result = {}
            for key, value in items:
                require(key not in result)
                result[key] = value
            return result
        return status, json.loads(raw, object_pairs_hook=pairs,
            parse_constant=lambda _: require(False))
    except BaseException:
        raise BrokerError('GitHub transport failed; outcome unknown, do not retry') from None


def rsa_signer(private_key):
    """Build trusted RS256 signer; key is never passed via argv or environment."""
    require(type(private_key) is bytes and 32 <= len(private_key) <= 32768)
    def sign(message):
        try:
            require(type(message) is bytes and 0 < len(message) <= 16384)
            with tempfile.TemporaryDirectory(prefix='meridian-app-key-') as folder:
                path = os.path.join(folder, 'key.pem')
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'wb') as output:
                    output.write(private_key)
                result = subprocess.run(['/usr/bin/openssl', 'dgst', '-sha256', '-sign', path],
                    input=message, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15,
                    check=False, shell=False, env={'PATH':'/usr/bin:/bin', 'LANG':'C'})
                require(result.returncode == 0 and 256 <= len(result.stdout) <= 1024)
                return result.stdout
        except BaseException:
            raise BrokerError('App signing failed') from None
    return sign


def permissions(value):
    require(type(value) is dict and value.get('pull_requests') == 'write'
            and set(value) <= {'pull_requests', 'metadata'}
            and ('metadata' not in value or value['metadata'] == 'read'))


def account(value, pins):
    require(type(value) is dict and value.get('id') == pins['account_id']
            and type(value.get('id')) is int and value.get('login') == pins['account_login']
            and value.get('type') == 'User')


def repository(value, pins):
    require(type(value) is dict and type(value.get('id')) is int and value['id'] == pins['repository_id']
            and value.get('full_name') == pins['repository_full_name'] and value.get('fork') is False)
    account(value.get('owner'), pins)


def installation(value, pins):
    require(type(value) is dict and type(value.get('id')) is int and value['id'] == pins['installation_id']
            and type(value.get('app_id')) is int and value['app_id'] == pins['app_id']
            and value.get('app_slug') == pins['app_slug'] and value.get('repository_selection') == 'selected'
            and 'suspended_at' in value and value['suspended_at'] is None
            and value.get('target_id') == pins['account_id'] and value.get('target_type') == 'User')
    account(value.get('account'), pins)
    permissions(value.get('permissions'))


def bearer(value):
    # Format is transport hygiene, not proof of identity, scope or lifetime.
    return (type(value) is str and 4 < len(value) <= 16384 and value.startswith('ghs_')
            and all(33 <= ord(char) <= 126 for char in value))


def encoded(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=')


def jwt(pins, sign, now):
    stamp = int(now)
    header = encoded(b'{"alg":"RS256","typ":"JWT"}')
    claims = encoded(json.dumps({'iat':stamp - 60, 'exp':stamp + 300, 'iss':str(pins['app_id'])},
                               separators=(',', ':')).encode())
    message = header + b'.' + claims
    signature = sign(message)  # Trusted RS256 signer; key never enters environment or this module.
    require(type(signature) is bytes and 256 <= len(signature) <= 1024)
    return (message + b'.' + encoded(signature)).decode('ascii')


@contextlib.contextmanager
def publisher_token(*, http, sign, pins=None, clock=time.time):
    """Yield one scoped credential to trusted publisher only; revoke on every exit.

    Unknown mint outcomes stop without retry. If no token was received, revocation
    is impossible and the caller must reconcile before any subsequent attempt.
    GitHub lifetime remains up to one hour; local pilot deadlines do not shorten it.
    """
    token = None
    failure = None
    revoke_failed = False
    stage = 'configuration'
    try:
        approved = config(PINS if pins is None else pins)
        require(callable(http) and callable(sign))
        stage = 'signing'
        started = clock()
        require(type(started) in (float, int) and 0 < started < 100000000000)
        auth = jwt(approved, sign, started)

        def get(path, credential=auth):
            status, result = http('GET', API + path, credential, None)
            require(status == 200 and type(result) is dict)
            return result

        stage = 'App identity'
        app = get('/app')
        require(type(app.get('id')) is int and app['id'] == approved['app_id']
                and app.get('slug') == approved['app_slug'])
        account(app.get('owner'), approved)
        permissions(app.get('permissions'))
        stage = 'installation identity'
        installation(get('/app/installations/' + str(approved['installation_id'])), approved)
        # App JWT verifies this exact repository is installed before any mint.
        installation(get('/repos/' + approved['repository_full_name'] + '/installation'), approved)
        stage = 'mint outcome unknown'
        status, minted = http('POST', API + '/app/installations/' + str(approved['installation_id']) + '/access_tokens',
                              auth, {'repository_ids':[approved['repository_id']], 'permissions':{'pull_requests':'write'}})
        # Retain a usable token before validating any other response field/status.
        if type(minted) is dict and bearer(minted.get('token')):
            token = minted['token']
        stage = 'mint response validation'
        require(status == 201 and token is not None)
        require(minted.get('repository_selection') == 'selected')
        permissions(minted.get('permissions'))
        repos = minted.get('repositories')
        require(type(repos) is list and len(repos) == 1)
        repository(repos[0], approved)
        expires = minted.get('expires_at')
        require(type(expires) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', expires))
        expiry = datetime.datetime.strptime(expires, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc).timestamp()
        current = clock()
        require(started <= current < started + 300 and 30 < expiry - current <= 3600)
        stage = 'token repository restriction'
        listing = get('/installation/repositories?per_page=100', token)
        require(type(listing.get('total_count')) is int and listing['total_count'] == 1
                and type(listing.get('repositories')) is list and len(listing['repositories']) == 1)
        repository(listing['repositories'][0], approved)
        require(0 < expiry - clock() <= 3600)
        stage = 'trusted publisher'
        yield token
    except BaseException:
        failure = stage
    finally:
        if token is not None:
            try:
                status, _ = http('DELETE', API + '/installation/token', token, None)
                require(status == 204)
            except BaseException:
                revoke_failed = True
    if failure is not None or revoke_failed:
        message = ('Publisher broker failed at ' + failure) if failure else 'Publisher broker completed'
        if revoke_failed:
            message += '; token revocation failed, reconciliation required'
        raise BrokerError(message) from None
