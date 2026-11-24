import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

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

    def test_partial_sale_on_final_tick_accounts_for_remainder(self):
        runner = HalfRunner({'mint': 'test'})
        runner.positions['early'] = [101, 0]
        runner.opened_at['early'] = 0
        with patch('newcomer_wave_pair.time.monotonic', return_value=601), patch('newcomer_wave_pair.emit') as emit:
            runner.observe(True, lambda mint, currency, qty: SIZE//2)
        self.assertTrue(runner.finished)
        emit.assert_called_with('runnerUnresolved', mint='test', remainingQty=51, cashRaw=-SIZE//2-2*FEE)

    @patch('newcomer_wave_pair.emit')
    def test_failed_partial_or_remainder_preserves_inventory(self, emit):
        for initial_sale, held, error, leg, amount, status in (
                (None, 610, HTTPError('https://example.invalid', 429, '', {}, None), 'partialSale', 50, 429),
                (9000000, 1210, URLError('offline'), 'remainderSale', 51, None)):
            runner = HalfRunner({'mint':'m'})
            runner.positions['early'] = [101, 0]
            runner.opened_at['early'] = 0
            runner.half_sale = initial_sale
            quote = Mock(side_effect=error)
            with patch('newcomer_wave_pair.time.monotonic', return_value=held):
                runner.observe(False, quote)
            emit.assert_called_with('runnerMissingQuote', mint='m', qty=amount, leg=leg,
                                    heldSeconds=held, reason=type(error).__name__, status=status)
            self.assertEqual(quote.call_count, 1)
            self.assertEqual(runner.half_sale, initial_sale)
            self.assertFalse(runner.finished)
