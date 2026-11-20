from collections import deque
import unittest

from reclaim_history import breakout_slot
from worker import initial, STEP, DAY


class OpeningRangeTest(unittest.TestCase):
    def test_one_entry_per_day_and_no_fill_at_stop_level(self):
        day = DAY*100
        history = deque([[day+i*STEP, 100, 102, 98, 100] for i in range(6)])
        history.append([day+6*STEP, 101, 104, 101, 103])
        book = dict(ask=105, bid=104, askSize=1, bidSize=1)
        state = initial()
        self.assertEqual(breakout_slot(state, history, book, day+7*STEP)['execution'], 'PAPER_BUY')
        history.append([day+7*STEP, 104, 104, 98, 99])
        self.assertEqual(breakout_slot(state, history, dict(book, bid=97), day+8*STEP)['execution'], 'PAPER_SELL')
        self.assertLess(float(state['cash']), 993)
        history.append([day+8*STEP, 99, 104, 98, 103])
        self.assertEqual(breakout_slot(state, history, book, day+9*STEP)['execution'], 'HOLD')
