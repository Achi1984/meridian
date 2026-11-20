import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import new_pool_watch as watch
from meme_paper_account import MemeAccount, SIZE, UNIT


class MemeAccountTests(unittest.TestCase):
    def test_cash_capacity_duplicate_and_restart(self):
        with TemporaryDirectory() as directory:
            path=Path(directory)/'account.sqlite'
            a=MemeAccount(path)
            for mint in ('a','b','c'):
                self.assertTrue(a.buy(mint,'pool',10**20,SIZE,100))
            self.assertFalse(a.buy('d','pool',1,SIZE,100))
            self.assertEqual(a.status(100)['cashUsdc'],939.85)
            a.close()
            a=MemeAccount(path)
            self.assertEqual(len(a.active()),3)
            self.assertEqual(int(a.active()[0]['qty']),10**20)
            self.assertEqual(a.observe('a',18*UNIT,200),'stop')
            self.assertIsNone(a.observe('a',18*UNIT,200))
            self.assertFalse(a.buy('a','pool',1,SIZE,201))
            self.assertAlmostEqual(a.status(200)['realizedPnlUsdc'],-2.1)
            a.close()

    def test_no_quote_is_unpriced_and_trailing_exit_uses_observed_amount(self):
        a=MemeAccount(':memory:')
        self.assertTrue(a.buy('m','pool',100,SIZE,10))
        self.assertIsNone(a.observe('m',23*UNIT,70))
        a.observe('m',None,130)
        self.assertIsNone(a.status(130)['equityUsdc'])
        self.assertEqual(a.observe('m',21*UNIT,190),'trailingStop')
        self.assertEqual(a.status(191)['cashUsdc'],1000.9)
        a.close()

    def test_full_bot_entry_and_time_exit(self):
        clock=[100000]
        mint='1'*32
        pool='2'*32
        def response(*args):
            x=dict(address=pool,pool_created_at='1970-01-02T03:46:40Z',base_token_price_usd=1 if clock[0]==100000 else 1.2,
                   reserve_in_usd=20000,volume_usd={'m5':4000},transactions={'m5':{'buys':8,'sells':4}})
            rel={k:{'data':{'id':v}} for k,v in [('dex','pump-fun'),('base_token','solana_'+mint),('quote_token','solana_'+watch.WSOL)]}
            return {'data':[dict(id='solana_'+pool,attributes=x,relationships=rel)]}
        a=MemeAccount(':memory:')
        with TemporaryDirectory() as out, patch.object(watch,'get',side_effect=response), \
             patch.object(watch,'spot_quote',side_effect=lambda src,dst,amount: 1000 if src==watch.USDC else SIZE), \
             patch.object(watch.time,'time',side_effect=lambda:clock[0]), \
             patch.object(watch.time,'monotonic',side_effect=lambda:clock[0]), \
             patch.object(watch.time,'sleep',side_effect=lambda s:clock.__setitem__(0,clock[0]+s)):
            watch.run(Path(out),20,account=a)
            summary=json.loads((Path(out)/'summary.json').read_text())
            self.assertEqual(summary['events']['botBuy'],1)
            self.assertEqual(summary['events']['botSell'],1)
            self.assertEqual(summary['account']['cashUsdc'],999.9)
            self.assertEqual(a.db.execute('SELECT reason FROM positions').fetchone()[0],'time')
        a.close()

    def test_late_entries_blocked_and_missing_quote_does_not_release_capital(self):
        a=MemeAccount(':memory:')
        self.assertFalse(a.buy('m','pool',1,SIZE,86400-20*60))
        self.assertTrue(a.buy('m','pool',1,SIZE,86400-21*60))
        a.observe('m',None,86400-3*60)
        self.assertEqual(a.status(86400)['cashUsdc'],979.95)
        self.assertEqual(a.observe('m',SIZE,86410),'dayClose')
        a.close()

    def test_final_exit_recovery_and_exhaustion(self):
        for quotes, rounds, remaining in [
            ([ValueError(), ValueError(), 19*UNIT], 2, 0),
            ([ValueError()] * 4, 3, 1),
        ]:
            with self.subTest(rounds=rounds), TemporaryDirectory() as out:
                account = MemeAccount(':memory:')
                self.addCleanup(account.close)
                self.assertTrue(account.buy('mint','pool',100,SIZE,10000))
                with patch.object(watch,'get',return_value={'data':[{}]}), \
                     patch.object(watch,'snapshot',return_value={'pool':'pool'}), \
                     patch.object(watch,'spot_quote',side_effect=quotes) as quote, \
                     patch.object(watch.time,'time',return_value=10060), \
                     patch.object(watch.time,'sleep') as sleep:
                    watch.run(Path(out),1,account=account)
                summary = json.loads((Path(out)/'summary.json').read_text())
                self.assertEqual(summary['exitRetryRounds'],rounds)
                self.assertEqual(quote.call_count,rounds+1)
                self.assertEqual(sleep.call_count,rounds)
                self.assertEqual(summary['events'].get('botExitUnresolved',0),remaining)
                self.assertEqual(summary['account']['openPositions'],remaining)
                self.assertEqual(summary['account']['equityUsdc'],None if remaining else 998.9)
                self.assertEqual(summary['account']['cashUsdc'],979.95 if remaining else 998.9)
