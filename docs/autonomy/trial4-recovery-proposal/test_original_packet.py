"""Bounded offline provenance/tamper checks using the downloaded original artifact."""
import copy
import base64
import importlib.util
import pathlib
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('validator', ROOT / 'validate_original_packet.py')
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
RAW = base64.b64decode((ROOT / 'original-packet.zip.b64').read_text().strip(), validate=True)
HELPER = (ROOT / 'original-pilot.py').read_bytes()


class OriginalPacketTests(unittest.TestCase):
    def test_exact_original_validates_without_publication_authority(self):
        with mock.patch('urllib.request.build_opener', side_effect=AssertionError('network')), \
             mock.patch('subprocess.Popen', side_effect=AssertionError('process')):
            result = v.validate_archive(RAW, HELPER)
        self.assertEqual(result['validation'], 'ORIGINAL_PACKET_VALID')
        self.assertFalse(result['publication_authorized'])
        self.assertFalse(result['live_state_verified'])
        self.assertEqual(len(result['files']), 2)

    def test_changed_digest_or_size_rejected(self):
        for changed in (RAW + b'x', RAW[:-1], RAW[:-1] + bytes([RAW[-1] ^ 1])):
            with self.subTest(size=len(changed)), self.assertRaises(ValueError):
                v.validate_archive(changed, HELPER)

    def test_helper_mismatch_rejected_before_execution(self):
        with mock.patch('builtins.exec', side_effect=AssertionError('executed')):
            with self.assertRaises(ValueError):
                v.load_pinned_helper(HELPER + b'\n')

    def test_provenance_rebindings_and_extra_fields_rejected(self):
        helper = v.load_pinned_helper(HELPER)
        packet = helper.unpack(RAW)
        changes = [('control_attempt', 2), ('control_attempt', True), ('control_run', 1),
                   ('source_attempt', 3), ('source_head', '0' * 40), ('base', '0' * 40),
                   ('packet', 'recovery'), ('repository', 'other/repo'), ('extra', 'not_allowed')]
        for key, value in changes:
            changed = copy.deepcopy(packet)
            changed['evidence'][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                v.validate_packet(changed, helper)

    def test_claim_milestone_and_executable_changes_rejected(self):
        helper = v.load_pinned_helper(HELPER)
        packet = helper.unpack(RAW)
        cases = []
        changed = copy.deepcopy(packet); changed['claim'] = '0' * 40; cases.append(changed)
        changed = copy.deepcopy(packet); changed['evidence']['milestones'][0]['merged_at'] = 'wrong'; cases.append(changed)
        changed = copy.deepcopy(packet); changed['files'][helper.PATHS[1]] += '\n//changed'; cases.append(changed)
        changed = copy.deepcopy(packet); changed['files']['extra.py'] = 'print(1)'; cases.append(changed)
        changed = copy.deepcopy(packet); changed['files'][helper.PATHS[0]] = 'Missing ledger evidence'; cases.append(changed)
        for changed in cases:
            with self.assertRaises(ValueError):
                v.validate_packet(changed, helper)

    def test_expiry_never_extended_and_still_no_authority(self):
        with mock.patch.object(v.time, 'time', return_value=v.DEADLINE + 1):
            result = v.validate_archive(RAW, HELPER)
        self.assertEqual(result['original_window'], 'expired')
        self.assertEqual(result['original_deadline'], 1791730800)
        self.assertFalse(result['publication_authorized'])


if __name__ == '__main__':
    unittest.main()
