import unittest
from decimal import Decimal as D
from carry_forward_mark import DAY,exit_price,threshold


class ForwardMarkTests(unittest.TestCase):
    def test_partial_second_level(self):
        self.assertEqual(exit_price([['100','2'],['97','8']],D(3),True),99)
        with self.assertRaises(ValueError):
            exit_price([['100','2']],D(3),False)

    def test_signed_funding_and_deadline(self):
        r=threshold(D(1),D(-1),D(2),D(1),D(500),0,DAY)
        self.assertEqual(D(r['fundingStillNeededUsdt']),3)
        self.assertEqual(D(r['requiredMeanFundingBps']),20)
        self.assertEqual(D(r['netAtDoubleCostsUsdt']),-6)
        r=threshold(D(10),D(0),D(2),D(1),D(500),DAY,DAY)
        self.assertEqual(D(r['fundingStillNeededUsdt']),0)
        self.assertIsNone(r['requiredMeanFundingBps'])
