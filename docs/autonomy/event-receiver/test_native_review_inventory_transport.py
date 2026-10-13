import json
import unittest
from email.message import Message
from unittest.mock import patch
from test_native_review_inventory import fixture
from native_review_inventory_transport import observe_inventory, MAX_PAGE_BYTES

BASE = 'https://api.github.com/repos/Achi1984/meridian/pulls/736/reviews?per_page=50&page='

class Response:
    def __init__(self, rows, page=1, links=(), status=200, url=None):
        self.raw = rows if type(rows) is bytes else json.dumps(rows).encode()
        self.status, self.url = status, url or BASE + str(page)
        self.headers = Message()
        for link in links:
            self.headers.add_header('Link', link)
    def geturl(self): return self.url
    def read(self, limit): return self.raw[:limit]
    def __enter__(self): return self
    def __exit__(self, *args): return False

class TransportTests(unittest.TestCase):
    def run_case(self, responses, expected=None):
        expected = json.dumps(fixture()[0]).encode() if expected is None else expected
        with patch('native_review_inventory_transport.urllib.request.build_opener') as build:
            build.return_value.open.side_effect = responses
            result = observe_inventory(expected, 'synthetic-token')
            calls = build.return_value.open.call_args_list
        for key in ('authenticated','provenanceVerified','authorized','dispatchAllowed',
                    'mergeAllowed','durable','fullReviewEvidence'):
            self.assertIs(result[key], False)
        self.assertIsNone(result['plannerResponse'])
        self.assertNotIn('synthetic-token', json.dumps(result))
        self.assertLessEqual(len(calls), 6)
        for call in calls:
            self.assertEqual(call.args[0].method, 'GET')
            self.assertIn(call.args[0].full_url, [BASE + str(n) for n in range(1,4)])
            self.assertLessEqual(call.kwargs['timeout'], 15)
        return result, calls

    def test_two_pass_success_remains_incomplete(self):
        row = fixture()[1]
        result,calls = self.run_case([Response([row]),Response([row])])
        self.assertEqual(len(calls), 2)
        self.assertEqual(result['status'], 'OBSERVED_INVENTORY_INCOMPLETE')
        self.assertFalse(result['observation']['transportPaginationVerified'])

    def test_three_page_six_fetch_boundary(self):
        row=fixture()[1]
        rows=[row]+[{**row,'id':1000+n} for n in range(99)]
        responses=[]
        for _ in range(2):
            responses += [Response(rows[:50], links=[f'<{BASE}2>; rel="next"']),
                          Response(rows[50:],page=2), Response([],page=3)]
        result,calls=self.run_case(responses)
        self.assertEqual(len(calls),6)
        self.assertEqual(result['observation']['reviewCount'],100)

    def test_bad_pins_prevent_open(self):
        result,calls=self.run_case([],b'{}')
        self.assertEqual(result['status'],'BLOCKED')
        self.assertEqual(calls,[])

    def test_bad_responses_and_links(self):
        row=fixture()[1]
        bad=[Response({},), Response(b'['), Response(b'[{"id":1,"id":2}]'), Response(b' '* (MAX_PAGE_BYTES+1)),
             Response([row],status=302),Response([row],url='https://evil.invalid'),
             Response([row],links=[f'<{BASE}2>; rel="next"']),
             Response([row],links=['<https://evil.invalid>; rel="last"']),
             Response([row],links=[f'<{BASE}1>; rel="last"']*2),
             Response([row],links=[f'<{BASE}4>; rel="last"']),
             Response([row],links=[f'<{BASE}1>; rel="next"']),
             Response([row],links=['']), OSError('synthetic-token')]
        for response in bad:
            with self.subTest(response=response):
                result,_=self.run_case([response])
                self.assertEqual(result['status'],'BLOCKED')

    def test_drift_blocks(self):
        row=fixture()[1]
        result,_=self.run_case([Response([row]),Response([{**row,'state':'DISMISSED'}])])
        self.assertEqual(result['status'],'BLOCKED')

    def test_full_third_page_blocks(self):
        row=fixture()[1]
        responses=[Response([{**row,'id':p*100+n} for n in range(50)],page=p) for p in range(1,4)]
        result,calls=self.run_case(responses)
        self.assertEqual(result['status'],'BLOCKED')
        self.assertEqual(len(calls),3)

    def test_token_rejected_before_opener(self):
        expected=json.dumps(fixture()[0]).encode()
        for token in ('', 'bad\nheader', 'x'*4097, None):
            with patch('native_review_inventory_transport.urllib.request.build_opener') as build:
                self.assertEqual(observe_inventory(expected,token)['status'],'BLOCKED')
                build.assert_not_called()

    def test_timeout_after_response_discards_evidence(self):
        with patch('native_review_inventory_transport.time.monotonic',side_effect=[0,1,61]):
            result,calls=self.run_case([Response([fixture()[1]])])
        self.assertEqual(result['status'],'BLOCKED')
        self.assertEqual(len(calls),1)

    def test_redirect_handler_refuses_follow(self):
        from collector import NoRedirect
        self.assertIsNone(NoRedirect().redirect_request(None,None,302,'',{},'https://evil.invalid'))

    def test_timeout_no_request(self):
        with patch('native_review_inventory_transport.time.monotonic',side_effect=[0,61]):
            result,calls=self.run_case([])
        self.assertEqual(result['status'],'BLOCKED')
        self.assertEqual(calls,[])

if __name__=='__main__': unittest.main()
