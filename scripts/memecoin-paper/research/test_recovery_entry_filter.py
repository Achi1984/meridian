import unittest
from recovery_entry_filter import decisions


class EntryFilterTests(unittest.TestCase):
    def test_decision_uses_fresh_same_size_quote_and_strict_threshold(self):
        initial = dict(event='resaleMark', arm='early', session=1, mint='m', tick=0, qty=3, usdcRaw=100, at=0)
        current = dict(initial, tick=1, at=50, usdcRaw=111)
        entry = dict(initial, event='entry', arm='wave', at=140)
        key = (1, 'm')
        def decide(mark, order):
            return decisions([initial, mark, order], cutoff=140).get(key)
        self.assertEqual(decide(current,entry), 'skipExtended')
        self.assertEqual(decide(dict(current,usdcRaw=110),entry),'followBaseline')
        for mark in (dict(current,at=49), dict(current,qty=2), dict(current,at=141)):
            self.assertEqual(decide(mark,entry),'followBaselineNoFreshReference')
        self.assertIsNone(decide(current,dict(entry,at=139)))
        gap = dict(current,event='missingExitQuote')
        self.assertEqual(decisions([initial,current,gap,entry],0)[key],'followBaselineNoFreshReference')

    def test_comparison_uses_shared_closes_and_groups_repeat_mints(self):
        from newcomer_eight_hour import Account, FEE, SIZE, UNIT
        from recovery_entry_filter import compare

        events = [dict(event='start', session=0, at=0)]
        accounts = {key:Account(policy) for key,policy in zip('ABC',['trailing','standard','fixed'])}
        for session, mint, final_net in [(1,'m',3), (2,'m',4), (3,'n',5), (4,'open',None)]:
            base = dict(session=session, mint=mint, qty=10, arm='wave')
            rows = [dict(base,event='entry',at=session*10),
                    dict(base,event='resaleMark',at=session*10,usdcRaw=SIZE)]
            if final_net is not None:
                rows.extend([dict(base,event='resaleMark',at=session*10+1,usdcRaw=SIZE+2*FEE-3*UNIT),
                             dict(base,event='exit',at=session*10+2,usdcRaw=SIZE+2*FEE+final_net*UNIT)])
            for row in rows:
                events.append(row)
                for account in accounts.values():
                    account.update(row,session)
        status = dict(startedAt=0,updatedAt=40,lastEvent='resaleMark',session=4,
                      accounts={key:a.snapshot() for key,a in accounts.items()})
        report = compare(events,status,cutoff=0)
        self.assertEqual(report['withoutBestIncludedUsdc'],5)
        paired = report['matchedExitComparison']
        self.assertEqual((paired['matched'],paired['unmatched']),(3,1))
        self.assertEqual(paired['filterOnlyUsdc'],12)
        self.assertEqual(paired['filterAndStopUsdc'],-9)
        self.assertEqual(paired['stopDeltaOnKeptUsdc'],-21)
