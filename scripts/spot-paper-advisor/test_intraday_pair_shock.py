import unittest
from collections import Counter
from math import log
from datetime import datetime, timezone
from regime_breakout import Account
from intraday_pair_shock import DAY, STEP, Pair, exit_reason, session, us_session


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

    def test_new_york_entry_on_next_open_and_close_based_exit_in_both_seasons(self):
        for month, hour in [(1, 14), (7, 13)]:
            day = int(datetime(2024, month, 2, tzinfo=timezone.utc).timestamp())
            start = day+hour*3600+1800
            slots = range(day,day+DAY,STEP)
            series = {t: [t,100,101,99,100] for t in slots}
            entry = start+3*STEP
            series[entry-STEP][4] = 101
            series[entry][4] = 105
            prices = dict.fromkeys(slots, 100.)
            prices[entry+STEP] = 104.
            markets = [(prices,{}, {})]*2
            accounts = [Account(), Account()]
            us_session(day, (series,series), markets, accounts)
            self.assertTrue(all(a.trades == 1 and a.quantity == 0 and a.net > 3 for a in accounts))
