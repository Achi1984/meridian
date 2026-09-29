"""Frozen Perpetual Orthogonalized Taker Order Flow V2 engine. Research only."""

from __future__ import annotations
from math import isfinite, sqrt
from statistics import mean
from perpetual_taker_order_flow_v1 import (
    ASSETS, HOUR, WEEK, BASE_COST_BPS, STRESS_COST_BPS, SIDE_COUNT,
    AssetData, turnover, terminal_close, _compound, _pf, _sharpe, _max_dd, _windows
)

RULESET='PERPETUAL-ORTHOGONALIZED-TAKER-ORDER-FLOW-V2-FROZEN'
ESTIMATOR_START=1673654400000  # 2023-01-14T00:00:00Z
MIN_ESTIMATOR_PAIRS=52
VALIDATION_START=1736553600000 # 2025-01-11T00:00:00Z
VALIDATION_END=1787961600000   # 2026-08-29T00:00:00Z
EXPECTED_PERIODS=85
REQUIRED_ELIGIBLE=12

VALIDATION_GATE={
    'expected_periods':85,
    'min_pf':1.10,
    'min_sharpe':0.50,
    'max_dd_pct':25.0,
    'min_positive_windows':3,
    'min_positive_assets':7,
    'max_positive_concentration_pct':35.0,
}


def history_anchors(end_inclusive):
    if end_inclusive<ESTIMATOR_START:return []
    out=[];t=ESTIMATOR_START
    while t<=end_inclusive:
        out.append(t);t+=WEEK
    return out


def _ols_last_residual(xs,ys):
    if len(xs)!=len(ys) or len(xs)<2:
        raise ValueError('OLS_PAIR_COUNT')
    if not all(isfinite(x) for x in xs+ys):
        raise ValueError('OLS_NONFINITE')
    xb=mean(xs);yb=mean(ys)
    denom=sum((x-xb)**2 for x in xs)
    if denom<=0:
        raise ValueError('OLS_ZERO_X_VARIANCE')
    beta=sum((x-xb)*(y-yb) for x,y in zip(xs,ys))/denom
    alpha=yb-beta*xb
    residual=ys[-1]-(alpha+beta*xs[-1])
    if not all(isfinite(x) for x in (alpha,beta,residual)):
        raise ValueError('OLS_NONFINITE_RESULT')
    return residual,alpha,beta


def _corr(xs,ys):
    if len(xs)<2 or len(xs)!=len(ys):return None
    xb=mean(xs);yb=mean(ys)
    dx=[x-xb for x in xs];dy=[y-yb for y in ys]
    vx=sum(x*x for x in dx);vy=sum(y*y for y in dy)
    if vx<=0 or vy<=0:return 0.0
    return sum(x*y for x,y in zip(dx,dy))/sqrt(vx*vy)


class OrthoAssetData(AssetData):
    def lagged_week_return(self,t):
        p0=self.open_by_time.get(t-WEEK)
        p1=self.open_by_time.get(t)
        if p0 is None or p1 is None or p0<=0:return None
        return p1/p0-1.0

    def ortho_signal(self,t):
        anchors=history_anchors(t)
        if len(anchors)<MIN_ESTIMATOR_PAIRS:return None
        xs=[];ys=[]
        for s in anchors:
            r=self.lagged_week_return(s)
            f=self.flow_signal(s)
            if r is None or f is None:
                return None
            xs.append(r);ys.append(f)
        try:
            residual,alpha,beta=_ols_last_residual(xs,ys)
        except ValueError:
            return None
        return {
            'residual':residual,
            'rawFlow':ys[-1],
            'lagReturn':xs[-1],
            'observations':len(xs),
            'alpha':alpha,
            'beta':beta,
        }


def prepare_dataset(raw_by_asset):
    if set(raw_by_asset)!=set(ASSETS):
        raise ValueError('ASSET_UNIVERSE_MISMATCH')
    return {
        a:OrthoAssetData(a,raw_by_asset[a].get('hourly',[]),raw_by_asset[a].get('funding',[]))
        for a in ASSETS
    }


def select_weights(dataset,t):
    rows=[]
    for a in ASSETS:
        info=dataset[a].ortho_signal(t)
        holding=dataset[a].entry_exit_return(t)
        if info is not None and holding is not None:
            rows.append((a,info,holding))
    if len(rows)!=REQUIRED_ELIGIBLE:
        raise ValueError(f'ELIGIBLE_ASSETS_NE_{REQUIRED_ELIGIBLE}:{len(rows)}')

    ranked=sorted(rows,key=lambda x:(-x[1]['residual'],x[0]))
    longs=[x[0] for x in ranked[:SIDE_COUNT]]
    shorts=[x[0] for x in ranked[-SIDE_COUNT:]]
    weights={}
    for a in longs:weights[a]=0.5/SIDE_COUNT
    for a in shorts:weights[a]=-0.5/SIDE_COUNT
    info={a:i for a,i,_ in rows}
    holding={a:h for a,_,h in rows}
    return weights,info,holding,longs,shorts


