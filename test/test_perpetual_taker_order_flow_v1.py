import json
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'research'))

from perpetual_taker_order_flow_v1 import (
    ASSETS, BASE_COST_BPS, DAY, DEVELOPMENT_END, DEVELOPMENT_EXPECTED_PERIODS,
    DEVELOPMENT_START, FLOW_HOURS, HOLDOUT_END, HOLDOUT_EXPECTED_PERIODS,
    HOLDOUT_START, HOUR, RULESET, SIDE_COUNT, STRESS_COST_BPS, WEEK,
    AssetData, development_authorizes_holdout, funding_coverage, run_stage,
    select_weights, stage_gate, terminal_close, turnover, weekly_anchors
)


class FakeAsset:
    def __init__(self,signal,holding=.01,entry=True,raise_on_future=False):
        self.signal=signal
        self.holding=holding
        self.entry=entry
        self.raise_on_future=raise_on_future
    def flow_signal(self,t):return self.signal
    def entry_open_available(self,t):return self.entry
    def entry_exit_return(self,t):
        if self.raise_on_future:
            raise AssertionError('future return must not be read during selection')
        return self.holding


def hourly_rows(start,n,prior_t=None,prior_buy=.60,future_buy=.99):
    out=[]
    for i in range(n):
        ot=start+i*HOUR
        q=100.0
        ratio=prior_buy if prior_t is None or ot<prior_t else future_buy
        tq=q*ratio
        base=10.0
        tb=base*ratio
        p=100.0+i*.001
        out.append([ot,ot+HOUR-1,p,p*1.001,p*.999,p,base,q,20.0,tb,tq])
    return out


def funding_rows(start,end,rate=.0001):
    out=[];t=start+8*HOUR
    while t<=end:
        out.append([t,rate]);t+=8*HOUR
    return out


def good_metrics(stage='DEVELOPMENT',**kw):
    is_dev=stage=='DEVELOPMENT'
    base={
        'periods':DEVELOPMENT_EXPECTED_PERIODS if is_dev else HOLDOUT_EXPECTED_PERIODS,
        'minEligibleAssets':12,'maxEligibleAssets':12,'sideCounts':[2],
        'returnPct':12.0,'priceOnlyReturnPct':10.0,'profitFactor':1.4,'sharpe':1.0,
        'maxDrawdownPct':12.0,'positiveWindows':5,
        'longContribution':.10,'shortContribution':.08,
        'positiveAssets':10 if is_dev else 9,
        'positiveConcentrationPct':20.0,
        'meanHighMinusLowNextWeek':.01,
    }
    base.update(kw)
    return base


