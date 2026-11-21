import unittest
from wave_band_report import report


class BandReportTests(unittest.TestCase):
    def test_open_trade_deducts_only_cost_of_that_arm(self):
        rows = [dict(event='cohortSelection',mint='m',band='moderate'),
                dict(event='cohort',at=10,mints=['m'])]
        rows += [dict(event='entry',mint='m',arm=a,usdc=20) for a in ('early','wave')]
        rows += [dict(event='exit',mint='m',arm='early',netUsdc=40)]
        rows += [dict(event='summary',arm=a,entries=1,closed=int(a=='early'),unresolved=int(a=='wave')) for a in ('early','wave')]
        early,wave = report([rows])
        self.assertEqual((early['triples'],early['netIfUnpricedWorthZeroUsdc']), (1,40))
        self.assertEqual((wave['unresolved'],wave['netIfUnpricedWorthZeroUsdc']), (1,-20.05))

    def test_incomplete_log_rejected(self):
        with self.assertRaises(ValueError):
            report([[dict(event='cohort',at=10,mints=[])]])
