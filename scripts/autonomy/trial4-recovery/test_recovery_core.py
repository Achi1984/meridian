import base64
import contextlib
import copy
import importlib.util
import pathlib
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('core', ROOT / 'recovery_core.py')
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
RAW = base64.b64decode((ROOT / 'evidence/original-packet.zip.b64').read_text())
HELPER = (ROOT / 'evidence/original-pilot.py').read_bytes()
v, helper, packet = r.verified_evidence(RAW, HELPER)
REPO = {'id': 1342084551, 'full_name': r.REPO, 'fork': False, 'owner': {'id': 319562141, 'login': 'Achi1984'}}


class Fixture:
    def __init__(self):
        self.writes = []; self.lifecycle = []; self.ref = None; self.changed_main = False
        self.failure = None; self.tree = 'a' * 40; self.claim = 'b' * 40; self.output = 'c' * 40
        self.context = {'repository': r.REPO, 'ref': 'refs/heads/main', 'sha': r.BASE,
                        'event': 'workflow_dispatch', 'actor': 'Achi1984', 'attempt': 1, 'run_id': 999,
                        'environment_approved': True, 'original_failure_reconciled': True}

    def api(self, path, method='GET', payload=None, expected=200, *, publisher_token=None):
        if method != 'GET': self.writes.append((path, method, copy.deepcopy(payload), publisher_token))
        if path == 'git/ref/heads/main': return {'object': {'sha': 'd' * 40 if self.changed_main else r.BASE}}
        if path == 'git/ref/heads/' + r.ORIGINAL_BRANCH: return {'object': {'sha': v.CLAIM_SHA}}
        if path == 'git/ref/heads/' + r.BRANCH:
            if self.ref is None: raise r.ApiFailure(500 if self.failure == 'unknown_absence' else 404)
            return {'object': {'sha': self.ref}}
        if path.startswith('contents/'):
            if self.failure == 'path_exists': return {'sha': 'f' * 40}
            raise r.ApiFailure(404)
        if path == 'pulls/686': return {'number': 686, 'state': 'open', 'merged': False,
            'head': {'sha': v.EXPECTED_EVIDENCE['source_head'], 'repo': REPO}, 'base': {'ref': 'main', 'repo': REPO}}
        if path.startswith('pulls?'): return []
        if path == 'actions/runs/38141528699': return {'id': 38141528699, 'run_attempt': 2,
            'workflow_id': 347821227, 'path': '.github/workflows/backend-safety.yml', 'event': 'pull_request',
            'status': 'completed', 'conclusion': 'success', 'head_sha': v.EXPECTED_EVIDENCE['source_head'],
            'repository': REPO, 'head_repository': REPO, 'pull_requests': [{'number': 686}]}
        if path == 'actions/runs/38147058996': return {'id': 38147058996, 'run_attempt': 1,
            'head_sha': v.EXPECTED_EVIDENCE['base'], 'status': 'completed', 'conclusion': 'failure', 'repository': REPO}
        if path.startswith('actions/jobs/'):
            job = int(path.rsplit('/', 1)[-1])
            return {'id': job, 'run_id': 38147058996, 'run_attempt': 1, 'status': 'completed',
                    'conclusion': 'success' if job == 114492561673 else 'failure'}
        if path.startswith('actions/workflows/'):
            workflow = int(path.split('/')[2])
            return {'total_count': 1, 'workflow_runs': [{'head_sha': r.BASE, 'head_branch': 'main',
                'event': 'push', 'workflow_id': workflow, 'path': '.github/workflows/' + ('backend-safety.yml' if workflow == 347821227 else 'runtime-smoke.yml'),
                'status': 'completed', 'conclusion': 'success', 'repository': REPO}]}
        if path.startswith('actions/artifacts/'): return {'id': v.ARTIFACT_ID, 'expired': False,
            'name': 'version-history-ledger-packet', 'size_in_bytes': v.ARCHIVE_BYTES, 'digest': 'sha256:' + v.ARCHIVE_SHA256,
            'workflow_run': {'id': 38147058996, 'head_sha': v.EXPECTED_EVIDENCE['base']}}
        if path == 'git/commits/' + v.CLAIM_SHA: return {'message': helper.claim_message(v.EXPECTED_EVIDENCE),
            'parents': [{'sha': v.EXPECTED_EVIDENCE['base']}], 'tree': {'sha': self.tree}}
        if path.startswith('git/commits/'): return {'tree': {'sha': self.tree}}
        if path == 'git/commits': return {'sha': self.claim if self.ref is None else self.output}
        if path == 'git/refs':
            if self.failure == 'claim_race': raise r.ApiFailure(422)
            if self.ref is not None: raise AssertionError('claim reset')
            self.ref = payload['sha']; return {'ref': payload['ref'], 'object': {'sha': self.ref}}
        if path == 'git/trees': return {'sha': 'e' * 40}
        if path == 'git/refs/heads/' + r.BRANCH:
            if payload['force'] is not False: raise AssertionError('force')
            self.ref = payload['sha']; return {'object': {'sha': self.ref}}
        if path == 'pulls':
            if self.failure == 'unknown_post': raise TimeoutError('do not print ' + publisher_token)
            return {'number': 700, 'state': 'open', 'draft': True, 'user': {'login': r.BOT, 'type': 'Bot'},
                'head': {'sha': self.output, 'ref': r.BRANCH, 'repo': REPO},
                'base': {'sha': r.BASE, 'ref': 'main', 'repo': REPO}}
        raise AssertionError('unexpected route ' + path)

    @contextlib.contextmanager
    def factory(self):
        self.lifecycle.append('mint')
        if self.failure == 'base_during_mint': self.changed_main = True
        try: yield 'ghs_mock_recovery'
        finally:
            self.lifecycle.append('revoke')
            if self.failure == 'revoke_failure': raise ValueError('secret should not leak ghs_mock_recovery')

    def run(self, **changes):
        args = dict(config=dict(r.CONFIGURED), context=self.context, api=self.api,
                    publisher_factory=self.factory, publisher_receipt=lambda:{'revocation_confirmed':self.lifecycle==['mint','revoke'],'app_id':5272026,'installation_id':170212503,'repository_id':1342084551}, archive=RAW, helper_bytes=HELPER)
        args.update(changes)
        with mock.patch.object(r.time, 'time', return_value=r.DEADLINE - 120):
            return r.recover_once(**args)


