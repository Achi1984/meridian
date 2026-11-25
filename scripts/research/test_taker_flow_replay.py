import unittest
from taker_flow_sensitivity import summarize
from taker_flow_replay import HOUR, classify


class FlowTests(unittest.TestCase):
    def test_signed_flow_uses_only_seven_prior_same_hours(self):
        t = 10*24*HOUR
        shares = {t-i*24*HOUR:0.6 for i in range(1,8)}
        shares.update({t:0.55,t+HOUR:0.9})
        self.assertFalse(classify(shares,dict(at=t,side=1)))
        shares[t] = 0.45
        self.assertTrue(classify(shares,dict(at=t,side=-1)))
        del shares[t-7*24*HOUR]
        with self.assertRaises(KeyError):
            classify(shares,dict(at=t,side=-1))

    def test_overlap_is_per_instrument_and_exit_allows_new_entry(self):
        rows = [dict(asset=a,signalHour=t*HOUR,netPct=v) for a,t,v in
                [('BTC',10,2),('BTC',11,8),('ETH',11,-1),('BTC',13,-1)]]
        r = summarize(rows)
        self.assertEqual(r['nonOverlappingPerInstrument'],3)
        self.assertEqual(r['meanNonOverlappingPct'],0)
        self.assertEqual(r['meanWithoutBestPct'],0)
