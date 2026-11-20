import unittest

from regime_breakout import Account, regime, signals
from worker import STEP


class RegimeBreakoutTests(unittest.TestCase):
    def test_regime_uses_sixty_completed_closes(self):
        self.assertEqual(regime(list(range(60))), 1)
        self.assertEqual(regime(list(reversed(range(60)))), -1)
        for closes in [[1]*60, list(range(59)), [None]+list(range(59))]:
            self.assertEqual(regime(closes), 0)

    def test_failed_breakdown_blocks_only_after_reclaim(self):
        bars = [[i*STEP, 100, 102, 98, 100] for i in range(11)]
        bars[6][3:] = [95, 96]
        bars[7][3:] = [95, 99]
        bars[8][3:] = [96, 97]
        events = dict(signals(bars, 97))
        self.assertEqual(events[7*STEP][:2], (-1, False))
        self.assertEqual(events[8*STEP][:2], (0, True))
        self.assertEqual(events[9*STEP][:2], (-1, True))

    def test_short_costs_and_positive_funding_receipt(self):
        account = Account()
        account.target(-1, 100)
        account.settle(.001, 100, 100)
        account.target(0, 90)
        expected = 100*.9999*.999*.9995 - 90*1.0001*1.001*1.0005 + .1
        self.assertAlmostEqual(account.net, expected)
        self.assertEqual((account.wins, account.trades), (1, 1))
        self.assertAlmostEqual(account.funding, -.1)

    def test_reversal_realizes_and_rebalances_once(self):
        account = Account()
        account.target(1, 100)
        account.target(1, 120)
        self.assertEqual(account.quantity, 1)
        account.target(-1, 125)
        self.assertEqual(account.quantity, -.8)
        self.assertEqual(account.trades, 1)
        account.settle(None, None, 125)
        self.assertAlmostEqual(account.funding, .1)
        self.assertEqual(account.missing_funding, 1)
