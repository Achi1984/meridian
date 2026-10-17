"""Offline filesystem fault injection; only fresh temporary fixture directories."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).resolve().parents[1] / 'scripts/publisher_marker_recovery.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MarkerRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='meridian-recovery-test-')
        self.root = Path(self.temp.name)
        os.chmod(self.root, 0o700)
        self.path = self.root / m.MARKER
        self.path.write_bytes(m.CONTENT)
        os.chmod(self.path, 0o600)
        self.fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        self.expected = m.inspect_marker(self.fd)
        self.record = {'operation_id': 'a' * 32, 'failed_source_sha256': 'b' * 64,
                       'reviewed_source_sha256': 'c' * 64,
                       'reconciliation_comment_id': 123, 'approval_comment_id': 456}
        self.archive = self.root / ('recovery-' + 'a' * 32)

    def tearDown(self):
        os.close(self.fd)
        self.temp.cleanup()

    def run_recovery(self):
        return m.retire_marker(self.fd, self.expected, self.record)

    def test_success_preserves_inode_content_and_non_authoritative_evidence(self):
        self.assertEqual(self.run_recovery(), m.RETIRED)
        self.assertFalse(self.path.exists())
        saved = self.archive / m.MARKER
        self.assertEqual(saved.stat().st_ino, self.expected['st_ino'])
        self.assertEqual(saved.read_bytes(), m.CONTENT)
        self.assertEqual(self.archive.stat().st_mode & 0o777, 0o700)
        evidence = self.archive / 'evidence.json'
        self.assertEqual(evidence.stat().st_mode & 0o777, 0o600)
        record = json.loads(evidence.read_bytes())
        self.assertEqual(record['marker'], self.expected)
        self.assertFalse(record['setupAuthorized'])
        self.assertEqual(record['authority'], 'CALLER_REFERENCES_NOT_AUTHENTICATED')

    def test_second_invocation_never_recreates_marker_or_overwrites_evidence(self):
        self.assertEqual(self.run_recovery(), m.RETIRED)
        before = (self.archive / 'evidence.json').read_bytes()
        self.assertEqual(self.run_recovery(), m.BLOCKED)
        self.assertEqual((self.archive / 'evidence.json').read_bytes(), before)
        self.assertFalse(self.path.exists())

    def test_archive_collision_preserves_both_records_and_marker(self):
        self.archive.mkdir(mode=0o700)
        (self.archive / 'evidence.json').write_text('existing')
        self.assertEqual(self.run_recovery(), m.UNCERTAIN)
        self.assertEqual((self.archive / 'evidence.json').read_text(), 'existing')
        self.assertEqual(m.inspect_marker(self.fd), self.expected)

    def test_archive_symlink_is_not_followed(self):
        target = self.root / 'other'
        target.mkdir()
        self.archive.symlink_to(target, target_is_directory=True)
        self.assertEqual(self.run_recovery(), m.UNCERTAIN)
        self.assertEqual(list(target.iterdir()), [])
        self.assertTrue(self.path.exists())

    def test_interrupt_after_mkdir_side_effect_requires_reconciliation(self):
        mkdir = os.mkdir

        def interrupted(*args, **kwargs):
            mkdir(*args, **kwargs)
            raise KeyboardInterrupt()

        with patch.object(m.os, 'mkdir', side_effect=interrupted):
            self.assertEqual(self.run_recovery(), m.UNCERTAIN)
        self.assertTrue(self.archive.is_dir())
        self.assertEqual(list(self.archive.iterdir()), [])
        self.assertEqual(m.inspect_marker(self.fd), self.expected)

    def test_marker_symlink_is_not_followed(self):
        target = self.root / 'original'
        self.path.rename(target)
        self.path.symlink_to(target)
        self.assertEqual(self.run_recovery(), m.BLOCKED)
        self.assertEqual(target.read_bytes(), m.CONTENT)
        self.assertFalse(self.archive.exists())

    def test_hardlinked_marker_is_rejected(self):
        os.link(self.path, self.root / 'second-link')
        self.assertEqual(self.run_recovery(), m.BLOCKED)
        self.assertTrue(self.path.exists())

    def test_wrong_mode_and_changed_content_are_rejected(self):
        os.chmod(self.path, 0o644)
        self.assertEqual(self.run_recovery(), m.BLOCKED)
        os.chmod(self.path, 0o600)
        self.path.write_bytes(b'x' * len(m.CONTENT))
        self.assertEqual(self.run_recovery(), m.BLOCKED)
        self.assertFalse(self.archive.exists())

    def test_wrong_directory_mode_is_rejected(self):
        os.chmod(self.root, 0o755)
        self.assertEqual(self.run_recovery(), m.BLOCKED)
        self.assertTrue(self.path.exists())

    def test_stale_expected_identity_is_rejected(self):
        self.expected['st_ino'] += 1
        self.assertEqual(self.run_recovery(), m.BLOCKED)
        self.assertFalse(self.archive.exists())

    def test_record_rejects_path_traversal_unknown_fields_and_boolean_ids(self):
        for key, value in [('operation_id', '../escape'), ('approval_comment_id', True), ('extra', 'SYNTHETIC_PRIVATE_CANARY')]:
            before = dict(self.record)
            self.record[key] = value
            self.assertEqual(self.run_recovery(), m.BLOCKED)
            self.assertFalse(self.archive.exists())
            self.record = before

    def test_partial_writes_are_completed_before_rename(self):
        write = os.write
        with patch.object(m.os, 'write', side_effect=lambda fd, value: write(fd, value[:7])):
            self.assertEqual(self.run_recovery(), m.RETIRED)
        self.assertEqual(json.loads((self.archive / 'evidence.json').read_bytes())['record'], self.record)

    def test_failed_evidence_write_preserves_marker_and_requires_inspection(self):
        with patch.object(m.os, 'write', return_value=0):
            self.assertEqual(self.run_recovery(), m.UNCERTAIN)
        self.assertTrue(self.path.exists())
        self.assertTrue(self.archive.exists())

    def test_fsync_failure_at_every_boundary_never_claims_success(self):
        real = os.fsync
        # marker, evidence, archive, parent, then archive and parent after rename.
        for failure in range(1, 7):
            with self.subTest(failure=failure):
                if failure > 1:
                    self.tearDown()
                    self.setUp()
                calls = 0
                def sync(fd):
                    nonlocal calls
                    calls += 1
                    if calls == failure:
                        raise OSError('SYNTHETIC_PRIVATE_CANARY')
                    return real(fd)
                with patch.object(m.os, 'fsync', side_effect=sync):
                    result = self.run_recovery()
                self.assertEqual(result, m.BLOCKED if failure == 1 else m.UNCERTAIN)
                self.assertTrue(self.path.exists() or (self.archive / m.MARKER).exists())

    def test_rename_failure_has_no_fallback_or_retry(self):
        with patch.object(m, '_rename_no_replace', side_effect=OSError('unsupported')) as rename:
            self.assertEqual(self.run_recovery(), m.UNCERTAIN)
            rename.assert_called_once()
        self.assertTrue(self.path.exists())
        self.assertFalse((self.archive / m.MARKER).exists())

    def test_interrupted_after_atomic_move_preserves_archive_and_reports_uncertainty(self):
        rename = m._rename_no_replace
        def interrupt(source, destination):
            rename(source, destination)
            raise KeyboardInterrupt()
        with patch.object(m, '_rename_no_replace', side_effect=interrupt):
            self.assertEqual(self.run_recovery(), m.UNCERTAIN)
        self.assertFalse(self.path.exists())
        self.assertEqual((self.archive / m.MARKER).read_bytes(), m.CONTENT)

    def test_destination_marker_collision_never_overwrites_existing_inode(self):
        rename = m._rename_no_replace
        def collision(source, destination):
            fd = os.open(m.MARKER, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=destination)
            os.write(fd, b'KEEP')
            os.close(fd)
            rename(source, destination)
        with patch.object(m, '_rename_no_replace', side_effect=collision):
            self.assertEqual(self.run_recovery(), m.UNCERTAIN)
        self.assertEqual((self.archive / m.MARKER).read_bytes(), b'KEEP')
        self.assertEqual(self.path.read_bytes(), m.CONTENT)

    def test_same_uid_swap_is_detected_after_move_not_misreported_as_success(self):
        rename = m._rename_no_replace
        original = self.root / 'preserved-original'
        def swap(source, destination):
            self.path.rename(original)
            self.path.write_bytes(m.CONTENT)
            os.chmod(self.path, 0o600)
            rename(source, destination)
        with patch.object(m, '_rename_no_replace', side_effect=swap):
            self.assertEqual(self.run_recovery(), m.UNCERTAIN)
        self.assertEqual(original.read_bytes(), m.CONTENT)
        self.assertTrue((self.archive / m.MARKER).exists())

    def test_concurrent_new_attempt_is_never_deleted(self):
        rename = m._rename_no_replace
        def replacement(source, destination):
            rename(source, destination)
            self.path.write_bytes(m.CONTENT)
            os.chmod(self.path, 0o600)
        with patch.object(m, '_rename_no_replace', side_effect=replacement):
            self.assertEqual(self.run_recovery(), m.UNCERTAIN)
        self.assertTrue(self.path.exists())
        self.assertTrue((self.archive / m.MARKER).exists())


if __name__ == '__main__':
    unittest.main()
