import unittest
from decimal import Decimal as D
from unittest.mock import Mock, patch
import okx_filter_demo as bot
from okx_short_filter import decide


class FilterDemoTests(unittest.TestCase):
    def test_mirrored_veto(self):
        now = 7200000
        oi = [(now, "11"), (now-3600000, "10")]
        for side, rate, accepted in [("LONG", ".01", False), ("SHORT", ".01", True),
                                     ("SHORT", "-.01", False), ("LONG", "-.01", True)]:
            funding = dict(instId="BTC", ts=now, fundingRate=rate)
            self.assertEqual(decide(side, funding, oi, now, "BTC")["filtered"+side.title()], accepted)

    def test_paired_demo(self):
        for side, accepted in [("LONG", True), ("SHORT", True), ("SHORT", False), ("LONG", False)]:
            with self.subTest(side=side, accepted=accepted):
                self.simulate(side, accepted)

    def simulate(self, side, accepted):
        journal = Mock(data={"sessions": {}})
        signal = dict(status="EVALUATED", lastSessionUtc="2026-11-27", flatStartSignal=side,
                      filteredLong=side=="LONG" and accepted, filteredShort=side=="SHORT" and accepted)
        orders = {}
        def send(keys, cid, direction, closing, price=None):
            orders[cid] = dict(ordId=cid, feeCcy="USDC", fee="-0.003", avgPx="60000",
                               pnl="0", accFillSz=str(bot.SIZE), side=direction, closing=closing)
        book = dict(ts=1000000, bids=[["59999","1"]], asks=[["60000","1"]])
        with (patch.object(bot, "observation", return_value=signal),
              patch.object(bot, "quote", return_value=(book, D(59999), D(60000))),
              patch.object(bot.pilot, "entry_price", return_value="60000"),
              patch.object(bot, "send", side_effect=send),
              patch.object(bot, "read_order", side_effect=lambda k,c,*_: orders.get(c)),
              patch.object(bot, "get", side_effect=lambda path,*a,**kw: [] if "pending" in path else [{"ordId":"MerF20261127I"}]),
              patch.object(bot, "check", return_value={"tickSz":".1"}),
              patch.object(bot, "verify_position"), patch.object(bot, "datetime") as clock):
            clock.now.return_value.date.return_value.isoformat.return_value="2026-11-28"
            bot.run((), journal)
            bot.run((), journal)
        trade=journal.data["sessions"]["2026-11-27"]
        self.assertEqual(trade["state"], "closed")
        self.assertEqual(len(orders), 2 if accepted else 0)
        self.assertEqual(trade["modelFiltered"], trade["modelBase"] if accepted else "0")
        if accepted:
            self.assertEqual(orders["MerF20261127I"]["side"], "buy" if side=="LONG" else "sell")
            self.assertTrue(orders["MerF20261127O"]["closing"])
            self.assertEqual(D(trade["demoAfterFees"]), D("-.006"))