class RecoveryTests(unittest.TestCase):
    def test_unconfigured_and_wrong_execution_stop_without_writes(self):
        self.assertEqual(r.recover_once()['outcome'], 'stopped')
        for field, value in [('actor', 'other'), ('attempt', 2), ('attempt', True), ('sha', '0' * 40),
                             ('environment_approved', False), ('original_failure_reconciled', False)]:
            f = Fixture(); f.context[field] = value
            self.assertEqual(f.run()['outcome'], 'stopped'); self.assertEqual(f.writes, [])

    def test_success_preserves_evidence_and_only_exact_two_files(self):
        f = Fixture(); original = copy.deepcopy(packet)
        result = f.run()
        self.assertEqual(result['outcome'], 'prepared_draft'); self.assertEqual(f.lifecycle, ['mint', 'revoke'])
        self.assertEqual(packet, original); self.assertEqual(result['original_control_attempt'], 1)
        self.assertEqual(result['model_calls'], 0); self.assertFalse(result['publication_authorized'])
        tree = next(item for item in f.writes if item[0] == 'git/trees')[2]
        self.assertEqual({item['path']: item['content'] for item in tree['tree']}, packet['files'])
        posts = [item for item in f.writes if item[3] is not None]
        self.assertEqual(len(posts), 1); self.assertEqual(posts[0][:2], ('pulls', 'POST'))
        self.assertTrue(all(item[0] != 'git/refs/heads/' + r.ORIGINAL_BRANCH for item in f.writes))
        self.assertTrue(all(item[2].get('ref') != 'refs/heads/' + r.ORIGINAL_BRANCH for item in f.writes))
        writes = len(f.writes)
        self.assertEqual(f.run()['outcome'], 'stopped'); self.assertEqual(len(f.writes), writes)

    def test_artifact_or_absence_failure_prevents_mutation_and_mint(self):
        for failure in ('unknown_absence', 'path_exists', 'tampered_archive'):
            f = Fixture(); f.failure = failure
            result = f.run(archive=RAW + b'x') if failure == 'tampered_archive' else f.run()
            self.assertEqual(result['outcome'], 'stopped'); self.assertEqual(f.writes, []); self.assertEqual(f.lifecycle, [])

    def test_claim_race_consumption_reconciles_without_mint(self):
        f = Fixture(); f.failure = 'claim_race'
        self.assertEqual(f.run()['outcome'], 'reconciliation_required')
        self.assertEqual(f.lifecycle, []); self.assertEqual(len(f.writes), 2)

    def test_base_drift_after_mint_revokes_without_post(self):
        f = Fixture(); f.failure = 'base_during_mint'
        self.assertEqual(f.run()['outcome'], 'reconciliation_required')
        self.assertEqual(f.lifecycle, ['mint', 'revoke'])
        self.assertFalse(any(item[0] == 'pulls' for item in f.writes))

    def test_unknown_post_and_revoke_failure_never_retry_or_leak(self):
        for failure in ('unknown_post', 'revoke_failure'):
            f = Fixture(); f.failure = failure; result = f.run()
            self.assertEqual(result['outcome'], 'reconciliation_required')
            self.assertEqual(f.lifecycle, ['mint', 'revoke'])
            self.assertEqual(sum(item[0] == 'pulls' for item in f.writes), 1)
            self.assertNotIn('ghs_', str(result))

    def test_suppressed_post_error_cannot_report_success(self):
        f = Fixture(); f.failure = 'unknown_post'
        @contextlib.contextmanager
        def suppressing_factory():
            f.lifecycle.append('mint')
            try: yield 'ghs_mock_recovery'
            except TimeoutError: pass
            finally: f.lifecycle.append('revoke')
        result = f.run(publisher_factory=suppressing_factory)
        self.assertEqual(result['outcome'], 'reconciliation_required')
        self.assertEqual(f.lifecycle, ['mint', 'revoke'])

    def test_missing_revocation_or_wrong_identity_proof_cannot_succeed(self):
        good = {'revocation_confirmed': True, 'app_id': 5272026,
                'installation_id': 170212503, 'repository_id': 1342084551}
        for proof in ({}, {**good, 'revocation_confirmed': False},
                      *({**good, field: 7} for field in ('app_id', 'installation_id', 'repository_id'))):
            f = Fixture()
            self.assertEqual(f.run(publisher_receipt=lambda: proof)['outcome'], 'reconciliation_required')
            self.assertEqual(f.lifecycle, ['mint', 'revoke'])

    def test_changed_approved_base_requires_matching_execution(self):
        f = Fixture()
        result = f.run(config={**r.CONFIGURED, 'base': 'd' * 40})
        self.assertEqual(result['outcome'], 'stopped'); self.assertEqual(f.writes, [])

    def test_expired_proposal_stops_without_ports(self):
        f = Fixture()
        with mock.patch.object(r.time, 'time', return_value=r.DEADLINE):
            result = r.recover_once(config=dict(r.CONFIGURED), context=f.context, api=f.api,
                publisher_factory=f.factory, publisher_receipt=lambda:{}, archive=RAW, helper_bytes=HELPER)
        self.assertEqual(result['outcome'], 'stopped'); self.assertEqual(f.writes, []); self.assertEqual(f.lifecycle, [])


if __name__ == '__main__': unittest.main()
