import copy
import hashlib
import importlib.util
import json
import pathlib
import unittest
import test_review_evidence_contract as fixtures

spec = importlib.util.spec_from_file_location('publisher', pathlib.Path(__file__).resolve().parents[1]
                                            / 'scripts/actions-publication-protocol.py')
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)


class PublicationTests(unittest.TestCase):
    def setUp(self):
        c, a, self.scope, self.policy = fixtures.NegativePublicationTests().candidate()
        self.body = fixtures.produce(c, a, self.scope, self.policy)
        self.pins = {'repositoryId': 1234, 'mailbox': 571,
                     'bodySha256': hashlib.sha256(self.body.encode()).hexdigest(),
                     'scopeSha256': pub.contract.digest(self.scope),
                     'policySha256': pub.contract.digest(pub.contract.policy_checked(json.dumps(self.policy))),
                     'controlSha': 'e'*40, 'workflowPath': pub.WORKFLOW,
                     'workflowId': 5678, 'runId': 9000, 'runAttempt': 1,
                     'event': 'workflow_dispatch', 'ref': 'refs/heads/main',
                     'publisherActorId': 4321, 'ownerApprovalCommentId': 2222,
                     'ownerApprovalBodySha256': 'f'*64}
        self.plan = self.build()
        self.run = {k: self.pins[k] for k in ('repositoryId', 'workflowPath', 'workflowId',
                                              'runId', 'runAttempt', 'event', 'ref')}
        self.run.update(repository=pub.REPOSITORY, headSha=self.pins['controlSha'],
                        status='completed', conclusion='success')
        self.comment = dict(id=5555, repository=pub.REPOSITORY, repositoryId=1234,
                            issueNumber=571, actorId=4321, actorType='Bot', body=self.body,
                            createdAt='2026-10-14T05:00:00Z', updatedAt='2026-10-14T05:00:00Z')
        self.ledger = dict(operationKey=self.plan['operationKey'], intentSha256=self.plan['intentSha256'],
                           runId=9000, runAttempt=1, commentId=5555,
                           bodySha256=self.pins['bodySha256'], status='CONFIRMED')

    def build(self):
        return pub.build_plan(self.body, json.dumps(self.scope), json.dumps(self.policy), json.dumps(self.pins))

    def receipt(self):
        return pub.validate_receipt(self.body, json.dumps(self.scope), json.dumps(self.policy),
                                    json.dumps(self.pins), json.dumps(self.run),
                                    json.dumps(self.comment), json.dumps(self.ledger))

    def test_fixed_destination_original_body_and_no_authority(self):
        self.assertEqual(self.plan['request'], {'method': 'POST', 'url':
                         'https://api.github.com/repos/Achi1984/meridian/issues/571/comments',
                         'json': {'body': self.body}})
        result = self.receipt()
        for flag in pub.FLAGS:
            self.assertIs(result[flag], False)
            self.assertIs(self.plan[flag], False)
        self.assertFalse(result['bindingAllowed'])
        self.assertEqual(result['verdict'], 'REVISION_REQUIRED')

    def test_reject_wrong_pins_including_boolean_ids_and_retry(self):
        original = copy.deepcopy(self.pins)
        for key, value in [('mailbox', 572), ('mailbox', True), ('repositoryId', True),
                           ('runAttempt', 2), ('runAttempt', True), ('workflowId', 0),
                           ('controlSha', 'main'), ('ref', 'refs/pull/770/head'),
                           ('event', 'issue_comment'), ('workflowPath', '.github/workflows/other.yml'),
                           ('bodySha256', 'a'*64), ('scopeSha256', 'a'*64), ('policySha256', 'a'*64)]:
            self.pins = {**original, key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.build()
        self.pins = {**original, 'authorized': True}
        with self.assertRaises(ValueError):
            self.build()

    def test_changed_run_or_payload_cannot_obtain_fresh_operation_key(self):
        original = self.plan
        self.pins['runId'] += 1
        changed = self.build()
        self.assertEqual(original['operationKey'], changed['operationKey'])
        self.assertNotEqual(original['intentSha256'], changed['intentSha256'])
        self.body += '\n'
        self.pins['bodySha256'] = hashlib.sha256(self.body.encode()).hexdigest()
        changed = self.build()
        self.assertEqual(original['operationKey'], changed['operationKey'])
        self.assertNotEqual(original['intentSha256'], changed['intentSha256'])

    def test_run_metadata_substitution_rejected(self):
        original = copy.deepcopy(self.run)
        for key, value in [('repository', 'other/repo'), ('repositoryId', 12), ('runId', 12),
                           ('runAttempt', 2), ('headSha', self.scope['headSha']),
                           ('workflowId', 12), ('workflowPath', 'fake'), ('event', 'pull_request'),
                           ('ref', 'fake'), ('status', 'in_progress'), ('conclusion', 'failure')]:
            self.run = {**original, key: value}
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'RECEIPT_RUN'):
                self.receipt()

    def test_comment_actor_alone_does_not_establish_provenance(self):
        original = copy.deepcopy(self.comment)
        for key, value in [('id', True), ('actorId', 7), ('actorType', 'User'),
                           ('issueNumber', 572), ('repositoryId', 9), ('repository', 'other/repo'),
                           ('body', self.body+'\n'), ('updatedAt', '2026-10-14T05:01:00Z')]:
            self.comment = {**original, key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.receipt()
        self.comment = original
        self.ledger = {}
        with self.assertRaises(ValueError):
            self.receipt()

    def test_ledger_must_bind_exact_operation_intent_run_and_comment(self):
        original = copy.deepcopy(self.ledger)
        for key, value in [('operationKey', 'a'*64), ('intentSha256', 'a'*64),
                           ('runId', 12), ('runAttempt', True), ('commentId', 999),
                           ('bodySha256', 'a'*64), ('status', 'RESERVED')]:
            self.ledger = {**original, key: value}
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'RECEIPT_LEDGER'):
                self.receipt()

    def test_state_machine_no_replay_or_send_permission(self):
        key, digest = self.plan['operationKey'], self.plan['intentSha256']
        state = dict(operationKey=key, intentSha256=digest, status='ABSENT')
        reserved = pub.transition(json.dumps(state), key, digest, 'reserve')
        self.assertFalse(reserved['sendAllowed'])
        self.assertTrue(reserved['requiresAtomicPersistence'])
        for status in ('RESERVED', 'CONFIRMED', 'AMBIGUOUS'):
            state['status'] = status
            with self.assertRaisesRegex(ValueError, 'STATE_TERMINAL_OR_REPLAY'):
                pub.transition(json.dumps(state), key, digest, 'reserve')
        for event, status in [('uncertain', 'AMBIGUOUS'), ('verified_receipt', 'CONFIRMED')]:
            result = pub.transition(json.dumps(reserved['state']), key, digest, event)
            self.assertEqual(result['state']['status'], status)
            for flag in pub.FLAGS:
                self.assertIs(result[flag], False)
        with self.assertRaisesRegex(ValueError, 'STATE_CONFLICT'):
            pub.transition(json.dumps(reserved['state']), key, 'a'*64, 'verified_receipt')

    def test_claimed_success_is_still_unauthenticated(self):
        result = self.receipt()
        self.assertEqual(result['kind'], 'UNAUTHENTICATED_ACTIONS_RECEIPT_CANDIDATE')
        self.assertFalse(result['authenticated'])
        self.assertFalse(result['durable'])
        self.assertFalse(result['dispatchAllowed'])

    def test_duplicate_keys_rejected(self):
        raw = json.dumps(self.pins).replace('"mailbox": 571', '"mailbox": 571, "mailbox": 571')
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_JSON_KEY'):
            pub.build_plan(self.body, json.dumps(self.scope), json.dumps(self.policy), raw)


if __name__ == '__main__':
    unittest.main()
