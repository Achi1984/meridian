import unittest
from unittest.mock import patch
from maturity_probe import forward, probe


class MaturityTests(unittest.TestCase):
    def test_forward_waits_for_first_full_half_hour(self):
        now = [600]
        def sleep(delay):
            now[0] += delay
        row = dict(created='1970-01-01T00:01:01Z', pool='p', mint='m', quote='q')
        with patch('maturity_probe.sample', return_value=[row]):
            cohort, result = forward(lambda *args: {'data': []}, lambda: now[0], sleep)
        self.assertEqual(cohort['pools'][0]['earliest30mAt'], 1920)
        self.assertEqual(result['secondsAfterMaturity'], 0)
        self.assertEqual(result['outcome'], 'poolMissing')

    def test_rejects_identity_change_before_checking_prices(self):
        row = dict(pool='p', mint='other', quote='q')
        with patch('maturity_probe.snapshot', return_value=row):
            result, = probe({'p': ('m', 'q', 1800)}, lambda *args: {'data': [{}]}, clock=lambda: 1860)
        self.assertEqual(result['outcome'], 'identityMismatch')

    def test_malformed_pool_does_not_hide_later_pool(self):
        rows = {'p': ('m', 'q', 1800), 'r': ('n', 'q', 1800)}
        valid = dict(pool='r', mint='n', quote='q', liquidity=4000)
        with patch('maturity_probe.snapshot', side_effect=[ValueError('invalid'), valid]):
            results = list(probe(rows, lambda *args: {'data': [{}]}, clock=lambda: 1860))
        self.assertEqual([r['outcome'] for r in results], ['poolFeedUnavailable', 'lowLiquidity'])

    def test_expired_liquidity_observation_prevents_quote_pass(self):
        row = dict(pool='p', mint='m', quote='q', liquidity=8000)
        with patch('maturity_probe.snapshot', return_value=row), \
             patch('maturity_probe.entry_signal', return_value=(True, {})):
            result, = probe({'p': ('m', 'q', 1800)}, lambda *args: {'data': [{}]},
                            quote=lambda *args: 20_000_000, clock=iter([1850, 1860, 1940, 1940]).__next__)
        self.assertEqual(result['outcome'], 'staleSignal')
