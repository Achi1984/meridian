import unittest
from unittest.mock import Mock, patch

from new_pool_watch import SIZE, USDC, WSOL, spot_quote
from roundtrip_quote_audit import observe


class QuoteAuditTest(unittest.TestCase):
    def test_resale_uses_each_exact_buy_quantity(self):
        q = Mock(side_effect=[(200,198),(19_900_000,19_701_000),(19_700_000,19_503_000)])
        row = observe(WSOL, q, Mock(side_effect=[100,104]))
        self.assertEqual([c.args for c in q.call_args_list],
                         [(USDC,WSOL,SIZE),(WSOL,USDC,200),(WSOL,USDC,198)])
        self.assertAlmostEqual(row['expectedLossPct'], 1)
        self.assertAlmostEqual(row['conservativeLossPct'], 2.985)

    def test_stale_window(self):
        q = Mock(side_effect=[(200,200),(100,99)])
        with self.assertRaisesRegex(ValueError,'window'):
            observe(WSOL,q,Mock(side_effect=[100,132]))
        self.assertEqual(q.call_count,2)

    @patch('new_pool_watch.spot_quote_amounts',return_value=(200,198))
    def test_existing_bot_uses_minimum(self, q):
        self.assertEqual(spot_quote(USDC,WSOL,SIZE),198)
