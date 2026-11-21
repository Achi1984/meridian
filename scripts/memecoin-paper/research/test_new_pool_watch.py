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
