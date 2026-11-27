import sqlite3
import tempfile
import unittest
from pathlib import Path

from demo_order_rehearsal import EntryRehearsal, replay


class RehearsalTests(unittest.TestCase):
    def setUp(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        self.entry = EntryRehearsal(db)
        self.entry.reserve("Test1", "1")
        self.order = dict(clOrdId="Test1", ordId="42", instId="BTC-USDT-SWAP",
                          side="buy", sz="1", state="partially_filled", accFillSz=".2")

    def test_restart_and_cancel_race(self):
        with tempfile.TemporaryDirectory() as folder:
            result = replay(Path(folder))
        self.assertTrue(result["recovery"]["lookupRequired"])
        self.assertTrue(result["stop"]["cancelRequired"])
        self.assertEqual(result["account"], dict(matched=True, remainingContracts="0.08", flat=False))

    def test_unmatched_and_regressive_snapshots(self):
        self.entry.observe(self.order)
        for change in [dict(ordId="41"), dict(clOrdId="Other"), dict(sz="2"),
                       dict(accFillSz=".1"), dict(state="filled"), dict(accFillSz="NaN")]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.entry.observe(dict(self.order, **change))
        self.assertEqual(self.entry.report()["filledContracts"], "0.2")

    def test_terminal_state_and_external_balance(self):
        self.entry.observe(dict(self.order, state="filled", accFillSz="1"))
        with self.assertRaises(ValueError):
            self.entry.observe(self.order)
        pos = dict(instId="BTC-USDT-SWAP", posSide="net", pos="1")
        for changed, orders in [(dict(pos, pos="0"), []), (pos, [self.order])]:
            with self.assertRaises(ValueError):
                self.entry.reconcile(changed, orders)
        self.assertFalse(self.entry.reconcile(pos, [])["flat"])

    def test_confirmed_rejection_and_timeout(self):
        with self.assertRaises(ValueError):
            self.entry.record_rejection("Test1", "50004")
        self.assertTrue(self.entry.report()["lookupRequired"])
        self.entry.record_rejection("Test1", "51008")
        self.assertFalse(self.entry.reserve("Test1", "1"))
        with self.assertRaises(ValueError):
            self.entry.observe(self.order)
        self.assertEqual(self.entry.report()["status"], "rejected")

    def test_stop_with_unknown_outcome(self):
        self.entry.stop()
        self.assertFalse(self.entry.reserve("Test1", "1"))
        with self.assertRaises(ValueError):
            self.entry.reserve("Different", "1")
        self.assertTrue(self.entry.report()["lookupRequired"])


if __name__ == "__main__":
    unittest.main()
