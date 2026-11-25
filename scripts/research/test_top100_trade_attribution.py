import unittest
from decimal import Decimal as D
from top100_trade_attribution import decompose, report


def trade(side):
    buys = side == 1
    return dict(instrument="X", side=side,
                entry=dict(ts=1, qty="2", bid="99", ask="101", price="102" if buys else "98"),
                exit=dict(ts=2, qty="2", bid="109", ask="111", price="108" if buys else "112"),
                beforeFunding="11.79" if buys else "-28.21", funding="-1",
                net="10.79" if buys else "-29.21")


class AttributionTest(unittest.TestCase):
    def test_both_directions(self):
        for side in (1, -1):
            t = trade(side)
            row = decompose(t)
            self.assertEqual(row["marketMove"], side * 20)
            self.assertEqual((row["spread"], row["slippage"]), (-4, -4))
            self.assertEqual(sum(v for k,v in row.items() if k != "net"), D(t["net"]))

    def test_unsettled_is_counted_separately(self):
        t = dict(trade(-1), net=None)
        result = report(dict(accounts=dict(direct=dict(open={"X": {}}, closed=[trade(1), t])),
                             observations=[dict(error="missing")]))
        direct = result["accounts"]["direct"]
        self.assertEqual((direct["open"], direct["pendingFunding"], result["failedSlots"]), (1, 1, 1))
        self.assertEqual(list(direct["settledBySide"]), ["long"])
        self.assertIsNone(direct["trades"][1]["net"])

    def test_inconsistent_ledger(self):
        for field in ("net", "beforeFunding"):
            with self.assertRaises(ValueError):
                decompose(dict(trade(1), **{field: "0"}))
