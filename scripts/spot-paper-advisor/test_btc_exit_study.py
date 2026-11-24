import json
import sqlite3
import unittest

from btc_exit_study import ExitStudy, hourly_signals
from worker import iso


class ExitStudyTest(unittest.TestCase):
    def test_closed_hour_only_and_gap(self):
        history = {i*3600:[i*3600,100+i*i,101+i*i,99+i*i,100+i*i] for i in range(50)}
        end = 50*3600
        self.assertEqual(hourly_signals(history,end),('green',False))
        history[end]=[end,2,3,1,2]
        self.assertEqual(hourly_signals(history,end),('green',False))
        self.assertEqual(hourly_signals(history,end+3600),('red',True))
        del history[end-3600]
        self.assertEqual(hourly_signals(history,end+3600),('unknown',None))

    def test_paired_exit_and_restart(self):
        start = 60*3600
        bars = [[i*3600,100,101,99,100] for i in range(10,60)]
        bars[-1]=[59*3600,90,91,89,90]
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        db.execute('CREATE TABLE slots(slot INTEGER PRIMARY KEY,record TEXT)')
        for n,action in enumerate(('PAPER_BUY','HOLD','PAPER_SELL')):
            slot=start+n*600
            book=dict(bid=90,ask=91,received=slot+2,bidAt=slot+2,askAt=slot+2,bidSize=1,askSize=2)
            state=dict(btc='1',entryCostUsd='100',cash='980' if n==2 else '900')
            report=dict(at=iso(slot),publishedAt=iso(slot+3),pair='BTC/USD',schema='MERIDIAN_USD_ROUND_V1',
                        arms=dict(v3=dict(execution=action),v4=dict(execution='HOLD')))
            db.execute('INSERT INTO slots VALUES (?,?)',(slot,json.dumps(dict(report=report,fillBook=book,
                       states=dict(v3=state,v4={}),snapshot=dict(hour=bars)))))
        study=ExitStudy()
        summary=study.read(db)
        self.assertEqual(study.read(db),summary)
        self.assertEqual(ExitStudy().read(db),summary)
        v3=summary['arms']['v3']
        self.assertEqual((v3['closed'],v3['earlierExits'],v3['originalNetUsd']),(1,1,-20))
        self.assertAlmostEqual(v3['alternativeNetUsd'],90*.999*.995-100)
