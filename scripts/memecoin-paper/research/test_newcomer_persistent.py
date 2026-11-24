import unittest
from unittest.mock import Mock, patch
from newcomer_wave_pair import Pair, SIZE


class PersistenceTest(unittest.TestCase):
    def replay(self, confirmation):
        study = Pair(dict(mint='m', pool='p', quote='q'), persistence=True)
        quote = Mock(side_effect=[100, SIZE, confirmation, 75, SIZE])
        fetch = lambda *args: {'data': []}
        with patch('newcomer_wave_pair.emit'), patch('newcomer_wave_pair.time.monotonic', return_value=0):
            study.tick(0, False, quote, fetch)
        with patch('newcomer_wave_pair.emit'), patch('newcomer_wave_pair.time.monotonic', return_value=60):
            study.tick(1, False, quote, fetch)
        return study, quote

    def test_equal_confirmation_uses_new_quantity_and_clock(self):
        study, quote = self.replay(SIZE)
        self.assertEqual(study.positions['persistent'], [75, None])
        self.assertEqual(study.opened_at['persistent'], 60)
        with patch('newcomer_wave_pair.emit'), patch('newcomer_wave_pair.time.monotonic', return_value=600):
            study.tick(10, False, Mock(return_value=SIZE))
        self.assertIsNotNone(study.positions['early'][1])
        self.assertIsNone(study.positions['persistent'][1])

    def test_falling_quote_skips_new_buy(self):
        study, quote = self.replay(SIZE-1)
        self.assertNotIn('persistent', study.positions)
        self.assertEqual(quote.call_count, 3)
