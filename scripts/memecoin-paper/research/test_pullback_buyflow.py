import unittest
from unittest.mock import patch
from pullback_buyflow import accepts, age_ok, summary, tick, USDC


class PullbackTests(unittest.TestCase):
    def test_signal_boundaries(self):
        self.assertTrue(accepts(-1, 6, 4))
        for inputs in [(0, 6, 4), (-1, 5, 4), (-1, 5, 5), (float('nan'), 6, 4)]:
            self.assertFalse(accepts(*inputs))
        self.assertTrue(age_ok(6600))
        self.assertFalse(age_ok(7201))

    def test_paired_entry_idempotent_and_fee_adjusted_exit(self):
        stamp = [7000]
        ledger = {}
        rows = [dict(mint=m, pool=m, quote=USDC, created='1970-01-01T00:00:00Z',
                     liquidity=10000, buys=6, sells=4) for m in ['yes','no']]
        def fetch(url, age):
            row = next(r for r in rows if url.endswith('/'+r['pool']))
            return {'data':dict(**row, attributes={'price_change_percentage':{'h1':-2 if row['mint']=='yes' else 1}})}
        def quote(src,dst,amount):
            return 150 if src==USDC else 20_000_000
        def scan():
            return tick(ledger, fetch, quote, lambda:stamp[0], lambda:None)
        with patch('pullback_buyflow.sample',return_value=rows), patch('pullback_buyflow.snapshot',side_effect=lambda x:x):
            self.assertEqual(scan()['newObservations'],2)
            self.assertEqual(scan()['newObservations'],0)
            self.assertEqual(summary(ledger)['pullbackBuyflow']['open'],1)
            stamp[0]=86400
            scan()
        self.assertEqual(summary(ledger)['allComparable']['realizedUsdc'],-.2)
        self.assertEqual(summary(ledger)['pullbackBuyflow']['realizedUsdc'],-.1)

    def test_missing_quote_not_counted_as_closed(self):
        ledger={'m':dict(state='open',selected=True,due=86400,quantity=1)}
        def fail(*args):
            raise ValueError('missing')
        with patch('pullback_buyflow.sample',return_value=[]):
            tick(ledger,None,fail,lambda:86405,lambda:None)
            self.assertEqual(ledger['m']['state'],'open')
            tick(ledger,None,fail,lambda:88201,lambda:None)
        self.assertEqual(summary(ledger)['pullbackBuyflow']['unpriced'],1)
        self.assertIsNone(summary(ledger)['pullbackBuyflow']['withoutBestUsdc'])
