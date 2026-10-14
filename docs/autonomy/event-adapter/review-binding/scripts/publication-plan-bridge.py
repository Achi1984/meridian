"""Bounded stdin bridge to the actual negative publication validator. No tokens."""
import importlib.util
import json
import pathlib
import sys

spec = importlib.util.spec_from_file_location('protocol', pathlib.Path(__file__).with_name('actions-publication-protocol.py'))
protocol = importlib.util.module_from_spec(spec)
spec.loader.exec_module(protocol)

def main():
    try:
        raw = sys.stdin.buffer.read(65537)
        if len(raw) > 65536:
            raise ValueError('bound')
        request = protocol.contract.decode(raw.decode('utf-8'), 65536)
        protocol.contract.shape(request, ('body', 'scopeRaw', 'policyRaw', 'pinsRaw'))
        plan = protocol.build_plan(request['body'], request['scopeRaw'], request['policyRaw'], request['pinsRaw'])
        out = json.dumps(plan, separators=(',', ':'), ensure_ascii=True)
        if len(out.encode()) > 32768:
            raise ValueError('bound')
        sys.stdout.write(out)
        return 0
    except Exception:
        # No raw payload, token, credential or child diagnostic on failure.
        sys.stderr.write('PUBLICATION_PLAN_REJECTED\n')
        return 1

if __name__ == '__main__':
    sys.exit(main())
