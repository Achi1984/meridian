"""Frozen Perpetual Cross-Sectional Reversal V1 research engine. Research only."""

from __future__ import annotations
from dataclasses import dataclass
from math import isfinite, log, sqrt
from statistics import mean, stdev
from typing import Dict, List

RULESET='PERPETUAL-CROSS-SECTIONAL-REVERSAL-V1-FROZEN'
DAY=24*60*60*1000
WEEK=7*DAY
FUND_MAX_GAP=12*60*60*1000

ASSETS=(
 'ADA','DOGE','LINK','DOT','LTC','BCH','AVAX','HBAR','TRX','ETC','XLM','ATOM',
 'UNI','AAVE','FIL','NEAR','OP','INJ','APT','CRV','LDO','GALA','IMX'
)

FORMATION_WEEKS=8
SKIP_WEEKS=1
BASE_COST_BPS=8.0
STRESS_COST_BPS=13.0
MIN_ELIGIBLE=15

DISCOVERY_START=1704672000000  # 2024-01-08T00:00:00Z
DISCOVERY_END=1735516800000    # 2024-12-30T00:00:00Z, exclusive entry / final exit
DISCOVERY_EXPECTED_PERIODS=51

DISCOVERY_GATE={
 'expected_periods':51,
 'min_pf':1.15,
 'min_sharpe':0.75,
 'max_dd_pct':20.0,
 'min_positive_windows':4,
 'min_positive_assets':14,
 'max_positive_concentration_pct':20.0,
}

def _sum(xs): return sum(xs)

def _compound(rs):
    e=1.0
    for r in rs:e*=1.0+r
    return e-1.0

def _pf(rs):
    w=sum(x for x in rs if x>0)
    l=-sum(x for x in rs if x<0)
    return w/l if l>0 else (99.0 if w>0 else 0.0)

def _sharpe(rs):
    if len(rs)<2:return 0.0
    sd=stdev(rs)
    return mean(rs)/sd*sqrt(52.0) if sd>0 else (99.0 if mean(rs)>0 else 0.0)

def _max_dd(rs):
    e=1.0;peak=1.0;dd=0.0
    for r in rs:
        e*=1.0+r
        peak=max(peak,e)
        if peak>0:dd=max(dd,(peak-e)/peak)
    return dd

def _windows(rs,parts=5):
    out=[]
    for i in range(parts):
        a=len(rs)*i//parts;b=len(rs)*(i+1)//parts
        out.append(_compound(rs[a:b]) if b>a else 0.0)
    return out

def weekly_anchors(start,end):
    out=[];t=start
    while t<end:
        out.append(t);t+=WEEK
    return out

def funding_coverage(times,start,end):
    if not times:return False
    pts=[start]+times+[end]
    return all(0 < pts[i]-pts[i-1] <= FUND_MAX_GAP for i in range(1,len(pts)))

@dataclass
class AssetData:
    asset:str
    price:list
    funding:list

    def __post_init__(self):
        self._validate()
        self.open_by_time={int(r[0]):float(r[2]) for r in self.price}
        self.close_mark={int(r[0])+DAY:float(r[5]) for r in self.price}
        self.funding_times=[int(r[0]) for r in self.funding]
        self.funding_rates=[float(r[1]) for r in self.funding]

    def _validate(self):
        last=None
        for row in self.price:
            if len(row)<6:raise ValueError(f'{self.asset}:MALFORMED_PRICE')
            ot=int(row[0]);o,h,l,c=map(float,row[2:6])
            if not all(isfinite(x) and x>0 for x in (o,h,l,c)):
                raise ValueError(f'{self.asset}:INVALID_OHLC')
            if h<max(o,c,l) or l>min(o,c,h):
                raise ValueError(f'{self.asset}:INCONSISTENT_OHLC')
            if last is not None and ot-last!=DAY:
                raise ValueError(f'{self.asset}:PRICE_GAP')
            last=ot
        last=None
        for row in self.funding:
            if len(row)<2:raise ValueError(f'{self.asset}:MALFORMED_FUNDING')
            t=int(row[0]);rate=float(row[1])
            if not isfinite(rate):raise ValueError(f'{self.asset}:INVALID_FUNDING')
            if last is not None and t<=last:
                raise ValueError(f'{self.asset}:DUPLICATE_OR_NONMONOTONIC_FUNDING')
            last=t

    def formation_return(self,t):
        start=t-(FORMATION_WEEKS+SKIP_WEEKS)*WEEK
        end=t-SKIP_WEEKS*WEEK
        p0=self.close_mark.get(start);p1=self.close_mark.get(end)
        if p0 is None or p1 is None or p0<=0:return None
        return p1/p0-1.0

    def entry_exit_return(self,t):
        p0=self.open_by_time.get(t);p1=self.open_by_time.get(t+WEEK)
        if p0 is None or p1 is None or p0<=0:return None
        return p1/p0-1.0

    def funding_sum(self,start,end):
        rows=[(t,r) for t,r in zip(self.funding_times,self.funding_rates) if t>start and t<=end]
        times=[x[0] for x in rows]
        if not funding_coverage(times,start,end):
            raise ValueError(f'{self.asset}:HOLD_FUNDING_COVERAGE')
        return sum(x[1] for x in rows)

