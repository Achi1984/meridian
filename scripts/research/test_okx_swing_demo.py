import unittest
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import patch

import okx_swing_demo as pilot


class SwingDemoTest(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 28, tzinfo=timezone.utc)
        self.rows = {}
        self.pos = Decimal(0)
        self.orders = []
        self.signal = {"flatStartSignal": "FLAT", "trend": -1}
        self.latest = "in"
        for name, effect in (
                ("order", lambda keys, cid: self.rows.get(cid)),
                ("observe", lambda *args: self.signal),
                ("check", lambda keys: {"tickSz": "0.1"}),
                ("get", self.get), ("place", self.place),
                ("verify_position", lambda keys, expected: self.assertEqual(expected, self.pos))):
            mock = patch.object(pilot, name, side_effect=effect)
            mock.start()
            self.addCleanup(mock.stop)

    def get(self, path, keys, **query):
        if "books" in path:
            return [{"ts": int(pilot.time.time()*1000), "bids": [["59999"]], "asks": [["60000"]]}]
        if "fills-history" in path:
            return [{"ordId": self.latest}]
        return []

    def place(self, keys, cid, **fields):
        self.orders.append(fields)
        self.pos += pilot.SIZE if fields["side"] == "buy" else -pilot.SIZE
        self.rows[cid] = dict(side=fields["side"], accFillSz=str(pilot.SIZE), feeCcy="USDC",
                              fee="-0.003", pnl="0.1", ordId="in" if cid == pilot.ENTRY else "out")
        return self.rows[cid]

    def evaluate(self):
        return pilot.run((), self.now, [])

    def test_flat(self):
        self.assertEqual(self.evaluate()["action"], "wait")
        self.assertFalse(self.orders)

    def test_short_hold_then_exit_and_reconcile(self):
        self.signal["flatStartSignal"] = "SHORT"
        self.assertEqual(self.evaluate()["action"], "hold")
        self.signal["flatStartSignal"] = "FLAT"
        self.assertEqual(self.evaluate()["action"], "hold")
        self.signal["trend"] = 0
        self.assertEqual(self.evaluate()["realizedAfterTradingFeesUSDC"], "0.094")
        self.assertEqual(self.evaluate()["action"], "closed")
        self.assertEqual([o["side"] for o in self.orders], ["sell", "buy"])
        self.assertTrue(self.orders[-1]["reduceOnly"])

    def test_no_exit_if_another_trader_touched_position(self):
        self.signal.update(flatStartSignal="LONG", trend=1)
        self.evaluate()
        self.latest = "other"
        self.signal["trend"] = 0
        with self.assertRaises(pilot.PreflightError):
            self.evaluate()
        self.assertEqual(len(self.orders), 1)

    def test_deadline_closes_long_without_spot_data(self):
        self.signal.update(flatStartSignal="LONG", trend=1)
        self.evaluate()
        self.now = self.now.replace(month=12, day=5)
        self.assertEqual(self.evaluate()["action"], "closed")

    def test_no_late_entry(self):
        self.now = self.now.replace(month=12, day=2)
        self.assertEqual(self.evaluate()["action"], "entry window ended")
        self.assertFalse(self.orders)
