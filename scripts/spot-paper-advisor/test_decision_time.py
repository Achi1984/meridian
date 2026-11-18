import unittest
from unittest.mock import patch

import feeds
import worker


class DecisionTimeTest(unittest.TestCase):
    def test_later_prices_cannot_change_earlier_decision_inputs(self):
        slot = 100 * 3600 + 1200
        state = worker.initial()

        def replay(extra_bars, future_price):
            def kraken(path):
                if path.startswith('Depth'):
                    return dict(bids=[[100, 2, slot]], asks=[[101, 2, slot]])
                step = 300 if path.endswith('interval=5') else 3600
                end = slot - slot % step
                count = 72 if step == 300 else 24
                rows = []
                for index in range(-count, extra_bars + 1):
                    price = 100 + index / 10 if index < 0 else future_price
                    rows.append([end + index * step, price, price + 1, price - 1,
                                 price, 0, 0, 0])
                return rows

            with patch.object(feeds, '_kraken', side_effect=kraken):
                snapshot = feeds.market(slot, lambda: slot + 1)
            return (snapshot, worker.reference(snapshot['ten'], state),
                    worker.challenger_inputs(snapshot, state, slot))

        at_decision = replay(0, 100)
        self.assertEqual(at_decision[1], 'BUY')
        for future_price in (5, 5000):
            with self.subTest(future_price=future_price):
                self.assertEqual(replay(12, future_price), at_decision)
