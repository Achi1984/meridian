import unittest
from datetime import datetime, timezone

from spot_session_shock import trade_day


class SessionShockTest(unittest.TestCase):
    def test_signal_uses_completed_candle_and_entry_uses_next_open_in_both_seasons(self):
        for month, hour in [(1, 14), (6, 13)]:
            day = int(datetime(2026, month, 5, tzinfo=timezone.utc).timestamp())
            entry = day + hour * 3600 + 1800
            exit_slot = entry + 380 * 60
            bars = [[t, 100, 100, 100, 100] for t in range(day, exit_slot + 600, 600)]
            bars[(entry-day)//600-1][4] = 97
            bars[-1][1] = 101
            label, (net, gross) = trade_day(day, bars)
            self.assertEqual(label, 'afterDrop')
            self.assertAlmostEqual(gross, 1)
            self.assertLess(net, 0)
            self.assertEqual(trade_day(day, bars[:-1]), ('afterDrop', None))

    def test_gap_before_decision(self):
        self.assertEqual(trade_day(0, []), ('missingSignal', None))
