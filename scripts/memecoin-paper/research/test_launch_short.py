import unittest
from urllib.error import HTTPError

from launch_short import MARGIN, MARKET_PAGE, TOKENS, cohort, run

MINT = 'a'*32


class ShortStudy(unittest.TestCase):
    def replay(self, prices, override=None, slot_delay=0):
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

        run({MINT: 900}, rows.append, fetch, lambda: at, sleep, lambda slot: at-slot_delay)
        return rows

    def test_reversals_and_breakdowns(self):
        for prices, bot in [([100, 110, 105, 100], 'failedPump'),
                            ([100, 97, 94, 90], 'continuedSelling')]:
            rows = self.replay(prices)
            self.assertEqual(rows[-2]['event'], 'quote')
            self.assertEqual(rows[-1]['bot'], bot)
            self.assertEqual(rows[-1]['event'], 'paperMark')
            self.assertLess(rows[-1]['estimatedPnlLamports'], 200000-90000-100000)

    def test_stale_chain_observation(self):
        for delay in (21, -1):
            rows = self.replay([100, 97, 94, 90], slot_delay=delay)
            self.assertEqual(rows[-1]['event'], 'quoteUnavailable')

    def test_initial_outage_restarts_observations(self):
        def first_round_unavailable(i, q):
            if i == 0:
                raise HTTPError('quote', 503, 'unavailable', {}, None)

        rows = self.replay([1, 100, 97, 94, 90], first_round_unavailable)
        self.assertEqual([r['event'] for r in rows], [
            'quoteUnavailable', 'initialRoundRetry', 'quote', 'quote', 'quote',
            'paperOpen', 'quote', 'paperMark'])
        self.assertEqual(rows[5]['at'], 1180)

    def test_outage_retry_is_bounded_and_status_specific(self):
        for code, attempts in [(502, 2), (503, 2), (504, 2), (404, 1), (429, 1)]:
            def unavailable(i, q):
                raise HTTPError('quote', code, 'unavailable', {}, None)

            rows = self.replay([100, 100], unavailable)
            self.assertEqual(sum(r['event'] == 'quoteUnavailable' for r in rows), attempts)
            self.assertFalse(any(r['event'] == 'paperOpen' for r in rows))

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

class MarketSelection(unittest.TestCase):
    def token(self, mint, first='1970-01-02T00:00:00+00:00'):
        return dict(id=mint, firstPool=dict(createdAt=first), launchpad='pump.fun')

    def test_listed_sample_checks_identity_age_and_cap(self):
        listed = [c*32 for c in 'abcdefghij']
        tokens = [self.token(m) for m in listed[:7]]
        tokens.extend([self.token(listed[7], '1970-01-01T00:00:00+00:00'),
                       self.token(listed[8], 'invalid'), self.token('z'*32)])
        responses = {MARKET_PAGE: {'items': [dict(mint=m) for m in listed]},
                     TOKENS+'/search?query='+','.join(listed): tokens}
        events = []
        selected = cohort(lambda url, age: responses[url], 90000, events.append)
        self.assertEqual(list(selected), listed[:6])
        self.assertEqual(events[-1]['source'], 'listedWithLiquidity')

    def test_empty_directory_skips_metadata(self):
        events = []
        self.assertEqual(cohort(lambda url, age: {MARKET_PAGE: {'items': []}}[url],
                                90000, events.append), {})
        self.assertEqual(events[-1]['listedSample'], 0)

    def test_unavailable_directory_labels_fallback(self):
        def fetch(url, age):
            if url == MARKET_PAGE:
                raise HTTPError(url, 503, 'unavailable', {}, None)
            self.assertEqual(url, TOKENS+'/recent?limit=100')
            return [self.token(MINT)]
        events = []
        self.assertEqual(list(cohort(fetch, 90000, events.append)), [MINT])
        self.assertEqual(events[0]['status'], 503)
        self.assertEqual(events[-1]['source'], 'recentLaunchFallback')
