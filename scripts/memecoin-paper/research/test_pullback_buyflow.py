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
            if url.endswith('/trades'):
                return {'data':[]}
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


class VariantTests(unittest.TestCase):
    def position(self):
        from pullback_variants import initial
        return dict(**initial(20_000_000),pool='pool',quantity=101,entryAt=100,due=86400,
                    state='open',selected=True)

    def test_confirmation_and_skipped_quote_window(self):
        from pullback_variants import confirm
        p=self.position()
        row=dict(pool='pool',mint='m',buys=6,sells=4)
        with patch('pullback_variants.snapshot',return_value=row):
            confirm('m',p,lambda *_:{'data':{}},lambda src,dst,qty:102 if src==USDC else 20_000_000,lambda:401)
        self.assertEqual(p['B']['state'],'open')
        self.assertEqual(p['B']['quantity'],102)
        late=self.position()
        confirm('m',late,None,None,lambda:461)
        self.assertEqual(late['B']['state'],'missedWindow')

    def test_quarter_rounding_and_three_fees(self):
        from pullback_variants import observe
        p=self.position()
        quotes={101:41_000_000,25:9_000_000,76:30_000_000}
        def quote(src,dst,qty):
            return quotes[qty]
        observe('m',p,None,quote,lambda:200)
        self.assertEqual(p['C']['soldQuantity'],25)
        self.assertEqual(p['C']['saleAt'],200)
        p.update(state='closed',netUsdc=20.9,exitAt=86400)
        observe('m',p,None,quote,lambda:86401)
        self.assertAlmostEqual(p['C']['netUsdc'],18.85)
        self.assertEqual(p['follow48']['state'],'pending')
        observe('m',p,None,quote,lambda:172801)
        self.assertEqual(p['follow48']['state'],'closed')

    def test_failed_partial_quote_stays_unpriced(self):
        from pullback_variants import observe
        p=self.position()
        def quote(src,dst,qty):
            if qty==101:return 41_000_000
            raise ValueError('no partial quote')
        observe('m',p,None,quote,lambda:200)
        observe('m',p,None,quote,lambda:230)
        self.assertEqual(p['C']['state'],'unpriced')

    def test_monitoring_continues_inside_busy_discovery(self):
        from pullback_variants import initial
        p = dict(**initial(20_000_000), pool='p', quantity=10, entryAt=0,
                 state='open', due=86400, selected=True)
        stamp = [295]
        ledger = {'m':p}
        def discovery(at, read):
            for i in range(15):
                read('candidate', 30)
            return []
        def fetch(url, age):
            if url=='candidate':
                stamp[0]+=13
            return {'data':{}}
        with patch('pullback_buyflow.sample',side_effect=discovery), patch(
                'pullback_variants.snapshot',return_value=dict(mint='m',pool='p',buys=7,sells=3)):
            tick(ledger,fetch,lambda *_:20_000_000,lambda:stamp[0],lambda:None)
        self.assertEqual(p['B']['state'],'open')
        self.assertLessEqual(p['B']['decisionAt'],360)
        self.assertGreater(p['C']['marks'],1)

    def test_due_confirmation_precedes_seven_slow_marks(self):
        from pullback_buyflow import monitor
        stamp = [400]
        ledger = {str(i):self.position() for i in range(7)}
        for p in ledger.values():
            p['B']['state']='skippedSignal'
        ledger['m']=self.position()
        def quote(*_):
            stamp[0]+=10
            return 20_000_000
        with patch('pullback_variants.snapshot',return_value=dict(pool='pool',mint='m',buys=7,sells=3)):
            monitor(ledger,lambda *_:{'data':{}},quote,lambda:stamp[0],lambda:None)
        self.assertEqual(ledger['m']['B']['state'],'open')
        self.assertLessEqual(ledger['m']['B']['decisionAt'],460)

    def test_failed_marks_rotate_across_reloads(self):
        import json
        from pullback_buyflow import monitor
        ledger = {mint: self.position() for mint in ('missing', 'first', 'second')}
        attempts = []
        def quote(mint, *_):
            attempts.append(mint)
            if mint == 'missing':
                raise ValueError('no quote')
            return 20_000_000
        for p in ledger.values():
            p['B']['state'] = 'skippedSignal'
        for at in range(800, 803):
            monitor(ledger, None, quote, lambda: at, lambda: None, max_marks=1)
            ledger = json.loads(json.dumps(ledger))
        self.assertEqual(attempts, list(ledger))
        self.assertEqual(ledger['missing']['C']['marks'], 0)

    def test_discovery_limits_background_marks_per_pass(self):
        from pullback_buyflow import monitor
        now = 800
        ledger = {str(i):self.position() for i in range(20)}
        for i,p in enumerate(ledger.values()):
            p['B']['state']='skippedSignal'
            p['C']['lastMarkAt']=110+i
        for _ in range(3):
            monitor(ledger,None,lambda *_:20_000_000,lambda:now,lambda:None,max_marks=1)
        self.assertEqual([p['C']['marks'] for p in ledger.values()], [1]*3+[0]*17)
