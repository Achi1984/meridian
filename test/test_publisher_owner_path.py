"""Only synthetic roots are opened; the real owner target is never inspected."""
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import publisher_owner_path as m
import publisher_marker_recovery as recovery


class OwnerPathTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='meridian-path-test-')
        self.root = Path(self.temp.name)
        self.ancestor = self.root / 'home'
        self.home = self.ancestor / 'owner'
        self.directory = self.home / m.DIRECTORY
        self.directory.mkdir(parents=True)
        for directory in (self.root, self.ancestor, self.home, self.directory):
            directory.chmod(0o700)
        self.marker = self.directory / recovery.MARKER
        self.marker.write_bytes(recovery.CONTENT)
        self.marker.chmod(0o600)
        self.opened = []
        original = os.open
        def fixture_open(path, flags, *args, **kwargs):
            self.assertFalse(flags & (os.O_CREAT | os.O_TRUNC | os.O_WRONLY | os.O_RDWR))
            fd = original(self.root if path == '/' else path, flags, *args, **kwargs)
            self.opened.append(fd)
            return fd
        self.patches = [patch.object(m.os, 'open', side_effect=fixture_open),
                        patch.object(m.pwd, 'getpwuid', return_value=SimpleNamespace(
                            pw_uid=os.getuid(), pw_dir='/home/owner'))]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        for fd in self.opened:
            with self.assertRaises(OSError):
                os.fstat(fd)
        self.temp.cleanup()

    def test_success_matches_primitive_and_ignores_home_environment(self):
        with patch.dict(os.environ, {'HOME': '/attacker'}):
            result = m.inspect_owner_marker()
        self.assertEqual(result, recovery._identity(self.marker.stat()))
        self.assertEqual(self.marker.read_bytes(), recovery.CONTENT)
        self.assertEqual(list(self.directory.iterdir()), [self.marker])

    def test_no_target_override(self):
        with self.assertRaises(TypeError):
            m.inspect_owner_marker('/another/path')

    def test_noncanonical_home(self):
        for home in ('/', 'relative', '//home/owner', '/home/../owner',
                     '/home/./owner', '/home/owner/', '/home/owner\0'):
            with self.subTest(home=home), patch.object(m.pwd, 'getpwuid', return_value=SimpleNamespace(pw_uid=os.getuid(), pw_dir=home)):
                with self.assertRaises(ValueError):
                    m.inspect_owner_marker()
        self.assertEqual(self.opened, [])

    def test_effective_identity_mismatch(self):
        with patch.object(m.os, 'geteuid', return_value=os.getuid()+1):
            with self.assertRaises(ValueError):
                m.inspect_owner_marker()
        self.assertEqual(self.opened, [])

    def test_passwd_identity_mismatch(self):
        with patch.object(m.pwd, 'getpwuid', return_value=SimpleNamespace(pw_uid=os.getuid()+1, pw_dir='/home/owner')):
            with self.assertRaises(ValueError):
                m.inspect_owner_marker()

    def test_symlink_ancestor_home_and_final(self):
        for path in (self.ancestor, self.home, self.directory):
            with self.subTest(path=path):
                saved = path.with_name(path.name + '-saved')
                path.rename(saved)
                path.symlink_to(saved, target_is_directory=True)
                with self.assertRaises(OSError):
                    m.inspect_owner_marker()
                path.unlink()
                saved.rename(path)

    def test_unsafe_ancestor(self):
        for mode in (0o777, 0o1777, 0o775):
            self.ancestor.chmod(mode)
            with self.assertRaises(ValueError):
                m.inspect_owner_marker()

    def test_private_directory_modes(self):
        for path, mode in ((self.home, 0o775), (self.directory, 0o755)):
            path.chmod(mode)
            with self.assertRaises(ValueError):
                m.inspect_owner_marker()
            path.chmod(0o700)

    def test_safe_home_read_and_traverse_permissions(self):
        for mode in (0o700, 0o750, 0o755):
            self.home.chmod(mode)
            self.assertEqual(m.inspect_owner_marker(), recovery._identity(self.marker.stat()))

    def test_missing_path_does_not_create(self):
        self.marker.unlink()
        self.directory.rmdir()
        with self.assertRaises(FileNotFoundError):
            m.inspect_owner_marker()
        self.assertFalse(self.directory.exists())

    def test_marker_symlink(self):
        saved = self.marker.with_name('saved')
        self.marker.rename(saved)
        self.marker.symlink_to(saved)
        with self.assertRaises(OSError):
            m.inspect_owner_marker()

    def test_marker_hardlink(self):
        os.link(self.marker, self.directory / 'hardlink')
        with self.assertRaises(ValueError):
            m.inspect_owner_marker()

    def test_marker_mode_and_content(self):
        self.marker.chmod(0o644)
        with self.assertRaises(ValueError):
            m.inspect_owner_marker()
        self.marker.chmod(0o600)
        self.marker.write_bytes(b'wrong')
        with self.assertRaises(ValueError):
            m.inspect_owner_marker()

    def test_closed_descriptor_failure(self):
        original = m._check_directory
        def closed(fd, *args):
            os.close(fd)
            return original(fd, *args)
        with patch.object(m, '_check_directory', side_effect=closed):
            with self.assertRaises(OSError):
                m.inspect_owner_marker()

    def test_fifo_marker_does_not_block(self):
        self.marker.unlink()
        os.mkfifo(self.marker, 0o600)
        with self.assertRaises(ValueError):
            m.inspect_owner_marker()

    def test_wrong_home_owner(self):
        original = os.fstat
        home_inode = self.home.stat().st_ino
        def foreign(fd):
            info = original(fd)
            if info.st_ino == home_inode:
                return SimpleNamespace(st_mode=info.st_mode, st_uid=os.getuid()+1,
                                       st_dev=info.st_dev, st_ino=info.st_ino)
            return info
        with patch.object(m.os, 'fstat', side_effect=foreign):
            with self.assertRaises(ValueError):
                m.inspect_owner_marker()

    def test_ancestor_replacement_detected(self):
        original = m.inspect_marker
        def swapped(fd):
            value = original(fd)
            self.ancestor.rename(self.root / 'old-home')
            self.ancestor.mkdir(mode=0o700)
            return value
        with patch.object(m, 'inspect_marker', side_effect=swapped):
            with self.assertRaises(ValueError):
                m.inspect_owner_marker()

    def test_signal_closes_acquired_descriptors(self):
        with patch.object(m, 'inspect_marker', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                m.inspect_owner_marker()

    def test_directory_replacement_detected(self):
        original = m.inspect_marker
        def swapped(fd):
            value = original(fd)
            self.directory.rename(self.home / 'old-directory')
            self.directory.mkdir(mode=0o700)
            return value
        with patch.object(m, 'inspect_marker', side_effect=swapped):
            with self.assertRaises(ValueError):
                m.inspect_owner_marker()

    def test_marker_changed_between_inspections(self):
        with patch.object(m, 'inspect_marker', side_effect=[{'st_ino': 1}, {'st_ino': 2}]):
            with self.assertRaises(ValueError):
                m.inspect_owner_marker()

    def test_close_error_is_not_success_and_other_descriptors_close(self):
        original = os.close
        once = False
        directory_inode = self.directory.stat().st_ino
        def fail_once(fd):
            nonlocal once
            is_directory = os.fstat(fd).st_ino == directory_inode
            original(fd)
            if is_directory and not once:
                once = True
                raise OSError('injected close error')
        with patch.object(m.os, 'close', side_effect=fail_once):
            with self.assertRaises(OSError):
                m.inspect_owner_marker()


if __name__ == '__main__':
    unittest.main()
