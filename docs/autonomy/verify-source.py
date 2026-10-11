"""Run the inactive autonomy packages from their actual repository layout.

Manual local verification only. No network, workflow installation or dispatch.
Run: python3 -B docs/autonomy/verify-source.py
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    root = Path(__file__).resolve().parent
    node = shutil.which('node')
    if node is None:
        raise SystemExit('Node is required; verification did not run.')
    suites = []
    for label, folder in (
        ('Pinned composition', root / 'composition-evidence-20261011' / 'test'),
        ('Continuation adapter', root / 'event-adapter' / 'test'),
    ):
        files = sorted(folder.glob('*.test.mjs'))
        if not files:
            raise SystemExit(f'Missing test suite: {label}')
        suites.append((label, [node, '--test', *map(str, files)]))
    for label, folder in (
        ('Review binding and structured producer', root / 'event-adapter' / 'review-binding' / 'test'),
        ('Receiver and comment handoff', root / 'event-receiver'),
    ):
        if not list(folder.glob('test_*.py')):
            raise SystemExit(f'Missing test suite: {label}')
        suites.append((label, [sys.executable, '-B', '-m', 'unittest', 'discover',
                              '-s', str(folder), '-p', 'test_*.py', '-v']))
    # Always verify sibling files, never a development override pointing at a
    # different adapter/binder. Runtime selection still belongs to the caller.
    env = {key: value for key, value in os.environ.items()
           if not key.startswith('MERIDIAN_TEST_')
           and key not in ('PYTHONPATH', 'PYTHONHOME', 'NODE_OPTIONS')}
    for label, command in suites:
        print(f'\nVerifying: {label}', flush=True)
        try:
            result = subprocess.run(command, cwd=root, env=env, timeout=60,
                                    check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise SystemExit(f'Verification failed or timed out: {label}')
        if result.returncode:
            raise SystemExit(result.returncode)
    print('\nAll inactive source suites passed; no live authority established.')


if __name__ == '__main__':
    main()
