import unittest
from collections import Counter
from datetime import datetime, timezone

from new_pool_watch import WSOL
from pool_funnel import audit


class FunnelTest(unittest.TestCase):
    def test_counts_pools_and_overlapping_failures(self):
        first = dict(at=100, event='firstSeen', mint='a', pool='A', quote=WSOL,
                     created=datetime.fromtimestamp(0, timezone.utc).isoformat(), dex='pump-fun',
                     price=1, liquidity=10000, buys=4, sells=3, volume=4000)
        again = dict(first, event='seenAgain', at=160, price=1.2)
        rows = [first, dict(first,pool='B'), dict(again,price=1), again, again,
                dict(again,pool='B',volume=0,price=1),
                dict(event='momentumCandidate',pool='A'), dict(event='quoteUnavailable',side='sell')]
        summary = dict(events=dict(Counter(r['event'] for r in rows)),pools=2,ticks=2,
                       account={'equityUsdc':None})
        report = audit(rows, summary)
        self.assertEqual(report['distinctPools']['signal'], 1)
        self.assertEqual(report['distinctPools']['launchpad'], 2)
        self.assertEqual(report['failedAtLeastOnceAmongNeverConfirmed'], {'priceMomentum':1,'volume':1})
        self.assertEqual(report['entryDiagnostics']['neverPassed'], {
            'tokenPair':0,'priceMomentum':1,'liquidity':0,'volume':1,'orderFlow':0})
        self.assertEqual(report['entryDiagnostics']['onlyZeroLiquidity'], 0)
        self.assertEqual(report['quoteErrorsBySide'], {'sell':1})
        self.assertIsNone(report['account']['equityUsdc'])
        with self.assertRaises(ValueError):
            audit(rows[:-1], summary)

    def test_floor_replay_uses_first_signal_and_bounded_followup(self):
        first = dict(event='firstSeen', at=0, created='1970-01-01T00:00:00+00:00',
                     mint='a',quote=WSOL,pool='A',dex='pump-fun',price=1,liquidity=4000,
                     volume=4000,buys=4,sells=3)
        signal = dict(first,event='seenAgain',at=60,price=2,liquidity=6000)
        rows = [first,dict(first,pool='B'),signal,dict(signal,pool='B'),
                dict(signal,at=359,price=4),dict(signal,at=360,price=1),
                dict(signal,pool='B',at=421,price=4)]
        result=audit(rows,dict(events=dict(Counter(r['event'] for r in rows)),pools=2,ticks=8,account={}))
        self.assertEqual(result['liquidityFloorComparison']['10000']['signalPools'],0)
        self.assertEqual(result['liquidityFloorComparison']['5000'],
                         dict(signalPools=2,pricedAtFiveMinutes=1,missingAtFiveMinutes=1,
                              medianPriceChangePct=-50))

    def test_confirmation_is_single_use_and_outcome_starts_at_confirmation(self):
        from new_pool_watch import PersistenceStudy
        study=PersistenceStudy()
        base=dict(pool='p',mint='a',quote=WSOL,price=1,liquidity=4000,volume=4000,
                  buys=6,sells=3,dex='pump-fun',created='1970-01-01T00:00:00Z')
        def observe(pool,now,price):
            study.observe(dict(base,pool=pool),dict(base,pool=pool,liquidity=6000,price=price),now,now)
        for pool in ('p','q','r'):
            observe(pool,60,2)
        self.assertEqual(study.due(120),['p','q','r'])
        observe('q',120,1.99)
        observe('q',121,3)
        observe('p',120,2.5)
        observe('p',360,7)
        self.assertFalse(study.returns)
        self.assertEqual(study.due(420),['p'])
        observe('p',420,2)
        self.assertAlmostEqual(study.returns['p'],-20)
        self.assertEqual(study.rejected,{'q'})
        self.assertNotIn('r',study.confirmed)
