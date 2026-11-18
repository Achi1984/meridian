import io
import json
from urllib.error import HTTPError
import unittest
from unittest.mock import patch

import feeds


class FeedTests(unittest.TestCase):
    def test_http_errors_keep_only_status_and_known_codes(self):
        for body, expected in [(b'{"error":{"code":"insufficient_quota","message":"private"}}', 'HTTP_429:insufficient_quota'),
                               (b'{"error":{"code":"private"}}', 'HTTP_429'),
                               (b'invalid', 'HTTP_429')]:
            error = HTTPError(feeds._OPENAI, 429, 'private', {}, io.BytesIO(body))
            with patch.object(feeds._HTTP, 'open', side_effect=error) as post:
                with self.assertRaises(feeds.FeedError) as failure:
                    feeds._request(feeds._OPENAI, key='test', body=b'{}')
                self.assertEqual(feeds.model_failure(failure.exception), expected)
                post.assert_called_once()

    def test_market_uses_closed_contiguous_windows(self):
        slot = 3600*100+1200
        def fetch(path):
            if path.startswith('Depth'):
                return dict(bids=[['100','2',slot]],asks=[['101','3',slot]])
            step = 300 if path.endswith('interval=5') else 3600
            length = 72 if step==300 else 24
            end = slot-slot%step
            return [[end-step*i,'100','110','90','101',0,0,0] for i in range(length,-1,-1)]
        with patch.object(feeds,'_kraken',side_effect=fetch):
            result = feeds.market(slot, lambda:slot+1)
        self.assertEqual(result['ten'][-1], [slot-600,100,110,90,101])
        self.assertEqual(result['hour'][-1][0],3600*99)
        self.assertEqual((len(result['ten']),len(result['hour'])),(36,24))

    def test_gap_fails_even_with_trailing_uncommitted_data(self):
        data = [[n*300,100,110,90,101,0,0,0] for n in (0,2,3)]
        with patch.object(feeds,'_kraken',return_value=data), self.assertRaisesRegex(feeds.FeedError,'GAP'):
            feeds._candles(5,900,3)

    def test_public_timeout_retries_with_new_book(self):
        quote = dict(bids=[['100','2',99]],asks=[['101','3',100]])
        with patch.object(feeds,'_kraken',side_effect=[feeds.FeedError('REQUEST_FAILED'),quote]) as read:
            self.assertEqual(feeds.book(lambda:100)['bidAt'],99)
            self.assertEqual(read.call_count,2)

    def test_repeated_public_error_stops(self):
        with patch.object(feeds,'_kraken',side_effect=feeds.FeedError('HTTP_503')) as read:
            with self.assertRaisesRegex(feeds.FeedError,'HTTP_503'):
                feeds.book(lambda:100)
            self.assertEqual(read.call_count,2)

    def test_stale_book_fails(self):
        book=dict(bids=[['100','2',90]],asks=[['101','3',99]])
        with patch.object(feeds,'_kraken',return_value=book), self.assertRaisesRegex(feeds.FeedError,'BOOK_TIME_INVALID'):
            feeds.book(lambda:100)

    def test_structured_decision_and_refusal_accounting(self):
        usage=dict(input_tokens=100, input_tokens_details={'cached_tokens':50},output_tokens=20)
        part={'type':'output_text','text':json.dumps({'action':'HOLD','reason':'Warten.'})}
        resp={'model':'model','status':'completed','output':[{'type':'message','role':'assistant','content':[part]}],'usage':usage}
        with patch.object(feeds,'_request',return_value=resp) as post:
            self.assertEqual(feeds.decide({},'model','key'),('HOLD','Warten.',{'input':100,'cached':50,'output':20}))
            self.assertTrue(json.loads(post.call_args.kwargs['body'])['text']['format']['strict'])
            part['type']='refusal'
            with self.assertRaises(feeds.FeedError) as failure:
                feeds.decide({},'model','key')
            self.assertEqual(str(failure.exception), 'MODEL_REFUSAL')
            self.assertEqual(failure.exception.usage['output'],20)