def weekly_anchors(start,end):
    out=[];t=start
    while t<end:
        out.append(t);t+=WEEK
    return out


def period_row(dataset,t,prev,cost_bps):
    weights,info,holding,longs,shorts=select_weights(dataset,t)
    price=funding=long_gross=short_gross=0.0
    attr={a:0.0 for a in ASSETS}
    long_next=[];short_next=[]

    for a,w in weights.items():
        hr=holding[a]
        fs=dataset[a].funding_sum(t,t+WEEK)
        pr=w*hr
        fr=-w*fs
        gross=pr+fr
        price+=pr;funding+=fr;attr[a]+=gross
        if w>0:
            long_gross+=gross;long_next.append(hr)
        else:
            short_gross+=gross;short_next.append(hr)

    tr=turnover(prev,weights)
    cost=tr*cost_bps/10000.0
    for a in ASSETS:
        attr[a]-=abs(weights.get(a,0.0)-prev.get(a,0.0))*cost_bps/10000.0

    residuals=[info[a]['residual'] for a in ASSETS]
    lag_returns=[info[a]['lagReturn'] for a in ASSETS]
    corr=_corr(residuals,lag_returns)

    return {
      't':t,'weights':weights,'eligibleAssets':len(info),'sideCount':len(longs),
      'price':price,'funding':funding,'cost':cost,'turnover':tr,
      'net':price+funding-cost,'priceOnly':price-cost,
      'longGross':long_gross,'shortGross':short_gross,'attr':attr,
      'longs':longs,'shorts':shorts,
      'longRawFlowMean':mean(info[a]['rawFlow'] for a in longs),
      'shortRawFlowMean':mean(info[a]['rawFlow'] for a in shorts),
      'longOrthoFlowMean':mean(info[a]['residual'] for a in longs),
      'shortOrthoFlowMean':mean(info[a]['residual'] for a in shorts),
      'longNextWeekMean':mean(long_next),
      'shortNextWeekMean':mean(short_next),
      'highMinusLowNextWeek':mean(long_next)-mean(short_next),
      'meanEstimatorObservations':mean(info[a]['observations'] for a in ASSETS),
      'orthoLagReturnCorrelation':corr,
    }


def run_method(dataset,cost_bps):
    prev={};weeks=[];asset_attr={a:0.0 for a in ASSETS}
    long_counts={a:0 for a in ASSETS};short_counts={a:0 for a in ASSETS}
    total_funding=total_cost=total_turnover=total_long=total_short=0.0

    for t in weekly_anchors(VALIDATION_START,VALIDATION_END):
        row=period_row(dataset,t,prev,cost_bps)
        weeks.append(row)
        for a,v in row['attr'].items():asset_attr[a]+=v
        for a in row['longs']:long_counts[a]+=1
        for a in row['shorts']:short_counts[a]+=1
        total_funding+=row['funding'];total_cost+=row['cost'];total_turnover+=row['turnover']
        total_long+=row['longGross'];total_short+=row['shortGross']
        prev=dict(row['weights'])

    if weeks:
        tr,cost,attr=terminal_close(prev,cost_bps)
        weeks[-1]['net']-=cost;weeks[-1]['priceOnly']-=cost
        weeks[-1]['cost']+=cost;weeks[-1]['turnover']+=tr
        total_cost+=cost;total_turnover+=tr
        for a,v in attr.items():asset_attr[a]+=v

    rs=[x['net'] for x in weeks]
    prs=[x['priceOnly'] for x in weeks]
    windows=_windows(rs,5)
    positive={a:v for a,v in asset_attr.items() if v>0}
    pt=sum(positive.values())
    concentration=max(positive.values())/pt*100.0 if positive else 0.0
    corrs=[abs(x['orthoLagReturnCorrelation']) for x in weeks if x['orthoLagReturnCorrelation'] is not None]

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
      'minEligibleAssets':min((x['eligibleAssets'] for x in weeks),default=0),
      'maxEligibleAssets':max((x['eligibleAssets'] for x in weeks),default=0),
      'sideCounts':sorted(set(x['sideCount'] for x in weeks)),
      'meanLongRawFlow':mean(x['longRawFlowMean'] for x in weeks) if weeks else None,
      'meanShortRawFlow':mean(x['shortRawFlowMean'] for x in weeks) if weeks else None,
      'meanLongOrthoFlow':mean(x['longOrthoFlowMean'] for x in weeks) if weeks else None,
      'meanShortOrthoFlow':mean(x['shortOrthoFlowMean'] for x in weeks) if weeks else None,
      'meanLongNextWeekReturn':mean(x['longNextWeekMean'] for x in weeks) if weeks else None,
      'meanShortNextWeekReturn':mean(x['shortNextWeekMean'] for x in weeks) if weeks else None,
      'meanHighMinusLowNextWeek':mean(x['highMinusLowNextWeek'] for x in weeks) if weeks else None,
      'meanEstimatorObservations':mean(x['meanEstimatorObservations'] for x in weeks) if weeks else None,
      'meanAbsOrthoLagReturnCrossSectionCorr':mean(corrs) if corrs else None,
      'weekly':weeks,
    }


