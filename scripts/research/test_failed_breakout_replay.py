import unittest

from failed_breakout_replay import HOUR, observations


class ReentryTests(unittest.TestCase):
    def observe(self, close):
        bars={i*HOUR:[100,101,99,100] for i in range(-25,5)}
        bars[-HOUR]=[100,104,99,103]
        bars[0]=[103,max(104,close),min(99,close),close]
        bars[HOUR]=[100,101,99,100]
        bars[4*HOUR]=[98,99,97,98]
        return observations(bars,{HOUR:.03,4*HOUR:.001},0,5*HOUR)[0]

    def test_entry_after_confirmation_funding_excludes_entry_time(self):
        r=self.observe(101)
        self.assertTrue(r['inside'])
        self.assertAlmostEqual(r['reversalNetPct'],1.8)
        self.assertAlmostEqual(r['continuationNetPct'],-2.4)

    def test_crossing_entire_range_does_not_count_as_reentry(self):
        self.assertFalse(self.observe(98)['inside'])
        self.assertFalse(self.observe(102)['inside'])
