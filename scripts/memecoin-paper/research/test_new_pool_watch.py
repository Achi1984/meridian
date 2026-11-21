import unittest
from unittest.mock import patch
from tempfile import TemporaryDirectory
from pathlib import Path
import json

from new_pool_watch import WSOL, USDC, SIZE, qualifies, quote, run


class NewPoolTests(unittest.TestCase):
    def test_confirmation_requires_second_observation_and_liquidity(self):
        a=dict(mint='mint',quote=WSOL,price=1,liquidity=12000)
        b=dict(a,price=1.15,volume=5000,buys=5,sells=3)
        self.assertFalse(qualifies(a,b,0))
        self.assertTrue(qualifies(a,b,120))
        self.assertFalse(qualifies(a,dict(b,liquidity=11000),120))
        self.assertFalse(qualifies(a,dict(b,mint='other'),120))

    def test_quote_uses_minimum_and_validates_direction(self):
        d=dict(inputMint=USDC,outputMint=WSOL,inputAmount=str(SIZE),outputAmount='100',
               otherAmountThreshold='99',routePlan=[{}])
        with patch('new_pool_watch.get',return_value=dict(success=True,data=d)):
            self.assertEqual(quote(USDC,WSOL,SIZE),99)
            with self.assertRaises(ValueError):
                quote(WSOL,USDC,SIZE)

    def test_failed_feed_does_not_report_an_empty_success(self):
        with TemporaryDirectory() as folder, patch('new_pool_watch.get',side_effect=OSError):
            with self.assertRaises(RuntimeError):
                run(Path(folder),1)
            self.assertEqual(json.loads((Path(folder)/'summary.json').read_text())['events']['feedError'],1)

    def test_research_quote_records_conservative_output_or_missing_side(self):
        import new_pool_watch as watch
        for replies,kind in [([123,19000000],'confirmationRoundTrip'),
                             ([123,ValueError('route')],'confirmationQuoteUnavailable')]:
            rows=[]
            with patch.object(watch.time,'time',return_value=101),patch.object(watch,'spot_quote',side_effect=replies) as quotes:
                watch.confirmed_quote_probe('p','m',100,lambda k,**v:rows.append((k,v)))
            self.assertEqual(quotes.call_args_list[-1].args,('m',watch.USDC,123))
            self.assertEqual(rows[0][0],kind)
            if kind=='confirmationRoundTrip':
                self.assertTrue(rows[0][1]['passesGate'])
            else:
                self.assertEqual(rows[0][1]['side'],'sell')

    def test_inflow_without_followup_pool_mark(self):
        import new_pool_watch as w
        first = dict(pool='p',mint='m',quote=WSOL,dex='pump-fun',created='1970-01-01T00:00:00Z',
                     liquidity=3000,price=1,buys=6,sells=3)
        row = dict(first, liquidity=3500, price=1.05)
        self.assertTrue(w.early_inflow(first,row,60,60))
        self.assertFalse(w.early_inflow(first,dict(row,price=1.11),60,60))
        study = w.InflowQuotes()
        events = []
        def record(kind, **fields):
            events.append((kind,fields))
        with patch.object(w.time,'time',return_value=100) as clock, patch.object(
                w,'spot_quote',side_effect=[1000,OSError(),21_000_000]) as quotes:
            study.enter(row,record)
            study.enter(row,record)
            clock.return_value=279
            study.exits(record)
            self.assertEqual(quotes.call_count,1)
            clock.return_value=280
            study.exits(record)
            clock.return_value=340
            study.exits(record)
        self.assertEqual(quotes.call_args.args,('m',USDC,1000))
        self.assertEqual(events[-1][1]['netAfterAssumedFeesUsdc'],0.90)
        self.assertFalse(study.pending)

    def test_inflow_unpriced_after_window(self):
        import new_pool_watch as w
        study = w.InflowQuotes()
        study.pending['p']=('m',123,0)
        with patch.object(w.time,'time',return_value=301),patch.object(w,'spot_quote') as quote:
            events=[]
            study.exits(lambda kind, **fields: events.append(kind))
            quote.assert_not_called()
        self.assertEqual(events,['inflowUnpriced'])
        self.assertFalse(study.quoted_net)
