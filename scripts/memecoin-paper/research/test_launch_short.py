import unittest
from urllib.error import HTTPError

from launch_short import MARGIN, run

MINT = 'a'*32


class ShortStudy(unittest.TestCase):
    def replay(self, prices, override=None):
        at = 1000
        rows = []

        def sleep(delay):
            nonlocal at
            at += delay

        def fetch(url, max_age):
            self.assertIn('/'+MINT+'/quote/short?', url)
            i = (at-1000)//60
            q = dict(mint=MINT, venue='curve', tier=2, margin_lamports=MARGIN,
                     reserves=dict(slot=i, token_tokens=10000, sol_lamports=prices[i]*100000,
                                   fees_bps=[10, 15]), owed_tokens=100, min_proceeds_lamports=200000,
                     proceeds_lamports=202021, secured_until=2000, borrow_fee_per_hour_lamports=100,
                     fees=dict(open_fee_lamports=30, min_charge_lamports=10),
                     liquidation=dict(trigger_lamports=500000))
            if override:
                override(i, q)
            return q

        run({MINT: 900}, rows.append, fetch, lambda: at, sleep)
        return rows

    def test_reversals_and_breakdowns(self):
        for prices, bot in [([100, 110, 105, 100], 'failedPump'),
                            ([100, 97, 94, 90], 'continuedSelling')]:
            rows = self.replay(prices)
            self.assertEqual(rows[-2]['event'], 'quote')
            self.assertEqual(rows[-1]['bot'], bot)
            self.assertEqual(rows[-1]['event'], 'paperMark')
            self.assertLess(rows[-1]['estimatedPnlLamports'], 200000-90000-100000)

    def test_unavailable_exit(self):
        def unavailable(i, q):
            if i == 3:
                raise HTTPError('quote', 503, 'unavailable', {}, None)
        self.assertEqual(self.replay([100, 97, 94, 90], unavailable)[-1]['event'], 'unresolved')

    def test_liquidation_or_venue_change(self):
        for last in [lambda q: q.update(venue='pumpswap'),
                     lambda q: q['reserves'].update(sol_lamports=100000000)]:
            rows = self.replay([100, 97, 94, 90], lambda i, q: last(q) if i == 3 else None)
            self.assertEqual(rows[-1]['event'], 'unresolved')

    def test_no_invalid_entries(self):
        for update in [lambda q: q.update(mint='other'), lambda q: q.update(secured_until=1100),
                       lambda q: q['reserves'].update(slot=1), lambda q: q['reserves'].pop('fees_bps')]:
            rows = self.replay([100, 97, 94, 90], lambda i, q: update(q))
            self.assertFalse(any(row['event'] == 'paperOpen' for row in rows))
