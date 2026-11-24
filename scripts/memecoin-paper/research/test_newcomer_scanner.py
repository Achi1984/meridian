import unittest
from unittest.mock import patch

from newcomer_scanner import SIZE, WINDOWS, metrics, scan


class ScannerTests(unittest.TestCase):
    def setUp(self):
        self.row = dict(mint='mint', pool='pool', created='1970-01-01T00:00:00Z')
        self.bars = [[at, 10, 11, 9, 11, 1] for at in range(0, 3600, 60)]

    def test_windows_and_incomplete_history(self):
        result = metrics(self.row, self.bars, [], 3600)
        self.assertEqual([result[w]['volumeUsd'] for w in result], [5, 10, 30, 60])
        self.assertAlmostEqual(result[5]['changePct'], 10)
        self.assertNotIn(60, metrics(self.row, self.bars[1:], [], 3600))
        self.assertIn(30, metrics(self.row, self.bars[1:], [], 3600))
        trade = dict(attributes=dict(block_timestamp='1970-01-01T00:59:00Z',
                                     to_token_address='mint', tx_from_address='buyer'))
        self.assertEqual(metrics(self.row, self.bars, [trade]*2, 3600)[5]['uniqueBuyers'], 1)
        self.assertIsNone(metrics(self.row, self.bars, [trade]*300, 3600)[5]['uniqueBuyers'])

    def test_multihour_windows_require_complete_pool_history(self):
        bars = [[i*60, 10, 11, 9, 11, 1] for i in range(720)]
        full = metrics(self.row, bars, None, 43200)
        self.assertEqual([full[w]['volumeUsd'] for w in WINDOWS], list(WINDOWS))
        young = dict(self.row, created='1970-01-01T00:00:01Z')
        self.assertNotIn(720, metrics(young, bars, None, 43200))
        gaps = metrics(self.row, bars[1:], None, 43200)
        self.assertNotIn(720, gaps)
        self.assertIn(360, gaps)

    def test_capped_trade_page_at_window_boundary_is_incomplete(self):
        trade = dict(attributes=dict(block_timestamp='1970-01-01T00:55:00Z',
                                     to_token_address='mint', tx_from_address='buyer'))
        page = [trade] * 300
        self.assertIsNone(metrics(self.row, self.bars, page, 3600)[5]['uniqueBuyers'])
        older = dict(attributes=dict(trade['attributes'], block_timestamp='1970-01-01T00:54:59Z'))
        self.assertEqual(metrics(self.row, self.bars, [older] + page[1:], 3600)[5]['uniqueBuyers'], 1)

    def test_trade_feed_failure_preserves_volume_but_excludes_paper_entry(self):
        def fetch(url, age):
            if '/trades' in url:
                raise ValueError('trade feed unavailable')
            return {'data': {'attributes': {'ohlcv_list': self.bars}}}

        events = []
        with patch('newcomer_scanner.sample', return_value=[self.row]):
            chosen = scan(lambda kind, **r: events.append(r), fetch, lambda *args: SIZE, lambda: 3600)
        self.assertEqual(chosen, [])
        self.assertEqual(events[0]['reasons'], ['tradeDataUnavailable'])
        for window in (5, 10, 30, 60):
            self.assertEqual(events[0]['ranks'][window], 1)
            self.assertEqual(events[0]['windows'][window]['volumeUsd'], window)
            self.assertIsNone(events[0]['windows'][window]['uniqueBuyers'])

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

    def test_partial_30m_cannot_displace_complete_pool(self):
        from newcomer_scanner import rank_complete_windows
        def record(mint, created, vol):
            return dict(row=dict(mint=mint, created=created),
                        windows={5: dict(observedMinutes=5, volumeUsd=vol),
                                 30: dict(observedMinutes=30, volumeUsd=vol)})
        complete = [record(str(i), '1970-01-01T00:30:00Z', 100+i) for i in range(10)]
        young = record('young','1970-01-01T00:30:01Z',10000)
        incomplete = record('gap','1970-01-01T00:20:00Z',10001)
        del incomplete['windows'][30]
        rank_complete_windows([young,incomplete]+complete, 3600)
        self.assertEqual(young['earliest30mAt'],3660)
        self.assertIn(5,young['ranks'])
        self.assertNotIn(30,young['ranks'])
        self.assertNotIn(30,incomplete['ranks'])
        self.assertTrue(all(30 in e['ranks'] for e in complete))

    def test_trending_discovers_older_launch_and_deduplicates(self):
        from newcomer_scanner import GT, WSOL, sample
        row = dict(self.row, mint='m', quote=WSOL, dex='pumpswap', liquidity=6000)
        def fetch(url, age):
            if '/search?' in url:
                return [dict(id='m',firstPool=dict(createdAt=row['created']))]
            if '/trending_pools' in url:
                return {'data':[row,dict(row,pool='deeper',liquidity=9000)]}
            if url.startswith(GT):
                return {'data':[]}
            return []
        with patch('newcomer_scanner.snapshot',side_effect=lambda r:r):
            records = sample(3600,fetch)
        self.assertEqual(len(records),1)
        self.assertEqual(records[0]['pool'],'deeper')
        self.assertEqual(records[0]['discoverySources'],['trending'])
