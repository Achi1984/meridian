"""Frozen Self-History Perpetual Factor V2 research engine. Research only."""

from __future__ import annotations
from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from math import sqrt, isfinite
from statistics import mean, stdev
from typing import Dict, List, Tuple

RULESET='SELF-HISTORY-PERP-FACTOR-V2-FROZEN'
FOUR_H=4*60*60*1000
DAY=24*60*60*1000
WEEK=7*DAY
FUND_MAX_GAP=12*60*60*1000

DISCOVERY_ASSETS=('BTC','ETH','BNB','SOL','XRP','ADA','DOGE','LINK','DOT','SUI')
TRANSFER_ASSETS=('LTC','BCH','AVAX','HBAR')
FACTORS=('MOMENTUM_12W','FUNDING_CARRY_7D','PREMIUM_REVERSION_7D')
ELIGIBLE_MONTH={
    'BTC':'2023-01','ETH':'2023-01','BNB':'2023-01','SOL':'2023-01','XRP':'2023-01',
    'ADA':'2023-01','DOGE':'2023-01','LINK':'2023-01','DOT':'2023-01','LTC':'2023-01',
    'BCH':'2023-01','AVAX':'2023-01','HBAR':'2023-03','SUI':'2025-05'
}
BASE_COST_BPS=8.0
STRESS_COST_BPS=32.0
OWN_HISTORY_WEEKS=52
MOMENTUM_WEEKS=12

DISCOVERY_GATE={
    'min_periods':85,'min_active':55,'min_factor_active':40,'min_pf':1.15,'min_sharpe':0.75,
    'max_dd_pct':20.0,'min_positive_windows':4,'min_positive_assets':6,
    'max_positive_concentration_pct':35.0,'min_positive_factor_books':2,'min_own_beats_factors':2
}

def month_key(ts:int)->str:
    import datetime as dt
    d=dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc)
    return f'{d.year:04d}-{d.month:02d}'

def weekly_anchors(start:int,end:int)->List[int]:
    out=[]; t=start
    while t<end:
        out.append(t); t+=WEEK
    return out

def _pf(rs):
    wins=sum(x for x in rs if x>0); losses=-sum(x for x in rs if x<0)
    return wins/losses if losses>0 else (99.0 if wins>0 else 0.0)

def _compound(rs):
    e=1.0
    for r in rs:e*=1.0+r
    return e-1.0

def _max_dd(rs):
    e=1.0; peak=1.0; dd=0.0
    for r in rs:
        e*=1.0+r; peak=max(peak,e)
        if peak>0:dd=max(dd,(peak-e)/peak)
    return dd

def _sharpe(rs):
    if len(rs)<2:return 0.0
    sd=stdev(rs)
    return mean(rs)/sd*sqrt(52.0) if sd>0 else (99.0 if mean(rs)>0 else 0.0)

def _windows(rs,parts=5):
    out=[]
    for i in range(parts):
        a=len(rs)*i//parts; b=len(rs)*(i+1)//parts
        out.append(_compound(rs[a:b]) if b>a else 0.0)
    return out

def empirical_percentile(history,current):
    if len(history)!=OWN_HISTORY_WEEKS:raise ValueError('exact 52-week history required')
    if not isfinite(current) or any(not isfinite(x) for x in history):raise ValueError('non-finite factor')
    return sum(1 for x in history if x<=current)/len(history)

