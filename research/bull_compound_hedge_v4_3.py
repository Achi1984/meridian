#!/usr/bin/env python3
"""MERIDIAN Bull Compound v0.4.3 — corrected staged hedge sizing.

Corrects v0.4.2 TP sizing so each TP closes a fixed fraction of the hedge base
(not a shrinking fraction on later days). Prevents new stage additions after a
TP has fired. The market trigger stays frozen from v0.4.1; only sizing/de-risk
policy is selected on 2020-2022, then evaluated untouched on 2023-2025.
"""
from __future__ import annotations
import itertools, json, statistics
from dataclasses import dataclass, asdict
from pathlib import Path
import bull_compound_backtest as base
import bull_compound_backtest_v3 as ohlcmod
import bull_compound_hedge_v4_1 as v41

FEE=0.001; SLIP=0.0005; CORE=1.0
FIBS=(1.618,2.0,2.618); TP_DD=(0.04,0.08,0.12); TP_WEIGHTS=(0.25,0.30,0.25)
STOP_UP=0.12; RESET_DD=0.15; BREAKOUT=60; RSI_MIN=62; EMA_RATIO=1.0
SHORT_EFF_LEV=8.0
CURRENT_LONG_NOTIONAL=0.1968

@dataclass(frozen=True)
class Policy:
    mode:str
    f1:float
    f2:float
    f3:float
    dd2:float
    dd3:float
    timeout:int
    invalid_up:float


def il(ds,x):
    for i,d in enumerate(ds):
        if d>=x:return i
    return len(ds)
def ir(ds,x):
    for i in range(len(ds)-1,-1,-1):
        if ds[i]<=x:return i
    return -1

def fee(face,px):return face*FEE/px

def left(pos):return sum(l['face'] for l in pos['lots'])

def avg_entry(pos):
    f=left(pos); inv=sum(l['face']/l['entry'] for l in pos['lots'])
    return f/inv if f>0 and inv>0 else None

def mtm(pos,px):
    return 0.0 if not pos else sum(l['face']*(1/px-1/l['entry']) for l in pos['lots'])

def add(pos,face,raw,realized):
    ex=raw*(1-SLIP); f=fee(face,ex); realized-=f
    pos['lots'].append({'face':face,'entry':ex});pos['rpnl']-=f
    pos['tp_base_face']=left(pos)  # only called before any TP has fired
    ae=avg_entry(pos);pos['avg_entry']=ae;pos['tp']=[ae*(1-d) for d in TP_DD];pos['stop']=ae*(1+STOP_UP)
    return realized

def close(pos,face,px,realized):
    face=min(face,left(pos)); ex=px*(1+SLIP); remain=face;net=0;new=[]
    for lot in pos['lots']:
        if remain<=1e-12:new.append(lot);continue
        q=min(remain,lot['face']);net+=q*(1/ex-1/lot['entry'])-fee(q,ex)
        rem=lot['face']-q
        if rem>1e-12:new.append({'face':rem,'entry':lot['entry']})
        remain-=q
    pos['lots']=new;realized+=net;pos['rpnl']+=net
    return realized

def struct2(i,op,lo,cl,r14):
    return i>=1 and cl[i]<op[i] and cl[i]<cl[i-1] and r14[i] is not None and r14[i-1] is not None and r14[i]<r14[i-1]
def struct3(i,lo,cl):return i>=3 and cl[i]<min(lo[i-3:i])
def stage_ok(p,stage,i,pos,op,lo,cl,r14):
    dd=(pos['peak']-cl[i])/pos['peak'] if pos['peak'] else 0
    st=struct2(i,op,lo,cl,r14) if stage==2 else struct3(i,lo,cl)
    dv=dd>=(p.dd2 if stage==2 else p.dd3)
    return st if p.mode=='structure' else dv if p.mode=='drawdown' else (st and dv)

