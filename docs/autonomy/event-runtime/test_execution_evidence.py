"""Actual local execution -> v2 contract; synthetic Git is not remote provenance."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import check_executor as executor


class ExecutionEvidenceTests(unittest.TestCase):
    def test_actual_receipt_roundtrip_and_failed_or_wrong_head_rejection(self):
        parent = Path(__file__).resolve().parent.parent
        source = parent / 'event-adapter'
        if not source.is_dir():
            source = parent / 'event_bridge'
        spec = importlib.util.spec_from_file_location(
            'execution_contract', source / 'review-binding/scripts/review-evidence-contract.py')
        contract = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(contract)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, text=True,
                                               stderr=subprocess.DEVNULL).strip()
            git('init', '-q')
            git('config', 'user.name', 'Synthetic Integration')
            git('config', 'user.email', 'synthetic@example.invalid')
            shutil.copytree(source, root / 'docs/autonomy/event-adapter',
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.git'))
            git('add', '.')
            git('commit', '-qm', 'Synthetic base')
            base = git('rev-parse', 'HEAD')
            (root / 'fixture.txt').write_text('Synthetic local integration fixture.\n')
            git('add', '.')
            git('commit', '-qm', 'Synthetic head')
            head = git('rev-parse', 'HEAD')
            scope = {'repository': 'Achi1984/meridian', 'requestId': 'REQ-INTEGRATION',
                     'opId': 'OP-INTEGRATION', 'headSha': head, 'baseSha': base,
                     'prNumber': 703, 'ci': {'runId': 1, 'runAttempt': 1,
                                           'workflowId': 2, 'headSha': head}}
            receipt = executor.execute_check(root, scope)
            self.assertTrue(receipt['check']['executed'])
            self.assertEqual(receipt['check']['status'], 'passed')
            self.assertEqual(receipt['exitCode'], 0)
            self.assertEqual(receipt['check']['evidenceSha256'], receipt['evidenceSha256'])
            for flag in executor.FLAGS:
                self.assertIs(receipt[flag], False)
            claim = {'schemaVersion': 1, **scope, 'verdict': 'GREEN_LIGHT',
                     'ci': {**scope['ci'], 'status': 'completed', 'conclusion': 'success'}}
            assessment = {'findings': [], 'checks': [receipt['check']]}
            def produce(value):
                return contract.produce_envelope(json.dumps(claim), json.dumps(value),
                    json.dumps(scope), json.dumps(executor.REQUIRED_POLICY))
            body = produce(assessment)
            result = contract.validate_envelope(body, json.dumps(scope),
                                                json.dumps(executor.REQUIRED_POLICY))
            self.assertEqual(result['assessment'], assessment)
            for flag in contract.FLAGS:
                self.assertIs(result[flag], False)
            for mutation in ({'headSha': 'f' * 40}, {'status': 'failed', 'exitCode': 1}):
                altered = copy.deepcopy(assessment)
                altered['checks'][0].update(mutation)
                with self.assertRaises(ValueError):
                    produce(altered)


if __name__ == '__main__':
    unittest.main()
