"""Frozen Cross-Sectional Funding Carry Risk-Budget V2 engine. Research only."""

from math import isfinite, log, sqrt
from statistics import stdev, median
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
    evaluate_book,
    _terminal_close,
    _compound,
    _pf,
    _max_dd,
    _sharpe,
    _windows,
    _coverage,
)

RULESET='CROSS-SECTIONAL-FUNDING-CARRY-RISK-BUDGET-V2-FROZEN'
ASSETS=('TRX','ETC','XLM','ATOM','UNI','AAVE','FIL','NEAR')
FACTOR='FUNDING_CARRY_7D'
VOL_DAYS=28
VOL_BARS=VOL_DAYS*6
VOL_TARGET=0.20
MIN_ASSET_WEIGHT=0.15
MAX_ASSET_WEIGHT=0.35
MIN_BREADTH=6

GATE={
    'min_periods':150,
    'min_active':100,
    'min_pf':1.05,
    'min_sharpe':0.50,
    'max_dd_pct':25.0,
    'min_positive_windows':3,
    'min_positive_assets':5,
    'max_positive_concentration_pct':35.0,
    'min_mean_gross':0.35,
}

@dataclass
class FundingRiskAssetData:
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

    def trailing_log_returns(self,t):
        anchors=[t-(VOL_BARS-i)*FOUR_H for i in range(VOL_BARS+1)]
        prices=[self.price.get(x) for x in anchors]
        if any(x is None or not isfinite(x) or x<=0 for x in prices):
            return None
        return [log(prices[i]/prices[i-1]) for i in range(1,len(prices))]

    def annualized_vol(self,t):
        rs=self.trailing_log_returns(t)
        if rs is None or len(rs)!=VOL_BARS:
            return None
        s=stdev(rs)
        v=s*sqrt(6*365)
        return v if isfinite(v) and v>0 else None


def prepare_dataset(raw_by_asset):
    return {
        asset:FundingRiskAssetData(asset,raw_by_asset[asset].get('klines',[]),raw_by_asset[asset].get('funding',[]))
        for asset in ASSETS
    }


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


def _snapshot(panel,t):
    values={}
    for asset in ASSETS:
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


def select_top2_bottom2(values):
    if len(values)<MIN_BREADTH:
        return (),()
    rows=sorted(values.items(),key=lambda kv:(kv[1],kv[0]))
    shorts=tuple(a for a,_ in rows[:2])
    longs=tuple(a for a,_ in rows[-2:])
    return longs,shorts


def _side_weights(vols,sign):
    assets=sorted(vols)
    if len(assets)!=2:
        raise ValueError('exactly two assets required per side')
    a,b=assets
    ia=1.0/vols[a];ib=1.0/vols[b]
    raw_a=0.5*ia/(ia+ib)
    abs_a=min(MAX_ASSET_WEIGHT,max(MIN_ASSET_WEIGHT,raw_a))
    abs_b=0.5-abs_a
    if not (MIN_ASSET_WEIGHT-1e-12<=abs_b<=MAX_ASSET_WEIGHT+1e-12):
        raise ValueError('side weight bounds violated')
    return {a:sign*abs_a,b:sign*abs_b}


def risk_budget_weights(dataset,values,t):
    longs,shorts=select_top2_bottom2(values)
    if not longs or not shorts:
        return {},{'reason':'BREADTH','selectedVols':{},'riskScale':0.0,'preScalePortfolioVol':None}

    selected=tuple(longs)+tuple(shorts)
    asset_vols={}
    return_series={}
    for a in selected:
        v=dataset[a].annualized_vol(t)
        if v is None:
            return {},{'reason':'VOL_DATA','selectedVols':asset_vols,'riskScale':0.0,'preScalePortfolioVol':None}
        rs=dataset[a].trailing_log_returns(t)
        if rs is None:
            return {},{'reason':'VOL_DATA','selectedVols':asset_vols,'riskScale':0.0,'preScalePortfolioVol':None}
        asset_vols[a]=v
        return_series[a]=rs

    prelim={}
    prelim.update(_side_weights({a:asset_vols[a] for a in longs},+1.0))
    prelim.update(_side_weights({a:asset_vols[a] for a in shorts},-1.0))

    portfolio_rs=[]
    for i in range(VOL_BARS):
        portfolio_rs.append(sum(prelim[a]*return_series[a][i] for a in selected))
    pvol=stdev(portfolio_rs)*sqrt(6*365)
    if not isfinite(pvol) or pvol<=0:
        return {},{'reason':'PORTFOLIO_VOL','selectedVols':asset_vols,'riskScale':0.0,'preScalePortfolioVol':pvol}

    scale=min(1.0,VOL_TARGET/pvol)
    weights={a:w*scale for a,w in prelim.items()}
    gross=sum(abs(x) for x in weights.values())
    return weights,{
        'reason':None,
        'selectedVols':asset_vols,
        'riskScale':scale,
        'preScalePortfolioVol':pvol,
        'gross':gross,
        'longs':longs,
        'shorts':shorts,
    }


