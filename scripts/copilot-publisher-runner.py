"""Trusted publisher entry point. Import is inert; no active packet is configured here."""
import base64
import importlib.util
import os
import json
import re
import time
import pathlib
import sys


PINS = {
    'app_id': 5272026,
    'app_slug': 'meridian-draft-publisher',
    'bot_login': 'meridian-draft-publisher[bot]',
    'installation_id': 170212503,
    'account_id': 319562141,
    'account_login': 'Achi1984',
    'repository_id': 1342084551,
    'repository_full_name': 'Achi1984/meridian',
}


def private_key():
    """Consume the step-scoped secret before any child process can inherit it."""
    value = os.environ.pop('MERIDIAN_PUBLISHER_APP_PRIVATE_KEY', None)
    if type(value) is not str or not 32 <= len(value) <= 32768:
        raise ValueError('Invalid publisher key transport')
    raw = value.encode('ascii')
    if any(byte not in (10, 13) and not 32 <= byte <= 126 for byte in raw):
        raise ValueError('Invalid publisher key transport')
    lines = value.splitlines()
    # Assemble the two accepted PEM delimiters without embedding key-like literals.
    headers = tuple('-----' + 'BEGIN ' + label + '-----' for label in ('RSA PRIVATE KEY', 'PRIVATE KEY'))
    if len(lines) < 3 or lines[0] not in headers:
        raise ValueError('Invalid publisher key transport')
    if lines[-1] != lines[0].replace('BEGIN', 'END'):
        raise ValueError('Invalid publisher key transport')
    if any(not line or len(line) > 76 for line in lines[1:-1]):
        raise ValueError('Invalid publisher key transport')
    # Transport validation only; OpenSSL validates the real RSA key when signing.
    if len(base64.b64decode(''.join(lines[1:-1]), validate=True)) < 32:
        raise ValueError('Invalid publisher key transport')
    return raw


def sibling(name):
    path = pathlib.Path(__file__).resolve().with_name(name)
    if path.is_symlink() or not path.is_file():
        raise ValueError('Missing trusted publisher module')
    spec = importlib.util.spec_from_file_location(name.removesuffix('.py'), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Only fixed event names and typed scalar evidence cross this boundary.
EVENTS = {
    'validated': {'control_run':'id', 'control_attempt':'id', 'source_run':'id',
                  'source_attempt':'id', 'source_sha':'sha', 'control_sha':'sha',
                  'claim_sha':'sha', 'branch':'branch', 'artifact_id':'id'},
    'publication_attempted': {}, 'branch_updated': {'output_sha':'sha'},
    'app_verified': {'app_id':'id'}, 'installation_verified': {'installation_id':'id'},
    'mint_attempted': {'mint_requested_at':'time'}, 'mint_response_received': {},
    'scope_verified': {'repository_id':'id', 'expires_at':'time'},
    'post_attempted': {}, 'post_received': {}, 'draft_validated': {'pr_number':'id'},
    'revocation_attempted': {}, 'revocation_confirmed': {},
}


class Receipt:
    def __init__(self):
        self.fields = {'schema_version':1, 'stage':'initial', 'outcome':'stopped'}

    def observe(self, event, **fields):
        schema = EVENTS.get(event)
        if schema is None or set(fields) != set(schema) or self.fields.get(event) is True:
            raise ValueError('Invalid receipt event')
        if self.fields['stage'] != 'initial' and list(EVENTS).index(event) <= list(EVENTS).index(self.fields['stage']):
            raise ValueError('Invalid receipt event')
        for name, value in fields.items():
            kind = schema[name]
            if kind in ('id', 'time'):
                valid = type(value) is int and 0 < value < (100000000000 if kind == 'time' else 9007199254740992)
            elif kind == 'sha':
                valid = type(value) is str and re.fullmatch('[0-9a-f]{40}', value)
            else:
                valid = type(value) is str and len(value) <= 120 and re.fullmatch('pilot/[a-z0-9-]+', value)
            if not valid:
                raise ValueError('Invalid receipt field')
        self.fields.update(fields)
        self.fields[event] = True
        self.fields['stage'] = event

    def emit(self, completed):
        data = dict(self.fields)
        complete = all(data.get(name) is True for name in ('validated', 'publication_attempted', 'branch_updated', 'app_verified', 'installation_verified',
                     'mint_attempted', 'mint_response_received', 'scope_verified', 'post_attempted', 'post_received',
                     'draft_validated', 'revocation_attempted', 'revocation_confirmed'))
        uncertain = any(data.get(name) is True for name in ('publication_attempted', 'mint_attempted', 'post_attempted'))
        data['outcome'] = 'success' if completed and complete else ('reconciliation_required' if uncertain else 'stopped')
        stamp = int(time.time())
        data['completed_at'] = stamp if 0 < stamp < 100000000000 else None
        raw = json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
        line = 'MERIDIAN_PUBLISHER_RECEIPT ' + raw
        if len((line + '\n').encode('utf-8')) > 4096:
            raise ValueError('Receipt exceeds bound')
        print(line, flush=True)
        return data['outcome']


def run(observer=None):
    key = private_key()
    pilot = sibling('copilot-coding-pilot.py')
    broker = sibling('copilot-publisher-broker.py')
    pilot.PUBLISHER_BOT_LOGIN = PINS['bot_login']

    def factory():
        return broker.publisher_token(http=broker.github_http,
                                      sign=broker.rsa_signer(key), pins=dict(PINS), observer=observer)

    # Existing identity, source, claim, artifact and deadline checks precede mint.
    pilot.publish(publisher_factory=factory, observer=observer)


def main():
    receipt = Receipt()
    completed = False
    try:
        if len(sys.argv) != 1:
            os.environ.pop('MERIDIAN_PUBLISHER_APP_PRIVATE_KEY', None)
            raise ValueError('No publisher arguments accepted')
        run(observer=receipt.observe)
        completed = True
        return 0
    except BaseException:
        # Do not expose key, tokens, exception payloads or tracebacks.
        try:
            print('PUBLISHER_STOPPED; reconcile outcome before retry', file=sys.stderr)
        except BaseException:
            pass
        return 1
    finally:
        try:
            outcome = receipt.emit(completed)
            if completed and outcome != 'success':
                return 1
        except BaseException:
            # Log transport may fail too; never turn missing evidence into success.
            return 1


if __name__ == '__main__':
    sys.exit(main())
