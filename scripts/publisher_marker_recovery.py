"""Inactive Linux marker-retirement primitive; no CLI or production caller.

The caller must independently establish current owner approval, an exclusive
window and fresh provider/DB reconciliation. A record or open fd is not proof
of any of those facts. This module never obtains credentials or retries.
"""
import ctypes
import errno
import json
import os
import re
import stat

MARKER = 'publisher-test-attempt'
CONTENT = b'OWNER_RECONCILIATION_REQUIRED_BEFORE_ANOTHER_ATTEMPT\n'
BLOCKED = 'RECOVERY_BLOCKED_NO_MARKER_MOVE'
UNCERTAIN = 'RECOVERY_RECONCILIATION_REQUIRED'
RETIRED = 'RECOVERY_MARKER_ARCHIVED_NO_SETUP_AUTHORIZED'
FIELDS = ('st_dev', 'st_ino', 'st_uid', 'st_mode', 'st_nlink', 'st_size',
          'st_mtime_ns', 'st_ctime_ns')


def _identity(info):
    return {key: getattr(info, key) for key in FIELDS}


def _directory(fd):
    info = os.fstat(fd)
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise ValueError('directory')
    return info


def _marker(fd):
    info = os.fstat(fd)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1
            or info.st_size != len(CONTENT)):
        raise ValueError('marker')
    if os.pread(fd, len(CONTENT) + 1, 0) != CONTENT:
        raise ValueError('content')
    return info


def inspect_marker(directory_fd):
    """Read-only identity for the fixed name; directory fd must be trusted.

    The future wrapper must open the canonical owner directory with no symlink
    traversal. This primitive does not resolve HOME or authorize a target.
    """
    _directory(directory_fd)
    fd = os.open(MARKER, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                 dir_fd=directory_fd)
    try:
        info = _marker(fd)
        if _identity(os.stat(MARKER, dir_fd=directory_fd,
                             follow_symlinks=False)) != _identity(info):
            raise ValueError('changed marker')
        return _identity(info)
    finally:
        os.close(fd)


def _rename_no_replace(source_fd, destination_fd):
    # No rename/copy/unlink fallback: unsupported platforms fail closed.
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, 'renameat2', None)
    if rename is None:
        raise OSError(errno.ENOSYS, 'atomic no-replace unavailable')
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                       ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(source_fd, MARKER.encode(), destination_fd, MARKER.encode(), 1):
        code = ctypes.get_errno()
        raise OSError(code, 'atomic retirement failed')


def _record(value, expected):
    keys = {'operation_id', 'failed_source_sha256', 'reviewed_source_sha256',
            'reconciliation_comment_id', 'approval_comment_id'}
    if type(value) is not dict or set(value) != keys:
        raise ValueError('record schema')
    if type(value['operation_id']) is not str or not re.fullmatch('[a-f0-9]{32}', value['operation_id']):
        raise ValueError('operation identity')
    for key in ('failed_source_sha256', 'reviewed_source_sha256'):
        if type(value[key]) is not str or not re.fullmatch('[a-f0-9]{64}', value[key]):
            raise ValueError('source identity')
    for key in ('reconciliation_comment_id', 'approval_comment_id'):
        if type(value[key]) is not int or not 0 < value[key] < 2**63:
            raise ValueError('evidence identity')
    if type(expected) is not dict or set(expected) != set(FIELDS):
        raise ValueError('marker identity schema')
    if any(type(v) is not int or v < 0 for v in expected.values()):
        raise ValueError('marker identity value')
    # These references retain the caller's record; they are NOT authenticated.
    return json.dumps({'schema': 1, 'record': value, 'marker': expected,
                       'authority': 'CALLER_REFERENCES_NOT_AUTHENTICATED',
                       'setupAuthorized': False}, sort_keys=True).encode() + b'\n'


def retire_marker(directory_fd, expected, record):
    """One attempt, for a future reviewed caller; tests use temporary fixtures.

    Keeps the old inode and evidence in recovery-<operation_id>. Any failure
    after archive creation requires inspection; never infer retry permission.
    Same-UID malicious/concurrent writers are outside the exclusivity contract.
    """
    marker_fd = archive_fd = evidence_fd = None
    archive_created = False
    rename_attempted = False
    try:
        encoded = _record(record, expected)
        directory = _directory(directory_fd)
        marker_fd = os.open(MARKER, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                            dir_fd=directory_fd)
        if _identity(_marker(marker_fd)) != expected:
            raise ValueError('stale identity')
        if inspect_marker(directory_fd) != expected:
            raise ValueError('changed name')
        os.fsync(marker_fd)
        archive_name = 'recovery-' + record['operation_id']
        # A signal may arrive after mkdir's side effect but before it returns.
        # Mark the attempt first: uncertainty must never imply safe retry.
        archive_created = True
        os.mkdir(archive_name, mode=0o700, dir_fd=directory_fd)
        archive_fd = os.open(archive_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                             dir_fd=directory_fd)
        archive = _directory(archive_fd)
        if archive.st_dev != directory.st_dev:
            raise ValueError('different filesystem')
        evidence_fd = os.open('evidence.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                              0o600, dir_fd=archive_fd)
        offset = 0
        while offset < len(encoded):
            written = os.write(evidence_fd, encoded[offset:])
            if written <= 0:
                raise OSError('incomplete evidence')
            offset += written
        os.fsync(evidence_fd)
        os.close(evidence_fd)
        evidence_fd = None
        os.fsync(archive_fd)
        os.fsync(directory_fd)
        if inspect_marker(directory_fd) != expected or _identity(_marker(marker_fd)) != expected:
            raise ValueError('changed before retirement')
        # Ensure the archive pathname still names the directory opened above.
        named = os.stat(archive_name, dir_fd=directory_fd, follow_symlinks=False)
        if (named.st_dev, named.st_ino) != (archive.st_dev, archive.st_ino):
            raise ValueError('archive replaced')
        rename_attempted = True
        _rename_no_replace(directory_fd, archive_fd)
        moved = os.stat(MARKER, dir_fd=archive_fd, follow_symlinks=False)
        held = _marker(marker_fd)
        # rename changes ctime; compare the stable identity and original bytes.
        for key in FIELDS:
            if key != 'st_ctime_ns' and getattr(moved, key) != expected[key]:
                raise ValueError('unexpected moved marker')
        if (moved.st_dev, moved.st_ino) != (held.st_dev, held.st_ino):
            raise ValueError('lost marker identity')
        try:
            os.stat(MARKER, dir_fd=directory_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise ValueError('concurrent new marker')
        os.fsync(archive_fd)
        os.fsync(directory_fd)
        result = RETIRED
    except (Exception, KeyboardInterrupt):
        result = UNCERTAIN if archive_created or rename_attempted else BLOCKED
    finally:
        for fd in (evidence_fd, archive_fd, marker_fd):
            if fd is not None:
                try:
                    os.close(fd)
                except OSError:
                    result = UNCERTAIN
    return result
