"""Frozen Perpetual Taker Order Flow V1 research engine. Research only."""

from __future__ import annotations
from dataclasses import dataclass
from math import isfinite, sqrt
from statistics import mean, stdev

RULESET='PERPETUAL-TAKER-ORDER-FLOW-V1-FROZEN'

HOUR=60*60*1000
DAY=24*HOUR
WEEK=7*DAY
FLOW_HOURS=168
FUND_MAX_GAP=12*HOUR

ASSETS=(
    'BTC','ETH','BNB','SOL','XRP','ADA','DOGE','LINK','DOT','LTC','BCH','AVAX'
)

BASE_COST_BPS=8.0
STRESS_COST_BPS=13.0
SIDE_COUNT=2
REQUIRED_ELIGIBLE=12

DEVELOPMENT_START=1673654400000  # 2023-01-14T00:00:00Z
DEVELOPMENT_END=1735344000000    # 2024-12-28T00:00:00Z
DEVELOPMENT_EXPECTED_PERIODS=102

HOLDOUT_START=1736553600000      # 2025-01-11T00:00:00Z
HOLDOUT_END=1787961600000        # 2026-08-29T00:00:00Z
HOLDOUT_EXPECTED_PERIODS=85

DEVELOPMENT_GATE={
    'expected_periods':102,
    'min_pf':1.15,
    'min_sharpe':0.75,
    'max_dd_pct':25.0,
    'min_positive_windows':4,
    'min_positive_assets':8,
    'max_positive_concentration_pct':30.0,
}

HOLDOUT_GATE={
    'expected_periods':85,
    'min_pf':1.05,
    'min_sharpe':0.50,
    'max_dd_pct':30.0,
    'min_positive_windows':3,
    'min_positive_assets':7,
    'max_positive_concentration_pct':35.0,
}


def _compound(rs):
    e=1.0
    for r in rs:
        e*=1.0+r
    return e-1.0


def _pf(rs):
    gains=sum(x for x in rs if x>0)
    losses=-sum(x for x in rs if x<0)
    if losses>0:return gains/losses
    return 99.0 if gains>0 else 0.0


def _sharpe(rs):
    if len(rs)<2:return 0.0
    sd=stdev(rs)
    if sd>0:return mean(rs)/sd*sqrt(52.0)
    return 99.0 if mean(rs)>0 else 0.0


def _max_dd(rs):
    equity=1.0;peak=1.0;dd=0.0
    for r in rs:
        equity*=1.0+r
        peak=max(peak,equity)
        if peak>0:
            dd=max(dd,(peak-equity)/peak)
    return dd


def _windows(rs,parts=5):
    out=[]
    for i in range(parts):
        a=len(rs)*i//parts
        b=len(rs)*(i+1)//parts
        out.append(_compound(rs[a:b]) if b>a else 0.0)
    return out


def weekly_anchors(start,end):
    out=[];t=start
    while t<end:
        out.append(t)
        t+=WEEK
    return out


def funding_coverage(times,start,end):
    if not times:return False
    first=times[0]-start
    if first<0 or first>FUND_MAX_GAP:return False
    for i in range(1,len(times)):
        gap=times[i]-times[i-1]
        if gap<=0 or gap>FUND_MAX_GAP:return False
    tail=end-times[-1]
    return 0<=tail<=FUND_MAX_GAP