class TakerOrderFlowV1Tests(unittest.TestCase):
    def test_frozen_identity_calendar_costs_and_universe(self):
        self.assertEqual(RULESET,'PERPETUAL-TAKER-ORDER-FLOW-V1-FROZEN')
        self.assertEqual(len(ASSETS),12)
        self.assertEqual(FLOW_HOURS,168)
        self.assertEqual(SIDE_COUNT,2)
        self.assertEqual(BASE_COST_BPS,8.0)
        self.assertEqual(STRESS_COST_BPS,13.0)
        dev=weekly_anchors(DEVELOPMENT_START,DEVELOPMENT_END)
        hold=weekly_anchors(HOLDOUT_START,HOLDOUT_END)
        self.assertEqual(len(dev),102)
        self.assertEqual(len(hold),85)
        self.assertEqual(dev[-1]+WEEK,DEVELOPMENT_END)
        self.assertEqual(hold[-1]+WEEK,HOLDOUT_END)
        self.assertLess(DEVELOPMENT_END,HOLDOUT_START)

    def test_flow_uses_exact_prior_168_hours_and_ignores_holding_week(self):
        t=1000*HOUR
        start=t-WEEK
        rows=hourly_rows(start,FLOW_HOURS+WEEK//HOUR+1,prior_t=t,prior_buy=.60,future_buy=.99)
        f=funding_rows(start,start+2*WEEK)
        a=AssetData('X',rows,f)
        self.assertAlmostEqual(a.flow_signal(t),.20,places=12)

        rows2=hourly_rows(start,FLOW_HOURS+WEEK//HOUR+1,prior_t=t,prior_buy=.60,future_buy=.01)
        b=AssetData('Y',rows2,f)
        self.assertAlmostEqual(a.flow_signal(t),b.flow_signal(t),places=12)

    def test_flow_requires_every_prior_hour(self):
        t=1000*HOUR
        start=t-WEEK
        rows=hourly_rows(start,FLOW_HOURS+2)
        del rows[50]
        with self.assertRaisesRegex(ValueError,'HOURLY_GAP'):
            AssetData('X',rows,funding_rows(start,start+WEEK))

    def test_selection_is_top2_long_bottom2_short(self):
        data={a:FakeAsset(float(i)) for i,a in enumerate(ASSETS)}
        w,signals,longs,shorts=select_weights(data,0)
        self.assertEqual(longs,[ASSETS[-1],ASSETS[-2]])
        self.assertEqual(set(shorts),set(ASSETS[:2]))
        self.assertEqual(len(longs),2)
        self.assertEqual(len(shorts),2)
        self.assertTrue(all(w[a]>.0 for a in longs))
        self.assertTrue(all(w[a]<.0 for a in shorts))
        self.assertAlmostEqual(sum(w.values()),0.0)
        self.assertAlmostEqual(sum(abs(x) for x in w.values()),1.0)

    def test_selection_does_not_read_future_return(self):
        data={a:FakeAsset(float(i),raise_on_future=True) for i,a in enumerate(ASSETS)}
        w,signals,longs,shorts=select_weights(data,0)
        self.assertEqual(len(signals),12)
        self.assertEqual(len(longs),2)
        self.assertEqual(len(shorts),2)
        self.assertAlmostEqual(sum(w.values()),0.0)
        self.assertAlmostEqual(sum(abs(x) for x in w.values()),1.0)

    def test_selection_requires_entry_time_data_but_not_exit_time_data(self):
        data={a:FakeAsset(float(i)) for i,a in enumerate(ASSETS)}
        data['BTC']=FakeAsset(99.0,entry=False)
        with self.assertRaisesRegex(ValueError,'ELIGIBLE_ASSETS_NE_12'):
            select_weights(data,0)

    def test_holdout_engine_is_locked_without_valid_development_evidence(self):
        self.assertFalse(development_authorizes_holdout(None))
        self.assertFalse(development_authorizes_holdout({
            'ruleset':RULESET,'stage':'DEVELOPMENT',
            'decision':'DEVELOPMENT_FAIL_RESEARCH_REDESIGN',
            'dataIntegrityFailure':False,'gate':{'pass':False}
        }))
        with self.assertRaisesRegex(PermissionError,'HOLDOUT_NOT_AUTHORIZED'):
            run_stage({},'TEMPORAL_HOLDOUT')

        good={
            'ruleset':RULESET,'stage':'DEVELOPMENT',
            'decision':'DEVELOPMENT_PASS_TEMPORAL_HOLDOUT_REQUIRED',
            'dataIntegrityFailure':False,'gate':{'pass':True}
        }
        self.assertTrue(development_authorizes_holdout(good))

    def test_funding_interval_excludes_entry_and_includes_exit(self):
        self.assertTrue(funding_coverage([8*HOUR,16*HOUR,24*HOUR],0,24*HOUR))
        self.assertFalse(funding_coverage([13*HOUR,21*HOUR],0,24*HOUR))
        rows=hourly_rows(0,24*8+1)
        f=[[0,.99],[8*HOUR,.001],[16*HOUR,.002],[24*HOUR,.003]]
        a=AssetData('X',rows,f)
        self.assertAlmostEqual(a.funding_sum(0,24*HOUR),.006)

    def test_turnover_and_terminal_costs(self):
        prev={'BTC':.25,'ETH':.25,'SOL':-.25,'XRP':-.25}
        new={'BTC':.25,'BNB':.25,'SOL':-.25,'ADA':-.25}
        self.assertAlmostEqual(turnover(prev,new),1.0)
        tr,cost,attr=terminal_close(new,BASE_COST_BPS)
        self.assertAlmostEqual(tr,1.0)
        self.assertAlmostEqual(cost,.0008)
        self.assertAlmostEqual(sum(attr.values()),-.0008)

    def test_development_gate_passes_only_complete_strong_case(self):
        r=good_metrics('DEVELOPMENT')
        s=good_metrics('DEVELOPMENT',returnPct=5.0)
        g=stage_gate(r,s,'DEVELOPMENT')
        self.assertTrue(g['pass'],g['reasons'])
        self.assertEqual(g['decision'],'DEVELOPMENT_PASS_TEMPORAL_HOLDOUT_REQUIRED')

    def test_development_gate_rejects_weak_signal_and_short_side(self):
        r=good_metrics('DEVELOPMENT',meanHighMinusLowNextWeek=-.01,shortContribution=-.01)
        s=good_metrics('DEVELOPMENT',returnPct=5.0)
        g=stage_gate(r,s,'DEVELOPMENT')
        self.assertIn('HIGH_MINUS_LOW_SPREAD_NOT_POSITIVE',g['reasons'])
        self.assertIn('SHORT_CONTRIBUTION_NOT_POSITIVE',g['reasons'])

    def test_holdout_gate_is_distinct_and_unchanged(self):
        r=good_metrics('TEMPORAL_HOLDOUT')
        s=good_metrics('TEMPORAL_HOLDOUT',returnPct=3.0)
        g=stage_gate(r,s,'TEMPORAL_HOLDOUT')
        self.assertTrue(g['pass'],g['reasons'])
        self.assertEqual(g['decision'],'HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY')

    def test_machine_protocol_locks_holdout_and_signal(self):
        p=json.loads((ROOT/'research'/'perpetual-taker-order-flow-v1-protocol.json').read_text())
        self.assertEqual(p['signal']['hours'],168)
        self.assertEqual(p['signal']['direction'],'CONTINUATION_HIGH_LONG_LOW_SHORT')
        self.assertEqual(p['portfolio']['sideCount'],2)
        self.assertTrue(p['stages']['holdout']['authorizedOnlyAfterDevelopmentPass'])
        self.assertEqual(
            p['portfolio']['selectionInformationSet'],
            'PRIOR_168H_FLOW_PLUS_ENTRY_OPEN_ONLY_NO_EXIT_OR_HOLDING_RETURN'
        )
        self.assertEqual(
            p['stages']['holdout']['engineAuthorizationEvidence'],
            'CANONICAL_DEVELOPMENT_PASS_EVIDENCE_REQUIRED'
        )
        self.assertFalse(p['holdoutLoaded'])
        self.assertFalse(p['paperAuthorized'])
        self.assertFalse(p['liveAuthorized'])


if __name__=='__main__':
    unittest.main()