def validation_gate(result,stress):
    g=VALIDATION_GATE;reasons=[]
    if result['periods']!=g['expected_periods']:reasons.append('PERIODS_NE_'+str(g['expected_periods']))
    if result['minEligibleAssets']!=REQUIRED_ELIGIBLE or result['maxEligibleAssets']!=REQUIRED_ELIGIBLE:
        reasons.append('ELIGIBLE_ASSETS_NE_'+str(REQUIRED_ELIGIBLE))
    if result['sideCounts']!=[SIDE_COUNT]:reasons.append('SIDE_COUNT_NE_'+str(SIDE_COUNT))
    if result['returnPct']<=0:reasons.append('RETURN_NOT_POSITIVE')
    if result['priceOnlyReturnPct']<=0:reasons.append('PRICE_ONLY_NOT_POSITIVE')
    if result['profitFactor']<g['min_pf']:reasons.append('PF_LT_'+str(g['min_pf']))
    if result['sharpe']<g['min_sharpe']:reasons.append('SHARPE_LT_'+str(g['min_sharpe']))
    if result['maxDrawdownPct']>g['max_dd_pct']:reasons.append('DD_GT_'+str(g['max_dd_pct']))
    if result['positiveWindows']<g['min_positive_windows']:
        reasons.append('POSITIVE_WINDOWS_LT_'+str(g['min_positive_windows']))
    if stress['returnPct']<=0:reasons.append('STRESS_RETURN_NOT_POSITIVE')
    if result['longContribution']<=0:reasons.append('LONG_CONTRIBUTION_NOT_POSITIVE')
    if result['shortContribution']<=0:reasons.append('SHORT_CONTRIBUTION_NOT_POSITIVE')
    if result['positiveAssets']<g['min_positive_assets']:
        reasons.append('POSITIVE_ASSETS_LT_'+str(g['min_positive_assets']))
    if result['positiveConcentrationPct']>g['max_positive_concentration_pct']:
        reasons.append('POSITIVE_CONCENTRATION_GT_'+str(g['max_positive_concentration_pct']))
    if not (result['meanHighMinusLowNextWeek']>0):
        reasons.append('HIGH_MINUS_LOW_SPREAD_NOT_POSITIVE')
    decision='INDEPENDENT_VALIDATION_PASS_ASSET_TRANSFER_REQUIRED' if not reasons else 'INDEPENDENT_VALIDATION_FAIL_RESEARCH_REDESIGN'
    return {'pass':not reasons,'reasons':reasons,'decision':decision}


def run_validation(raw_by_asset):
    try:
        dataset=prepare_dataset(raw_by_asset)
        base=run_method(dataset,BASE_COST_BPS)
        stress=run_method(dataset,STRESS_COST_BPS)
        gate=validation_gate(base,stress)
        return {
          'ruleset':RULESET,'stage':'INDEPENDENT_VALIDATION',
          'researchOnly':True,'executionImpact':False,'autoPromotion':False,
          'dataIntegrityFailure':False,'result':base,'stress':stress,
          'gate':gate,'decision':gate['decision']
        }
    except Exception as e:
        return {
          'ruleset':RULESET,'stage':'INDEPENDENT_VALIDATION',
          'researchOnly':True,'executionImpact':False,'autoPromotion':False,
          'dataIntegrityFailure':True,'error':str(e),
          'gate':{'pass':False,'reasons':['DATA_INTEGRITY_FAILURE'],
                  'decision':'INDEPENDENT_VALIDATION_FAIL_RESEARCH_REDESIGN'},
          'decision':'INDEPENDENT_VALIDATION_FAIL_RESEARCH_REDESIGN'
        }
