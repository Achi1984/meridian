"""Frozen canonical Cross-Sectional Funding Carry Risk-Budget V2 engine. Research only."""

from math import isfinite, log, sqrt
from statistics import mean, median, stdev

from cross_sectional_funding_carry_v1 import FundingAssetData
from self_history_perp_factor_v3 import (
    BASE_COST_BPS,
    STRESS_COST_BPS,
    WEEK,
    FOUR_H,
    HISTORY_MAX_WEEKS,
    weekly_anchors,
    cross_section_weights,
    evaluate_book,
    _terminal_close,
    _compound,
    _pf,
    _max_dd,
    _sharpe,
    _windows,
)

RULESET='CROSS-SECTIONAL-FUNDING-CARRY-RISK-BUDGET-V2-CANONICAL-FROZEN'
ASSETS=('TRX','ETC','XLM','ATOM','UNI','AAVE','FIL','NEAR')
ELIGIBLE_MONTH={a:'2023-01' for a in ASSETS}
RISK_DAYS=28
RISK_INTERVALS=RISK_DAYS*6
TARGET_ANNUAL_VOL=0.10
MIN_BREADTH=6

GATE={
    'min_periods':150,
    'min_active':100,
    'min_pf':1.10,
    'min_sharpe':0.75,
    'max_dd_pct':20.0,
    'min_positive_windows':4,
    'min_positive_assets':5,
    'max_positive_concentration_pct':35.0,
    'min_mean_gross':0.25,
}

def month_key(ts):
    from datetime import datetime, timezone
    d=datetime.fromtimestamp(ts/1000,timezone.utc)
    return f'{d.year:04d}-{d.month:02d}'

def is_eligible(asset,t):
    return month_key(t)>=ELIGIBLE_MONTH[asset]

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

def factor_snapshot(panel,eligible,t):
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

def pre_risk_weights(values):
    if len(values)<MIN_BREADTH:
        return {}
    # transfer=False yields the frozen max(2, floor(N/5)) side count.
    # With N in [6,8] this is exactly 2 per side.
    w=cross_section_weights(values,False)
    if len([x for x in w.values() if x>0])!=2 or len([x for x in w.values() if x<0])!=2:
        raise ValueError('unexpected top2/bottom2 construction')
    # Freeze equal 25% absolute pre-risk weights explicitly.
    out={}
    for asset,x in w.items():
        out[asset]=0.25 if x>0 else -0.25
    return out

def risk_budget(dataset,weights,t):
    if not weights:
        return {},None,None
    anchors=[t-RISK_DAYS*24*60*60*1000+i*FOUR_H for i in range(RISK_INTERVALS+1)]
    series={}
    for asset in weights:
        px=[dataset[asset].price_at(at) for at in anchors]
        if any(p is None or not isfinite(p) or p<=0 for p in px):
            return {},None,None
        series[asset]=[log(px[i]/px[i-1]) for i in range(1,len(px))]
    portfolio=[]
    for i in range(RISK_INTERVALS):
        portfolio.append(sum(weights[a]*series[a][i] for a in weights))
    if len(portfolio)<2:
        return {},None,None
    sd=stdev(portfolio)
    annual=sd*sqrt(6*365)
    if not isfinite(annual) or annual<=0:
        return {},None,None
    scale=min(1.0,TARGET_ANNUAL_VOL/annual)
    final={a:w*scale for a,w in weights.items()}
    return final,scale,annual

def _metrics(weeks,asset_attr,total_funding,total_cost,total_turnover,total_long,total_short,flat_breadth,flat_risk):
    rs=[w['net'] for w in weeks]
    prs=[w['priceOnly'] for w in weeks]
    positive={a:v for a,v in asset_attr.items() if v>0}
    pos_total=sum(positive.values())
    concentration=max(positive.values())/pos_total*100.0 if positive else 0.0
    wins=_windows(rs,5)
    active=[w for w in weeks if w['active']]
    gross=[w['gross'] for w in active]
    scales=[w['riskScale'] for w in active]
    vols=[w['preScaleAnnualVol'] for w in active]
    return {
        'periods':len(weeks),
        'activeWeeks':len(active),
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
        'meanGrossExposure':mean(gross) if gross else 0.0,
        'medianGrossExposure':median(gross) if gross else 0.0,
        'meanRiskScale':mean(scales) if scales else 0.0,
        'meanPreScaleAnnualVol':mean(vols) if vols else 0.0,
        'weekly':weeks,
    }

