"""Frozen High-Volatility Perpetual Cross-Sectional Reversal V2. Research only."""

from math import log, sqrt
from statistics import mean, median, stdev

from perpetual_cross_sectional_reversal_v1 import (
    ASSETS, DAY, WEEK, BASE_COST_BPS, STRESS_COST_BPS, MIN_ELIGIBLE,
    AssetData, turnover, _terminal, _compound, _pf, _sharpe, _max_dd, _windows
)

RULESET='HIGH-VOLATILITY-PERPETUAL-CROSS-SECTIONAL-REVERSAL-V2-FROZEN'
VALIDATION_START=1736121600000  # 2025-01-06T00:00:00Z
VALIDATION_END=1788134400000    # 2026-08-31T00:00:00Z
EXPECTED_PERIODS=86
MIN_HIGH_VOL=8

VALIDATION_GATE={
    'expected_periods':86,
    'min_full_eligible':15,
    'min_high_vol':8,
    'min_side_count':2,
    'min_pf':1.10,
    'min_sharpe':0.50,
    'max_dd_pct':25.0,
    'min_positive_windows':3,
    'min_positive_assets':12,
    'max_positive_concentration_pct':25.0,
}

class VolAssetData(AssetData):
    def formation_volatility(self,t):
        start=t-9*WEEK
        end=t-WEEK
        marks=[start+i*DAY for i in range(57)]
        prices=[self.close_mark.get(x) for x in marks]
        if any(x is None or x<=0 for x in prices):
            return None
        rs=[log(prices[i]/prices[i-1]) for i in range(1,len(prices))]
        if len(rs)!=56:return None
        sd=stdev(rs)
        v=sd*sqrt(365.0)
        return v if v>=0 else None

def prepare_dataset(raw):
    return {a:VolAssetData(a,raw[a].get('price',[]),raw[a].get('funding',[])) for a in ASSETS}

def select_weights(dataset,t):
    full=[]
    for a in ASSETS:
        fr=dataset[a].formation_return(t)
        hr=dataset[a].entry_exit_return(t)
        vol=dataset[a].formation_volatility(t)
        if fr is not None and hr is not None and vol is not None:
            full.append((a,fr,hr,vol))
    if len(full)<MIN_ELIGIBLE:
        raise ValueError(f'ELIGIBLE_ASSETS_LT_{MIN_ELIGIBLE}:{len(full)}')

    vol_rank=sorted(full,key=lambda x:(x[3],x[0]))
    high_count=(len(vol_rank)+1)//2
    high=vol_rank[-high_count:]
    if len(high)<MIN_HIGH_VOL:
        raise ValueError(f'HIGH_VOL_ASSETS_LT_{MIN_HIGH_VOL}:{len(high)}')

    ranked=sorted(high,key=lambda x:(x[1],x[0]))
    side=len(ranked)//5
    if side<2:raise ValueError(f'SIDE_COUNT_LT_2:{side}')

    longs=[x[0] for x in ranked[:side]]
    shorts=[x[0] for x in ranked[-side:]]
    weights={}
    for a in longs:weights[a]=0.5/side
    for a in shorts:weights[a]=-0.5/side

    formation={a:fr for a,fr,_,_ in full}
    holding={a:hr for a,_,hr,_ in full}
    vols={a:v for a,_,_,v in full}
    return weights,formation,holding,vols,[x[0] for x in high],longs,shorts

def period_row(dataset,t,prev,cost_bps):
    weights,formation,holding,vols,high,longs,shorts=select_weights(dataset,t)
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

    return{
      't':t,'weights':weights,
      'eligibleAssets':len(formation),'highVolAssets':len(high),'sideCount':len(longs),
      'price':price,'funding':funding,'cost':cost,'turnover':tr,
      'net':price+funding-cost,'priceOnly':price-cost,
      'longGross':long_gross,'shortGross':short_gross,'attr':attr,
      'highVolValues':[vols[a] for a in high],
      'longFormationMean':mean(formation[a] for a in longs),
      'shortFormationMean':mean(formation[a] for a in shorts),
      'longNextWeekMean':mean(long_next),'shortNextWeekMean':mean(short_next),
      'loserMinusWinnerNextWeek':mean(long_next)-mean(short_next),
      'longs':longs,'shorts':shorts,
    }

def weekly_anchors(start,end):
    out=[];t=start
    while t<end:
        out.append(t);t+=WEEK
    return out

