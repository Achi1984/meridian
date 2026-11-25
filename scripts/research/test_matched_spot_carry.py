import unittest
from decimal import Decimal as D
from matched_spot_carry import economics


class CarryTests(unittest.TestCase):
    def test_equal_moves_cancel_and_negative_funding_is_paid(self):
        result=economics(D(100),D(110),D(100),D(110),D('-0.2'))
        self.assertEqual(result['basisUsdt'],0)
        self.assertEqual(result['fundingUsdt'],-1)
        self.assertAlmostEqual(result['costUsdt'],2.205)
        self.assertAlmostEqual(result['netUsdt'],-3.205)