def sim(ds,op,hi,lo,cl,e200,r14,p,start,end):
    s,e=il(ds,start),ir(ds,end); realized=0.0;pos=None;setup=None;pending=None;rearm=True
    trades=[];peak=CORE*cl[s];mdd=0;hp=cl[s];hdd=0;worst=CORE;adds=0;timeouts=0;invalids=0;max_margin=0
    for i in range(s,e+1):
        # prior close action at today's open
        if pending:
            a=pending;pending=None
            if a['kind'] in ('OPEN','ADD'):
                if pos is None:
                    pos={'lots':[],'opened':ds[i],'trigger_px':op[i],'trigger_i':i,'peak':hi[i],
                         'tp_done':[False]*3,'tp_base_face':0.0,'rpnl':0.0,'max_fraction':0.0}
                if not any(pos['tp_done']):
                    total=max(1e-9,CORE+realized);target=a['fraction']*total*op[i];q=max(0,target-left(pos))
                    if q>1e-12:
                        realized=add(pos,q,op[i],realized);pos['max_fraction']=max(pos['max_fraction'],a['fraction'])
                        if a['kind']=='ADD':adds+=1
            elif a['kind']=='CLOSE' and pos is not None:
                realized=close(pos,left(pos),op[i],realized)
                trades.append({'opened':pos['opened'],'closed':ds[i],'reason':a['reason'],'pnl_btc':pos['rpnl'],'max_fraction':pos['max_fraction']})
                if a['reason']=='TIMEOUT':timeouts+=1
                if a['reason']=='INVALID':invalids+=1
                pos=None

        # risk exits, stop first
        if pos is not None:
            pos['peak']=max(pos['peak'],hi[i])
            ae=avg_entry(pos);pos['avg_entry']=ae;pos['stop']=ae*(1+STOP_UP);pos['tp']=[ae*(1-d) for d in TP_DD]
            if hi[i]>=pos['stop']:
                realized=close(pos,left(pos),pos['stop'],realized)
                trades.append({'opened':pos['opened'],'closed':ds[i],'reason':'STOP','pnl_btc':pos['rpnl'],'max_fraction':pos['max_fraction']})
                pos=None
            else:
                for k,(lvl,w) in enumerate(zip(pos['tp'],TP_WEIGHTS)):
                    if pos is None:break
                    if not pos['tp_done'][k] and lo[i]<=lvl:
                        realized=close(pos,pos['tp_base_face']*w,lvl,realized);pos['tp_done'][k]=True

        # reset after 15% drawdown from setup peak; close runner/remainder
        if setup is not None:
            setup['peak']=max(setup['peak'],hi[i])
            if lo[i]<=setup['peak']*(1-RESET_DD):
                if pos is not None and left(pos)>0:
                    realized=close(pos,left(pos),cl[i],realized)
                    trades.append({'opened':pos['opened'],'closed':ds[i],'reason':'RESET_RUNNER','pnl_btc':pos['rpnl'],'max_fraction':pos['max_fraction']})
                    pos=None
                setup=None;pending=None;rearm=True

        # new fib structure
        if rearm and setup is None and i>=s+max(BREAKOUT,180):
            ph=max(cl[i-BREAKOUT:i])
            if cl[i]>ph:
                l180=min(cl[i-180:i])
                if ph/l180>=1.20:
                    setup={'targets':{f:l180+f*(ph-l180) for f in FIBS},'triggered':set(),'peak':hi[i]};rearm=False

        # starter trigger
        if setup is not None and pos is None and pending is None and i<e:
            er=e200[i];rr=r14[i]
            if er and rr is not None and rr>=RSI_MIN and cl[i]/er>=EMA_RATIO:
                for f in FIBS:
                    if f not in setup['triggered'] and cl[i]>=setup['targets'][f]:
                        setup['triggered'].add(f);pending={'kind':'OPEN','fraction':p.f1};break

        # stage up or cut starter; never add after TP1
        if pos is not None and pending is None and i<e and not any(pos['tp_done']):
            age=i-pos['trigger_i']
            if pos['max_fraction']<p.f2-1e-9 and stage_ok(p,2,i,pos,op,lo,cl,r14):
                pending={'kind':'ADD','fraction':p.f2}
            elif pos['max_fraction']>=p.f2-1e-9 and pos['max_fraction']<p.f3-1e-9 and stage_ok(p,3,i,pos,op,lo,cl,r14):
                pending={'kind':'ADD','fraction':p.f3}
            elif pos['max_fraction']<=p.f1+1e-9:
                if p.invalid_up>0 and cl[i]>pos['trigger_px']*(1+p.invalid_up):pending={'kind':'CLOSE','reason':'INVALID'}
                elif p.timeout>0 and age>=p.timeout:pending={'kind':'CLOSE','reason':'TIMEOUT'}

        tb=CORE+realized+mtm(pos,cl[i]);worst=min(worst,tb)
        if pos is not None:max_margin=max(max_margin,(left(pos)/cl[i])/SHORT_EFF_LEV)
        eq=tb*cl[i];peak=max(peak,eq);mdd=max(mdd,(peak-eq)/peak if peak else 0)
        hp=max(hp,cl[i]);hdd=max(hdd,(hp-cl[i])/hp if hp else 0)

    if pos is not None and left(pos)>0:
        realized=close(pos,left(pos),cl[e],realized);trades.append({'opened':pos['opened'],'closed':ds[e],'reason':'END','pnl_btc':pos['rpnl'],'max_fraction':pos['max_fraction']})
    total=CORE+realized
    return {'start':ds[s],'end':ds[e],'total_btc':total,'relative_to_hodl_btc_pct':(total-1)*100,
            'hedge_realized_btc':realized,'trades':len(trades),'profitable_trades':sum(t['pnl_btc']>0 for t in trades),
            'stops':sum(t['reason']=='STOP' for t in trades),'adds':adds,'timeout_exits':timeouts,'invalidation_exits':invalids,
            'max_drawdown_pct':mdd*100,'hodl_max_drawdown_pct':hdd*100,'worst_total_btc':worst,
            'max_short_margin_btc_at_8x':max_margin,'trade_events':trades}

