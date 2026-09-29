"""Frozen Cross-Sectional Funding Carry V1 transfer-validation engine. Research only."""

from math import isfinite
from dataclasses import dataclass
from bisect import bisect_left, bisect_right
from self_history_perp_factor_v3 import (
    BASE_COST_BPS,
    STRESS_COST_BPS,
    WEEK,
    FOUR_H,
    FUND_MAX_GAP,
    HISTORY_MAX_WEEKS,
    weekly_anchors,
    is_eligible,
    cross_section_weights,
    evaluate_book,
    _terminal_close,
    _compound,
    _pf,
    _max_dd,
    _sharpe,
    _windows,
    _coverage,
)

RULESET='CROSS-SECTIONAL-FUNDING-CARRY-V1-FROZEN'
ASSETS=('LTC','BCH','AVAX','HBAR')
FACTOR='FUNDING_CARRY_7D'

GATE={
    'min_periods':150,
    'min_active':70,
    'min_pf':1.05,
    'min_sharpe':0.50,
    'max_dd_pct':25.0,
    'min_positive_windows':3,
    'min_positive_assets':3,
    'max_positive_concentration_pct':50.0,
}

@dataclass
class FundingAssetData:
    asset:str
    klines:list
    funding:list

    def __post_init__(self):
        self._validate()
        self.price={int(r[0])+FOUR_H:float(r[5]) for r in self.klines}
        self.funding_times=[int(r[0]) for r in self.funding]
        self.funding_values=[float(r[1]) for r in self.funding]
        self.funding_prefix=[0.0]
        for x in self.funding_values:
            self.funding_prefix.append(self.funding_prefix[-1]+x)

    def _validate(self):
        last=None
        for row in self.klines:
            if len(row)<6:
                raise ValueError(f'{self.asset}: malformed kline')
            ot=int(row[0]);o,h,l,c=map(float,row[2:6])
            if not all(isfinite(x) and x>0 for x in (o,h,l,c)):
                raise ValueError(f'{self.asset}: invalid OHLC')
            if h<max(o,c,l) or l>min(o,c,h):
                raise ValueError(f'{self.asset}: inconsistent OHLC')
            if last is not None and ot<=last:
                raise ValueError(f'{self.asset}: duplicate/nonmonotonic kline')
            last=ot
        last=None
        for row in self.funding:
            if len(row)<2:
                raise ValueError(f'{self.asset}: malformed funding')
            t=int(row[0]);rate=float(row[1])
            if not isfinite(rate):
                raise ValueError(f'{self.asset}: invalid funding')
            if last is not None and t<=last:
                raise ValueError(f'{self.asset}: duplicate/nonmonotonic funding')
            last=t

    def price_at(self,anchor):
        return self.price.get(anchor)

    def _sum(self,start,end,left_inclusive=True,right_inclusive=False):
        li=bisect_left(self.funding_times,start) if left_inclusive else bisect_right(self.funding_times,start)
        ri=bisect_right(self.funding_times,end) if right_inclusive else bisect_left(self.funding_times,end)
        return self.funding_prefix[ri]-self.funding_prefix[li],self.funding_times[li:ri]

    def funding_factor(self,t):
        total,rows=self._sum(t-WEEK,t,True,False)
        if not _coverage(rows,t-WEEK,t,FUND_MAX_GAP,False):
            return None
        return -total

    def holding_funding(self,start,end):
        total,rows=self._sum(start,end,False,True)
        if not _coverage(rows,start,end,FUND_MAX_GAP,True):
            raise ValueError(f'{self.asset}: holding funding coverage')
        return total

def prepare_dataset(raw_by_asset):
    out={}
    for asset in ASSETS:
        raw=raw_by_asset[asset]
        out[asset]=FundingAssetData(asset,raw.get('klines',[]),raw.get('funding',[]))
    return out

def build_funding_panel(dataset,start,end):
    history_start=start-HISTORY_MAX_WEEKS*WEEK
    anchors=weekly_anchors(history_start,end+WEEK)
    panel={a:{} for a in ASSETS}
    for asset in ASSETS:
        d=dataset[asset]
        for t in anchors:
            v=d.funding_factor(t)
            if v is not None and isfinite(v):
                panel[asset][t]=v
    return panel

def _snapshot(panel,eligible,t):
    values={}
    for asset in eligible:
        cur=panel[asset].get(t)
        if cur is None:
            continue
        prior=[]
        for k in range(HISTORY_MAX_WEEKS,0,-1):
            v=panel[asset].get(t-k*WEEK)
            if v is not None:
                prior.append(v)
        if len(prior)<52:
            continue
        values[asset]=cur
    return values

def _metrics(weeks,asset_attr,total_funding,total_cost,total_turnover,total_long,total_short,flat_missing):
    rs=[w['net'] for w in weeks]
    prs=[w['priceOnly'] for w in weeks]
    positive={a:v for a,v in asset_attr.items() if v>0}
    pos_total=sum(positive.values())
    concentration=max(positive.values())/pos_total*100.0 if positive else 0.0
    wins=_windows(rs,5)
    return {
        'periods':len(weeks),
        'activeWeeks':sum(1 for w in weeks if w['active']),
        'returnPct':_compound(rs)*100.0,
        'priceOnlyReturnPct':_compound(prs)*100.0,
        'profitFactor':_pf(rs),
        'sharpe':_sharpe(rs),
        'maxDrawdownPct':_max_dd(rs)*100.0,
        'positiveWindows':sum(1 for x in wins if x>0),
        'windowsPct':[x*100.0 for x in wins],
        'fundingContribution':total_funding,
        'costContribution':-total_cost,
        'turnover':total_turnover,
        'longContribution':total_long,
        'shortContribution':total_short,
        'assetAttribution':asset_attr,
        'positiveAssets':len(positive),
        'positiveConcentrationPct':concentration,
        'flatByMissingInputWeeks':flat_missing,
        'weekly':weeks,
    }

