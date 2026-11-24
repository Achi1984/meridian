import unittest
from new_pool_watch import USDC, additional_discovery_candidate


class PumpSwapDiscoveryTest(unittest.TestCase):
    def test_recent_liquid_pool_and_quote_identity(self):
        row = dict(liquidity=10000, dex='pumpswap', quote=USDC, mint='token', created='1970-01-01T00:00:00Z')
        self.assertTrue(additional_discovery_candidate(row, 3600))
        self.assertFalse(additional_discovery_candidate(row, 3601))
        self.assertFalse(additional_discovery_candidate(dict(row, quote='other'), 1))
        self.assertFalse(additional_discovery_candidate(dict(row, liquidity=9999), 1))
