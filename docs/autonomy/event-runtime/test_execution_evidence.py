"""Actual local execution -> v2 contract; synthetic Git is not remote provenance."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import check_executor as executor
import check_journal as journal
import durable_check


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
            root = Path(directory) / 'checkout'
            root.mkdir()
            database = Path(directory) / 'checks.sqlite'
            journal.initialize(database)
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
            execution = durable_check.run_check_once(database, root, scope)
            self.assertEqual(execution['state'], 'COMPLETE')
            self.assertTrue(execution['persistConfirmed'])
            recovered = durable_check.recover_completed_check(database, scope)
            self.assertEqual(recovered, execution)
            receipt = recovered['receipt']
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
            binder_spec = importlib.util.spec_from_file_location('execution_binder', source / 'review-binding/scripts/review-evidence-envelope-binding.py')
            binder = importlib.util.module_from_spec(binder_spec); binder_spec.loader.exec_module(binder)
            actor = {'id':209825114,'login':'claude[bot]','type':'Bot'}
            stamp = '2026-10-11T20:00:00Z'
            def bind_body(raw, expected_scope):
                observed = {'repository':scope['repository'],'issueNumber':571,'eventAction':'created','comment':{'id':789,'user':actor,'created_at':stamp,'updated_at':stamp,'body':raw}}
                expected = {'scope':expected_scope,'actor':actor,'version':{'commentId':789,'createdAt':stamp,'updatedAt':stamp,'bodySha256':hashlib.sha256(raw.encode()).hexdigest()},'issueNumber':571,'reviewerFamily':'claude'}
                return binder.bind_envelope(json.dumps(observed),json.dumps(expected),json.dumps(executor.REQUIRED_POLICY))
            self.assertEqual(bind_body(body, scope)['decision'],'CANDIDATE_REVIEW')
            # Replay the unchanged RECOVERED actual execution check under a new
            # claim/pin while request/head/base/CI all remain identical.
            for changed in ({'opId':'OP-OTHER'},{'prNumber':704}):
                target = {**scope,**changed}; target_claim = {**claim,**changed}
                with self.assertRaisesRegex(ValueError,'CHECK_SCOPE_MISMATCH'):
                    contract.produce_envelope(json.dumps(target_claim),json.dumps(assessment),json.dumps(target),json.dumps(executor.REQUIRED_POLICY))
                forged = json.loads(body);forged['claim']=target_claim
                forged['evidenceSha256']=contract.digest({k:v for k,v in forged.items() if k!='evidenceSha256'})
                rejected=bind_body(contract.canonical(forged),target)
                self.assertEqual(rejected['reason'],'CHECK_SCOPE_MISMATCH');self.assertIsNone(rejected['plannerResponse'])
                self.assertIsNone(rejected['reviewBinding'])
            for mutation in ({'headSha': 'f' * 40}, {'status': 'failed', 'exitCode': 1}):
                altered = copy.deepcopy(assessment)
                altered['checks'][0].update(mutation)
                with self.assertRaises(ValueError):
                    produce(altered)


if __name__ == '__main__':
    unittest.main()