def run_method(dataset,panel,start,end,cost_bps):
    anchors=weekly_anchors(start,end)
    prev={}
    weeks=[]
    asset_attr={a:0.0 for a in ASSETS}
    total_funding=total_cost=total_turnover=total_long=total_short=0.0
    flat_missing=0

    for t in anchors:
        eligible=[a for a in ASSETS if is_eligible(a,t)]
        values=_snapshot(panel,eligible,t)
        if len(values)<3:
            weights={}
            flat_missing+=1
        else:
            weights=cross_section_weights(values,True)

        row=evaluate_book(dataset,weights,prev,t,cost_bps)
        weeks.append({
            't':t,
            'net':row['net'],
            'priceOnly':row['priceOnly'],
            'funding':row['funding'],
            'cost':row['cost'],
            'turnover':row['turnover'],
            'longGross':row['longGross'],
            'shortGross':row['shortGross'],
            'active':row['active'],
            'validBreadth':len(values),
        })
        for a,v in row['attr'].items():
            if a in asset_attr:
                asset_attr[a]+=v
        total_funding+=row['funding']
        total_cost+=row['cost']
        total_turnover+=row['turnover']
        total_long+=row['longGross']
        total_short+=row['shortGross']
        prev=dict(weights)

    if weeks:
        tr,cost,attr=_terminal_close(prev,ASSETS,cost_bps)
        weeks[-1]['net']-=cost
        weeks[-1]['priceOnly']-=cost
        weeks[-1]['cost']+=cost
        weeks[-1]['turnover']+=tr
        total_cost+=cost
        total_turnover+=tr
        for a,v in attr.items():
            asset_attr[a]+=v

    return _metrics(
        weeks,asset_attr,total_funding,total_cost,total_turnover,total_long,total_short,flat_missing
    )

def validation_gate(result,stress):
    g=GATE
    reasons=[]
    if result['periods']<g['min_periods']:
        reasons.append('PERIODS_LT_'+str(g['min_periods']))
    if result['activeWeeks']<g['min_active']:
        reasons.append('ACTIVE_WEEKS_LT_'+str(g['min_active']))
    if result['returnPct']<=0:
        reasons.append('RETURN_NOT_POSITIVE')
    if result['priceOnlyReturnPct']<=0:
        reasons.append('PRICE_ONLY_NOT_POSITIVE')
    if result['fundingContribution']<=0:
        reasons.append('FUNDING_CONTRIBUTION_NOT_POSITIVE')
    if result['profitFactor']<g['min_pf']:
        reasons.append('PF_LT_'+str(g['min_pf']))
    if result['sharpe']<g['min_sharpe']:
        reasons.append('SHARPE_LT_'+str(g['min_sharpe']))
    if result['maxDrawdownPct']>g['max_dd_pct']:
        reasons.append('DD_GT_'+str(g['max_dd_pct']))
    if result['positiveWindows']<g['min_positive_windows']:
        reasons.append('POSITIVE_WINDOWS_LT_'+str(g['min_positive_windows']))
    if result['longContribution']<=0:
        reasons.append('LONG_CONTRIBUTION_NOT_POSITIVE')
    if result['shortContribution']<=0:
        reasons.append('SHORT_CONTRIBUTION_NOT_POSITIVE')
    if result['positiveAssets']<g['min_positive_assets']:
        reasons.append('POSITIVE_ASSETS_LT_'+str(g['min_positive_assets']))
    if result['positiveConcentrationPct']>g['max_positive_concentration_pct']:
        reasons.append('POSITIVE_CONCENTRATION_GT_'+str(g['max_positive_concentration_pct']))
    if stress['returnPct']<=0:
        reasons.append('STRESS_RETURN_NOT_POSITIVE')
    return {
        'pass':not reasons,
        'reasons':reasons,
        'decision':'TRANSFER_VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY' if not reasons else 'TRANSFER_VALIDATION_FAIL_RESEARCH_REDESIGN',
    }

def run_transfer_validation(raw_by_asset,start,end):
    try:
        dataset=prepare_dataset(raw_by_asset)
        panel=build_funding_panel(dataset,start,end)
        base=run_method(dataset,panel,start,end,BASE_COST_BPS)
        stress=run_method(dataset,panel,start,end,STRESS_COST_BPS)
        gate=validation_gate(base,stress)
        return {
            'ruleset':RULESET,
            'stage':'TRANSFER_VALIDATION',
            'researchOnly':True,
            'executionImpact':False,
            'autoPromotion':False,
            'dataIntegrityFailure':False,
            'result':base,
            'stress':stress,
            'gate':gate,
            'decision':gate['decision'],
        }
    except Exception as e:
        return {
            'ruleset':RULESET,
            'stage':'TRANSFER_VALIDATION',
            'researchOnly':True,
            'executionImpact':False,
            'autoPromotion':False,
            'dataIntegrityFailure':True,
            'error':str(e),
            'gate':{'pass':False,'reasons':['DATA_INTEGRITY_FAILURE']},
            'decision':'TRANSFER_VALIDATION_FAIL_RESEARCH_REDESIGN',
        }