def prepare_dataset(raw):
    return {a:AssetData(a,raw[a].get('price',[]),raw[a].get('funding',[])) for a in ASSETS}

def select_weights(dataset,t):
    values={}
    holding={}
    for a in ASSETS:
        fr=dataset[a].formation_return(t)
        hr=dataset[a].entry_exit_return(t)
        if fr is not None and hr is not None and isfinite(fr) and isfinite(hr):
            values[a]=fr
            holding[a]=hr
    if len(values)<MIN_ELIGIBLE:
        raise ValueError(f'ELIGIBLE_ASSETS_LT_{MIN_ELIGIBLE}:{len(values)}')
    rows=sorted(values.items(),key=lambda kv:(kv[1],kv[0]))
    side=len(rows)//5
    if side<3:raise ValueError('SIDE_COUNT_LT_3')
    shorts=[a for a,_ in rows[-side:]]
    longs=[a for a,_ in rows[:side]]
    w={}
    for a in longs:w[a]=.5/len(longs)
    for a in shorts:w[a]=-.5/len(shorts)
    return w,values,holding,longs,shorts

def turnover(prev,new):
    return sum(abs(new.get(a,0.0)-prev.get(a,0.0)) for a in ASSETS)

def period_row(dataset,t,prev,cost_bps):
    weights,formation,holding,longs,shorts=select_weights(dataset,t)
    price=funding=long_gross=short_gross=0.0
    attr={a:0.0 for a in ASSETS}
    long_next=[];short_next=[]
    for a,w in weights.items():
        hr=holding[a]
        fs=dataset[a].funding_sum(t,t+WEEK)
        pr=w*hr
        fr=-w*fs
        gross=pr+fr
        price+=pr;funding+=fr
        attr[a]+=gross
        if w>0:
            long_gross+=gross;long_next.append(hr)
        else:
            short_gross+=gross;short_next.append(hr)

    tr=turnover(prev,weights)
    cost=tr*cost_bps/10000.0
    for a in ASSETS:
        tc=abs(weights.get(a,0.0)-prev.get(a,0.0))*cost_bps/10000.0
        attr[a]-=tc

    long_form=[formation[a] for a in longs]
    short_form=[formation[a] for a in shorts]
    return {
      't':t,'weights':weights,'eligibleAssets':len(formation),'sideCount':len(longs),
      'price':price,'funding':funding,'cost':cost,'turnover':tr,
      'net':price+funding-cost,'priceOnly':price-cost,
      'longGross':long_gross,'shortGross':short_gross,'attr':attr,
      'longFormationMean':mean(long_form),'shortFormationMean':mean(short_form),
      'longNextWeekMean':mean(long_next),'shortNextWeekMean':mean(short_next),
      'loserMinusWinnerNextWeek':mean(long_next)-mean(short_next),
      'longs':longs,'shorts':shorts,
    }

def _terminal(prev,cost_bps):
    tr=sum(abs(prev.get(a,0.0)) for a in ASSETS)
    cost=tr*cost_bps/10000.0
    attr={a:-abs(prev.get(a,0.0))*cost_bps/10000.0 for a in ASSETS if prev.get(a,0.0)}
    return tr,cost,attr

