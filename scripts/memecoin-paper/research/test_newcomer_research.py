import unittest
from datetime import datetime, timezone
from newcomer_research import flow


class WalletWindows(unittest.TestCase):
    def test_new_wallets_ignore_repeat_trades_and_future(self):
        def trade(i, at, wallet, size):
            return dict(id=i, attributes=dict(block_timestamp=datetime.fromtimestamp(at, timezone.utc).isoformat(),
                        from_token_address='q',to_token_address='m',volume_in_usd=size,tx_from_address=wallet))
        prior = trade('1',35,'a',5)
        recent = trade('2',95,'a',5)
        stats = flow([prior,recent,recent,trade('3',90,'b',10),trade('4',101,'c',30)],'m','q',100)
        self.assertEqual(stats['newRecentBuyers'],1)
        self.assertEqual(stats['netUsd'],[5,15])
        self.assertAlmostEqual(stats['largestRecentBuyerShare'],2/3)
