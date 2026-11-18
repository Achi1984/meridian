import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import feeds
from pilot import BUDGET, MODEL, RESERVE, STEP, BudgetedFeeds, configure
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
