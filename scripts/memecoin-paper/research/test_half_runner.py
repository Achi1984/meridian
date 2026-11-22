import unittest
from unittest.mock import patch

from newcomer_wave_pair import FEE, SIZE, HalfRunner


class RunnerTest(unittest.TestCase):
    def test_partial_then_final_includes_all_fees(self):
        runner = HalfRunner({'mint':'test'})
        runner.positions['early'] = [101, 0]
        runner.opened_at['early'] = 0
        with patch('newcomer_wave_pair.time.monotonic', side_effect=[601,601,1201,1201]), patch('newcomer_wave_pair.emit') as emit:
            runner.observe(False, lambda mint, currency, qty: SIZE//2 if qty==50 else 0)
            runner.observe(False, lambda mint, currency, qty: SIZE if qty==51 else 0)
            self.assertEqual(emit.call_args.kwargs['netRaw'], SIZE//2-3*FEE)
            self.assertTrue(runner.finished)

    def test_late_partial_remains_wholly_unresolved(self):
        runner = HalfRunner({'mint':'test'})
        runner.positions['early'] = [100, 0]
        runner.opened_at['early'] = 0
        with patch('newcomer_wave_pair.time.monotonic', return_value=721), patch('newcomer_wave_pair.emit') as emit:
            runner.observe(False, None)
            self.assertEqual(emit.call_args.kwargs['remainingQty'], 100)
            self.assertEqual(emit.call_args.kwargs['cashRaw'], -SIZE-FEE)
