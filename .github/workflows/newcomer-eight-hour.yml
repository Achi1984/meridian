import unittest
from newcomer_eight_hour import Account, SIZE, FEE


class RecoveryExitTests(unittest.TestCase):
    def test_failed_recovery_sells_at_next_available_bid(self):
        account = Account('failedRecovery')
        base = dict(mint='m', qty=10)
        account.update(dict(base, event='entry', at=0), 1)
        for at, net in [(0, -1000000), (60, -1000000), (120, -1000000)]:
            account.update(dict(base, event='resaleMark', at=at, usdcRaw=SIZE+2*FEE+net), 1)
        self.assertEqual(account.closed, 0)
        account.update(dict(base, event='missingExitQuote', at=180), 1)
        account.update(dict(base, event='resaleMark', at=240, usdcRaw=SIZE+2*FEE-3000000), 1)
        self.assertEqual(account.by_mint['m'], -3000000)

    def test_interrupted_confirmation_needs_two_new_loss_quotes(self):
        account = Account('failedRecovery')
        base = dict(mint='m', qty=10)
        account.update(dict(base, event='entry', at=0), 1)
        for at, kind in [(60, 'resaleMark'), (90, 'missingExitQuote'), (120, 'resaleMark'),
                         (240, 'resaleMark'), (300, 'resaleMark')]:
            account.update(dict(base, event=kind, at=at, usdcRaw=SIZE-2000000), 1)
        self.assertEqual(account.open[1,'m']['sellAfter'], 300)

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


class StagedTests(unittest.TestCase):
    def test_resume_after_wave_summary(self):
        import json
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from newcomer_eight_hour import run
        rows = [dict(event='start', at=1, session=0),
                dict(event='entry', at=2, session=1, arm='wave', mint='m', qty=100),
                dict(event='stagedMark', at=3, session=1, mint='m', bid=23_000_000,
                     lotBid=11_200_000, held=60),
                dict(event='summary', at=4, session=1, arm='wave'),
                dict(event='sessionEnd', at=5, session=1)]
        with TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path/'events.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
            run(path, 2)
            state = json.loads((path/'status.json').read_text())
            self.assertEqual(state['lastEvent'], 'finished')
            staged = state['accounts']['D']
            self.assertEqual([f['reason'] for f in staged['fills']], ['tp1'])
            self.assertEqual(staged['openPositions'][0]['qty'], 50)
            self.assertIsNone(staged['equityUsdc'])

    def test_scale_out_and_gap_across_restart(self):
        from newcomer_eight_hour import StagedAccount, START
        rows = [dict(event='entry', qty=101),
                dict(event='stagedMark', bid=SIZE, lotBid=10_000_000, held=20),
                dict(event='stagedMark', bid=23_000_000, lotBid=11_100_000, held=60),
                dict(event='stagedMissing'),
                dict(event='stagedMark', bid=13_000_000, lotBid=6_100_000, held=120),
                dict(event='stagedMark', bid=4_000_000, lotBid=None, held=180)]
        account = StagedAccount()
        for index, row in enumerate(rows):
            account.update(dict(row, mint='coin', at=index), 1)
            if index == 3:
                self.assertIsNone(account.equity())
                resumed = StagedAccount()
                for i, prior in enumerate(rows[:index+1]):
                    resumed.update(dict(prior, mint='coin', at=i), 1)
                self.assertEqual(account.snapshot(), resumed.snapshot())
                account = resumed
        self.assertEqual([(f['qty'],f['reason']) for f in account.fills],
                         [(50,'tp1'), (25,'tp2'), (26,'breakeven')])
        self.assertEqual(account.cash, START-SIZE+21_200_000-4*FEE)
        self.assertEqual(account.cash-START, account.by_mint['coin'])
        self.assertEqual(account.closed, 1)
