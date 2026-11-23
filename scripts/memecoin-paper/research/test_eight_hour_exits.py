import unittest
from newcomer_eight_hour import Account, SIZE, FEE


class RecoveryExitTests(unittest.TestCase):
    def simulate(self, policy, marks):
        account = Account(policy)
        base = dict(mint='m', qty=10, at=1)
        account.update(dict(base, event='entry'), 1)
        for value in marks:
            if value is None:
                account.update(dict(base, event='missingExitQuote'), 1)
            else:
                account.update(dict(base, event='resaleMark', usdcRaw=SIZE+2*FEE+value), 1)
        return account

    def test_trailing_arms_after_admission_and_uses_actual_bid_after_gap(self):
        account = self.simulate('trailing', [3_000_000, 0, 2_000_000, 4_000_000, None, -1_500_000])
        self.assertEqual(account.by_mint['m'], -1_500_000)
        self.assertEqual((account.closed, account.missing), (1, 1))

    def test_common_quotes_different_exits(self):
        marks = [0, 2_000_000, 4_000_000, 2_000_000]
        for policy, expected in [('standard', 0), ('fixed', 1), ('trailing', 1)]:
            account = self.simulate(policy, marks)
            self.assertEqual(account.closed, expected)
        self.assertEqual(self.simulate('trailing', marks[:-1]).closed, 0)
        self.assertIsNone(self.simulate('trailing', [0, 2_000_000, None]).equity())
