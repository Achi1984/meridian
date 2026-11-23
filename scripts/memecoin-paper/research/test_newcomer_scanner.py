import unittest
from unittest.mock import patch

from newcomer_scanner import SIZE, WINDOWS, metrics, scan


class ScannerTests(unittest.TestCase):
    def setUp(self):
        self.row = dict(mint='mint', pool='pool', created='1970-01-01T00:00:00Z')
        self.bars = [[at, 10, 11, 9, 11, 1] for at in range(0, 3600, 60)]

    def test_windows_and_incomplete_history(self):
        result = metrics(self.row, self.bars, [], 3600)
        self.assertEqual([result[w]['volumeUsd'] for w in WINDOWS], list(WINDOWS))
        self.assertAlmostEqual(result[5]['changePct'], 10)
        self.assertNotIn(60, metrics(self.row, self.bars[1:], [], 3600))
        self.assertIn(30, metrics(self.row, self.bars[1:], [], 3600))
        trade = dict(attributes=dict(block_timestamp='1970-01-01T00:59:00Z',
                                     to_token_address='mint', tx_from_address='buyer'))
        self.assertEqual(metrics(self.row, self.bars, [trade]*2, 3600)[5]['uniqueBuyers'], 1)
        self.assertIsNone(metrics(self.row, self.bars, [trade]*300, 3600)[5]['uniqueBuyers'])

    def test_ranking_top_ten_and_quote_gate(self):
        rows = [dict(self.row, mint=str(i).zfill(2)) for i in range(12)]
        def fetch(url, age):
            if '/trades' in url:
                return {'data': []}
            return {'data': {'attributes': {'ohlcv_list': self.bars}}}
        def quote(src, dst, quantity):
            if src == '00':
                raise ValueError('no resale')
            return SIZE
        events = []
        with patch('newcomer_scanner.sample', return_value=rows):
            chosen = scan(lambda kind, **r: events.append(r), fetch, quote, lambda: 3600)
        self.assertEqual([r['mint'] for r in chosen], [r['mint'] for r in rows[1:10]])
        self.assertIn('quoteUnavailable', events[0]['reasons'])
        self.assertEqual(events[10]['ranks'], {})
        self.assertAlmostEqual(events[1]['netResaleUsdc'], 19.9)
