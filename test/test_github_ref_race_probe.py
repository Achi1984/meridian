import importlib.util
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('probe', Path(__file__).parents[1] / 'scripts/github-ref-race-probe.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
REF = p.claim_ref('approvedtest00001')


class ProbeTests(unittest.TestCase):
    def test_concurrent_create_and_fresh_call(self):
        lock = threading.Lock()
        calls = []
        def create():
            with lock:
                calls.append(1)
                return 'CREATED_201' if len(calls) == 1 else 'REJECTED_422'
        result = p.probe(create)
        self.assertEqual(result['status'], 'OBSERVED_PASS')
        self.assertEqual(len(calls), 3)

    def test_uncertain_race_stops_without_third_request(self):
        calls = []
        def unknown():
            calls.append(1)
            raise TimeoutError('secret detail')
        result = p.probe(unknown)
        self.assertEqual(result['status'], 'INCONCLUSIVE')
        self.assertEqual(len(calls), 2)
        self.assertNotIn('secret', json.dumps(result))

    def test_duplicate_success_is_not_pass(self):
        self.assertEqual(p.probe(lambda: 'CREATED_201')['status'], 'INCONCLUSIVE')

    def test_existing_ref_is_inconclusive(self):
        self.assertEqual(p.probe(lambda: 'REJECTED_422')['status'], 'INCONCLUSIVE')

    def test_restart_is_separate_and_never_repeated(self):
        values = iter(['CREATED_201', 'REJECTED_422'])
        with patch.object(p, 'restart_process', return_value='REJECTED_422') as restart:
            self.assertEqual(p.probe(lambda: next(values), restart)['status'], 'OBSERVED_PASS')
            restart.assert_called_once_with()
        class Completed:
            returncode = 0
            stdout = b'{"outcome":"REJECTED_422"}'
            stderr = b''
        with patch.object(p.subprocess, 'run', return_value=Completed()) as run:
            self.assertEqual(p.restart_process(), 'REJECTED_422')
            self.assertEqual(run.call_args.args[0][-1], '--single-attempt')
            self.assertEqual(run.call_args.kwargs['timeout'], 35)
            run.assert_called_once()

    def test_identity_is_fixed_namespace(self):
        for value in ('../main', '', 'a'*33, None, 'Uppercase12345678'):
            with self.assertRaises(ValueError): p.claim_ref(value)

    def test_specimen_identity_gate_fails_closed(self):
        with self.assertRaises(ValueError): p.claim_ref('APPROVED_PROBE_ID')
        workflow = (Path(__file__).parents[1] / 'docs/autonomy/github-ref-race-probe.workflow.yml').read_text()
        self.assertIn("assert os.environ['REQUESTED_PROBE_ID'] == approved", workflow)
        self.assertLess(workflow.index('Require the exact owner-approved'), workflow.index('Obtain exactly'))

    def test_transport_target_budget_response_and_sanitization(self):
        calls = []
        class Response:
            status = 201
            raw = json.dumps({'ref': REF, 'object': {'sha': p.PINNED_SHA}}).encode()
            def read(self, size):
                self.assert_size = size
                assert size == p.MAX_RESPONSE_BYTES + 1
                return self.raw
        class HTTPS:
            def __init__(self, host, timeout):
                assert host == 'api.github.com' and timeout == 10
            def request(self, method, path, body, headers):
                assert method == 'POST' and path == '/repos/Achi1984/meridian/git/refs'
                assert json.loads(body) == {'ref': REF, 'sha': p.PINNED_SHA}
                calls.append(1)
            def getresponse(self): return Response()
            def close(self): pass
        with patch.object(p.http.client, 'HTTPSConnection', HTTPS):
            transport = p.GitHubCreateOnly('secret-token', REF)
            self.assertEqual(transport(), 'CREATED_201')
            Response.raw = b'x' * (p.MAX_RESPONSE_BYTES + 1)
            self.assertEqual(transport(), 'INVALID_201')
            Response.status = 302
            self.assertEqual(transport(), 'UNEXPECTED_STATUS')
            self.assertEqual(transport(), 'BUDGET_EXCEEDED')
            self.assertEqual(len(calls), 3)

    def test_cli_inactive_without_explicit_ack(self):
        with patch.dict(p.os.environ, {}, clear=True), patch('builtins.print') as output:
            self.assertEqual(p.main(), 2)
            output.assert_called_once_with('{"status":"INACTIVE"}')


if __name__ == '__main__': unittest.main()
