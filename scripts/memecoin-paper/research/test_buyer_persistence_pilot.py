import unittest
from datetime import datetime, timezone

from buyer_persistence_pilot import buyer_windows, report


def trade(second, buyer):
    return {'attributes': {'block_timestamp': datetime.fromtimestamp(second,timezone.utc).isoformat(),
                           'to_token_address':'target','tx_from_address':buyer*32,'is_anomalous':False}}


class BuyerPilotTests(unittest.TestCase):
    def test_disjoint_windows_and_duplicate_wallet(self):
        rows = [trade(399,'A'),trade(400,'B'),trade(699,'C'),trade(700,'C'),trade(800,'D'),
                trade(801,'D'),trade(1000,'E')]
        result = buyer_windows(rows,'target',1000)
        self.assertEqual((result['earlier'],result['later'],result['newInLater']),(2,2,1))
        self.assertFalse(buyer_windows(rows[1:],'target',1000)['complete'])

    def test_missing_measurements_and_common_parent(self):
        rows = [dict(baseline=True, costPass=True, buyers=dict(complete=False),conservativeNetPct=-2),
                dict(baseline=False, buyers=dict(passes=True), costPass=True)]
        arms = report(rows)['arms']
        self.assertEqual(arms['both']['unknown'],1)
        self.assertEqual(arms['buyers']['eligible'],0)
        self.assertEqual(arms['cost']['meanConservativeNetPct'],-2)
