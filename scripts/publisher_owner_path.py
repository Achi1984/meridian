"""Inactive canonical owner-marker inspection; no CLI or production caller.

Only passwd supplies the home path. No writes, recovery or setup are performed.
The returned identity is point-in-time evidence, never approval, exclusivity,
provider/DB reconciliation, or protection against a concurrent same-UID writer.
Even reading may update filesystem access timestamps. Unsafe ancestors fail
closed (including a group/world-writable ancestor with the sticky bit).
"""
import os
import pwd
import stat

from publisher_marker_recovery import inspect_marker

DIRECTORY = '.meridian-owner-setup'
FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


def _check_directory(fd, uid, role='ancestor'):
    info = os.fstat(fd)
    mode = stat.S_IMODE(info.st_mode)
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError('not a directory')
    if role == 'setup':
        if info.st_uid != uid or mode != 0o700:
            raise ValueError('owner directory must be owner-only 0700')
    elif (info.st_uid not in ((uid,) if role == 'home' else (0, uid))
          or mode & 0o7022):
        raise ValueError('unsafe ancestor')
    return (info.st_dev, info.st_ino)


def inspect_owner_marker():
    """Return the primitive's marker identity, closing every acquired fd.

    No target-path argument or environment override is accepted. Ancestors must
    be root/owner-owned and not group/world writable; home must be owner-owned
    with no group/world writes and the fixed directory owner-owned 0700.
    Missing paths and uncertain reads raise, never
    create or repair anything. Retained parent descriptors allow a final check
    that each name still identifies its opened directory. This does not remove
    races after the final check or authenticate mount namespace provenance.
    """
    uid = os.getuid()
    if uid != os.geteuid() or os.getgid() != os.getegid():
        raise ValueError('effective identity mismatch')
    account = pwd.getpwuid(uid)
    home = account.pw_dir
    if account.pw_uid != uid:
        raise ValueError('passwd identity mismatch')
    if (type(home) is not str or not home.startswith('/') or '\0' in home
            or any(part in ('', '.', '..') for part in home.split('/')[1:])):
        raise ValueError('noncanonical passwd home')
    parts = home.split('/')[1:] + [DIRECTORY]
    descriptors = []
    links = []
    try:
        root = os.open('/', FLAGS)
        descriptors.append(root)
        _check_directory(root, uid)
        parent = root
        for index, part in enumerate(parts):
            child = os.open(part, FLAGS, dir_fd=parent)
            descriptors.append(child)
            role = ('setup' if index == len(parts) - 1 else
                    'home' if index == len(parts) - 2 else 'ancestor')
            identity = _check_directory(child, uid, role)
            links.append((parent, part, child, identity, role))
            parent = child
        marker = inspect_marker(parent)
        _check_directory(root, uid)
        for parent, name, child, identity, role in links:
            named = os.stat(name, dir_fd=parent, follow_symlinks=False)
            if (not stat.S_ISDIR(named.st_mode)
                    or (named.st_dev, named.st_ino) != identity
                    or _check_directory(child, uid, role) != identity):
                raise ValueError('directory identity changed')
        if inspect_marker(descriptors[-1]) != marker:
            raise ValueError('marker changed during inspection')
        return marker
    finally:
        # Attempt every close even if one fails; a close error prevents success.
        failure = None
        for fd in reversed(descriptors):
            try:
                os.close(fd)
            except OSError as error:
                failure = error
        if failure is not None:
            raise failure
