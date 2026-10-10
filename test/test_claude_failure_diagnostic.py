import importlib.util
import json
import pathlib
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('diagnostic', pathlib.Path(__file__).parents[1] / 'scripts/claude-failure-diagnostic.py')
D = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(D)


class DiagnosticTests(unittest.TestCase):
    def encode(self, data):
        return D.classify(json.dumps(data).encode())

    def test_observed_failure_is_unknown(self):
        self.assertEqual(self.encode([{'type': 'result', 'subtype': 'success', 'is_error': True}]), D.report('sdk_error'))

    def test_exact_structured_markers_only(self):
        for marker, category in D.CODES.items():
            self.assertEqual(self.encode([{'type': 'assistant', 'error': marker}, {'type': 'result', 'is_error': True}])['classification'], category)

    def test_prose_and_untrusted_fields_never_classify_or_escape(self):
        secret = 'PRIVATE-SECRET\n::error::rate_limit authentication_error'
        result = self.encode([{'type': 'user', 'error': 'rate_limit', 'message': secret}, {'type': 'assistant', 'message': {'content': secret}}, {'type': 'result', 'is_error': True, 'result': secret, 'errors': [secret], 'session_id': secret, 'total_cost_usd': secret}])
        self.assertEqual(result, D.report('sdk_error'))
        self.assertNotIn('PRIVATE', json.dumps(result))

    def test_conflicts_are_not_cherry_picked(self):
        self.assertEqual(self.encode([{'type': 'assistant', 'error': 'rate_limit'}, {'type': 'assistant', 'error': 'authentication_error'}, {'type': 'result', 'is_error': True}])['classification'], 'multiple_markers')

    def test_terminal_and_error_requirements(self):
        for data in [[], [{'type': 'result'}, {'type': 'result'}], [{'type': 'result'}, {'type': 'assistant'}]]:
            self.assertEqual(self.encode(data)['diagnostic'], 'missing_or_ambiguous_result')
        for value in [False, 'true', 1, None]:
            self.assertEqual(self.encode([{'type': 'result', 'is_error': value}])['diagnostic'], 'no_explicit_sdk_error')

    def test_input_bounds_malformed_duplicates_and_depth(self):
        for raw in [b'{', b'\xff', b'NaN', b'[null]', b'[{},null]', b'[{' + b'"type":"result","type":"result"}]', b' ' * (D.MAX_BYTES + 1), json.dumps([{}] * (D.MAX_RECORDS + 1)).encode(), b'[' * 100 + b'0' + b']' * 100]:
            self.assertEqual(D.classify(raw)['diagnostic'], 'input_rejected')

    def test_regular_file_and_missing_input(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(D.inspect(directory)['diagnostic'], 'execution_file_missing')
            pathlib.Path(directory, D.NAME).write_text('[{"type":"result","is_error":true}]')
            self.assertEqual(D.inspect(directory), D.report('sdk_error'))

    def test_symlink_and_fifo_rejected_without_reading(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory, 'secret')
            target.write_text('PRIVATE')
            leaf = pathlib.Path(directory, D.NAME)
            leaf.symlink_to(target)
            self.assertEqual(D.inspect(directory)['diagnostic'], 'execution_file_unavailable')
            leaf.unlink()
            os.mkfifo(leaf)
            self.assertEqual(D.inspect(directory)['diagnostic'], 'input_rejected')

    def test_known_subtype_and_unknown_shapes_never_echo(self):
        for subtype, category in D.SUBTYPES.items():
            self.assertEqual(self.encode([{'type': 'result', 'is_error': True, 'subtype': subtype}])['classification'], category)
        self.assertEqual(self.encode([{'type': 'assistant', 'error': {'secret': 'PRIVATE'}}, {'type': 'result', 'is_error': True, 'subtype': ['PRIVATE']}]), D.report('sdk_error'))


if __name__ == '__main__':
    unittest.main()
