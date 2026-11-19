import sqlite3
import unittest
from unittest.mock import Mock, patch

import feeds
from usd_round import tick


class UsdRoundTest(unittest.TestCase):
    def test_shared_fill_history_and_repeat(self):
        hour = 100 * 86400
        start = hour + 600
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        db.execute('CREATE TABLE slots (slot INTEGER PRIMARY KEY, record TEXT)')
        bars = [[hour-i*3600,100,108,90,100] for i in (4,3,2,1)]
        bars[-1][2:4] = [102,98]
        def step(slot, choice):
            book = dict(bid=102, ask=103, bidSize=20, askSize=20,
                        received=slot+2, bidAt=slot+2, askAt=slot+2)
            ten = [[slot-i*600,100,105,98,104] for i in range(8,0,-1)]
            market = Mock(return_value=dict(hour=bars, ten=ten, book=book))
            fill = Mock(return_value=book)
            decide = Mock(return_value=(choice, 'test', {}))
            result = tick(db, slot, start, decide, market=market, orderbook=fill, clock=lambda:slot+2)
            if result:
                market.assert_called_once_with(slot, pair='XBTUSD')
                fill.assert_called_once_with(pair='XBTUSD')
                ctx = decide.call_args.args[0]
                self.assertEqual(ctx['pair'], 'BTC/USD')
                self.assertIn('cashUsd', ctx['portfolio'])
            else:
                decide.assert_not_called()
                fill.assert_not_called()
            return result
        arms = step(start, 'BUY')['arms']
        self.assertEqual(arms['cash']['equityUsd'], 1000)
        self.assertEqual(arms['v3']['execution'], 'PAPER_BUY')
        self.assertEqual(arms['v3']['equityUsd'], arms['v4']['equityUsd'])
        self.assertLess(arms['btcHold']['equityUsd'], arms['v4']['equityUsd'])
        self.assertIsNone(step(start, 'SELL'))
        arms = step(start+3600, 'SELL')['arms']
        for name in ('v3', 'v4'):
            self.assertEqual(arms[name]['closed'], 1)
            self.assertEqual(arms[name]['activeDays'], 1)
        self.assertEqual(arms['btcHold']['closed'], 0)

    def test_usd_pair_response_cannot_substitute_eur(self):
        response = {'error': [], 'result': {'XXBTZEUR': ['eur'], 'XXBTZUSD': ['usd']}}
        with patch.object(feeds, '_request', return_value=response):
            self.assertEqual(feeds._kraken('Depth?pair=XBTUSD&count=1'), ['usd'])
            del response['result']['XXBTZUSD']
            with self.assertRaises(feeds.FeedError):
                feeds._kraken('Depth?pair=XBTUSD&count=1')
