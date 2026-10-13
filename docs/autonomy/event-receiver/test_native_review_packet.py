import copy
from email.message import Message
import importlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import native_review_packet as packet
from test_native_review_observation import fixture, PATH
from test_collector import A, B, C, job, tap


class Reply:
    def __init__(self, body, url, headers=None):
        self.body, self.url = body, url
        self.headers = headers or Message()
        self.status = 200
        self.closed = False
        self.limits = []

    def __enter__(self): return self
    def __exit__(self, *args): self.closed = True
    def geturl(self): return self.url
    def read(self, limit):
        self.limits.append(limit)
        return self.body[:limit]


class Scenario:
    def __init__(self):
        self.expected, self.api = fixture()
        self.calls, self.replies = [], []
        self.log_read = False
        self.mode = None
        self.redirect = False
        self.tick = 0
        self.selected_reads = 0
        self.run_reads = 0
        self.run_mutation = None

    def open(self, request, timeout):
        url = request.full_url
        self.calls.append((request, timeout))
        if '/actions/jobs/' in url:
            if self.redirect:
                raise HTTPError(url, 302, 'SECRET signed URL',
                    {'Location': 'https://evidence.blob.core.windows.net/log?SECRET'}, None)
            self.log_read = True
            row = tap()
        elif url.startswith('https://evidence.blob.core.windows.net/'):
            self.log_read = True
            row = tap()
        elif url == 'https://api.github.com/graphql':
            row = {'data': {'repository': {'nameWithOwner': 'Achi1984/meridian',
                'databaseId': 1342084551, 'isFork': False,
                'pullRequest': {'number': 702, 'state': 'OPEN', 'headRefOid': B,
                    'baseRefOid': A, 'baseRefName': 'main', 'reviewThreads': {
                        'nodes': [{'id': 'T1', 'isResolved': not (self.log_read and self.mode == 'thread')}],
                        'pageInfo': {'hasNextPage': False, 'endCursor': 'c1'}}}}}}
        else:
            prefix = 'https://api.github.com/repos/Achi1984/meridian/'
            if not url.startswith(prefix): raise AssertionError('unexpected host')
            path = url[len(prefix):]
            if '/reviews?' in path:
                row = [copy.deepcopy(self.api.rows[PATH])]
                if self.log_read and self.mode in ('adverse', 'pending', 'inventory'):
                    added = copy.deepcopy(row[0]); added['id'] = 100
                    added['state'] = {'adverse': 'CHANGES_REQUESTED', 'pending': 'PENDING',
                                      'inventory': 'COMMENTED'}[self.mode]
                    if added['state'] == 'PENDING': added['submitted_at'] = None
                    row.append(added)
            elif '/jobs?' in path:
                row = {'total_count': 1, 'jobs': [job(self.api.rows['actions/runs/123'])]}
                if self.mode == 'wrong-job': row['jobs'][0]['run_attempt'] = 2
            else:
                row = self.api(path)
                if path == 'actions/runs/123':
                    self.run_reads += 1
                    if self.run_reads == 3 and self.run_mutation:
                        self.run_mutation(row)
                if self.log_read and self.mode == 'main' and path == 'commits/main': row['sha'] = C
                if self.log_read and self.mode == 'selected' and path == PATH: row['body'] = 'SECRET changed'
                if self.log_read and self.mode == 'pr' and path == 'pulls/702': row['head']['sha'] = C
                if self.log_read and self.mode == 'ci' and path == 'actions/runs/123': row['run_attempt'] = 2
                if self.mode == 'intermediate-ci' and path == 'actions/runs/123' and len(self.calls) == 14:
                    row['pull_requests'][0]['base']['sha'] = C
        if self.log_read and self.mode == 'deadline': self.tick = packet.MAX_SECONDS
        if self.log_read and self.mode == 'exception': raise RuntimeError('SECRET transport body')
        raw = row if type(row) is bytes else json.dumps(row).encode()
        result = Reply(raw, url)
        if self.mode == 'bad-log' and self.log_read: result.body = b'SECRET malformed TAP'
        self.replies.append(result)
        return result


