import unittest
from decimal import Decimal as D
from unittest.mock import patch
from carry_prior_windows import DAY, evaluate


class CarryWindowTests(unittest.TestCase):
    def test_fixed_qty_rollover_only_adds_cost_when_prices_are_flat(self):
        marks={t:D(100) for t in range(0,84*DAY+1,DAY//3)}
        rates={t:D('.0001') for t in marks}
        with patch('carry_prior_windows.series',return_value=marks):
            r=evaluate(('BTC',0,rates))
        self.assertEqual(r['settlements'],252)
        self.assertAlmostEqual(r['fundingUsdt'],12.6)
        self.assertAlmostEqual(r['netUsdt'],10.5)
        self.assertAlmostEqual(r['reopenSameQtyNetUsdt'],6.3)

    def test_missing_settlement_fails(self):
        with patch('carry_prior_windows.series',return_value={}):
            with self.assertRaisesRegex(ValueError,'cadence'):
                evaluate(('BTC',0,{}))
