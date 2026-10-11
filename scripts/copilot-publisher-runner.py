"""Trusted publisher entry point. Import is inert; no active packet is configured here."""
import base64
import importlib.util
import os
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
    if len(lines) < 3 or lines[0] not in ('-----BEGIN RSA PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----'):
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


def run():
    key = private_key()
    pilot = sibling('copilot-coding-pilot.py')
    broker = sibling('copilot-publisher-broker.py')
    pilot.PUBLISHER_BOT_LOGIN = PINS['bot_login']

    def factory():
        return broker.publisher_token(http=broker.github_http,
                                      sign=broker.rsa_signer(key), pins=dict(PINS))

    # Existing identity, source, claim, artifact and deadline checks precede mint.
    pilot.publish(publisher_factory=factory)


def main():
    try:
        if len(sys.argv) != 1:
            os.environ.pop('MERIDIAN_PUBLISHER_APP_PRIVATE_KEY', None)
            raise ValueError('No publisher arguments accepted')
        run()
        return 0
    except BaseException:
        # Do not expose key, tokens, exception payloads or tracebacks.
        print('PUBLISHER_STOPPED; reconcile outcome before retry', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
