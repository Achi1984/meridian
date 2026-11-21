import unittest
from runner_exit_replay import outcomes


class ExitReplayTest(unittest.TestCase):
    def test_trailing_exit_retains_observed_price(self):
        self.assertEqual(outcomes([(0,100),(60,200),(120,150),(180,60)]), (.60,1.50))

    def test_price_gap_leaves_exit_unknown(self):
        self.assertEqual(outcomes([(0,100),(121,300)]), (None,None))

    def test_both_exit_after_fifteen_minutes(self):
        self.assertEqual(outcomes([(t,100) for t in range(0,901,60)]), (1,1))

    def test_quote_trail_leaves_original_open(self):
        from unittest.mock import Mock
        from runner_study import RunnerStudy, UNIT
        prices = Mock(side_effect=[100,20*UNIT,40*UNIT,30*UNIT,10*UNIT])
        study = RunnerStudy(prices, 'usd', 20*UNIT)
        event = Mock()
        study.enter(dict(mint='m',pool='p'), event)
        study.mark(event, False)
        study.mark(event, False)
        self.assertEqual(event.call_args.args[0], 'runnerTrailingExit')
        self.assertIn('m', study.open)
        study.mark(event, False)
        self.assertEqual(event.call_args.args[0], 'runnerPaperExit')
