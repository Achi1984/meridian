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

class FilterComparisonTest(unittest.TestCase):
    def test_repeated_mint_open_and_closed_positions_and_capacity(self):
        from newcomer_eight_hour import FilterComparison
        report = FilterComparison()
        empty = False, False
        for session, eligible, holding, net in [
                (1, False, (True, False), -2000000), (2, False, (True, False), 800000),
                (3, False, (True, False), None), (4, True, (False, True), 200000),
                (5, True, (True, True), -100000), (6, True, (True, False), 0)]:
            key = session, 'mint'
            report.update(key, 'entry', eligible, empty, holding, None)
            if net is None:
                report.update(key, 'missingExitQuote', eligible, holding, holding, None)
            else:
                report.update(key, 'resaleMark', eligible, holding, empty, SIZE+2*FEE+net)
                report.update(key, 'exit', eligible, empty, empty, SIZE+2*FEE+net)
        groups = report.snapshot()
        self.assertEqual(groups['excludedByFilter'], dict(closed=2, open=1,
                         grossPositiveNetUsdc=0.8, grossNegativeNetUsdc=2, netUsdc=-1.2))
        self.assertEqual(groups['both']['netUsdc'], -0.1)
        self.assertEqual(groups['fOnlyCapacity']['netUsdc'], 0.2)
        self.assertEqual(groups['cOnlyCapacity']['closed'], 1)


class TargetQuoteTest(unittest.TestCase):
    def test_only_next_valid_tick_counts_and_missing_is_not_backfilled(self):
        from newcomer_eight_hour import NextTickTarget
        report = NextTickTarget()
        first = dict(event='resaleMark', tick=4, qty=10, at=100, usdcRaw=23000000)
        later = dict(first, tick=5, at=160, usdcRaw=19000000)
        for key, change in enumerate([{}, {'tick': 6}, {'at': 100}, {'qty': 11},
                                      {'event': 'missingExitQuote'}, {'event': 'lateExitQuote'}]):
            report.observe(key, first, True)
            report.observe(key, dict(first, event='exit'), False)
            report.observe(key, dict(later, **change), False)
            report.observe(key, later, False)
        report.observe(7, first, True)
        self.assertEqual(report.snapshot(), dict(targetExits=7, paired=1, withoutNextQuote=6,
                         lowerNextQuote=1, pairedOriginalNetUsdc=2.9, pairedNextNetUsdc=-1.1))

class IntegrityTests(unittest.TestCase):
    def test_duplicate_before_and_after_exit(self):
        from newcomer_eight_hour import START
        account = Account('standard')
        buy = dict(event='entry', mint='m', at=1, qty=7)
        account.update(buy, 1)
        account.update(buy, 1)
        self.assertEqual(account.cash, START-SIZE-FEE)
        account.update(dict(buy, event='exit', usdcRaw=SIZE), 1)
        account.update(buy, 1)
        self.assertEqual(account.cash, START-2*FEE)
        self.assertFalse(account.open)
        account.update(buy, 2)
        self.assertEqual(account.open[2,'m']['positionId'], '2:wave:m')

    def test_ledger_detects_quantity_and_cash_corruption(self):
        from campaign_ledger import reconcile
        from newcomer_eight_hour import START
        account = Account('standard')
        account.update(dict(event='entry', mint='m', at=1, qty=7), 1)
        fill = dict(account='B',positionId='1:wave:m', qty=7,usdcRaw=SIZE,side='buy')
        report = {'B':account.snapshot()}
        reconcile([fill], report, START, FEE)
        for patch in [dict(qty=8),dict(usdcRaw=SIZE-1)]:
            with self.assertRaises(ValueError):
                reconcile([dict(fill, **patch)], report, START, FEE)

    def test_carry_quote_after_restart_targets_original_quantity(self):
        import json
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from unittest.mock import patch
        from newcomer_eight_hour import run
        rows = [dict(event='start', at=1, session=0),
                dict(event='entry', at=2, session=1, arm='wave', mint='m', qty=7),
                dict(event='sessionEnd', at=3, session=1),
                dict(event='entry', at=28798, session=2, arm='wave', mint='m', qty=9),
                dict(event='carryQuote', at=28800, session=2, originSession=1, mint='m',
                     qty=7, usdcRaw=12345678)]
        with TemporaryDirectory() as tmp, patch('newcomer_eight_hour.time.time', return_value=28801):
            path = Path(tmp)
            (path/'events.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
            run(path, 2)
            report = json.loads((path/'status.json').read_text())
            positions = report['accounts']['B']['openPositions']
            self.assertEqual([(p['qty'],p['bid']) for p in positions], [(7,12345678),(9,None)])
            self.assertIsNone(report['accounts']['B']['equityUsdc'])

    def test_identified_journal_survives_handoff_and_verifies_from_disk(self):
        import json
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from unittest.mock import patch
        import newcomer_eight_hour as campaign
        clock = [1000]
        def session(**kwargs):
            if clock[0] == 1000:
                campaign.collector.emit('entry', arm='wave', mint='mint', qty=20)
            clock[0] += 14400
        with TemporaryDirectory() as tmp, patch.object(campaign.time,'time',side_effect=lambda:clock[0]), \
                patch.object(campaign.time,'sleep'), patch.object(campaign.collector,'run',side_effect=session), \
                patch.object(campaign.collector,'spot_quote',return_value=21000000) as quote, \
                patch.object(campaign.collector,'emit'):
            path = Path(tmp)
            campaign.run(path, 1)
            campaign.run(path, 2)
            quote.assert_called_once_with('mint',campaign.collector.USDC,20)
            report = json.loads((path/'status.json').read_text())
            self.assertTrue(report['ledgerVerified'])
            self.assertIsNone(report['accounts']['B']['equityUsdc'])
            rows = list(map(json.loads,(path/'events.jsonl').read_text().splitlines()))
            self.assertEqual(len(rows),len({r['eventId'] for r in rows}))
            buy = next(r for r in rows if r['event']=='entry')
            buy['fills'][0]['usdcRaw'] -= 1
            (path/'events.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
            with self.assertRaises(ValueError):
                campaign.verify_journal(path/'events.jsonl',report['accounts'],campaign.START,campaign.FEE)
