"""Manual bounded native review observation; importing this module is inert."""
import json
import os
import sys
if __name__ == '__main__':
    # Isolated Python excludes cwd/PYTHONPATH; load only reviewed sibling modules.
    if not sys.flags.isolated:
        print('{"status":"BLOCKED","reason":"ISOLATED_LAUNCH_REQUIRED"}')
        raise SystemExit(1)
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent))
from native_review_observation import observe_native_review, validate_expected
from native_review_transport import NativeReviewGitHub


def main(argv=None):
    """Explicit network opt-in is not owner approval or review authority."""
    try:
        args = sys.argv[1:] if argv is None else argv
        if len(args) != 2 or args[0] != '--allow-read-only-network':
            raise ValueError('ARGS')
        with open(args[1], 'rb') as stream:
            raw = stream.read(16385)
        expected = validate_expected(raw)
        scope = expected['scope']
        reader = NativeReviewGitHub(os.environ.get('GH_TOKEN'),
            pr_number=scope['prNumber'], run_id=scope['ci']['runId'],
            review_id=expected['review']['id'])
        result = observe_native_review(raw, reader)
        encoded = json.dumps(result, separators=(',', ':'), allow_nan=False)
        if len(encoded.encode('utf-8')) > 4096:
            raise ValueError('OUTPUT')
        print(encoded)
        # A matching receipt is still incomplete, not a successful approval gate.
        return 2 if result['status'] == 'OBSERVED_APPROVAL_INCOMPLETE' else 1
    except Exception:
        print('{"status":"BLOCKED","reason":"OBSERVATION_NOT_COMPLETED"}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
