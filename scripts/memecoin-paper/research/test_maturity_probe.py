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
