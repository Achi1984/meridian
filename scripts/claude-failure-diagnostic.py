"""Failure-only diagnostic: bounded local SDK JSON -> constant labels, never text.

No model/network calls. Marker classification is not provider authentication or
root-cause proof. Import is inert. Workflow wiring is intentionally separate.
"""
import json
import os
import stat
import sys

MAX_BYTES = 2 * 1024 * 1024
MAX_RECORDS = 4096
MAX_DEPTH = 24
NAME = 'claude-execution-output.json'
CODES = {
    'authentication_failed': 'authentication_marker',
    'authentication_error': 'authentication_marker',
    'rate_limit': 'rate_limit_marker',
    'rate_limit_error': 'rate_limit_marker',
    'billing_error': 'billing_marker',
    'invalid_request': 'invalid_request_marker',
    'invalid_request_error': 'invalid_request_marker',
    'server_error': 'provider_error_marker',
    'api_error': 'provider_error_marker',
    'overloaded_error': 'provider_error_marker',
}
SUBTYPES = {'error_max_turns': 'turn_limit_marker',
            'error_max_budget_usd': 'sdk_budget_marker',
            'error_during_execution': 'execution_error_marker',
            'error_max_structured_output_retries': 'structured_output_marker'}


def report(status, classification='unclassified'):
    return {'schema': 1, 'diagnostic': status, 'classification': classification,
            'rootCauseProven': False, 'reviewVerdictAvailable': False}


def unique(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError('duplicate')
        result[key] = value
    return result


def classify(raw):
    if type(raw) is not bytes or len(raw) > MAX_BYTES:
        return report('input_rejected')
    try:
        records = json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
                             parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        if type(records) is not list or len(records) > MAX_RECORDS:
            return report('input_rejected')
        pending = [(records, 0)]
        while pending:
            value, depth = pending.pop()
            if depth > MAX_DEPTH:
                return report('input_rejected')
            if type(value) is dict:
                pending.extend((v, depth + 1) for v in value.values())
            elif type(value) is list:
                pending.extend((v, depth + 1) for v in value)
        if not all(type(x) is dict for x in records):
            return report('input_rejected')
        results = [x for x in records if x.get('type') == 'result']
        if len(results) != 1 or not records or records[-1] is not results[0]:
            return report('missing_or_ambiguous_result')
        final = results[0]
        if final.get('is_error') is not True:
            return report('no_explicit_sdk_error')
        categories = set()
        subtype = final.get('subtype')
        if type(subtype) is str and subtype in SUBTYPES:
            categories.add(SUBTYPES[subtype])
        # Examine only structured SDK error markers, never messages, result prose,
        # tool output, errors[] prose, prompts, paths, usage or environment.
        for item in records:
            if item.get('type') == 'assistant':
                code = item.get('error')
                if type(code) is str and code in CODES:
                    categories.add(CODES[code])
        category = next(iter(categories)) if len(categories) == 1 else (
            'multiple_markers' if categories else 'unclassified')
        return report('sdk_error', category)
    except (ValueError, UnicodeError, RecursionError, TypeError, OverflowError):
        return report('input_rejected')


def inspect(runner_temp):
    directory = descriptor = None
    try:
        # Fixed leaf name; reject symlink directory/leaf and non-regular inputs.
        directory = os.open(runner_temp, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        descriptor = os.open(NAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                             dir_fd=directory)
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_BYTES:
            return report('input_rejected')
        chunks, size = [], 0
        while size <= MAX_BYTES:
            chunk = os.read(descriptor, min(65536, MAX_BYTES + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        return classify(b''.join(chunks))
    except FileNotFoundError:
        return report('execution_file_missing')
    except (OSError, ValueError, TypeError):
        return report('execution_file_unavailable')
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if directory is not None:
            os.close(directory)


if __name__ == '__main__':
    outcome = inspect(sys.argv[1]) if len(sys.argv) == 2 else report('input_rejected')
    print(json.dumps(outcome, separators=(',', ':')))