def pd(p):return asdict(p)
def cap_matrix():
    return [{'long_leverage':L,'short_eff_leverage':S,'long_margin':CURRENT_LONG_NOTIONAL/L,
             'short_margin_at_20pct':0.20/S,'combined_margin':CURRENT_LONG_NOTIONAL/L+0.20/S}
            for L in (3,4,5) for S in (7,8)]

def main():
    ds,op,hi,lo,cl=ohlcmod.fetch_ohlc();e200=base.ema(cl,200);r14=base.rsi(cl,14)
    tr0,tr1='2020-05-12','2022-12-31';topd='2021-11-10';va0,va1='2023-01-01','2025-12-31'
    profiles=((.05,.10,.20),(.05,.15,.20),(.10,.15,.20),(.05,.10,.15))
    policies=[]
    for mode,(f1,f2,f3),d2,d3,to,inv in itertools.product(('structure','drawdown','hybrid'),profiles,(.02,.03),(.04,.06),(0,5,10),(0,.04,.06)):
        policies.append(Policy(mode,f1,f2,f3,d2,d3,to,inv))
    rows=[]
    for p in policies:
        tr=sim(ds,op,hi,lo,cl,e200,r14,p,tr0,tr1);tp=sim(ds,op,hi,lo,cl,e200,r14,p,tr0,topd)
        if tr['trades']<2:continue
        score=tr['total_btc']-2*max(0,.985-tp['total_btc'])-4*max(0,.92-tr['worst_total_btc'])-0.0008*tr['stops']-0.0003*(tr['timeout_exits']+tr['invalidation_exits'])
        rows.append((score,tr['total_btc'],p,tr,tp))
    rows.sort(key=lambda x:(x[0],x[1]),reverse=True);_,_,bp,tr,tp=rows[0]
    va=sim(ds,op,hi,lo,cl,e200,r14,bp,va0,va1);co=sim(ds,op,hi,lo,cl,e200,r14,bp,tr0,va1)

    # Exact v0.4.1 static baseline for apples-to-apples verification.
    sp=v41.P(60,FIBS,62,1.0,'none',0.20,TP_DD,0.12,0.15)
    st=v41.sim(ds,op,hi,lo,cl,e200,r14,sp,tr0,tr1);sv=v41.sim(ds,op,hi,lo,cl,e200,r14,sp,va0,va1);sc=v41.sim(ds,op,hi,lo,cl,e200,r14,sp,tr0,va1)

    top20=[]
    for rank,x in enumerate(rows[:20],1):
        vr=sim(ds,op,hi,lo,cl,e200,r14,x[2],va0,va1)
        top20.append({'rank':rank,'policy':pd(x[2]),'train_total_btc':x[3]['total_btc'],'validation_total_btc':vr['total_btc']})
    out={'method':{'name':'MERIDIAN Bull Compound v0.4.3 Corrected Staged Hedge','train':[tr0,tr1],'validation':[va0,va1],
                   'data':'Binance Data Vision BTCUSDT daily OHLC','policies_tested':len(policies),'base_trigger':'locked v0.4.1',
                   'effective_short_leverage':SHORT_EFF_LEV,'fee_bps':10,'slippage_bps':5,'funding':'excluded'},
         'best_policy':pd(bp),'train_result':tr,'bull_checkpoint':tp,'validation_result':va,'continuous_result':co,
         'static_v4_1':{'train':st,'validation':sv,'continuous':sc},
         'top20':{'oos_beat_hodl':sum(x['validation_total_btc']>1 for x in top20),'median_oos':statistics.median(x['validation_total_btc'] for x in top20),'rows':top20},
         'capital_matrix':cap_matrix()}
    Path('bull-compound-hedge-v4-3.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
    def row(lbl,r):return f"| {lbl} | {r['total_btc']:.5f} | {r['relative_to_hodl_btc_pct']:+.2f}% | {r['trades']} | {r['profitable_trades']} | {r['stops']} | {r.get('adds',0)} | {r['max_drawdown_pct']:.2f}% |"
    lines=['# MERIDIAN Bull Compound v0.4.3 — corrected staged hedge','',
           '> Core BTC never sold. Trigger locked from v0.4.1. TP sizing corrected to fixed fractions of hedge base.','',
           '## Training-selected staged policy',f'- Mode: **{bp.mode}**',f'- Stages: **{bp.f1*100:.0f}% → {bp.f2*100:.0f}% → {bp.f3*100:.0f}%**',
           f'- Drawdown gates: {bp.dd2*100:.0f}% / {bp.dd3*100:.0f}%; timeout {bp.timeout or "off"}; invalidation {bp.invalid_up*100:.0f}%','',
           '## Staged results','| Period | BTC end | vs HODL | Trades | Profitable | Stops | Adds | Max DD |','|---|---:|---:|---:|---:|---:|---:|---:|',
           row('TRAIN 2020–2022',tr),row('OOS 2023–2025',va),row('Continuous 2020–2025',co),'',
           '## Static 20% v0.4.1 baseline','| Period | BTC end | vs HODL | Trades | Profitable | Stops | Adds | Max DD |','|---|---:|---:|---:|---:|---:|---:|---:|',
           row('TRAIN static20',st),row('OOS static20',sv),row('Continuous static20',sc),'',
           f"Bull checkpoint: {tp['total_btc']:.5f} BTC ({tp['relative_to_hodl_btc_pct']:+.2f}%).",
           f"Top-20 staged policies beating HODL OOS: {sum(x['validation_total_btc']>1 for x in top20)}/{len(top20)}; median OOS {statistics.median(x['validation_total_btc'] for x in top20):.5f} BTC.",'',
           '## Capital efficiency at full hedge','| Long | Short eff. | Long margin | Short margin | Combined |','|---:|---:|---:|---:|---:|']
    for r in cap_matrix():lines.append(f"| {r['long_leverage']}× | {r['short_eff_leverage']}× | {r['long_margin']:.5f} BTC | {r['short_margin_at_20pct']:.5f} BTC | {r['combined_margin']:.5f} BTC |")
    Path('bull-compound-hedge-v4-3.md').write_text('\n'.join(lines)+'\n',encoding='utf-8');print('\n'.join(lines))
if __name__=='__main__':main()
