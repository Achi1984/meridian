import unittest
from btc_grid_paper import FEE, settle


class GridFeeTests(unittest.TestCase):
    def test_only_filled_orders_accumulate_fees_once(self):
        account = {"cash": 500, "btc": 5, "fills": 0, "fees": 0.0}
        orders = [(1, 99, 20), (-1, 101, 30)]
        settle(account, orders, (100, 100, 100, 100), 1)
        self.assertEqual(account["fees"], 0)
        equity = settle(account, orders, (100, 105, 95, 100), 1)
        self.assertEqual(account["fills"], 2)
        self.assertAlmostEqual(account["fees"], 50*FEE)
        self.assertAlmostEqual(equity, 1000+20/99+30/101-50*FEE)
