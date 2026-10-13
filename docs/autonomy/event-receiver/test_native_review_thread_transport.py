import copy
import importlib
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import native_review_thread_transport as target
from collector import NoRedirect
from test_native_review_thread_collector import EXPECTED, response


class Reply:
    def __init__(self, body, status=200, url=target.ENDPOINT):
        self.body, self.status, self.url = body, status, url
        self.reads, self.closed = [], False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True

    def geturl(self):
        return self.url

    def read(self, limit):
        self.reads.append(limit)
        if isinstance(self.body, Exception):
            raise self.body
        return self.body[:limit]


def reply(row=None, **kwargs):
    return Reply(json.dumps(response() if row is None else row).encode(), **kwargs)


class TransportTests(unittest.TestCase):
    def run_case(self, replies, *, expected=EXPECTED, token='SECRET_TOKEN', clock=None, collector=None):
        calls = []

        class Opener:
            def open(self, request, timeout):
                calls.append((request, timeout))
                item = replies[len(calls)-1]
                if isinstance(item, Exception):
                    raise item
                return item

        with patch.object(target.urllib.request, 'build_opener', return_value=Opener()) as build, \
             patch.object(target.time, 'monotonic', side_effect=clock or (lambda: 0)):
            if collector is None:
                result = target.observe_threads(json.dumps(expected).encode(), token)
            else:
                with patch.object(target, 'collect_thread_observation', side_effect=collector):
                    result = target.observe_threads(json.dumps(expected).encode(), token)
        for flag in ('authenticated', 'provenanceVerified', 'authorized', 'dispatchAllowed',
                     'mergeAllowed', 'durable', 'fullReviewEvidence'):
            self.assertIs(result[flag], False)
        self.assertIsNone(result['plannerResponse'])
        self.assertNotIn('SECRET', json.dumps(result))
        return result, calls, build

    def test_fixed_endpoint_query_headers_and_bounded_reads(self):
        rows = [reply(), reply()]
        result, calls, build = self.run_case(rows)
        self.assertEqual(result['status'], 'OBSERVED_THREADS_INCOMPLETE')
        self.assertEqual(len(calls), 2)
        self.assertIsInstance(build.call_args.args[0], NoRedirect)
        for request, timeout in calls:
            self.assertEqual(request.full_url, 'https://api.github.com/graphql')
            self.assertEqual(request.get_method(), 'POST')
            self.assertEqual(request.get_header('Authorization'), 'Bearer SECRET_TOKEN')
            self.assertEqual(request.get_header('Content-type'), 'application/json')
            self.assertEqual(json.loads(request.data), {'query': target.QUERY, 'variables': {'number': 736, 'after': None}})
            self.assertNotIn(b'SECRET', request.data)
            self.assertEqual(timeout, 15)
        self.assertTrue(all(row.closed and row.reads == [32769] for row in rows))

    def test_empty_inventory_and_maximum_six_pages(self):
        result, calls, _ = self.run_case([reply(response([])), reply(response([]))])
        self.assertEqual(result['observation']['threadCount'], 0)
        pages = [response([{'id': 'T'+str(i*50+n), 'isResolved': True} for n in range(50)], i < 2, 'c'+str(i)) for i in range(3)]
        result, calls, _ = self.run_case([reply(row) for row in pages + copy.deepcopy(pages)])
        self.assertEqual(result['observation']['threadCount'], 150)
        self.assertEqual([json.loads(r.data)['variables']['after'] for r, _ in calls], [None, 'c0', 'c1']*2)

    def test_invalid_scope_token_before_opener_or_network(self):
        for token in ('', 'x'*4097, 'SECRET\n', 'has space', '\u00e4', None, 1):
            result, calls, build = self.run_case([], token=token)
            self.assertEqual(result['status'], 'BLOCKED'); self.assertEqual(calls, [])
            build.assert_not_called()
        for key, value in (('prNumber', 2**31), ('prNumber', True), ('headSha', 'invalid')):
            expected = copy.deepcopy(EXPECTED); expected['scope'][key] = value
            result, calls, build = self.run_case([], expected=expected)
            self.assertEqual(result['status'], 'BLOCKED'); build.assert_not_called()

    def test_wrong_status_url_errors_and_oversize_no_retry(self):
        for item in (reply(status=302), reply(status=403), reply(url='https://evil.example/graphql'),
                     Reply(b'x'*32769), Reply(b'{"errors":[{"message":"SECRET"}]}'),
                     Reply(b'{"data":{},"data":{}}'), Reply(b'NaN'),
                     TimeoutError('SECRET'), HTTPError(target.ENDPOINT, 429, 'SECRET', {}, None),
                     Reply(TimeoutError('SECRET'))):
            result, calls, _ = self.run_case([item])
            self.assertEqual(result['status'], 'BLOCKED'); self.assertEqual(len(calls), 1)
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, 'redirect', {}, 'https://evil.example'))

    def test_scope_cursor_duplicates_and_second_pass_drift(self):
        rows = []
        for key, value in (('number', 737), ('headRefOid', 'c'*40), ('baseRefOid', 'c'*40)):
            row = response(); row['data']['repository']['pullRequest'][key] = value; rows.append(row)
        row = response(); row['data']['repository']['nameWithOwner'] = 'other/repo'; rows.append(row)
        rows.extend([response([{'id': 'T', 'isResolved': True}]*2), response(more=True)])
        for row in rows:
            result, calls, _ = self.run_case([reply(row)])
            self.assertEqual(result['status'], 'BLOCKED'); self.assertEqual(len(calls), 1)
        result, calls, _ = self.run_case([reply(), reply(response([{'id': 'PRRT_1', 'isResolved': False}]))])
        self.assertEqual(result['status'], 'BLOCKED'); self.assertEqual(len(calls), 2)
        pages = [response([{'id': 'T'+str(i*50+n), 'isResolved': True} for n in range(50)], True, 'repeat') for i in range(2)]
        result, calls, _ = self.run_case([reply(row) for row in pages])
        self.assertEqual(result['status'], 'BLOCKED'); self.assertEqual(len(calls), 2)

    def test_elapsed_budget_before_after_and_remaining_socket_timeout(self):
        result, calls, _ = self.run_case([], clock=iter([0, 60, 60]).__next__)
        self.assertEqual(result['status'], 'BLOCKED'); self.assertEqual(calls, [])
        result, calls, _ = self.run_case([reply()], clock=iter([0, 0, 60, 60]).__next__)
        self.assertEqual(result['status'], 'BLOCKED'); self.assertEqual(len(calls), 1)
        result, calls, _ = self.run_case([reply(), reply()], clock=iter([0, 55, 56, 57, 58, 59]).__next__)
        self.assertEqual(result['status'], 'OBSERVED_THREADS_INCOMPLETE')
        self.assertEqual([timeout for _, timeout in calls], [5, 3])
        result, calls, _ = self.run_case([reply(), reply()], clock=iter([0, 0, 0, 0, 0, 60]).__next__)
        self.assertEqual(result['status'], 'BLOCKED')

    def test_callback_rejects_query_or_variables_before_network(self):
        cases = [('mutation{danger}', {'number': 736, 'after': None}),
                 (target.QUERY+' ', {'number': 736, 'after': None}),
                 (target.QUERY, {'number': True, 'after': None}),
                 (target.QUERY, {'number': 737, 'after': None}),
                 (target.QUERY, {'number': 736, 'after': 'https://evil.example'}),
                 (target.QUERY, {'number': 736, 'after': None, 'extra': 1})]
        for query, variables in cases:
            def injected(expected, reader):
                return reader(query, variables)
            result, calls, _ = self.run_case([], collector=injected)
            self.assertEqual(result['status'], 'BLOCKED'); self.assertEqual(calls, [])

    def test_seventh_callback_is_blocked_and_aggregate_boundary_is_bounded(self):
        # Six maximum-sized bodies hit exactly the aggregate limit. A seventh
        # callback must be rejected before the opener, independent of collector.
        def injected(expected, reader):
            for _ in range(7):
                reader(target.QUERY, {'number': 736, 'after': None})
        rows = [Reply(b'x'*32768) for _ in range(6)]
        result, calls, _ = self.run_case(rows, collector=injected)
        self.assertEqual(result['status'], 'BLOCKED'); self.assertEqual(len(calls), 6)

    def test_import_does_not_construct_transport(self):
        with patch.object(target.urllib.request, 'build_opener') as build:
            importlib.reload(target)
            build.assert_not_called()


if __name__ == '__main__':
    unittest.main()
