import unittest
from decimal import Decimal as D
from exit_study import barrier_exit


class BarrierTest(unittest.TestCase):
    def test_dual_touch_reports_both_bounds(self):
        bar = (D(98), D(104), D(100), D(101))
        self.assertEqual(barrier_exit([bar], D(100), D(101)), (D('98.5'), 'ambiguous'))
        self.assertEqual(barrier_exit([bar], D(100), D(101), True), (D(103), 'ambiguous'))

    def test_open_below_stop_and_fallback(self):
        gap = (D(96), D(99), D(97), D(98))
        calm = (D(99), D(101), D(100), D(100))
        self.assertEqual(barrier_exit([calm,gap], D(100), D(99)), (D(97), 'stop'))
        self.assertEqual(barrier_exit([calm], D(100), D(99)), (D(99), 'time'))
