"""Read-only Trial4 provenance validator. Never authorizes or executes publication."""
import argparse
import hashlib
import json
import os
import pathlib
import stat
import time
import types

HELPER_SHA256 = '4786e18ec611a22a9c6cebb476cb6910d7f5812c7240c64432b50916e05b16df'
SOURCE_COMMIT = 'a34163015220d688c14cba044713ddc9684cab44'
ARTIFACT_ID = 11705462075
ARCHIVE_SHA256 = '1331957db426ec31a4c478144bd60e84708ede0090aae160b4ea2b04351f7dd8'
ARCHIVE_BYTES = 1208
CLAIM_SHA = '4e404f06e4c89786775e261397e0b941c5c5d4b3'
DEADLINE = 1791730800
EXPECTED_EVIDENCE = {
    'base': '294ee068149f2faeae287c633d7ec2f19259802d',
    'control_attempt': 1, 'control_run': 38147058996,
    'packet': 'version-history-ledger-20261011-t4', 'repository': 'Achi1984/meridian',
    'source_attempt': 2, 'source_head': '99eff9111d4ca42d8d89cd88ee5b2831c36282bb',
    'source_run': 38141528699,
    'milestones': [
        {'commit_url': 'https://github.com/Achi1984/meridian/commit/0c0c1dadfb183f520bbb846d5cf9e6d2e7a925b2',
         'merge_sha': '0c0c1dadfb183f520bbb846d5cf9e6d2e7a925b2', 'merged_at': '2026-10-10T17:02:53Z',
         'pr': 646, 'pr_url': 'https://github.com/Achi1984/meridian/pull/646'},
        {'commit_url': 'https://github.com/Achi1984/meridian/commit/56cb8cf80472fee2e300a79366e491731bdfccf6',
         'merge_sha': '56cb8cf80472fee2e300a79366e491731bdfccf6', 'merged_at': '2026-10-10T17:09:56Z',
         'pr': 651, 'pr_url': 'https://github.com/Achi1984/meridian/pull/651'}],
}


def require(value, reason):
    if not value:
        raise ValueError(reason)


def read_bounded(path, limit):
    path = pathlib.Path(path)
    require(not path.is_symlink() and path.is_file(), 'REGULAR_LOCAL_FILE_REQUIRED')
    with path.open('rb') as handle:
        require(stat.S_ISREG(os.fstat(handle.fileno()).st_mode), 'REGULAR_LOCAL_FILE_REQUIRED')
        raw = handle.read(limit + 1)
    require(len(raw) <= limit, 'LOCAL_FILE_TOO_LARGE')
    return raw


def load_pinned_helper(raw):
    require(type(raw) is bytes and hashlib.sha256(raw).hexdigest() == HELPER_SHA256,
            'ORIGINAL_HELPER_HASH_MISMATCH')
    # Execute only the exact reviewed, inert-import bytes; never import code from the artifact.
    module = types.ModuleType('verified_original_pilot')
    module.__file__ = '<verified-original-pilot>'
    exec(compile(raw, module.__file__, 'exec'), module.__dict__)
    return module


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def validate_packet(packet, helper):
    require(type(packet) is dict and set(packet) == {'evidence', 'claim', 'files'}, 'PACKET_SCHEMA_MISMATCH')
    require(type(packet['claim']) is str and packet['claim'] == CLAIM_SHA, 'CLAIM_CHANGED')
    # Canonical JSON distinguishes bool from int, unlike Python dictionary equality.
    require(canonical(packet['evidence']) == canonical(EXPECTED_EVIDENCE), 'ORIGINAL_PROVENANCE_CHANGED')
    files = helper.validate_files(packet['files'])
    helper.validate_ledger(files[helper.PATHS[0]], EXPECTED_EVIDENCE)
    return files


def validate_archive(raw, helper_raw):
    require(type(raw) is bytes and len(raw) == ARCHIVE_BYTES, 'ORIGINAL_ARCHIVE_SIZE_MISMATCH')
    require(hashlib.sha256(raw).hexdigest() == ARCHIVE_SHA256, 'ORIGINAL_ARCHIVE_DIGEST_MISMATCH')
    helper = load_pinned_helper(helper_raw)
    packet = helper.unpack(raw)
    files = validate_packet(packet, helper)
    return {
        'validation': 'ORIGINAL_PACKET_VALID', 'mode': 'offline_read_only',
        'artifact_id': ARTIFACT_ID, 'archive_sha256': ARCHIVE_SHA256,
        'source_commit': SOURCE_COMMIT, 'helper_sha256': HELPER_SHA256,
        'claim_sha': CLAIM_SHA, 'original_control_run': EXPECTED_EVIDENCE['control_run'],
        'original_control_attempt': 1, 'original_base': EXPECTED_EVIDENCE['base'],
        'original_deadline': DEADLINE,
        'original_window': 'expired' if time.time() >= DEADLINE else 'not_yet_expired',
        'files': [{'path': path, 'bytes': len(text.encode()), 'sha256': hashlib.sha256(text.encode()).hexdigest()}
                  for path, text in sorted(files.items())],
        'publication_authorized': False, 'live_state_verified': False,
        'recovery_claim_created': False, 'model_calls': 0,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=pathlib.Path)
    parser.add_argument('--helper', type=pathlib.Path, default=pathlib.Path(__file__).with_name('original-pilot.py'))
    args = parser.parse_args()
    try:
        report = validate_archive(read_bounded(args.archive, 131072), read_bounded(args.helper, 262144))
    except Exception:
        print(json.dumps({'validation': 'REJECTED', 'publication_authorized': False}))
        return 1
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
