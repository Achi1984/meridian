import unittest
from unittest.mock import patch
import btc_compound_paper as model


class CompoundTest(unittest.TestCase):
    def test_forward_boundary(self):
        state = model.cohort(model.HOUR + 1)
        self.assertEqual(state["cursor"], 2*model.HOUR)
        self.assertEqual(state["bots"]["Short"]["fixed"]["balance"],1000)

    def test_mirrored_reclaim_uses_only_closed_bars(self):
        H=model.HOUR
        hist={i*H:(100+i,102+i,99+i,101+i) for i in range(32)}
        hist[30*H]=(131,132,127,128)
        hist[31*H]=(128,135,128,133)
        self.assertEqual(model.setup(hist,32*H,1),(127,"Signal bestätigt"))
        self.assertEqual(model.setup(hist,32*H,-1),(None,"4h-Trend fehlt"))
        mirror={t:(300-o,300-l,300-h,300-c) for t,(o,h,l,c) in hist.items()}
        self.assertEqual(model.setup(mirror,32*H,-1),(173,"Signal bestätigt"))

    def test_wait_reason_matches_the_first_failed_entry_rule(self):
        H=model.HOUR
        hist={i*H:(100+i,102+i,99+i,101+i) for i in range(32)}
        bot=model.cohort(0)["bots"]["Long"]
        hist[32*H]=(133,135,132,134)
        model.step(bot,hist,32*H,1,0)
        self.assertEqual(bot["decision"],{"reason":"Wartet auf Rücksetzer","closeMs":33*H})
        hist[30*H]=(131,134,127,128)
        model.step(bot,hist,32*H,1,0)
        self.assertEqual(bot["decision"]["reason"],"Bestätigung fehlt")
        self.assertIsNone(bot["position"])

    def test_pairs_share_fills_costs_and_gap_but_size_on_realized_balance(self):
        for side,sign in (("Long",1),("Short",-1)):
            bot=model.cohort(0)["bots"][side]
            bot["compound"]["balance"]=1100
            stop=100-sign*5
            with patch.object(model,"setup",return_value=(stop,"Signal bestätigt")), patch.object(model,"trail",return_value=stop):
                model.step(bot,{0:(100,101,99,100)},0,sign,.01)
                self.assertEqual(bot["decision"],{"closeMs":model.HOUR,"reason":"Position eröffnet"})
                pos=bot["position"]
                self.assertEqual(pos["fundingPerBTC"],0)
                self.assertAlmostEqual(pos["qty"]["compound"]/pos["qty"]["fixed"],1.1)
                gap=100-sign*10
                model.step(bot,{1:(gap,gap+1,gap-1,gap)},1,sign,.001)
                trade,=bot["trades"]
                self.assertIsNone(bot["position"])
                self.assertEqual(bot["decision"]["reason"],"Am Stop geschlossen")
                self.assertAlmostEqual(trade["exit"],gap*(1-sign*model.SLIP))
                self.assertAlmostEqual(trade["net"]["compound"]/trade["net"]["fixed"],1.1)
                for arm,qty in pos["qty"].items():
                    gross=sign*qty*(trade["exit"]-trade["entry"])
                    self.assertGreater(trade["fees"][arm],0)
                    self.assertAlmostEqual(trade["funding"][arm],-sign*gap*.001*qty)
                    self.assertAlmostEqual(trade["net"][arm],gross-trade["fees"][arm]+trade["funding"][arm])
                self.assertLess(trade["net"]["fixed"],-5)
                self.assertGreater(bot["fixed"]["drawdown"],0)
