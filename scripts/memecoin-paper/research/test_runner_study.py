import unittest
from unittest.mock import Mock
from runner_study import RunnerStudy, UNIT, FEE


class RunnerTests(unittest.TestCase):
    def test_targets_are_net_and_double_is_observation(self):
        size = 20 * UNIT
        quotes = Mock(side_effect=[100, size, 2*size, 2*size+2*FEE, 3*size+2*FEE])
        study = RunnerStudy(quotes, 'usd', size)
        event = Mock()
        study.enter(dict(pool='p', mint='m'), event)
        study.mark(event, False)
        study.mark(event, False)
        study.mark(event, False)
        self.assertEqual([call.args[0] for call in event.call_args_list],
                         ['runnerPaperEntry','runnerDoubleSeen','runnerPaperExit'])
        self.assertEqual(event.call_args.kwargs['netUsdc'], 40)

    def test_unquoted_final_exit_is_unresolved(self):
        study = RunnerStudy(Mock(side_effect=[100, 20*UNIT, OSError()]), 'usd', 20*UNIT)
        event = Mock()
        study.enter(dict(pool='p', mint='m'), event)
        study.mark(event, True)
        self.assertIn('m', study.open)
        self.assertEqual(event.call_args.args[0], 'runnerUnresolved')
