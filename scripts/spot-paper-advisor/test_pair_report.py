import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from pair_report import comparison, iso


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
