import json
import unittest
from unittest.mock import patch

import feeds


class FeedTests(unittest.TestCase):
    def test_market_uses_closed_contiguous_windows(self):
        slot = 3600*100+1200
        def fetch(path):
            if path.startswith('Depth'):
                return dict(bids=[['100','2',slot]],asks=[['101','3',slot]])
            step = 300 if 'interval=5&' in path else 3600
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

    def test_stale_book_fails(self):
        book=dict(bids=[['100','2',90]],asks=[['101','3',99]])
        with patch.object(feeds,'_kraken',return_value=book), self.assertRaisesRegex(feeds.FeedError,'BOOK_TIME_INVALID'):
            feeds.book(lambda:100)

    def test_structured_decision_and_refusal_accounting(self):
        usage=dict(input_tokens=100, input_tokens_details={'cached_tokens':50},output_tokens=20)
        part={'type':'output_text','text':json.dumps({'action':'HOLD','reason':'Warten.'})}
        resp={'status':'completed','output':[{'type':'message','role':'assistant','content':[part]}],'usage':usage}
        with patch.object(feeds,'_request',return_value=resp) as post:
            self.assertEqual(feeds.decide({},'model','key'),('HOLD','Warten.',{'input':100,'cached':50,'output':20}))
            self.assertTrue(json.loads(post.call_args.kwargs['body'])['text']['format']['strict'])
            part['type']='refusal'
            with self.assertRaises(feeds.FeedError) as failure:
                feeds.decide({},'model','key')
            self.assertEqual(failure.exception.usage['output'],20)
