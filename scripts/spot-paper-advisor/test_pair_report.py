import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from unittest.mock import patch

from pair_report import comparison, iso
from pilot import publish_pair


class PairReportTest(unittest.TestCase):
    def test_latest_common_slot_and_independent_opening_values(self):
        start = 1200
        with tempfile.TemporaryDirectory() as tmp:
            volume = Path(tmp)
            (volume/'challenger-v2').mkdir()
            for path, epoch, values in [
                (volume/'pilot.sqlite', 600, [(600,998), (1200,999), (1800,997)]),
                (volume/'challenger-v2'/'pilot.sqlite', start, [(1200,1000)])]:
                db = sqlite3.connect(path)
                db.executescript('CREATE TABLE pilot(id,start); CREATE TABLE slots(slot INTEGER PRIMARY KEY, record TEXT);')
                db.execute('INSERT INTO pilot VALUES(1,?)', (epoch,))
                for slot, equity in values:
                    report = dict(arms={'model': {'equityEur': equity}},
                                  last=dict(action='HOLD', reason='MARKET_UNAVAILABLE'))
                    db.execute('INSERT INTO slots VALUES(?,?)', (slot,json.dumps({'report':report})))
                db.commit()
                db.close()
            _, result = comparison(volume)
            self.assertEqual(result['at'], iso(start))
            self.assertEqual(result['v1']['change'], 1)
            self.assertEqual(result['v2']['change'], 0)
            self.assertEqual(result['v2']['action'], 'SKIPPED')

    def test_later_challenger_commit_publishes_once_without_next_cycle(self):
        old, current = ({'at': iso(slot)} for slot in (1200, 1800))
        with patch('pilot.comparison', side_effect=[(0, old), (0, old), (0, current)]), \
             patch('pilot.time.time', return_value=1810), patch('pilot.time.sleep') as sleep, \
             patch('builtins.print') as output:
            publish_pair(Path('/state'), 1800)
        rows = [json.loads(call.args[0])['pilotAudit']['comparison'] for call in output.call_args_list]
        self.assertEqual(rows, [old, current])
        self.assertEqual(sleep.call_count, 2)

    def test_missing_challenger_stops_at_deadline(self):
        with patch('pilot.comparison', return_value=(0, None)), \
             patch('pilot.time.time', side_effect=[1889, 1890]), patch('pilot.time.sleep') as sleep, \
             patch('builtins.print') as output:
            publish_pair(Path('/state'), 1800)
        sleep.assert_called_once_with(1)
        output.assert_not_called()
