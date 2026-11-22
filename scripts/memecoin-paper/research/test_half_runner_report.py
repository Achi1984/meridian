import unittest

from half_runner_report import inventory_path


class InventoryReportTest(unittest.TestCase):
    def setUp(self):
        self.events = [
            dict(event='entry', arm='early', qty=101),
            dict(event='resaleMark', arm='early', usdcRaw=19900000),
            dict(event='exit', arm='early', usdcRaw=19900000, reason='time', heldSeconds=606),
            dict(event='runnerMark', qty=50, usdcRaw=9900000, heldSeconds=608),
            dict(event='runnerPartialSale', qty=50, usdcRaw=9900000, feeRaw=50000),
            dict(event='runnerMark', qty=51, usdcRaw=11000000, heldSeconds=1210),
            dict(event='runnerExit', qty=51, usdcRaw=11000000, heldSeconds=1210,
                 netRaw=750000, baselineNetRaw=-200000),
        ]

    def test_split_receipts(self):
        result = inventory_path(self.events, {})
        self.assertEqual((result['deltaRaw'], result['sampledDrawdownUsdc']), (950000, .2))

    def test_corrupted_receipts(self):
        for index, field in [(3,'qty'), (4,'usdcRaw'), (4,'feeRaw'), (6,'netRaw'),
                             (6,'baselineNetRaw'), (6,'qty'), (6,'heldSeconds')]:
            with self.subTest(index=index, field=field), self.assertRaises(ValueError):
                rows = [dict(row) for row in self.events]
                rows[index][field] += 1
                inventory_path(rows, {})

    def test_remaining_inventory_after_partial(self):
        terminal = dict(event='runnerUnresolved', remainingQty=51, cashRaw=-10200000)
        rows = self.events[:5] + [terminal]
        result = inventory_path(rows, {})
        self.assertEqual(result['zeroRecoveryUsdc'], -10.2)
        self.assertNotIn('deltaRaw', result)
        terminal['remainingQty'] = 50
        with self.assertRaises(ValueError):
            inventory_path(rows, {})

    def test_early_exit_without_barrier(self):
        self.events[-2]['heldSeconds'] = self.events[-1]['heldSeconds'] = 800
        with self.assertRaises(ValueError):
            inventory_path(self.events, {})
