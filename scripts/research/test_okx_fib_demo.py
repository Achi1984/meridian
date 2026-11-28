import unittest
from decimal import Decimal as D
from unittest.mock import Mock, patch

import okx_fib_demo as fib


class FibDemoTests(unittest.TestCase):
    def test_mirrored_zone_reclaim_and_no_premature_entry(self):
        def bar(t, o, h, l, c):
            return (t, *map(D, (o,h,l,c)))
        bars=[bar(i,106,108,104,106) for i in range(24)]
        bars[1]=bar(1,104,109,100,106)
        bars[19]=bar(19,115,120,114,118)
        bars.extend([bar(24,110,111,108,109),bar(25,109,113,109,112)])
        self.assertEqual(fib.signal(bars,D(".1"))["side"],"buy")
        mirrored=[(t,220-o,220-l,220-h,220-c) for t,o,h,l,c in bars]
        self.assertEqual(fib.signal(mirrored,D(".1"))["side"],"sell")
        self.assertIsNone(fib.signal(bars[:-1]+[bar(25,109,113,108,109)],D(".1")))
        self.assertFalse(fib.worthwhile(D(119),D(108),D(120),1))

    def test_paper_stop_first_and_gap(self):
        t=dict(state="open",side="buy",entry="100",stop="95",target="110",next=10)
        fib.mark_paper(t,[(10,D(91),D(112),D(90),D(110))],10)
        self.assertEqual((t["state"],t["exit"]),("closed","91"))
        t.update(state="open",next=5)
        fib.mark_paper(t,[(10,1,1,1,1)],10)
        self.assertEqual(t["state"],"data_gap")

    def test_reserve_before_post_and_reconcile_missing(self):
        journal=Mock()
        journal.data={"demo":[]}
        signal=dict(side="sell",frame="4H",bar=1,target="99",stop="101")
        def ambiguous(*args):
            journal.save.assert_called_once()
            self.assertEqual(journal.data["demo"][0]["state"],"reserved")
            raise TimeoutError
        with patch.object(fib,"request",side_effect=ambiguous), self.assertRaises(TimeoutError):
            fib.execute((),journal,signal,D(100))
        with patch.object(fib,"read_order",return_value=None):
            fib.reconcile((),journal.data["demo"][0])
        self.assertEqual(journal.data["demo"][0]["state"],"reserved")
