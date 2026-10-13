import contextlib
import io
import json
import unittest
import subprocess
import sys
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch, mock_open
import native_review_observe as cli
from test_native_review_observation import fixture
from test_native_review_transport import Opener


class EntrypointTests(unittest.TestCase):
    def test_isolated_startup_without_B_creates_no_bytecode(self):
        source = Path(cli.__file__).resolve().parent
        with tempfile.TemporaryDirectory() as directory:
            staged = Path(directory)
            for name in ('native_review_observe.py', 'native_review_observation.py',
                         'native_review_transport.py', 'review_handoff.py', 'collector.py'):
                shutil.copyfile(source / name, staged / name)
            result = subprocess.run([sys.executable, '-I', str(staged / 'native_review_observe.py')],
                                    capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)['reason'], 'OBSERVATION_NOT_COMPLETED')
            self.assertEqual(result.stderr, '')
            self.assertEqual(list(staged.rglob('__pycache__')), [])
            self.assertEqual(list(staged.rglob('*.pyc')), [])

    def test_actual_isolated_startup_and_missing_opt_in(self):
        script = str(Path(cli.__file__).resolve())
        for flags, reason in ((['-I', '-B'], 'OBSERVATION_NOT_COMPLETED'),
                              (['-B'], 'ISOLATED_LAUNCH_REQUIRED')):
            result = subprocess.run([sys.executable, *flags, script],
                                    capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)['reason'], reason)
            self.assertEqual(result.stderr, '')

    def run_cli(self, raw, args=None, token='TEST-TOKEN', rows=None):
        output = io.StringIO()
        with patch('builtins.open', mock_open(read_data=raw)), \
             patch.dict('os.environ', {} if token is None else {'GH_TOKEN': token}, clear=True), \
             patch('collector.urllib.request.build_opener', return_value=Opener(rows or {})) as factory, \
             contextlib.redirect_stdout(output):
            code = cli.main(['--allow-read-only-network', 'pins.json'] if args is None else args)
        return code, json.loads(output.getvalue()), factory

    def test_complete_composition_is_incomplete_nonzero(self):
        expected, api = fixture()
        code, result, factory = self.run_cli(json.dumps(expected).encode(), rows=api.rows)
        self.assertEqual(code, 2)
        self.assertEqual(result['status'], 'OBSERVED_APPROVAL_INCOMPLETE')
        self.assertIs(result['mergeAllowed'], False)
        self.assertEqual(len(factory.return_value.calls), 9)
        self.assertNotIn('TEST-TOKEN', json.dumps(result))

    def test_no_opt_in_or_extra_arguments_never_construct_transport(self):
        for args in ([], ['pins.json'], ['--allow-read-only-network'],
                     ['--allow-read-only-network', 'pins.json', 'extra']):
            code, result, factory = self.run_cli(b'{}', args=args)
            self.assertEqual(code, 1)
            self.assertEqual(result['status'], 'BLOCKED')
            factory.assert_not_called()

    def test_full_schema_invalid_never_constructs_transport(self):
        expected, _ = fixture()
        expected['scope']['ci']['workflowId'] = 1
        for raw in (b'x' * 16385, b'{"scope":{},"scope":{}}',
                    json.dumps(expected).encode(), b'{}', b'NaN'):
            code, _, factory = self.run_cli(raw)
            self.assertEqual(code, 1)
            factory.assert_not_called()

    def test_missing_token_never_constructs_opener(self):
        expected, _ = fixture()
        code, _, factory = self.run_cli(json.dumps(expected).encode(), token=None)
        self.assertEqual(code, 1)
        factory.assert_not_called()

    def test_missing_file_redacted(self):
        output = io.StringIO()
        with patch('builtins.open', side_effect=OSError('SECRET PATH')), \
             patch('native_review_observe.NativeReviewGitHub') as factory, \
             contextlib.redirect_stdout(output):
            code = cli.main(['--allow-read-only-network', 'SECRET'])
        self.assertEqual(code, 1)
        self.assertNotIn('SECRET', output.getvalue())
        factory.assert_not_called()

    def test_transport_failure_and_dismissed_review_redacted(self):
        expected, api = fixture()
        for row in (RuntimeError('SECRET RESPONSE'), {**api.rows['pulls/702/reviews/99'], 'state': 'DISMISSED'}):
            code, result, _ = self.run_cli(json.dumps(expected).encode(),
                rows={**api.rows, 'pulls/702/reviews/99': row})
            self.assertEqual(code, 1)
            self.assertEqual(result['status'], 'BLOCKED')
            self.assertNotIn('SECRET', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
