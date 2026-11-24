import unittest
from newcomer_stop_replay import score


class StopReplayTest(unittest.TestCase):
    def path(self, values, closed=True):
        common = dict(arm='early', mint='m', qty=3)
        rows = [dict(event='entry', at=0, usdc=20, **common)]
        rows.extend(dict(event='resaleMark', at=i*60, tick=i, usdcRaw=v, **common)
                    for i,v in enumerate(values))
        if closed:
            rows.append(dict(event='exit', usdcRaw=values[-1], netUsdc=(values[-1]-20100000)/1e6, **common))
        return score('m', rows)

    def test_threshold_and_later_recovery(self):
        r = self.path([19500000,18100000,22000000])
        self.assertEqual((r['tightNet'],r['baselineNet'],r['delta']),(-2,1.9,-3.9))

    def test_gap_through_both_stops(self):
        r = self.path([19600000,1000])
        self.assertEqual((r['delta'],r['changedExit'],r['tightNet']),(0,False,-20.099))

    def test_unresolved_baseline_does_not_create_paired_delta(self):
        r = self.path([19500000,17500000],False)
        self.assertIsNone(r['delta'])
        self.assertEqual((r['baselineZeroRecovery'],r['tightZeroRecovery']),(-20.05,-2.6))