@dataclass
class AssetData:
    asset:str
    hourly:list
    funding:list

    def __post_init__(self):
        self._validate()
        self.rows_by_time={int(r[0]):r for r in self.hourly}
        self.open_by_time={int(r[0]):float(r[2]) for r in self.hourly}
        self.funding_times=[int(r[0]) for r in self.funding]
        self.funding_rates=[float(r[1]) for r in self.funding]

    def _validate(self):
        last=None
        for row in self.hourly:
            if len(row)<11:raise ValueError(f'{self.asset}:MALFORMED_HOURLY')
            t=int(row[0])
            o,h,l,c=map(float,row[2:6])
            q=float(row[7]);trades=float(row[8]);tb=float(row[9]);tq=float(row[10])
            vals=(o,h,l,c,q,trades,tb,tq)
            if not all(isfinite(x) for x in vals):
                raise ValueError(f'{self.asset}:NONFINITE_HOURLY')
            if not all(x>0 for x in (o,h,l,c)):
                raise ValueError(f'{self.asset}:INVALID_OHLC')
            if h<max(o,c,l) or l>min(o,c,h):
                raise ValueError(f'{self.asset}:INCONSISTENT_OHLC')
            if min(q,trades,tb,tq)<0:
                raise ValueError(f'{self.asset}:NEGATIVE_FLOW_FIELD')
            if tq>q+max(1e-8,abs(q)*1e-10):
                raise ValueError(f'{self.asset}:TAKER_QUOTE_GT_TOTAL')
            if last is not None and t-last!=HOUR:
                raise ValueError(f'{self.asset}:HOURLY_GAP')
            last=t

        last=None
        for row in self.funding:
            if len(row)<2:raise ValueError(f'{self.asset}:MALFORMED_FUNDING')
            t=int(row[0]);rate=float(row[1])
            if not isfinite(rate):raise ValueError(f'{self.asset}:INVALID_FUNDING')
            if last is not None and t<=last:
                raise ValueError(f'{self.asset}:DUPLICATE_OR_NONMONOTONIC_FUNDING')
            last=t

    def flow_signal(self,t):
        start=t-WEEK
        rows=[]
        for i in range(FLOW_HOURS):
            row=self.rows_by_time.get(start+i*HOUR)
            if row is None:return None
            rows.append(row)
        q=sum(float(r[7]) for r in rows)
        b=sum(float(r[10]) for r in rows)
        if not isfinite(q) or not isfinite(b) or q<=0:return None
        if b<0 or b>q+max(1e-8,abs(q)*1e-10):return None
        return (2.0*b-q)/q

    def entry_open_available(self,t):
        p0=self.open_by_time.get(t)
        return p0 is not None and p0>0

    def entry_exit_return(self,t):
        p0=self.open_by_time.get(t)
        p1=self.open_by_time.get(t+WEEK)
        if p0 is None or p1 is None or p0<=0 or p1<=0:return None
        return p1/p0-1.0

    def funding_sum(self,start,end):
        pairs=[(t,r) for t,r in zip(self.funding_times,self.funding_rates) if t>start and t<=end]
        times=[x[0] for x in pairs]
        if not funding_coverage(times,start,end):
            raise ValueError(f'{self.asset}:HOLD_FUNDING_GAP')
        return sum(x[1] for x in pairs)


def prepare_dataset(raw_by_asset):
    if set(raw_by_asset)!=set(ASSETS):
        raise ValueError('ASSET_UNIVERSE_MISMATCH')
    return {
        a:AssetData(a,raw_by_asset[a].get('hourly',[]),raw_by_asset[a].get('funding',[]))
        for a in ASSETS
    }


def select_weights(dataset,t):
    # Ranking is allowed to use only information available at entry time.
    # Future exit prices / holding returns must never affect eligibility or rank.
    rows=[]
    for a in ASSETS:
        signal=dataset[a].flow_signal(t)
        if signal is not None and dataset[a].entry_open_available(t):
            rows.append((a,signal))
    if len(rows)!=REQUIRED_ELIGIBLE:
        raise ValueError(f'ELIGIBLE_ASSETS_NE_{REQUIRED_ELIGIBLE}:{len(rows)}')

    ranked=sorted(rows,key=lambda x:(-x[1],x[0]))
    longs=[x[0] for x in ranked[:SIDE_COUNT]]
    shorts=[x[0] for x in ranked[-SIDE_COUNT:]]
    weights={}
    for a in longs:weights[a]=0.5/SIDE_COUNT
    for a in shorts:weights[a]=-0.5/SIDE_COUNT
    signals={a:s for a,s in rows}
    return weights,signals,longs,shorts


def turnover(prev,new):
    keys=set(prev)|set(new)
    return sum(abs(new.get(k,0.0)-prev.get(k,0.0)) for k in keys)


def terminal_close(prev,cost_bps):
    tr=sum(abs(v) for v in prev.values())
    cost=tr*cost_bps/10000.0
    attr={a:-abs(prev.get(a,0.0))*cost_bps/10000.0 for a in ASSETS}
    return tr,cost,attr


def period_row(dataset,t,prev,cost_bps):
    weights,signals,longs,shorts=select_weights(dataset,t)

    # Validate future holding data only after the entry-time selection is frozen.
    # Missing exit data fails the stage; it can never cause re-ranking.
    holding={}
    for a in ASSETS:
        hr=dataset[a].entry_exit_return(t)
        if hr is None:
            raise ValueError(f'{a}:HOLDING_RETURN_MISSING')
        holding[a]=hr

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

    return {
        't':t,'weights':weights,'eligibleAssets':len(signals),'sideCount':len(longs),
        'price':price,'funding':funding,'cost':cost,'turnover':tr,
        'net':price+funding-cost,'priceOnly':price-cost,
        'longGross':long_gross,'shortGross':short_gross,'attr':attr,
        'longs':longs,'shorts':shorts,
        'longSignalMean':mean(signals[a] for a in longs),
        'shortSignalMean':mean(signals[a] for a in shorts),
        'longNextWeekMean':mean(long_next),
        'shortNextWeekMean':mean(short_next),
        'highMinusLowNextWeek':mean(long_next)-mean(short_next),
    }


