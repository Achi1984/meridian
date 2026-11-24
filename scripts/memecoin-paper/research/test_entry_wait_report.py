import unittest
from unittest.mock import patch

from entry_wait_report import attribute


class EntryWaitTests(unittest.TestCase):
    @patch('entry_wait_report.report')
    @patch('entry_wait_report.evaluate', side_effect=lambda rows: rows)
    def test_opportunity_cost_and_unpriced_inventory(self, evaluate, report):
        def item(at, mint, early, wave):
            return dict(cohortAt=at, mint=mint, paths={
                arm: dict(state=state, netUsdc=value)
                for arm, (state, value) in [('early', early), ('wave', wave)]})
        cash = ('noEntry', 0)
        rows = [item(1, 'a', ('closed', -3), cash), item(2, 'b', ('closed', 2), cash),
                item(3, 'c', ('noEntryWithGap', None), cash),
                item(4, 'd', ('unresolved', None), ('closed', 7)),
                item(5, 'a', ('closed', -9), cash)]
        result = attribute([rows[::-1]])
        self.assertEqual((result['uniqueMints'], result['repeats'], result['unresolvedMints'],
                          result['noEntryGapMints']), (4, 1, 1, 1))
        self.assertEqual((result['avoidedLossUsdc'], result['missedProfitUsdc']), (3, 2))
        self.assertEqual((result['pricedDeltaUsdc'], result['pricedDeltaWithoutBestMintUsdc']), (1, -2))
        self.assertEqual(result['realizedUsdc'], dict(early=-1, wave=7))
