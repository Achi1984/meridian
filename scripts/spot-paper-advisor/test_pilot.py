import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import feeds
from pilot import DAY, run, BUDGET, MODEL, RESERVE, STEP, BudgetedFeeds, configure
from worker import connect


class PilotTest(unittest.TestCase):
    def test_restart_rejects_new_epoch_and_late_empty_database(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'pilot.sqlite'
            db = connect(path, MODEL)
            configure(db, STEP, STEP-10)
            db.close()
            db = connect(path, MODEL)
            configure(db, STEP, STEP*4)
            with self.assertRaises(ValueError):
                configure(db, STEP*2, STEP*4)
            with self.assertRaises(ValueError):
                configure(connect(':memory:', MODEL), STEP, STEP*2)

    @patch('pilot.time.time', return_value=600)
    @patch('feeds.decide')
    def test_settlement_unknown_calls_and_no_overspend(self, decide, clock):
        db = connect(':memory:', MODEL)
        configure(db, STEP, STEP)
        feed = BudgetedFeeds(db, STEP, STEP*5)
        decide.return_value = ('HOLD', 'ok', dict(input=100, cached=10, output=50))
        feed.decide({}, MODEL, 'test')
        decide.assert_called_once_with({}, MODEL, 'test', service_tier='default')
        self.assertEqual(db.execute('SELECT charge,settled FROM calls').fetchone(), (1170, 1))
        decide.side_effect = feeds.FeedError('REQUEST_FAILED')
        feed.slot += STEP
        with self.assertRaises(feeds.FeedError):
            feed.decide({}, MODEL, 'test')
        self.assertEqual(db.execute('SELECT charge,settled FROM calls WHERE slot=?',(feed.slot,)).fetchone(), (RESERVE, 0))
        db.execute('UPDATE calls SET charge=? WHERE settled=1', (BUDGET-RESERVE,))
        feed.slot += STEP
        with self.assertRaisesRegex(feeds.FeedError, 'PILOT_BUDGET_LIMIT'):
            feed.decide({}, MODEL, 'test')
        self.assertEqual(decide.call_count, 2)
        clock.return_value = feed.end
        with self.assertRaisesRegex(feeds.FeedError, 'PILOT_EXPIRED'):
            feed.decide({}, MODEL, 'test')

    @patch('pilot.time.time', return_value=STEP)
    @patch('feeds.decide')
    def test_failed_model_output_with_known_usage_is_charged(self, decide, clock):
        db = connect(':memory:', MODEL)
        configure(db, STEP, STEP)
        decide.side_effect = feeds.FeedError('MODEL_REFUSAL', dict(input=100, cached=10, output=50))
        with self.assertRaisesRegex(feeds.FeedError, 'MODEL_REFUSAL'):
            BudgetedFeeds(db, STEP, STEP*2).decide({}, MODEL, 'test')
        self.assertEqual(db.execute('SELECT charge,settled FROM calls').fetchone(), (1170, 1))

    @patch('builtins.print')
    @patch('pilot.os.path.ismount', return_value=True)
    @patch('pilot.time.time', return_value=STEP+7*DAY)
    @patch('pilot.cycle')
    def test_restart_after_deadline_rebuilds_final_audit_without_network(self, cycle, clock, mounted, output):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            db = connect(directory/'pilot.sqlite', MODEL)
            configure(db, STEP, STEP)
            report = dict(arms=dict(model=dict(equityEur=990)), last=dict(execution='HOLD', reason='OK'))
            with db:
                db.execute('INSERT INTO slots VALUES (?,?)', (STEP, json.dumps(dict(report=report))))
            db.close()
            run(directory, STEP, 'test')
            cycle.assert_not_called()
            self.assertEqual(json.loads((directory/'pilot-report.json').read_text()), report)
            audit = json.loads((directory/'pilot-audit.json').read_text())['pilotAudit']
            self.assertEqual(audit['completedSlots'], 1)
            self.assertEqual(audit['missingOrPendingSlots'], 1007)

    @patch('pilot.time.time', return_value=STEP)
    def test_delayed_responses_must_match_both_model_and_tariff_before_settlement(self, clock):
        usage = dict(input_tokens=100, input_tokens_details=dict(cached_tokens=10), output_tokens=50)
        for model, tier, code, expected in (
                ('unknown', 'default', 'MODEL_SNAPSHOT_MISMATCH', (RESERVE, 0)),
                (MODEL, 'priority', 'PILOT_TARIFF_UNVERIFIED', (RESERVE, 0)),
                (MODEL, None, 'PILOT_TARIFF_UNVERIFIED', (RESERVE, 0)),
                (MODEL, 'default', 'MODEL_TIMEOUT', (1170, 1))):
            with self.subTest(model=model, tier=tier):
                db = connect(':memory:', MODEL)
                configure(db, STEP, STEP)
                response = dict(model=model, service_tier=tier, usage=usage)
                with patch('feeds._request', return_value=response), patch('feeds.time.monotonic', side_effect=[1, 32]):
                    with self.assertRaisesRegex(feeds.FeedError, code):
                        BudgetedFeeds(db, STEP, 2*STEP).decide({}, MODEL, 'test')
                self.assertEqual(db.execute('SELECT charge,settled FROM calls').fetchone(), expected)
                db.close()
