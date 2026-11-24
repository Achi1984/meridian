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

    def test_rejection_cost_includes_rare_winner_and_separates_missing_exits(self):
        ledger = {i: dict(selected=False, state='closed', netUsdc=pnl)
                  for i, pnl in enumerate([-18, -12, 180, 0])}
        ledger.update(holding=dict(selected=False, state='open'),
                      missing=dict(selected=False, state='unpriced'),
                      accepted=dict(selected=True, state='closed', netUsdc=20))
        rows = summary(ledger)
        audit = rows['rejectedComparable']
        self.assertEqual(audit, dict(total=6, closed=4, open=1, unpriced=1,
                                    avoidedLossUsdc=30, missedProfitUsdc=180,
                                    selectionBenefitUsdc=-150, missedNet10x=1))
        self.assertEqual(audit['selectionBenefitUsdc'],
                         rows['pullbackBuyflow']['realizedUsdc'] - rows['allComparable']['realizedUsdc'])
        self.assertIsNone(summary({})['rejectedComparable']['selectionBenefitUsdc'])

    def test_delayed_entry_reprices_and_checks_all_horizons(self):
        from pullback_buyflow import follow_second_look
        row = dict(pool='p', mint='m', liquidity=5000, buys=6, sells=4)
        position = dict(selected=False, state='open', pool='p', entryAt=7200,
                        due=86400, liquidityUsd=5000, secondLook={'state': 'waiting'})
        def quote(src, dst, amount):
            if src == USDC:
                self.assertEqual(amount, 20_000_000)
                return 77
            self.assertEqual(amount, 77)
            return 21_000_000
        def run(at):
            follow_second_look('m', position, lambda *args: {'data': row}, quote, lambda: at, lambda: None)
        with patch('pullback_buyflow.snapshot', side_effect=lambda x:x):
            run(8999)
            self.assertEqual(position['secondLook']['state'], 'waiting')
            run(9000)
            for h in (2, 3, 6, 12):
                run(9000+h*3600)
            run(86400)
        stats = summary({'m':position})['secondLook30m']
        self.assertEqual(stats['closed'], 1)
        for key in ('2h','3h','6h','12h','exit'):
            self.assertEqual(stats[key]['netVsSkipUsdc'], .9)

    def test_missed_confirmation_is_not_backfilled(self):
        from pullback_buyflow import follow_second_look
        p = dict(entryAt=0, secondLook={'state':'waiting'})
        follow_second_look('m', p, None, None, lambda:1921, lambda:None)
        self.assertEqual(p['secondLook']['state'], 'missedWindow')