def run_method(dataset,start,end,cost_bps):
    anchors=weekly_anchors(start,end)
    prev={};weeks=[];asset_attr={a:0.0 for a in ASSETS}
    long_counts={a:0 for a in ASSETS};short_counts={a:0 for a in ASSETS}
    total_funding=total_cost=total_turnover=total_long=total_short=0.0

    for t in anchors:
        row=period_row(dataset,t,prev,cost_bps)
        weeks.append(row)
        for a,v in row['attr'].items():asset_attr[a]+=v
        for a in row['longs']:long_counts[a]+=1
        for a in row['shorts']:short_counts[a]+=1
        total_funding+=row['funding'];total_cost+=row['cost'];total_turnover+=row['turnover']
        total_long+=row['longGross'];total_short+=row['shortGross']
        prev=dict(row['weights'])

    if weeks:
        tr,cost,attr=_terminal(prev,cost_bps)
        weeks[-1]['net']-=cost
        weeks[-1]['priceOnly']-=cost
        weeks[-1]['cost']+=cost
        weeks[-1]['turnover']+=tr
        total_cost+=cost;total_turnover+=tr
        for a,v in attr.items():asset_attr[a]+=v

    rs=[x['net'] for x in weeks];prs=[x['priceOnly'] for x in weeks]
    windows=_windows(rs,5)
    positive={a:v for a,v in asset_attr.items() if v>0};pt=sum(positive.values())
    concentration=max(positive.values())/pt*100.0 if positive else 0.0
    return {
      'periods':len(weeks),
      'returnPct':_compound(rs)*100.0,
      'priceOnlyReturnPct':_compound(prs)*100.0,
      'profitFactor':_pf(rs),
      'sharpe':_sharpe(rs),
      'maxDrawdownPct':_max_dd(rs)*100.0,
      'positiveWindows':sum(1 for x in windows if x>0),
      'windowsPct':[x*100.0 for x in windows],
      'fundingContribution':total_funding,
      'costContribution':-total_cost,
      'turnover':total_turnover,
      'longContribution':total_long,
      'shortContribution':total_short,
      'assetAttribution':asset_attr,
      'positiveAssets':len(positive),
      'positiveConcentrationPct':concentration,
      'longWeeksByAsset':long_counts,
      'shortWeeksByAsset':short_counts,
      'minEligibleAssets':min(x['eligibleAssets'] for x in weeks) if weeks else 0,
      'maxEligibleAssets':max(x['eligibleAssets'] for x in weeks) if weeks else 0,
      'sideCounts':sorted(set(x['sideCount'] for x in weeks)),
      'meanLongFormationReturn':mean(x['longFormationMean'] for x in weeks) if weeks else None,
      'meanShortFormationReturn':mean(x['shortFormationMean'] for x in weeks) if weeks else None,
      'meanLongNextWeekReturn':mean(x['longNextWeekMean'] for x in weeks) if weeks else None,
      'meanShortNextWeekReturn':mean(x['shortNextWeekMean'] for x in weeks) if weeks else None,
      'meanLoserMinusWinnerNextWeek':mean(x['loserMinusWinnerNextWeek'] for x in weeks) if weeks else None,
      'weekly':weeks,
    }

def discovery_gate(result,stress):
    g=DISCOVERY_GATE;reasons=[]
    if result['periods']!=g['expected_periods']:reasons.append('PERIODS_NE_'+str(g['expected_periods']))
    if result['minEligibleAssets']<MIN_ELIGIBLE:reasons.append('ELIGIBLE_ASSETS_LT_'+str(MIN_ELIGIBLE))
    if result['returnPct']<=0:reasons.append('RETURN_NOT_POSITIVE')
    if result['priceOnlyReturnPct']<=0:reasons.append('PRICE_ONLY_NOT_POSITIVE')
    if result['profitFactor']<g['min_pf']:reasons.append('PF_LT_'+str(g['min_pf']))
    if result['sharpe']<g['min_sharpe']:reasons.append('SHARPE_LT_'+str(g['min_sharpe']))
    if result['maxDrawdownPct']>g['max_dd_pct']:reasons.append('DD_GT_'+str(g['max_dd_pct']))
    if result['positiveWindows']<g['min_positive_windows']:reasons.append('POSITIVE_WINDOWS_LT_'+str(g['min_positive_windows']))
    if stress['returnPct']<=0:reasons.append('STRESS_RETURN_NOT_POSITIVE')
    if result['longContribution']<=0:reasons.append('LONG_CONTRIBUTION_NOT_POSITIVE')
    if result['shortContribution']<=0:reasons.append('SHORT_CONTRIBUTION_NOT_POSITIVE')
    if result['positiveAssets']<g['min_positive_assets']:reasons.append('POSITIVE_ASSETS_LT_'+str(g['min_positive_assets']))
    if result['positiveConcentrationPct']>g['max_positive_concentration_pct']:
        reasons.append('POSITIVE_CONCENTRATION_GT_'+str(g['max_positive_concentration_pct']))
    if not (result['meanLoserMinusWinnerNextWeek']>0):
        reasons.append('LOSER_MINUS_WINNER_SPREAD_NOT_POSITIVE')
    return{
      'pass':not reasons,
      'reasons':reasons,
      'decision':'DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED' if not reasons else 'DISCOVERY_FAIL_RESEARCH_REDESIGN'
    }

def run_discovery(raw_by_asset):
    try:
        dataset=prepare_dataset(raw_by_asset)
        base=run_method(dataset,DISCOVERY_START,DISCOVERY_END,BASE_COST_BPS)
        stress=run_method(dataset,DISCOVERY_START,DISCOVERY_END,STRESS_COST_BPS)
        gate=discovery_gate(base,stress)
        return{
          'ruleset':RULESET,'stage':'DISCOVERY',
          'researchOnly':True,'executionImpact':False,'autoPromotion':False,
          'holdoutLoaded':False,'dataIntegrityFailure':False,
          'result':base,'stress':stress,'gate':gate,'decision':gate['decision']
        }
    except Exception as e:
        return{
          'ruleset':RULESET,'stage':'DISCOVERY',
          'researchOnly':True,'executionImpact':False,'autoPromotion':False,
          'holdoutLoaded':False,'dataIntegrityFailure':True,'error':str(e),
          'gate':{'pass':False,'reasons':['DATA_INTEGRITY_FAILURE']},
          'decision':'DISCOVERY_FAIL_RESEARCH_REDESIGN'
        }
