import unittest
from unittest.mock import patch
from liquidity_quote_shadow import shortlist, USDC


class ShortlistTests(unittest.TestCase):
    def test_counts_show_where_sample_is_lost(self):
        rows=[dict(quote=q,liquidity=v,mint=m) for q,v,m in
              [('other',20000,'a'),(USDC,9999,'b'),(USDC,10000,'c'),(USDC,10000,'c')]]
        with patch('liquidity_quote_shadow.snapshot',side_effect=lambda p:p):
            pools,counts=shortlist(rows)
        self.assertEqual([p['mint'] for p in pools],['c'])
        self.assertEqual(counts,dict(scanned=4,supportedQuote=3,sufficientLiquidity=2,uniqueMints=1))
