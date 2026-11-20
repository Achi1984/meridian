import json
import sqlite3
import unittest

from xperp_cost_report import report


class CostReportTests(unittest.TestCase):
    def test_paired_ledger_and_pending_exclusion(self):
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        db.execute('attach database ":memory:" as spot')
        db.execute('create table observations(slot,event,data)')
        db.execute('create table spot.slots(slot,record)')
        entry = dict(status='FILLED',ts=100,price='100',executedUsd='90')
        sale = dict(status='FILLED',entryTs=100,price='102',fundingUsd='-.1',netUsd='1.8091')
        for slot,event,row in [(1,'PAPER_BUY',entry),(2,'PAPER_SELL',sale),
                               (3,'PAPER_BUY',entry),(4,'PAPER_SELL',dict(status='FUNDING_PENDING'))]:
            db.execute('insert into observations values(?,?,?)',(slot,event,json.dumps(row)))
            spot = dict(states=dict(v3=dict(btc='1')),fillBook=dict(bid='102',ask='100'))
            db.execute('insert into spot.slots values(?,?)',(slot,json.dumps(spot)))
        result = report(db)
        self.assertEqual((result['pairedClosed'],result['fundingPending'],result['openPaired']),(1,1,False))
        high,low = result['trades'][0]['scenarios']
        self.assertAlmostEqual(high['spotNetUsd'],1.798-0.403996)
        self.assertAlmostEqual(high['futuresMinusSpotUsd'],1.8091-high['spotNetUsd'])
        self.assertAlmostEqual(high['fundingEffectUsd'],.1)
        self.assertGreater(high['futuresMinusSpotUsd'],low['futuresMinusSpotUsd'])
