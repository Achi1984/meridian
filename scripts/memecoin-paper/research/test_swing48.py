import json
import unittest
from unittest.mock import patch
import swing48 as bot


class SwingStudy(unittest.TestCase):
    def test_pullback_recovery_and_liquidity(self):
        c = dict(high=100, low=100, highLiquidity=100, rose=False)
        def obs(price, liquidity=100):
            return bot.wave(c, dict(price=price, liquidity=liquidity))
        self.assertFalse(obs(160))
        self.assertFalse(obs(125))
        self.assertFalse(obs(141))
        self.assertFalse(obs(145,79))
        self.assertTrue(obs(145,80))

    def test_contiguous_windows(self):
        from datetime import datetime, timezone
        c = dict(quote='u', mint='m')
        def trade(t):
            return dict(id=str(t), attributes=dict(block_timestamp=datetime.fromtimestamp(t,timezone.utc).isoformat(),
                        from_token_address='u', to_token_address='m'))
        self.assertEqual(bot.trade_windows(c,[trade(t) for t in (1199,1200,2000,2100,2999)],3000),[[2,0],[2,0]])
        self.assertIsNone(bot.trade_windows(c,[trade(3001)],3020))

    def test_handoff_half_trail_and_48h_pending(self):
        s=bot.fresh(100)
        c=dict(mint='m', pool='p')
        with patch.object(bot,'capture',return_value={'error':'missing'}), patch.object(bot.time,'time',return_value=100), patch.object(bot,'spot_quote',side_effect=[101,19_000_000]):
            bot.enter(s,c,{'at':100})
        p=s['positions']['m']
        bot.monitor(s,'m',p,200,lambda q:{101:31_000_000,50:15_200_000,51:15_400_000}[q])
        self.assertEqual(p['arms']['runner']['left'],51)
        s=json.loads(json.dumps(s))
        p=s['positions']['m']
        bot.monitor(s,'m',p,300,lambda q:22_000_000)
        bot.monitor(s,'m',p,400,lambda q:15_000_000)
        self.assertEqual([f['reason'] for f in p['arms']['runner']['fills']],['half','trail'])
        self.assertEqual(p['arms']['fixed']['left'],0)
        bot.reconcile(s)
        with patch.object(bot,'capture',return_value={}), patch.object(bot.time,'time',return_value=500), patch.object(bot,'spot_quote',side_effect=[100,20_000_000]):
            bot.enter(s,dict(mint='n',pool='p2'),{'at':500})
        p=s['positions']['n']
        bot.monitor(s,'n',p,500+bot.WINDOW,lambda q:None)
        self.assertEqual(p['arms']['fixed']['left'],100)
        bot.monitor(s,'n',p,900+bot.WINDOW,lambda q:1)
        self.assertTrue(all(a['fills'][0]['reason']=='48h' for a in p['arms'].values()))
        bot.reconcile(s)

    def test_partial_quote_missing_and_loss_gap(self):
        s=bot.fresh(0)
        with patch.object(bot,'capture',return_value={}), patch.object(bot.time,'time',return_value=5), patch.object(bot,'spot_quote',side_effect=[100,19_000_000]):
            bot.enter(s,dict(mint='m',pool='p'),{'at':5})
        p=s['positions']['m']
        bot.monitor(s,'m',p,10,lambda q:32_000_000 if q==100 else None)
        self.assertEqual(p['arms']['runner']['left'],100)
        self.assertEqual(p['arms']['runner']['pending'],'half')
        bot.reconcile(s)
        bot.monitor(s,'m',p,20,lambda q:1)
        self.assertEqual(p['arms']['runner']['fills'][0]['reason'],'loss')
        self.assertEqual(p['arms']['runner']['fills'][0]['gross'],1)
        bot.reconcile(s)


    def test_old_checkpoint_pool_outcomes_and_http_failure(self):
        from urllib.error import HTTPError
        s = bot.fresh(1)
        sample = dict(pool='p', mint='m', quote='u', first=1, samples=0,
                      high=100, low=70, highLiquidity=100, rose=True)
        s['candidates'] = {'p':sample, 'missing':dict(sample,pool='missing')}
        row = dict(id='solana_p', pool='p', mint='m', quote='u', price=90, liquidity=90)
        def scan(trades):
            with patch.object(bot,'get',side_effect=[{'data':[]},{'data':[row]},trades]), \
                 patch.object(bot,'snapshot',side_effect=lambda item:item), \
                 patch.object(bot.time,'time',return_value=4000), patch.object(bot.time,'sleep'):
                bot.scan(s,4000)
        scan(HTTPError('provider',429,'limited',{},None))
        diag = sample['diagnostics']
        self.assertEqual(diag['latest']['outcome'],'tradesError')
        self.assertEqual(diag['latest']['httpStatus'],429)
        self.assertTrue(all(diag['latest']['market'].values()))
        scan({'data':[]})
        self.assertEqual(diag['counts'],{'tradesError':1,'tradeRateLimitCooldown':1})
        self.assertEqual(s['candidates']['missing']['diagnostics']['counts'],{'poolAbsentFromSnapshot':2})
        self.assertEqual(s['positions'],{})


    def test_idle_pool_no_trade_call(self):
        c = dict(pool='p', mint='m', quote='u', first=1, samples=0, high=100,
                 low=70, highLiquidity=100, rose=True)
        s = bot.fresh(1)
        s['candidates']['p'] = c
        row = dict(id='solana_p',pool='p',mint='m',quote='u',price=90,liquidity=90,
                   buys=0,sells=0,attributes={'transactions':{'m30':{'buys':0,'sells':0}}})
        with patch.object(bot,'get',side_effect=[{'data':[]},{'data':[row]}]), patch.object(bot,'snapshot',side_effect=lambda item:item), patch.object(bot.time,'time',return_value=4000), patch.object(bot.time,'sleep'):
            bot.scan(s,4000)
        self.assertEqual(c['diagnostics']['latest']['outcome'],'noTrades30m')
        self.assertEqual(s['errors'],{})
        self.assertEqual(s['positions'],{})
        for val in (None,False,'0',1):
            row['attributes']['transactions']['m30']['buys'] = val
            self.assertFalse(bot.quiet_half_hour(row))

    def test_trade_request_recovery(self):
        from urllib.error import HTTPError
        s = bot.fresh(1)
        with patch.object(bot,'get',side_effect=HTTPError('u',429,'limited',{'Retry-After':'400'},None)), patch.object(bot.time,'time',return_value=100):
            with self.assertRaises(HTTPError): bot.fetch_trades(s,'p')
        self.assertGreaterEqual(s['tradeRetryAt'],500)
        with patch.object(bot,'get',side_effect=[HTTPError('u',502,'gateway',{},None),{'data':[1]}]), patch.object(bot.time,'sleep'):
            self.assertEqual(bot.fetch_trades(s,'p'),[1])
