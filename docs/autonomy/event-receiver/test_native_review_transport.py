import io
import json
import unittest
import urllib.error
from unittest.mock import patch
from collector import GitHub, MAX_BYTES, NoRedirect, Rejected
from native_review_transport import NativeReviewGitHub
from native_review_observation import observe_native_review
from test_native_review_observation import fixture


class Response(io.BytesIO):
    status = 200


class Opener:
    def __init__(self, rows):
        self.rows, self.calls = rows, []

    def open(self, request, timeout):
        self.calls.append((request, timeout))
        path = request.full_url.removeprefix('https://api.github.com/repos/Achi1984/meridian/')
        value = self.rows[path]
        if isinstance(value, Exception):
            raise value
        return Response(value if type(value) is bytes else json.dumps(value).encode())


class TransportTests(unittest.TestCase):
    def reader(self, rows=None):
        reader = NativeReviewGitHub('TEST-TOKEN', pr_number=702, run_id=123, review_id=99)
        reader.opener = Opener(rows or {})
        return reader

    def test_composition_uses_real_get_transport(self):
        expected, api = fixture()
        reader = self.reader(api.rows)
        result = observe_native_review(json.dumps(expected).encode(), reader)
        self.assertEqual(result['status'], 'OBSERVED_APPROVAL_INCOMPLETE')
        self.assertIsNone(result['plannerResponse'])
        for flag in ('authenticated', 'provenanceVerified', 'authorized', 'dispatchAllowed',
                     'mergeAllowed', 'durable', 'fullReviewEvidence'):
            self.assertIs(result[flag], False)
        self.assertEqual(len(reader.opener.calls), 9)
        for request, timeout in reader.opener.calls:
            self.assertEqual(request.get_method(), 'GET')
            self.assertTrue(request.full_url.startswith('https://api.github.com/repos/Achi1984/meridian/'))
            self.assertEqual(request.get_header('Authorization'), 'Bearer TEST-TOKEN')
            self.assertEqual(timeout, 15)
        self.assertNotIn('TEST-TOKEN', json.dumps(result))

    def test_exact_paths_and_no_log_escape(self):
        reader = self.reader()
        for path in ('pulls/703', 'actions/runs/124', 'pulls/702/reviews/100', 'pulls/702/reviews',
                     'issues/571', 'pulls/702?x=1', '../pulls/702', 'https://evil.test',
                     '/pulls/702', 'pulls/0702', 'commits/main\n', [], None):
            with self.subTest(path=path), self.assertRaises(Rejected):
                reader(path)
        with self.assertRaises(Rejected):
            reader.job_log(123)
        self.assertEqual(reader.opener.calls, [])

    def test_bad_constructor_pins_do_not_construct_transport(self):
        for key in ('pr_number', 'run_id', 'review_id'):
            for value in (True, 0, -1, 2**63, '702', None):
                pins = dict(pr_number=702, run_id=123, review_id=99)
                pins[key] = value
                with patch('collector.urllib.request.build_opener') as build:
                    with self.assertRaises(Rejected):
                        NativeReviewGitHub('TEST-TOKEN', **pins)
                    build.assert_not_called()

    def test_legacy_paths_unchanged(self):
        reader = GitHub('TEST-TOKEN')
        reader.opener = Opener({})
        for path in ('commits/main', 'pulls/702', 'actions/runs/123', 'issues/571',
                     'issues/comments/99', 'actions/runs/123/attempts/1/jobs?per_page=50&page=3'):
            self.assertTrue(reader._allowed_path(path))
        with self.assertRaises(Rejected):
            reader('pulls/702/reviews/99')
        self.assertEqual(reader.opener.calls, [])

    def test_response_bounds_json_and_http_errors_block(self):
        expected, api = fixture()
        path = 'pulls/702/reviews/99'
        for value in (b'x' * (MAX_BYTES + 1), b'{"a":1,"a":2}', b'[]', b'NaN',
                      b'\xff', urllib.error.HTTPError('SECRET', 302, 'SECRET', {}, None),
                      urllib.error.HTTPError('SECRET', 403, 'SECRET', {}, None)):
            reader = self.reader({**api.rows, path: value})
            result = observe_native_review(json.dumps(expected).encode(), reader)
            self.assertEqual(result['status'], 'BLOCKED')
            self.assertNotIn('SECRET', json.dumps(result))

    def test_redirect_handler_is_inherited_and_rejects(self):
        reader = NativeReviewGitHub('TEST-TOKEN', pr_number=702, run_id=123, review_id=99)
        handlers = [h for h in reader.opener.handlers if isinstance(h, NoRedirect)]
        self.assertEqual(len(handlers), 1)
        self.assertIsNone(handlers[0].redirect_request(None, None, 302, '', {}, 'https://evil.test'))

    def test_invalid_observer_pins_do_not_request(self):
        reader = self.reader()
        self.assertEqual(observe_native_review(b'{"scope":{}}', reader)['status'], 'BLOCKED')
        self.assertEqual(reader.opener.calls, [])

    def test_independent_transport_pin_mismatch_blocks(self):
        expected, api = fixture()
        reader = NativeReviewGitHub('TEST-TOKEN', pr_number=703, run_id=123, review_id=99)
        reader.opener = Opener(api.rows)
        self.assertEqual(observe_native_review(json.dumps(expected).encode(), reader)['status'], 'BLOCKED')
        self.assertEqual(len(reader.opener.calls), 1)

    def test_review_or_attempt_drift_blocks(self):
        expected, api = fixture()
        for path, key, value in (('pulls/702/reviews/99', 'state', 'DISMISSED'),
                                 ('actions/runs/123', 'run_attempt', 2)):
            reader = self.reader(api.rows)
            original = reader.opener.open
            counts = {}
            def drift(request, timeout):
                current = request.full_url.split('/meridian/')[1]
                counts[current] = counts.get(current, 0) + 1
                if current == path and counts[current] == 2:
                    return Response(json.dumps({**api.rows[path], key: value}).encode())
                return original(request, timeout)
            reader.opener.open = drift
            self.assertEqual(observe_native_review(json.dumps(expected).encode(), reader)['status'], 'BLOCKED')


if __name__ == '__main__':
    unittest.main()