def run_method(dataset,start,end,cost_bps):
    prev={};weeks=[];asset_attr={a:0.0 for a in ASSETS}
    long_counts={a:0 for a in ASSETS};short_counts={a:0 for a in ASSETS}
    total_funding=total_cost=total_turnover=total_long=total_short=0.0

    for t in weekly_anchors(start,end):
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
        weeks[-1]['net']-=cost
        weeks[-1]['priceOnly']-=cost
        weeks[-1]['cost']+=cost
        weeks[-1]['turnover']+=tr
        total_cost+=cost;total_turnover+=tr
        for a,v in attr.items():asset_attr[a]+=v

    rs=[x['net'] for x in weeks]
    prs=[x['priceOnly'] for x in weeks]
    windows=_windows(rs,5)
    positive={a:v for a,v in asset_attr.items() if v>0}
    positive_total=sum(positive.values())
    concentration=max(positive.values())/positive_total*100.0 if positive else 0.0

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
        'meanLongSignal':mean(x['longSignalMean'] for x in weeks) if weeks else None,
        'meanShortSignal':mean(x['shortSignalMean'] for x in weeks) if weeks else None,
        'meanLongNextWeekReturn':mean(x['longNextWeekMean'] for x in weeks) if weeks else None,
        'meanShortNextWeekReturn':mean(x['shortNextWeekMean'] for x in weeks) if weeks else None,
        'meanHighMinusLowNextWeek':mean(x['highMinusLowNextWeek'] for x in weeks) if weeks else None,
        'weekly':weeks,
    }


def stage_gate(result,stress,stage):
    g=DEVELOPMENT_GATE if stage=='DEVELOPMENT' else HOLDOUT_GATE
    reasons=[]
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

    if stage=='DEVELOPMENT':
        decision='DEVELOPMENT_PASS_TEMPORAL_HOLDOUT_REQUIRED' if not reasons else 'DEVELOPMENT_FAIL_RESEARCH_REDESIGN'
    else:
        decision='HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY' if not reasons else 'HOLDOUT_FAIL_RESEARCH_REDESIGN'
    return {'pass':not reasons,'reasons':reasons,'decision':decision}


def development_authorizes_holdout(evidence):
    if not isinstance(evidence,dict):
        return False
    return (
        evidence.get('ruleset')==RULESET
        and evidence.get('stage')=='DEVELOPMENT'
        and evidence.get('decision')=='DEVELOPMENT_PASS_TEMPORAL_HOLDOUT_REQUIRED'
        and evidence.get('dataIntegrityFailure') is False
        and isinstance(evidence.get('gate'),dict)
        and evidence['gate'].get('pass') is True
    )


def run_stage(raw_by_asset,stage,development_evidence=None):
    if stage not in ('DEVELOPMENT','TEMPORAL_HOLDOUT'):
        raise ValueError('UNKNOWN_STAGE')
    if stage=='TEMPORAL_HOLDOUT' and not development_authorizes_holdout(development_evidence):
        raise PermissionError('HOLDOUT_NOT_AUTHORIZED')
    dataset=prepare_dataset(raw_by_asset)
    start,end=(DEVELOPMENT_START,DEVELOPMENT_END) if stage=='DEVELOPMENT' else (HOLDOUT_START,HOLDOUT_END)
    try:
        base=run_method(dataset,start,end,BASE_COST_BPS)
        stress=run_method(dataset,start,end,STRESS_COST_BPS)
        gate=stage_gate(base,stress,stage)
        return {
            'ruleset':RULESET,'stage':stage,'researchOnly':True,
            'executionImpact':False,'autoPromotion':False,
            'holdoutAuthorized':stage=='TEMPORAL_HOLDOUT',
            'dataIntegrityFailure':False,'result':base,'stress':stress,
            'gate':gate,'decision':gate['decision']
        }
    except Exception as e:
        decision='DEVELOPMENT_FAIL_RESEARCH_REDESIGN' if stage=='DEVELOPMENT' else 'HOLDOUT_FAIL_RESEARCH_REDESIGN'
        return {
            'ruleset':RULESET,'stage':stage,'researchOnly':True,
            'executionImpact':False,'autoPromotion':False,
            'holdoutAuthorized':stage=='TEMPORAL_HOLDOUT',
            'dataIntegrityFailure':True,'error':str(e),
            'gate':{'pass':False,'reasons':['DATA_INTEGRITY_FAILURE'],'decision':decision},
            'decision':decision
        }