def cross_section_weights(values:Dict[str,float],transfer=False)->Dict[str,float]:
    if not values:return {}
    rows=sorted(values.items(),key=lambda kv:(kv[1],kv[0]))
    n=len(rows); side=1 if transfer else max(2,n//5)
    if 2*side>n:return {}
    shorts=[a for a,_ in rows[:side]]
    longs=[a for a,_ in rows[-side:]]
    w={}
    for a in longs:w[a]=0.5/len(longs)
    for a in shorts:w[a]=-0.5/len(shorts)
    return w

def own_history_weights(percentiles:Dict[str,float],transfer=False)->Dict[str,float]:
    longs=sorted(a for a,p in percentiles.items() if p>=0.80)
    shorts=sorted(a for a,p in percentiles.items() if p<=0.20)
    need=1 if transfer else 2
    if len(longs)<need or len(shorts)<need:return {}
    w={}
    for a in longs:w[a]=0.5/len(longs)
    for a in shorts:w[a]=-0.5/len(shorts)
    return w

@dataclass
class AssetData:
    asset:str
    klines:list
    premium:list
    funding:list

    def __post_init__(self):
        self._validate()
        self.price={int(r[0])+FOUR_H:float(r[5]) for r in self.klines}
        self.premium_times=[int(r[1]) for r in self.premium]
        self.premium_values=[float(r[2]) for r in self.premium]
        self.funding_times=[int(r[0]) for r in self.funding]
        self.funding_values=[float(r[1]) for r in self.funding]
        self.premium_prefix=[0.0]
        for x in self.premium_values:self.premium_prefix.append(self.premium_prefix[-1]+x)
        self.funding_prefix=[0.0]
        for x in self.funding_values:self.funding_prefix.append(self.funding_prefix[-1]+x)

    def _validate(self):
        last=None
        for row in self.klines:
            if len(row)<6:raise ValueError(f'{self.asset}: malformed kline')
            ot,ct,o,h,l,c=int(row[0]),int(row[1]),*map(float,row[2:6])
            if not all(isfinite(x) and x>0 for x in (o,h,l,c)):raise ValueError(f'{self.asset}: invalid OHLC')
            if h<max(o,c,l) or l>min(o,c,h):raise ValueError(f'{self.asset}: inconsistent OHLC')
            if last is not None and ot-last!=FOUR_H:raise ValueError(f'{self.asset}: KLINE_GAP')
            last=ot
        last=None
        for row in self.premium:
            if len(row)<3:raise ValueError(f'{self.asset}: malformed premium')
            ot,ct,val=int(row[0]),int(row[1]),float(row[2])
            if not isfinite(val):raise ValueError(f'{self.asset}: invalid premium')
            if last is not None and ot-last!=FOUR_H:raise ValueError(f'{self.asset}: PREMIUM_GAP')
            last=ot
        last=None
        for row in self.funding:
            t,rate=int(row[0]),float(row[1])
            if not isfinite(rate):raise ValueError(f'{self.asset}: invalid funding')
            if last is not None:
                if t<=last:raise ValueError(f'{self.asset}: duplicate/nonmonotonic funding')
                if t-last>FUND_MAX_GAP:raise ValueError(f'{self.asset}: FUNDING_GAP')
            last=t

    def price_at(self,anchor):
        return self.price.get(anchor)

    def _sum(self,times,prefix,start,end,left_inclusive=True,right_inclusive=False):
        li=bisect_left(times,start) if left_inclusive else bisect_right(times,start)
        ri=bisect_right(times,end) if right_inclusive else bisect_left(times,end)
        return prefix[ri]-prefix[li],ri-li,li,ri

    def funding_factor(self,t):
        start=t-WEEK
        total,count,li,ri=self._sum(self.funding_times,self.funding_prefix,start,t,True,False)
        rows=self.funding_times[li:ri]
        if not _coverage(rows,start,t,FUND_MAX_GAP,False):return None
        return -total

    def premium_factor(self,t):
        start=t-WEEK
        total,count,li,ri=self._sum(self.premium_times,self.premium_prefix,start,t,True,False)
        if count!=42:return None
        return -(total/count)

    def momentum_factor(self,t):
        a=self.price_at(t); b=self.price_at(t-MOMENTUM_WEEKS*WEEK)
        if a is None or b is None or b<=0:return None
        return a/b-1.0

    def holding_funding(self,start,end):
        total,count,li,ri=self._sum(self.funding_times,self.funding_prefix,start,end,False,True)
        rows=self.funding_times[li:ri]
        if not _coverage(rows,start,end,FUND_MAX_GAP,True):
            raise ValueError(f'{self.asset}: holding funding coverage')
        return total

def _coverage(times,start,end,max_gap,right_inclusive):
    if not times:return False
    pts=[start]+list(times)+[end]
    return all(0 < pts[i]-pts[i-1] <= max_gap for i in range(1,len(pts)))

def factor_value(data:AssetData,factor,t):
    if factor=='MOMENTUM_12W':return data.momentum_factor(t)
    if factor=='FUNDING_CARRY_7D':return data.funding_factor(t)
    if factor=='PREMIUM_REVERSION_7D':return data.premium_factor(t)
    raise ValueError(factor)

def is_eligible(asset,t):
    return month_key(t)>=ELIGIBLE_MONTH[asset]

def prepare_dataset(raw_by_asset:dict)->Dict[str,AssetData]:
    out={}
    for asset,raw in raw_by_asset.items():
        out[asset]=AssetData(asset,raw.get('klines',[]),raw.get('premium',[]),raw.get('funding',[]))
    return out

def build_factor_panel(dataset:Dict[str,AssetData],assets,start,end):
    history_start=start-OWN_HISTORY_WEEKS*WEEK
    anchors=weekly_anchors(history_start,end+WEEK)
    panel={a:{f:{} for f in FACTORS} for a in assets}
    for a in assets:
        d=dataset[a]
        for t in anchors:
            for f in FACTORS:
                v=factor_value(d,f,t)
                if v is not None and isfinite(v):panel[a][f][t]=v
    return panel

def _turnover(prev,new,assets):
    return sum(abs(new.get(a,0.0)-prev.get(a,0.0)) for a in assets)

def evaluate_book(dataset,weights,prev,t,cost_bps):
    end=t+WEEK
    assets=set(weights)|set(prev)
    turnover=_turnover(prev,weights,assets)
    cost=turnover*cost_bps/10000.0
    price=0.0; funding=0.0; long_gross=0.0; short_gross=0.0
    attr={a:0.0 for a in assets}
    for a,w in weights.items():
        p0=dataset[a].price_at(t); p1=dataset[a].price_at(end)
        if p0 is None or p1 is None or p0<=0:
            raise ValueError(f'{a}: missing exact weekly price')
        pr=w*(p1/p0-1.0)
        fr=-w*dataset[a].holding_funding(t,end)
        gross=pr+fr
        price+=pr; funding+=fr
        if w>0:long_gross+=gross
        elif w<0:short_gross+=gross
        attr[a]+=gross
    for a in assets:
        tc=abs(weights.get(a,0.0)-prev.get(a,0.0))*cost_bps/10000.0
        attr[a]-=tc
    return {
        'active':bool(weights),'turnover':turnover,'price':price,'funding':funding,'cost':cost,
        'net':price+funding-cost,'priceOnly':price-cost,'longGross':long_gross,'shortGross':short_gross,
        'attr':attr
    }

def _terminal_close(prev,assets,cost_bps):
    turnover=sum(abs(prev.get(a,0.0)) for a in assets)
    cost=turnover*cost_bps/10000.0
    attr={a:-abs(prev.get(a,0.0))*cost_bps/10000.0 for a in assets if prev.get(a,0.0)}
    return turnover,cost,attr

def run_method(dataset,panel,assets,start,end,method,transfer=False,cost_bps=BASE_COST_BPS):
    anchors=weekly_anchors(start,end)
    prev={f:{} for f in FACTORS}
    factor_returns={f:[] for f in FACTORS}
    factor_active={f:0 for f in FACTORS}
    weeks=[]; asset_attr={a:0.0 for a in assets}
    total_cost=total_funding=total_turnover=total_long=total_short=0.0
    for t in anchors:
        eligible=[a for a in assets if is_eligible(a,t)]
        need_assets=2 if transfer else 8
        if len(eligible)<need_assets:
            raise ValueError(f'{month_key(t)}: eligible assets {len(eligible)} < {need_assets}')
        weights={}
        for f in FACTORS:
            vals={}
            pcts={}
            for a in eligible:
                cur=panel[a][f].get(t)
                if cur is None:raise ValueError(f'{a} {f} {t}: missing current factor')
                vals[a]=cur
                hist=[panel[a][f].get(t-k*WEEK) for k in range(OWN_HISTORY_WEEKS,0,-1)]
                if any(v is None for v in hist):
                    raise ValueError(f'{a} {f} {t}: incomplete 52w factor history')
                pcts[a]=empirical_percentile(hist,cur)
            weights[f]=own_history_weights(pcts,transfer) if method=='OWN' else cross_section_weights(vals,transfer)

        book_rows={}; week_attr={a:0.0 for a in assets}
        for f in FACTORS:
            row=evaluate_book(dataset,weights[f],prev[f],t,cost_bps)
            book_rows[f]=row
            factor_returns[f].append(row['net'])
            if row['active']:factor_active[f]+=1
            for a,v in row['attr'].items():
                if a in week_attr:week_attr[a]+=v/len(FACTORS)
            prev[f]=dict(weights[f])
        combined={
            't':t,
            'return':sum(book_rows[f]['net'] for f in FACTORS)/len(FACTORS),
            'priceOnly':sum(book_rows[f]['priceOnly'] for f in FACTORS)/len(FACTORS),
            'funding':sum(book_rows[f]['funding'] for f in FACTORS)/len(FACTORS),
            'cost':sum(book_rows[f]['cost'] for f in FACTORS)/len(FACTORS),
            'turnover':sum(book_rows[f]['turnover'] for f in FACTORS)/len(FACTORS),
            'longGross':sum(book_rows[f]['longGross'] for f in FACTORS)/len(FACTORS),
            'shortGross':sum(book_rows[f]['shortGross'] for f in FACTORS)/len(FACTORS),
            'active':any(book_rows[f]['active'] for f in FACTORS),
            'factor':{f:{'active':book_rows[f]['active'],'return':book_rows[f]['net']} for f in FACTORS}
        }
        weeks.append(combined)
        for a,v in week_attr.items():asset_attr[a]+=v
        total_cost+=combined['cost']; total_funding+=combined['funding']; total_turnover+=combined['turnover']
        total_long+=combined['longGross']; total_short+=combined['shortGross']

    if weeks:
        terminal_cost=0.0; terminal_attr={a:0.0 for a in assets}
        for f in FACTORS:
            tr,cost,attr=_terminal_close(prev[f],assets,cost_bps)
            terminal_cost+=cost/len(FACTORS)
            factor_returns[f][-1]-=cost
            for a,v in attr.items():terminal_attr[a]+=v/len(FACTORS)
        weeks[-1]['return']-=terminal_cost
        weeks[-1]['priceOnly']-=terminal_cost
        weeks[-1]['cost']+=terminal_cost
        total_cost+=terminal_cost
        for a,v in terminal_attr.items():
            asset_attr[a]+=v

    rs=[w['return'] for w in weeks]
    prs=[w['priceOnly'] for w in weeks]
    factor_metrics={f:{
        'returnPct':_compound(factor_returns[f])*100.0,
        'activeWeeks':factor_active[f],
        'profitFactor':_pf(factor_returns[f])
    } for f in FACTORS}
    positive={a:v for a,v in asset_attr.items() if v>0}
    pos_total=sum(positive.values())
    concentration=max(positive.values())/pos_total*100.0 if positive else 0.0
    wins=_windows(rs,5)
    return {
        'method':method,'periods':len(weeks),'activeWeeks':sum(1 for w in weeks if w['active']),
        'returnPct':_compound(rs)*100.0,'priceOnlyReturnPct':_compound(prs)*100.0,
        'profitFactor':_pf(rs),'sharpe':_sharpe(rs),'maxDrawdownPct':_max_dd(rs)*100.0,
        'positiveWindows':sum(1 for x in wins if x>0),'windowsPct':[x*100.0 for x in wins],
        'fundingContribution':total_funding,'costContribution':-total_cost,'turnover':total_turnover,
        'longContribution':total_long,'shortContribution':total_short,
        'assetAttribution':asset_attr,'positiveAssets':len(positive),'positiveConcentrationPct':concentration,
        'factorBooks':factor_metrics,'weekly':weeks
    }

def stress_from_method(base_method,dataset,panel,assets,start,end,method,transfer=False):
    return run_method(dataset,panel,assets,start,end,method,transfer,STRESS_COST_BPS)

def discovery_gate(own,xsec,own_stress):
    g=DISCOVERY_GATE; reasons=[]
    if own['periods']<g['min_periods']:reasons.append('PERIODS_LT_'+str(g['min_periods']))
    if own['activeWeeks']<g['min_active']:reasons.append('ACTIVE_WEEKS_LT_'+str(g['min_active']))
    for f in FACTORS:
        if own['factorBooks'][f]['activeWeeks']<g['min_factor_active']:reasons.append(f+':ACTIVE_LT_'+str(g['min_factor_active']))
    if own['returnPct']<=0:reasons.append('RETURN_NOT_POSITIVE')
    if own['priceOnlyReturnPct']<=0:reasons.append('PRICE_ONLY_NOT_POSITIVE')
    if own['profitFactor']<g['min_pf']:reasons.append('PF_LT_'+str(g['min_pf']))
    if own['sharpe']<g['min_sharpe']:reasons.append('SHARPE_LT_'+str(g['min_sharpe']))
    if own['maxDrawdownPct']>g['max_dd_pct']:reasons.append('DD_GT_'+str(g['max_dd_pct']))
    if own['positiveWindows']<g['min_positive_windows']:reasons.append('POSITIVE_WINDOWS_LT_'+str(g['min_positive_windows']))
    if own['longContribution']<=0:reasons.append('LONG_CONTRIBUTION_NOT_POSITIVE')
    if own['shortContribution']<=0:reasons.append('SHORT_CONTRIBUTION_NOT_POSITIVE')
    if own['positiveAssets']<g['min_positive_assets']:reasons.append('POSITIVE_ASSETS_LT_'+str(g['min_positive_assets']))
    if own['positiveConcentrationPct']>g['max_positive_concentration_pct']:reasons.append('POSITIVE_CONCENTRATION_GT_'+str(g['max_positive_concentration_pct']))
    if own_stress['returnPct']<=0:reasons.append('STRESS_RETURN_NOT_POSITIVE')
    positive_books=sum(1 for f in FACTORS if own['factorBooks'][f]['returnPct']>0)
    if positive_books<g['min_positive_factor_books']:reasons.append('POSITIVE_FACTOR_BOOKS_LT_'+str(g['min_positive_factor_books']))
    if own['returnPct']<=xsec['returnPct']:reasons.append('OWN_NOT_ABOVE_XSEC')
    beats=sum(1 for f in FACTORS if own['factorBooks'][f]['returnPct']>xsec['factorBooks'][f]['returnPct'])
    if beats<g['min_own_beats_factors']:reasons.append('OWN_FACTOR_BEATS_LT_'+str(g['min_own_beats_factors']))
    return {
        'pass':not reasons,'reasons':reasons,'positiveFactorBooks':positive_books,'ownBeatsFactors':beats,
        'decision':'DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED' if not reasons else 'DISCOVERY_FAIL_RESEARCH_REDESIGN'
    }

def run_discovery(raw_by_asset,start,end):
    try:
        dataset=prepare_dataset({a:raw_by_asset[a] for a in DISCOVERY_ASSETS})
        panel=build_factor_panel(dataset,DISCOVERY_ASSETS,start,end)
        own=run_method(dataset,panel,DISCOVERY_ASSETS,start,end,'OWN',False,BASE_COST_BPS)
        xsec=run_method(dataset,panel,DISCOVERY_ASSETS,start,end,'XSEC',False,BASE_COST_BPS)
        own_stress=stress_from_method(own,dataset,panel,DISCOVERY_ASSETS,start,end,'OWN',False)
        gate=discovery_gate(own,xsec,own_stress)
        return {
            'ruleset':RULESET,'researchOnly':True,'executionImpact':False,'autoPromotion':False,
            'stage':'DISCOVERY','dataIntegrityFailure':False,
            'own':own,'xsec':xsec,'ownStress':{k:v for k,v in own_stress.items() if k!='weekly'},
            'gate':gate,'decision':gate['decision']
        }
    except Exception as e:
        return {
            'ruleset':RULESET,'researchOnly':True,'executionImpact':False,'autoPromotion':False,
            'stage':'DISCOVERY','dataIntegrityFailure':True,'error':str(e),
            'gate':{'pass':False,'reasons':['DATA_INTEGRITY_FAILURE']},
            'decision':'DISCOVERY_FAIL_RESEARCH_REDESIGN'
        }
