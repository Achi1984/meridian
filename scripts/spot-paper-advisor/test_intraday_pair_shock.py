import unittest
from collections import Counter
from math import log
from intraday_pair_shock import DAY, STEP, Pair, exit_reason, session


class PairShockTests(unittest.TestCase):
    def test_signed_boundaries_for_both_directions(self):
        for shock in (.04, -.04):
            self.assertEqual(exit_reason(shock/2, 0, shock, STEP), 'halfReverted')
            self.assertEqual(exit_reason(1.5*shock, 0, shock, STEP), 'extended')
            self.assertEqual(exit_reason(shock, 0, shock, 10800), 'timeout')

    def test_signal_close_trades_next_open_and_closes_both_legs(self):
        slots = range(0, DAY, STEP)
        ratios = dict.fromkeys(slots, 0.)
        ratios[6*STEP] = log(1.04)
        prices = dict.fromkeys(slots, 100.)
        prices[7*STEP] = 104.
        pairs = [Pair(), Pair()]
        exits = Counter()
        session(0, ratios, [(prices,{},{}),(dict.fromkeys(slots, 100.),{},{})], pairs, exits)
        self.assertEqual(exits, {'halfReverted':1})
        self.assertGreater(pairs[0].result()['net'], 1)
        self.assertLess(pairs[1].result()['net'], -1)
        self.assertTrue(all(a.quantity == 0 for p in pairs for a in p.legs))

    def test_late_entry_liquidates_at_last_open(self):
        slots = range(0, DAY, STEP)
        ratios = dict.fromkeys(slots, 0.)
        ratios[DAY-3*STEP] = .04
        markets = [(dict.fromkeys(slots, 100.), {}, {})]*2
        pairs, exits = [Pair(), Pair()], Counter()
        session(0, ratios, markets, pairs, exits)
        self.assertEqual(exits, {'dayClose':1})
        self.assertLess(pairs[0].result()['net'], 0)
