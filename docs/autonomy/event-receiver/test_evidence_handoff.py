"""Synthetic complete-envelope collection through the actual sibling binder."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import unittest

from review_handoff import collect_review
from test_review_handoff import fixture, A


POLICY = {'requiredChecks': [{'id': 'release-tests', 'commandSha256': 'd' * 64}]}


class EvidenceHandoffTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        default = Path(__file__).resolve().parent.parent / 'event-adapter/review-binding/scripts/review-evidence-binding.py'
        path = Path(os.environ.get('MERIDIAN_TEST_BINDER', str(default))).with_name('review-evidence-envelope-binding.py')
        spec = importlib.util.spec_from_file_location('handoff_envelope_binder', path)
        cls.binder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.binder)
        fixtures_path=path.parent.parent/'test'/'test_review_binding.py'
        fixture_spec=importlib.util.spec_from_file_location('handoff_adapter_fixtures',fixtures_path)
        cls.adapter_fixtures=importlib.util.module_from_spec(fixture_spec);fixture_spec.loader.exec_module(cls.adapter_fixtures)

    def candidate(self):
        expected, api = fixture()
        scope = expected['scope']
        claim = api.rows['issues/comments/789']['body']
        assessment = {'findings': [], 'checks': [{
            'id': 'release-tests', 'commandSha256': 'd' * 64,
            'executed': True, 'status': 'passed', 'exitCode': 0,
            'evidenceSha256': 'e' * 64, 'headSha': scope['headSha'],
            'baseSha': scope['baseSha'], 'requestId': scope['requestId'],
            'ci': dict(scope['ci']),
        }]}
        body = self.binder._contract.produce_envelope(
            claim, json.dumps(assessment), json.dumps(scope), json.dumps(POLICY))
        api.rows['issues/comments/789']['body'] = body
        # Initial synthetic version pin. Never update it after changing observation.
        expected['version']['bodySha256'] = hashlib.sha256(body.encode()).hexdigest()
        return expected, api, body

    def test_actual_collector_preserves_full_envelope_version_and_policy(self):
        expected, api, body = self.candidate()
        seen = []
        def bound(observation, pins):
            seen.append(json.loads(observation)['comment']['body'])
            return self.binder.bind_envelope(observation, pins, json.dumps(POLICY))
        result = collect_review(json.dumps(expected), A, 'edited', api, bound)
        self.assertEqual(seen, [body])
        self.assertEqual(result['decision'], 'CANDIDATE_REVIEW')
        self.assertEqual(result['version'], expected['version'])
        self.assertEqual(result['reviewBinding'], {**expected['version'], 'ci': expected['scope']['ci']})
        self.assertEqual(result['plannerResponse']['verdict'], 'GREEN_LIGHT')
        self.assertEqual(api.calls.count('issues/comments/789'), 2)
        self.assertNotIn('assessment', json.dumps(result))
        self.assertNotIn('commandSha256', json.dumps(result))
        for key in ('authenticated', 'provenanceVerified', 'authorized', 'dispatchAllowed', 'mergeAllowed', 'durable'):
            self.assertIs(result[key], False)

    def test_collected_binding_blocks_stale_edit_and_ci_in_actual_adapter(self):
        expected,api,body=self.candidate()
        result=collect_review(json.dumps(expected),A,'edited',api,
            lambda observation,pins:self.binder.bind_envelope(observation,pins,json.dumps(POLICY)))
        observation={'repository':expected['scope']['repository'],'issueNumber':571,'eventAction':'edited',
            'comment':{key:api.rows['issues/comments/789'][key] for key in ('id','user','created_at','updated_at','body')}}
        fresh=self.adapter_fixtures.run_bound_adapter(result,self.adapter_fixtures.adapter_input(observation,expected))
        self.assertEqual(fresh['decision'],'READY_FOR_OWNER_DECISION')
        for changed in self.adapter_fixtures.stale_variants(observation,expected):
            rejected=self.adapter_fixtures.run_bound_adapter(result,changed)
            self.assertNotEqual(rejected['decision'],'READY_FOR_OWNER_DECISION')

    def test_edit_or_independent_policy_mismatch_cannot_produce_candidate(self):
        for edit_body in (True, False):
            with self.subTest(edit_body=edit_body):
                expected, api, body = self.candidate()
                policy = POLICY
                if edit_body:
                    api.rows['issues/comments/789']['body'] = body + ' '
                else:
                    policy = {'requiredChecks': [{'id': 'release-tests', 'commandSha256': 'f' * 64}]}
                result = collect_review(json.dumps(expected), A, 'edited', api,
                    lambda observation, pins: self.binder.bind_envelope(observation, pins, json.dumps(policy)))
                self.assertEqual(result['decision'], 'BLOCKED')
                self.assertIsNone(result['plannerResponse'])


if __name__ == '__main__':
    unittest.main()