def run_method(dataset,start,end,cost_bps):
    prev={};weeks=[];asset_attr={a:0.0 for a in ASSETS}
    long_counts={a:0 for a in ASSETS};short_counts={a:0 for a in ASSETS}
    total_funding=total_cost=total_turnover=total_long=total_short=0.0
    all_high_vol=[]

    for t in weekly_anchors(start,end):
        row=period_row(dataset,t,prev,cost_bps)
        weeks.append(row)
        for a,v in row['attr'].items():asset_attr[a]+=v
        for a in row['longs']:long_counts[a]+=1
        for a in row['shorts']:short_counts[a]+=1
        all_high_vol.extend(row['highVolValues'])
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
    return{
      'periods':len(weeks),
      'returnPct':_compound(rs)*100.0,
      'priceOnlyReturnPct':_compound(prs)*100.0,
      'profitFactor':_pf(rs),'sharpe':_sharpe(rs),'maxDrawdownPct':_max_dd(rs)*100.0,
      'positiveWindows':sum(1 for x in windows if x>0),'windowsPct':[x*100.0 for x in windows],
      'fundingContribution':total_funding,'costContribution':-total_cost,'turnover':total_turnover,
      'longContribution':total_long,'shortContribution':total_short,
      'assetAttribution':asset_attr,'positiveAssets':len(positive),'positiveConcentrationPct':concentration,
      'longWeeksByAsset':long_counts,'shortWeeksByAsset':short_counts,
      'minEligibleAssets':min(x['eligibleAssets'] for x in weeks) if weeks else 0,
      'maxEligibleAssets':max(x['eligibleAssets'] for x in weeks) if weeks else 0,
      'minHighVolAssets':min(x['highVolAssets'] for x in weeks) if weeks else 0,
      'maxHighVolAssets':max(x['highVolAssets'] for x in weeks) if weeks else 0,
      'sideCounts':sorted(set(x['sideCount'] for x in weeks)),
      'meanHighVolAnnualizedVol':mean(all_high_vol) if all_high_vol else None,
      'medianHighVolAnnualizedVol':median(all_high_vol) if all_high_vol else None,
      'meanLongFormationReturn':mean(x['longFormationMean'] for x in weeks) if weeks else None,
      'meanShortFormationReturn':mean(x['shortFormationMean'] for x in weeks) if weeks else None,
      'meanLongNextWeekReturn':mean(x['longNextWeekMean'] for x in weeks) if weeks else None,
      'meanShortNextWeekReturn':mean(x['shortNextWeekMean'] for x in weeks) if weeks else None,
      'meanLoserMinusWinnerNextWeek':mean(x['loserMinusWinnerNextWeek'] for x in weeks) if weeks else None,
      'weekly':weeks,
    }

def validation_gate(result,stress):
    g=VALIDATION_GATE;reasons=[]
    if result['periods']!=g['expected_periods']:reasons.append('PERIODS_NE_'+str(g['expected_periods']))
    if result['minEligibleAssets']<g['min_full_eligible']:reasons.append('ELIGIBLE_ASSETS_LT_'+str(g['min_full_eligible']))
    if result['minHighVolAssets']<g['min_high_vol']:reasons.append('HIGH_VOL_ASSETS_LT_'+str(g['min_high_vol']))
    if min(result['sideCounts'],default=0)<g['min_side_count']:reasons.append('SIDE_COUNT_LT_'+str(g['min_side_count']))
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
      'pass':not reasons,'reasons':reasons,
      'decision':'VALIDATION_PASS_TRANSFER_REQUIRED' if not reasons else 'VALIDATION_FAIL_RESEARCH_REDESIGN'
    }

def run_validation(raw):
    try:
        ds=prepare_dataset(raw)
        base=run_method(ds,VALIDATION_START,VALIDATION_END,BASE_COST_BPS)
        stress=run_method(ds,VALIDATION_START,VALIDATION_END,STRESS_COST_BPS)
        gate=validation_gate(base,stress)
        return{
          'ruleset':RULESET,'stage':'INDEPENDENT_VALIDATION',
          'researchOnly':True,'executionImpact':False,'autoPromotion':False,
          'dataIntegrityFailure':False,'result':base,'stress':stress,'gate':gate,'decision':gate['decision']
        }
    except Exception as e:
        return{
          'ruleset':RULESET,'stage':'INDEPENDENT_VALIDATION',
          'researchOnly':True,'executionImpact':False,'autoPromotion':False,
          'dataIntegrityFailure':True,'error':str(e),
          'gate':{'pass':False,'reasons':['DATA_INTEGRITY_FAILURE']},
          'decision':'VALIDATION_FAIL_RESEARCH_REDESIGN'
        }