def _metrics(weeks,asset_attr,total_funding,total_cost,total_turnover,total_long,total_short,flat_breadth,flat_risk,risk_diag):
    rs=[w['net'] for w in weeks]
    prs=[w['priceOnly'] for w in weeks]
    positive={a:v for a,v in asset_attr.items() if v>0}
    pos_total=sum(positive.values())
    concentration=max(positive.values())/pos_total*100.0 if positive else 0.0
    wins=_windows(rs,5)
    grosses=[w['gross'] for w in weeks if w['active']]
    scales=[x['riskScale'] for x in risk_diag if x.get('reason') is None]
    pvols=[x['preScalePortfolioVol'] for x in risk_diag if x.get('reason') is None]
    selected_vols=[v for x in risk_diag if x.get('reason') is None for v in x.get('selectedVols',{}).values()]
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
        'flatByBreadthWeeks':flat_breadth,
        'flatByRiskDataWeeks':flat_risk,
        'meanGrossExposure':sum(grosses)/len(grosses) if grosses else 0.0,
        'medianGrossExposure':median(grosses) if grosses else 0.0,
        'meanRiskScale':sum(scales)/len(scales) if scales else 0.0,
        'meanSelectedAssetAnnualizedVol':sum(selected_vols)/len(selected_vols) if selected_vols else None,
        'meanPreScalePortfolioAnnualizedVol':sum(pvols)/len(pvols) if pvols else None,
        'weekly':weeks,
    }


def run_method(dataset,panel,start,end,cost_bps):
    anchors=weekly_anchors(start,end)
    prev={}
    weeks=[]
    asset_attr={a:0.0 for a in ASSETS}
    total_funding=total_cost=total_turnover=total_long=total_short=0.0
    flat_breadth=flat_risk=0
    risk_diag=[]

    for t in anchors:
        values=_snapshot(panel,t)
        if len(values)<MIN_BREADTH:
            weights={}
            diag={'reason':'BREADTH','selectedVols':{},'riskScale':0.0,'preScalePortfolioVol':None}
            flat_breadth+=1
        else:
            weights,diag=risk_budget_weights(dataset,values,t)
            if not weights:
                flat_risk+=1
        risk_diag.append(diag)

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
            'gross':sum(abs(x) for x in weights.values()),
            'riskScale':diag.get('riskScale',0.0),
            'preScalePortfolioVol':diag.get('preScalePortfolioVol'),
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
        weeks,asset_attr,total_funding,total_cost,total_turnover,total_long,total_short,
        flat_breadth,flat_risk,risk_diag
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
    if result['meanGrossExposure']<g['min_mean_gross']:
        reasons.append('MEAN_GROSS_LT_'+str(g['min_mean_gross']))
    return {
        'pass':not reasons,
        'reasons':reasons,
        'decision':'VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY' if not reasons else 'VALIDATION_FAIL_RESEARCH_REDESIGN',
    }


def run_validation(raw_by_asset,start,end):
    try:
        dataset=prepare_dataset(raw_by_asset)
        panel=build_funding_panel(dataset,start,end)
        base=run_method(dataset,panel,start,end,BASE_COST_BPS)
        stress=run_method(dataset,panel,start,end,STRESS_COST_BPS)
        gate=validation_gate(base,stress)
        return {
            'ruleset':RULESET,
            'stage':'INDEPENDENT_VALIDATION',
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
            'stage':'INDEPENDENT_VALIDATION',
            'researchOnly':True,
            'executionImpact':False,
            'autoPromotion':False,
            'dataIntegrityFailure':True,
            'error':str(e),
            'gate':{'pass':False,'reasons':['DATA_INTEGRITY_FAILURE']},
            'decision':'VALIDATION_FAIL_RESEARCH_REDESIGN',
        }
