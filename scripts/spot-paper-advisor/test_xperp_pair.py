import json
import sqlite3
import unittest
from decimal import Decimal as D
from unittest.mock import patch

import xperp_pair as xp


class XPerpTests(unittest.TestCase):
    def test_contract_rounding_and_slippage(self):
        book = dict(ts='2000', asks=[['60000','16']], bids=[['59999','18']])
        lots, price, _ = xp.fill(book, 1, 3, 'BUY', D(100), D('.0001'), D(1), D(1))
        self.assertEqual((lots, price), (16, D(60060)))
        with self.assertRaises(ValueError):
            xp.fill(book, 3, 4, 'BUY', D(100), D('.0001'), D(1), D(1))
        with self.assertRaises(ValueError):
            xp.fill(book, 1, 3, 'SELL', D(19), D('.0001'), D(1), D(1))

    def test_realized_funding_signed_and_interval(self):
        with patch.object(xp,'public',side_effect=[
            [dict(fundingTime='300000')], [dict(fundingTime='180000',realizedRate='-.001'),
             dict(fundingTime='120000',realizedRate='.01')], [['180000','60000']]]):
            charge, _ = xp.funding(120000,180000,D('.01'))
            self.assertEqual(charge,D('-.6'))

    def test_flat_start_and_pending_separate(self):
        db = sqlite3.connect(':memory:')
        db.execute('create table observations(slot integer,event text,data text)')
        self.assertEqual(xp.summary(db)['realizedBalanceUsd'],1000)
        for i, row in enumerate([dict(status='FUNDING_PENDING'),dict(status='FILLED',netUsd='-.21')]):
            db.execute('insert into observations values(?,?,?)',(i,'PAPER_SELL',json.dumps(row)))
        result = xp.summary(db)
        self.assertEqual((result['pairedClosed'],result['fundingPending'],result['realizedBalanceUsd']),(1,1,999.79))