class PacketTests(unittest.TestCase):
    def run_case(self, scenario, **limits):
        with patch.object(packet.time, 'monotonic', side_effect=lambda: scenario.tick), \
             patch('urllib.request.build_opener', return_value=scenario):
            with patch.multiple(packet, **limits) if limits else patch.dict({}, {}):
                result = packet.observe_packet(json.dumps(scenario.expected).encode(), 'SECRET_TOKEN')
        for flag in packet.FLAGS: self.assertIs(result[flag], False)
        self.assertIsNone(result['plannerResponse'])
        self.assertNotIn('SECRET', json.dumps(result))
        self.assertNotIn('Synthetic approval', json.dumps(result))
        self.assertLessEqual(len(json.dumps(result).encode()), packet.MAX_RECEIPT)
        return result

    def test_complete_actual_transport_composition_is_still_incomplete(self):
        s = Scenario(); result = self.run_case(s)
        self.assertEqual(result['status'], 'OBSERVED_PACKET_INCOMPLETE')
        o = result['observation']
        self.assertEqual(o['requestsMade'], 30)
        self.assertEqual(o['requestsMade'], len(s.calls))
        self.assertEqual(o['responseBytes'], sum(len(r.body) for r in s.replies))
        self.assertEqual((o['reviewCount'], o['threadCount'], o['adverseReviewCount']), (1, 1, 0))
        self.assertEqual(o['ciEvidence']['jobs'][0]['total'], 10)
        self.assertEqual(o['ciEvidence']['evidenceClass'], 'JOB_LOG_REPORTED_COUNTERS')
        self.assertIs(o['ciEvidence']['testOutputForgeryExcluded'], False)
        self.assertTrue(all(r.closed for r in s.replies))
        self.assertTrue(all(timeout <= 15 for _, timeout in s.calls))
        self.assertEqual(sum('/reviews?' in r.full_url for r, _ in s.calls), 4)
        self.assertEqual(sum(r.get_method() == 'POST' for r, _ in s.calls), 4)

    def test_log_redirect_counted_without_authorization_on_storage(self):
        s = Scenario(); s.redirect = True; result = self.run_case(s)
        self.assertEqual(result['status'], 'OBSERVED_PACKET_INCOMPLETE')
        self.assertEqual(result['observation']['requestsMade'], 31)
        storage = [r for r, _ in s.calls if r.full_url.startswith('https://evidence.')]
        self.assertEqual(len(storage), 1)
        self.assertIsNone(storage[0].get_header('Authorization'))
        self.assertTrue(all(r.get_header('Authorization') == 'Bearer SECRET_TOKEN' for r, _ in s.calls if r not in storage))

    def test_downstream_adverse_drift_and_failure_never_leave_partial_success(self):
        for mode in ('adverse', 'pending', 'inventory', 'thread', 'main', 'selected',
                     'pr', 'ci', 'wrong-job', 'bad-log', 'deadline', 'exception', 'intermediate-ci'):
            with self.subTest(mode=mode):
                s = Scenario(); s.mode = mode; result = self.run_case(s)
                self.assertEqual(result['status'], 'BLOCKED')
                self.assertIsNone(result['observation'])

    def test_global_call_byte_and_time_exhaustion_across_helpers(self):
        s = Scenario(); result = self.run_case(s, MAX_CALLS=10)
        self.assertEqual(result['status'], 'BLOCKED'); self.assertEqual(len(s.calls), 10)
        baseline = Scenario(); self.run_case(baseline)
        limit = sum(len(r.body) for r in baseline.replies[:9]) + 8
        s = Scenario(); result = self.run_case(s, MAX_BYTES=limit)
        self.assertEqual(result['status'], 'BLOCKED')
        self.assertEqual(len(s.calls), 10)
        self.assertEqual(s.replies[-1].limits, [9])
        s = Scenario(); s.mode = 'deadline'; result = self.run_case(s)
        self.assertEqual(result['status'], 'BLOCKED')
        self.assertFalse(any('/reviews?' in r.full_url for r, _ in s.calls[17:]))

    def test_intermediate_ci_repository_identity_and_association_revalidated(self):
        mutations = [lambda r: r.update(repository={'full_name': 'other/repo', 'id': 1342084551, 'fork': False}),
                     lambda r: r.update(head_repository={'full_name': 'Achi1984/meridian', 'id': 1342084551, 'fork': True}),
                     lambda r: r.update(name='Other workflow'),
                     lambda r: r.update(path='.github/workflows/other.yml'),
                     lambda r: r.update(event='push'),
                     lambda r: r['pull_requests'][0].update(number=703),
                     lambda r: r['pull_requests'][0]['head'].update(sha=C),
                     lambda r: r['pull_requests'][0]['base'].update(sha=C)]
        for mutate in mutations:
            s = Scenario(); s.run_mutation = mutate
            result = self.run_case(s)
            self.assertEqual(result['status'], 'BLOCKED')
            self.assertFalse(s.log_read)

    def test_invalid_pins_or_token_do_not_create_opener(self):
        with patch('urllib.request.build_opener') as build:
            for raw, token in ((b'{}', 'SECRET'), (b'NaN', 'SECRET'),
                (json.dumps(Scenario().expected).encode(), 'SECRET\n')):
                self.assertEqual(packet.observe_packet(raw, token)['status'], 'BLOCKED')
            build.assert_not_called()

    def test_transport_cannot_expand_paths_or_log_scope(self):
        s = Scenario()
        with patch('urllib.request.build_opener', return_value=s):
            reader = packet._PacketGitHub('SECRET', s.expected, packet._PacketBudget())
            for path in ('pulls/703', 'actions/runs/124', 'issues/comments/99',
                         'actions/runs/123/attempts/2/jobs?per_page=50&page=1',
                         'actions/runs/123/attempts/1/jobs?per_page=50&page=4'):
                with self.assertRaises(Exception): reader(path)
            with self.assertRaises(Exception): reader.job_log(456)
            self.assertEqual(s.calls, [])

    def test_cli_returns_two_only_for_incomplete_observation_and_one_on_failure(self):
        s = Scenario()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'pins.json'; path.write_text(json.dumps(s.expected))
            with patch('urllib.request.build_opener', return_value=s), patch.dict(packet.os.environ, GH_TOKEN='SECRET_TOKEN'), \
                 patch('sys.stdout', new_callable=io.StringIO) as stdout:
                self.assertEqual(packet.main(['--allow-read-only-network', str(path)]), 2)
                self.assertEqual(json.loads(stdout.getvalue())['status'], 'OBSERVED_PACKET_INCOMPLETE')
            path.write_text('{}')
            with patch.object(packet.os.environ, 'get', side_effect=AssertionError('token must not be read')), \
                 patch('sys.stdout', new_callable=io.StringIO):
                self.assertEqual(packet.main(['--allow-read-only-network', str(path)]), 1)
        result = subprocess.run([sys.executable, '-B', str(Path(packet.__file__))], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)['reason'], 'ISOLATED_LAUNCH_REQUIRED')
        result = subprocess.run([sys.executable, '-I', '-B', str(Path(packet.__file__))], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1); self.assertEqual(result.stderr, '')

    def test_isolated_direct_cli_uses_same_budget_type_and_mocked_transport(self):
        program = '''
import json, pathlib, runpy, sys, tempfile
from unittest.mock import patch
sys.path.insert(0, sys.argv[1])
from test_native_review_packet import Scenario
scenario = Scenario()
with tempfile.TemporaryDirectory() as tmp:
    pins = pathlib.Path(tmp) / 'pins.json'
    pins.write_text(json.dumps(scenario.expected))
    path = str(pathlib.Path(sys.argv[1]) / 'native_review_packet.py')
    sys.argv = [path, '--allow-read-only-network', str(pins)]
    with patch('urllib.request.build_opener', return_value=scenario), patch.dict('os.environ', GH_TOKEN='SECRET_TOKEN'):
        runpy.run_path(path, run_name='__main__')
'''
        result = subprocess.run([sys.executable, '-I', '-B', '-c', program,
            str(Path(packet.__file__).parent)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(json.loads(result.stdout)['status'], 'OBSERVED_PACKET_INCOMPLETE')
        self.assertNotIn('SECRET', result.stdout + result.stderr)

    def test_import_is_inert_and_untrusted_budget_dict_rejected(self):
        s = Scenario()
        with patch('urllib.request.build_opener') as build:
            importlib.reload(packet); build.assert_not_called()
        raw = json.dumps(s.expected).encode()
        for observe in (packet.observe_inventory, packet.observe_threads):
            with patch('urllib.request.build_opener', return_value=s):
                self.assertEqual(observe(raw, 'SECRET', _budget={'authorized': True})['status'], 'BLOCKED')
            self.assertEqual(s.calls, [])


if __name__ == '__main__': unittest.main()
