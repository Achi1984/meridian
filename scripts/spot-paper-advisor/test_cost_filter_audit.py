import json
import sqlite3
import unittest
from decimal import Decimal

from cost_filter_audit import ai_veto, EXPANSION_START, HOUR, FORWARD_START, STAGES, audit, confirmation_results, confirmed_breakout, entry_signals, forward_comparison
from feeds import COST_VERSION
from worker import DAY, FEE, SLIP, STEP, iso


class CostFilterAuditTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE slots (slot INTEGER PRIMARY KEY, record TEXT)')

    def record(self, slot, reason, bid, *, size=1, delay=2):
        record = dict(promptVersion=COST_VERSION, states={'model': {'cash': '1000', 'btc': '0', 'opened': None}},
                      report={'last': dict(action='HOLD', execution='HOLD', at=iso(slot+delay), reason=reason)},
                      executionBook=dict(bid=bid, ask=bid+1, bidSize=size, askSize=size))
        self.db.execute('INSERT INTO slots VALUES (?, ?)', (slot, json.dumps(record)))

    def test_fixed_exit_ignores_intermediate_peak_and_accounts_for_costs(self):
        self.record(0, next(iter(STAGES)), 10000)
        self.record(STEP, 'model', 10500)
        self.record(6*STEP, 'model', 10100)
        sample, = audit(self.db)['samples']
        self.assertEqual(sample['stage'], 'beforeModel')
        self.assertEqual(sample['status'], 'MEASURED')
        self.assertLess(Decimal(sample['netEur']), 0)

    def test_midpoint_gain_consumed_by_execution_costs(self):
        self.record(0, next(iter(STAGES)), 10000)
        self.record(6*STEP, 'model', 10100)
        sample, = audit(self.db)['samples']
        parts = {key: Decimal(value) for key, value in sample['components'].items()}
        qty = parts['midpointMoveEur'] / 100
        self.assertGreater(qty, 0)
        self.assertEqual(parts['spreadEur'], qty)
        self.assertEqual(parts['slippageEur'], qty*(10001+10100)*SLIP)
        self.assertEqual(parts['feesEur'], qty*(10001*(1+SLIP)+10100*(1-SLIP))*FEE)
        self.assertEqual(Decimal(sample['netEur']), parts['midpointMoveEur'] - parts['spreadEur']
                         - parts['slippageEur'] - parts['feesEur'])

    def test_breakout_uses_two_closed_bars_and_one_prior_resistance(self):
        slot = 8 * STEP
        bars = [[i*STEP, 100, 102, 99, 101] for i in range(8)]
        record = {'inputs': {'ten': bars}}
        bars[-1][2:] = [110, 99, 105]
        self.assertFalse(confirmed_breakout(record, slot))
        bars[-2][2:] = [111, 99, 102]
        self.assertFalse(confirmed_breakout(record, slot))
        bars[-2][4] = 103
        self.assertTrue(confirmed_breakout(record, slot))
        bars[-1][0] = slot
        self.assertIsNone(confirmed_breakout(record, slot))
        self.assertIsNone(confirmed_breakout({}, slot))

    def test_retest_and_failed_breakdown(self):
        slot = 8*STEP
        bars = [[i*STEP, 100, 102, 98, 100] for i in range(8)]
        record = {'inputs': {'ten': bars}}
        bars[-2][1:] = [100, 104, 99, 103]
        bars[-1][1:] = [103, 104, 102, 103]
        self.assertTrue(entry_signals(record, slot)['breakoutRetest'])
        bars[-1][3] = 103
        self.assertFalse(entry_signals(record, slot)['breakoutRetest'])
        bars[-2][1:] = [99, 101, 97, 99]
        self.assertTrue(entry_signals(record, slot)['failedBreakdown'])
        bars[-1][1:] = [100, 102, 99, 101]
        self.assertFalse(entry_signals(record, slot)['failedBreakdown'])

    def test_forward_comparison_excludes_development_period_and_pending_pnl(self):
        def sample(offset, signal, status):
            return dict(entryAt=iso(FORWARD_START+offset), exitAt=iso(FORWARD_START+offset+6*STEP), breakoutRetest=signal,
                        failedBreakdown=False, status=status, netEur='1.25')
        groups = forward_comparison([sample(-STEP, True, 'MEASURED'), sample(0, True, 'MEASURED'),
                                     sample(STEP, True, 'PENDING_EXIT'), sample(2*STEP, None, 'EXIT_MISSING_RECORD')])['groups']
        self.assertEqual(groups['breakoutRetest']['signal'],
                         dict(total=2, measured=1, pending=1, unavailable=0, meanNetEur='1.25',
                              disjointWindows=dict(total=1, measured=1, pending=0, unavailable=0, meanNetEur='1.25')))
        self.assertEqual(groups['breakoutRetest']['unknown']['unavailable'], 1)
        self.assertIsNone(groups['breakoutRetest']['noSignal']['meanNetEur'])

    def test_disjoint_comparison_selects_before_outcomes_and_accepts_touching_windows(self):
        def row(t, status, pnl=None):
            return dict(entryAt=iso(FORWARD_START+t*STEP), exitAt=iso(FORWARD_START+(t+6)*STEP),
                        breakoutRetest=True, failedBreakdown=False, status=status, netEur=pnl)
        samples = [row(6, 'MEASURED', '-1'), row(1, 'MEASURED', '9'), row(0, 'EXIT_MISSING_RECORD')]
        summary = forward_comparison(samples)['groups']['breakoutRetest']['signal']
        self.assertEqual(summary['meanNetEur'], '4')
        self.assertEqual(summary['disjointWindows'],
                         dict(total=2, measured=1, pending=0, unavailable=1, meanNetEur='-1'))

    def test_paired_exits_use_same_entry_and_preserve_missing_early_quote(self):
        slot = FORWARD_START
        self.record(slot, next(iter(STAGES)), 10000)
        bars = [[slot-(8-i)*STEP, 100, 102, 98, 100] for i in range(8)]
        bars[-2][3] = 97
        bars[-1][2:] = [105, 99, 103]
        raw, = self.db.execute('SELECT record FROM slots').fetchone()
        self.db.execute('UPDATE slots SET record=?', (json.dumps(dict(json.loads(raw), inputs={'ten': bars})),))
        self.record(slot+6*STEP, 'model', 10100)
        sample, = audit(self.db)['samples']
        self.assertEqual(sample['exploratory30m']['status'], 'EXIT_MISSING_RECORD')
        self.assertIsNone(sample['exploratory30m']['extraNetFromHoldingEur'])
        self.record(slot+3*STEP, 'model', 10200)
        sample, = audit(self.db)['samples']
        early = sample['exploratory30m']
        self.assertEqual(early['exitAt'], iso(slot+3*STEP))
        self.assertGreater(Decimal(early['netEur']), Decimal(sample['netEur']))
        self.assertEqual(Decimal(early['extraNetFromHoldingEur']),
                         Decimal(sample['netEur']) - Decimal(early['netEur']))

    def test_forward_veto_outcomes_count_unique_full_hours_and_stage(self):
        before, after = STAGES
        slot = FORWARD_START
        self.record(slot-STEP, before, 10000)
        self.record(slot, before, 10000)
        self.record(slot+STEP, after, 10000)
        self.record(slot+2*STEP, before, 10000)
        self.record(slot+6*STEP, 'model', 11000)
        self.record(slot+7*STEP, 'model', 9900)
        close = slot-slot%DAY+DAY-STEP
        self.record(close-STEP, after, 10000)
        self.record(close+STEP, before, 10000)
        counts = audit(self.db)['forwardVetoOutcomes60m']
        self.assertEqual(counts['shortenedAtClose'], 1)
        self.assertEqual([counts['all'][key] for key in
                          ('total','measured','profitable','loss','flat','pending','unavailable')],
                         [4, 2, 1, 1, 0, 1, 1])
        self.assertEqual(counts['disjointWindows']['total'], 2)
        self.assertEqual(counts['byStage']['afterBuySignal']['loss'], 1)

    def test_first_covered_exit_uses_earliest_executable_quote(self):
        slot = FORWARD_START
        self.record(slot, next(iter(STAGES)), 10000)
        self.record(slot+STEP, 'model', 10200, size=0)
        self.record(slot+2*STEP, 'model', 10200)
        self.record(slot+3*STEP, 'model', 10500)
        def report():
            sample, = audit(self.db)['samples']
            return sample, sample['exploratoryFirstCoveredExit']
        sample, early = report()
        self.assertEqual(early['exitAt'], iso(slot+2*STEP))
        self.assertEqual(early['skippedChecks'], 1)
        self.assertEqual(early['skippedObservations'], [
            dict(at=iso(slot+STEP), reason='EXIT_INSUFFICIENT_BID_SIZE')])
        self.assertIsNone(early['deltaVsFixedEur'])
        self.record(slot+6*STEP, 'model', 9900)
        sample, early = report()
        self.assertEqual(early['status'], 'EARLY_EXIT')
        self.assertGreater(Decimal(early['netEur']), 0)
        self.assertEqual(Decimal(early['deltaVsFixedEur']),
                         Decimal(early['netEur']) - Decimal(sample['netEur']))

    def test_first_covered_exit_falls_back_to_fixed_deadline(self):
        slot = FORWARD_START
        self.record(slot, next(iter(STAGES)), 10000)
        self.record(slot+STEP, 'model', 10001)
        self.record(slot+6*STEP, 'model', 9950)
        sample, = audit(self.db)['samples']
        early = sample['exploratoryFirstCoveredExit']
        self.assertEqual(early, dict(status='DEADLINE_EXIT', exitAt=sample['exitAt'],
                                     netEur=sample['netEur'], deltaVsFixedEur='0', skippedChecks=4,
                                     skippedObservations=[dict(at=iso(slot+i*STEP), reason='EXIT_MISSING_RECORD')
                                                          for i in range(2, 6)]))

    def test_same_late_quote_counts_once_across_overlapping_windows(self):
        slot = FORWARD_START
        self.record(slot, next(iter(STAGES)), 10000)
        self.record(slot+STEP, next(iter(STAGES)), 10000)
        self.record(slot+2*STEP, 'model', 10000, delay=90)
        gaps = audit(self.db)['intermediateExitGaps']
        self.assertEqual(gaps, [dict(at=iso(slot+2*STEP), affectedWindows=2,
                                     reasons={'EXIT_OUTSIDE_WINDOW': 2})])

    def test_missing_book_reason_with_legacy_and_new_journal_records(self):
        slot = FORWARD_START
        self.record(slot, next(iter(STAGES)), 10000)
        for offset, extra in [(1, {}), (2, {'executionBookStatus': 'STALE_BOOK'})]:
            check = slot+offset*STEP
            self.record(check, 'model', 10000)
            raw, = self.db.execute('SELECT record FROM slots WHERE slot=?', (check,)).fetchone()
            row = dict(json.loads(raw), executionBook=None, **extra)
            self.db.execute('UPDATE slots SET record=? WHERE slot=?', (json.dumps(row), check))
        gaps = audit(self.db)['intermediateExitGaps']
        self.assertEqual([gap['executionBookStatus'] for gap in gaps], ['NOT_RECORDED', 'STALE_BOOK'])

    def test_hourly_expansion_compares_all_slots_outside_veto_cohort(self):
        start = EXPANSION_START
        for i in range(4):
            slot = start+i*HOUR
            self.record(slot, 'model', 10000+i*100)
            raw, = self.db.execute('SELECT record FROM slots WHERE slot=?', (slot,)).fetchone()
            bars = [[slot-(7-k)*HOUR, 100, 102, 99, 101] for k in range(7)]
            if i == 0:
                bars[-1][2] = 104
            elif i == 2:
                bars[-1][4] = 99
            elif i == 3:
                bars[-1][0] = slot
            row = dict(json.loads(raw), inputs={'hour': bars})
            self.db.execute('UPDATE slots SET record=? WHERE slot=?', (json.dumps(row), slot))
        self.record(start-STEP, 'model', 20000)
        study = audit(self.db)['hourlyExpansion']
        self.assertEqual([r['regime'] for r in study['samples']],
                         ['risingExpansion', 'risingControl', 'nonRising', 'unknown'])
        self.assertEqual(study['groups']['risingExpansion']['measured'], 1)
        self.assertEqual(study['groups']['unknown']['pending'], 1)
        self.assertEqual(study['samples'][0]['exitAt'], study['samples'][1]['entryAt'])

    def test_delayed_entry_compares_same_exit_and_keeps_skips_distinct_from_missing(self):
        slot = EXPANSION_START
        for at, bid in [(slot, 10000), (slot+STEP, 10100), (slot+HOUR, 10300)]:
            self.record(at, 'model', bid)
        def inputs(at, **values):
            raw, = self.db.execute('SELECT record FROM slots WHERE slot=?', (at,)).fetchone()
            self.db.execute('UPDATE slots SET record=? WHERE slot=?', (json.dumps(dict(json.loads(raw), inputs=values)), at))
        hour = [[slot-k*HOUR, 100, 102, 99, 101] for k in range(7, 0, -1)]
        hour[-1][2] = 105
        inputs(slot, hour=hour)
        for timestamp, finish, status in [(slot+STEP, 104, 'CONFIRMATION_UNAVAILABLE'),
                                          (slot, 101, 'SKIPPED'), (slot, 104, 'MEASURED')]:
            inputs(slot+STEP, ten=[[timestamp, 101, 105, 99, finish]])
            study = audit(self.db)['hourlyExpansion']
            sample = study['samples'][0]
            delayed = sample['confirmed10m']
            attribution = study['delayAttribution']['risingExpansion']
            always = Decimal(sample['unconditional10m']['netEur'])
            self.assertEqual(delayed['status'], status)
            if status == 'CONFIRMATION_UNAVAILABLE':
                self.assertEqual(attribution['incomplete'], 1)
                self.assertIsNone(attribution['signalDeltaAfterWaitEur'])
            else:
                self.assertEqual(attribution['complete'], 1)
                self.assertEqual(Decimal(attribution['waitOnlyDeltaEur']), always - Decimal(sample['netEur']))
                expected = -always if status == 'SKIPPED' else Decimal(0)
                self.assertEqual(Decimal(attribution['signalDeltaAfterWaitEur']), expected)
            if status == 'CONFIRMATION_UNAVAILABLE':
                self.assertEqual(study['confirmationPairs'], 0)
            else:
                self.assertEqual(study['confirmationPairs'], 1)
                self.assertEqual(Decimal(study['meanConfirmationDeltaEur']),
                                 Decimal(delayed['netEur']) - Decimal(sample['netEur']))
                if status == 'SKIPPED':
                    self.assertEqual(delayed['netEur'], '0')
                else:
                    self.assertLess(Decimal(delayed['netEur']), Decimal(sample['netEur']))

    def test_confirmation_control_uses_same_exit_and_separate_denominator(self):
        start = EXPANSION_START
        for i, high in enumerate([105, 102]):
            slot = start+i*HOUR
            self.record(slot, 'model', 10000+i*100)
            self.record(slot+STEP, 'model', 10002+i*100)
            hour = [[slot-k*HOUR, 100, 102, 99, 101] for k in range(7, 0, -1)]
            hour[-1][2] = high
            for at, bars in [(slot, dict(hour=hour)), (slot+STEP, dict(ten=[[slot, 101, 103, 99, 100+i*2]]))]:
                raw, = self.db.execute('SELECT record FROM slots WHERE slot=?', (at,)).fetchone()
                self.db.execute('UPDATE slots SET record=? WHERE slot=?', (json.dumps(dict(json.loads(raw), inputs=bars)), at))
        before = audit(self.db)['hourlyExpansion']
        self.assertIsNone(before['expansionMinusControlMeanDeltaEur'])
        self.assertEqual(before['risingControlConfirmationResults']['unmatched'], 1)
        self.record(start+2*HOUR, 'model', 9000)
        after = audit(self.db)['hourlyExpansion']
        expansion, control = after['samples'][:2]
        self.assertEqual(after['confirmationPairs'], 1)
        self.assertEqual(after['confirmationResults']['skipped'], 1)
        self.assertEqual(after['risingControlConfirmationResults']['entered'], 1)
        expected = (Decimal(expansion['confirmed10m']['deltaVsImmediateEur']) -
                    Decimal(control['confirmed10m']['deltaVsImmediateEur']))
        self.assertEqual(Decimal(after['expansionMinusControlMeanDeltaEur']), expected)

    def test_confirmation_totals_reconcile_skips_and_delayed_entries(self):
        samples = []
        for status, baseline, net in [('SKIPPED', -4, 0), ('SKIPPED', 2, 0),
                                      ('MEASURED', 1, 4), ('MEASURED', 0, -1)]:
            delayed = dict(status=status, netEur=str(net), deltaVsImmediateEur=str(net-baseline))
            samples.append(dict(regime='risingExpansion', netEur=str(baseline), confirmed10m=delayed))
        samples.extend([dict(regime='risingExpansion', confirmed10m={'status': 'PENDING_CONFIRMATION'}),
                        dict(regime='risingControl')])
        totals = confirmation_results(samples)
        self.assertEqual(totals, dict(paired=4, unmatched=1, skipped=2, entered=2,
                                      immediateNetEur='-1', confirmedNetEur='3', avoidedLossEur='4',
                                      missedGainEur='2', entryTimingDeltaEur='2', netDeltaEur='4',
                                      meanDeltaEur='1'))
        self.assertIsNone(confirmation_results(samples[-2:])['netDeltaEur'])

    def test_only_model_decisions_and_known_costs_enter_ai_comparison(self):
        last = dict(action='HOLD', reason='wait', execution='HOLD')
        row = dict(report={'last': last}, states={'model': {'btc': '0'}}, usage=None)
        immediate = dict(status='MEASURED', netEur='-2')
        def compare(rate=None):
            return ai_veto(row, immediate, Decimal('0.01'), rate)
        self.assertEqual(compare()['status'], 'NO_MODEL_DECISION')
        row['usage'] = {'input': 10}
        self.assertIsNone(compare()['deltaAfterApiEur'])
        self.assertEqual(Decimal(compare(Decimal('0.9'))['deltaAfterApiEur']), Decimal('1.991'))
        last['reason'] = list(STAGES)[1]
        self.assertEqual(compare()['status'], 'ALLOW')
        self.assertEqual(Decimal(compare(Decimal('0.9'))['deltaAfterApiEur']), Decimal('-0.009'))
        last['reason'] = 'MODEL_UNAVAILABLE: MODEL_TIMEOUT'
        self.assertEqual(compare()['status'], 'MODEL_FAILURE')

    def test_session_close_and_missing_evidence(self):
        reason = list(STAGES)[1]
        self.record(DAY-3*STEP, reason, 10000)
        self.assertEqual(audit(self.db)['samples'][0]['status'], 'PENDING_EXIT')
        self.record(DAY-STEP, 'DAY_CLOSE', 10500, delay=100)
        sample, = audit(self.db)['samples']
        self.assertEqual(sample['stage'], 'afterBuySignal')
        self.assertEqual(sample['exitAt'], iso(DAY-STEP))
        self.assertGreater(Decimal(sample['netEur']), 0)
        self.record(DAY, reason, 10000, size=0)
        self.record(DAY+STEP, reason, 10000)
        self.record(DAY+8*STEP, 'model', 11000)
        samples = audit(self.db)['samples']
        self.assertEqual(samples[1]['status'], 'ENTRY_INSUFFICIENT_ASK_SIZE')
        self.assertEqual(samples[2]['status'], 'EXIT_MISSING_RECORD')
