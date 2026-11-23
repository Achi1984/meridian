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