def run_method(dataset,panel,start,end,cost_bps):
    anchors=weekly_anchors(start,end)
    prev={}
    weeks=[]
    asset_attr={a:0.0 for a in ASSETS}
    total_funding=total_cost=total_turnover=total_long=total_short=0.0
    flat_breadth=0
    flat_risk=0

    for t in anchors:
        eligible=[a for a in ASSETS if is_eligible(a,t)]
        values=factor_snapshot(panel,eligible,t)
        if len(values)<MIN_BREADTH:
            weights={}
            risk_scale=None
            annual=None
            flat_breadth+=1
        else:
            pre=pre_risk_weights(values)
            weights,risk_scale,annual=risk_budget(dataset,pre,t)
            if not weights:
                flat_risk+=1

        row=evaluate_book(dataset,weights,prev,t,cost_bps)
        gross=sum(abs(x) for x in weights.values())
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
            'gross':gross,
            'riskScale':risk_scale if weights else None,
            'preScaleAnnualVol':annual if weights else None,
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
        flat_breadth,flat_risk
    )

def validation_gate(result,stress):
    g=GATE
    reasons=[]
    if result['periods']<g['min_periods']:reasons.append('PERIODS_LT_'+str(g['min_periods']))
    if result['activeWeeks']<g['min_active']:reasons.append('ACTIVE_WEEKS_LT_'+str(g['min_active']))
    if result['returnPct']<=0:reasons.append('RETURN_NOT_POSITIVE')
    if result['priceOnlyReturnPct']<=0:reasons.append('PRICE_ONLY_NOT_POSITIVE')
    if result['fundingContribution']<=0:reasons.append('FUNDING_CONTRIBUTION_NOT_POSITIVE')
    if result['profitFactor']<g['min_pf']:reasons.append('PF_LT_'+str(g['min_pf']))
    if result['sharpe']<g['min_sharpe']:reasons.append('SHARPE_LT_'+str(g['min_sharpe']))
    if result['maxDrawdownPct']>g['max_dd_pct']:reasons.append('DD_GT_'+str(g['max_dd_pct']))
    if result['positiveWindows']<g['min_positive_windows']:reasons.append('POSITIVE_WINDOWS_LT_'+str(g['min_positive_windows']))
    if result['longContribution']<=0:reasons.append('LONG_CONTRIBUTION_NOT_POSITIVE')
    if result['shortContribution']<=0:reasons.append('SHORT_CONTRIBUTION_NOT_POSITIVE')
    if result['positiveAssets']<g['min_positive_assets']:reasons.append('POSITIVE_ASSETS_LT_'+str(g['min_positive_assets']))
    if result['positiveConcentrationPct']>g['max_positive_concentration_pct']:
        reasons.append('POSITIVE_CONCENTRATION_GT_'+str(g['max_positive_concentration_pct']))
    if stress['returnPct']<=0:reasons.append('STRESS_RETURN_NOT_POSITIVE')
    if result['meanGrossExposure']<g['min_mean_gross']:reasons.append('MEAN_GROSS_LT_'+str(g['min_mean_gross']))
    return {
        'pass':not reasons,
        'reasons':reasons,
        'decision':'VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY' if not reasons else 'VALIDATION_FAIL_RESEARCH_REDESIGN'
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
            'stage':'VALIDATION',
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
            'stage':'VALIDATION',
            'researchOnly':True,
            'executionImpact':False,
            'autoPromotion':False,
            'dataIntegrityFailure':True,
            'error':str(e),
            'gate':{'pass':False,'reasons':['DATA_INTEGRITY_FAILURE']},
            'decision':'VALIDATION_FAIL_RESEARCH_REDESIGN',
        }
