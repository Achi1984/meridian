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
        self.assertEqual(model.setup(hist,32*H,1),127)
        self.assertIsNone(model.setup(hist,32*H,-1))
        mirror={t:(300-o,300-l,300-h,300-c) for t,(o,h,l,c) in hist.items()}
        self.assertEqual(model.setup(mirror,32*H,-1),173)

    def test_pairs_share_fills_costs_and_gap_but_size_on_realized_balance(self):
        for side,sign in (("Long",1),("Short",-1)):
            bot=model.cohort(0)["bots"][side]
            bot["compound"]["balance"]=1100
            stop=100-sign*5
            with patch.object(model,"setup",return_value=stop), patch.object(model,"trail",return_value=stop):
                model.step(bot,{0:(100,101,99,100)},0,sign,.01)
                pos=bot["position"]
                self.assertEqual(pos["fundingPerBTC"],0)
                self.assertAlmostEqual(pos["qty"]["compound"]/pos["qty"]["fixed"],1.1)
                gap=100-sign*10
                model.step(bot,{1:(gap,gap+1,gap-1,gap)},1,sign,.001)
                trade,=bot["trades"]
                self.assertIsNone(bot["position"])
                self.assertAlmostEqual(trade["exit"],gap*(1-sign*model.SLIP))
                self.assertAlmostEqual(trade["net"]["compound"]/trade["net"]["fixed"],1.1)
                self.assertLess(trade["net"]["fixed"],-5)
                self.assertGreater(bot["fixed"]["drawdown"],0)
