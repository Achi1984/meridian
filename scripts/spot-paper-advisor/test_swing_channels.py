import unittest
from swing_channels import ChannelRule, ChannelSignals, configurations, vote_groups


class ChannelTests(unittest.TestCase):
    def test_directional_strength_and_prior_range(self):
        s = ChannelSignals()
        for i in range(28):
            s.update(100+i, (99+i, 100+i))
        self.assertEqual((s.adx, s.atr, s.breakout, s.channel_exit), (100, 1, 1, 1))
        s.update(90, (85, 150))
        self.assertEqual((s.breakout, s.channel_exit), (-1, -1))
        s.update(91, None)
        self.assertIsNone(s.adx)

    def test_trailing_stop_ratchets_and_exits_on_completed_close(self):
        s = ChannelSignals()
        for side in (1, -1):
            rule = ChannelRule(False, False, False, True)
            s.close, s.atr = 100, 2
            self.assertEqual(rule.target(0, side, side, s), side)
            s.close += side*4
            self.assertEqual(rule.target(side, side, 0, s), side)
            self.assertEqual(rule.stop, 100-side*2)
            s.atr = 20
            self.assertEqual(rule.target(side, side, 0, s), side)
            s.close = 100-side*2
            self.assertEqual(rule.target(side, side, side, s), 0)

    def test_filters_gate_entry_only_and_channel_exits(self):
        self.assertEqual(len({r.name for r in configurations()}), 16)
        r = ChannelRule(True, True, True, False)
        s = ChannelSignals()
        s.adx, s.breakout = 24, -1
        self.assertEqual(r.target(0, -1, -1, s), 0)
        s.adx = 25
        self.assertEqual(r.target(0, -1, -1, s), -1)
        s.adx = 12
        self.assertEqual(r.target(-1, -1, 0, s), -1)
        s.channel_exit = 1
        self.assertEqual(r.target(-1, -1, 0, s), 0)

    def test_grid_contains_every_distinct_group_and_vote_threshold(self):
        groups = list(vote_groups(('momentum', 'rsi', 'macd', 'fib')))
        self.assertEqual(len(set(groups)), 32)
        self.assertTrue(all(1 <= minimum <= len(group) for group, minimum in groups))
        self.assertEqual(len(groups) * len(configurations()), 512)
