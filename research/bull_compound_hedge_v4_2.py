#!/usr/bin/env python3
"""MERIDIAN Bull Compound v0.4.2 — staged hedge sizing / de-risk research.

Goal: keep the BTC core untouched and test whether a 5% -> 10% -> 20% inverse
short hedge improves robustness versus opening the full 20% hedge immediately.
Base market trigger is deliberately frozen from v0.4.1 so the training period is
used only to select the staging/de-risk policy, reducing degrees of freedom.

Training: 2020-05-12..2022-12-31. OOS: 2023-01-01..2025-12-31.
Daily Binance BTCUSDT OHLC. Funding excluded. Fees/slippage included.
"""
from __future__ import annotations
import itertools, json, statistics
from dataclasses import dataclass, asdict
from pathlib import Path
import bull_compound_backtest as base
import bull_compound_backtest_v3 as ohlcmod

FEE=0.001
SLIP=0.0005
CORE_BTC=1.0
EFFECTIVE_SHORT_LEVERAGE=8.0
FIBS=(1.618,2.0,2.618)
TP_DD=(0.04,0.08,0.12)
TP_WEIGHTS=(0.25,0.30,0.25)  # 20% runner
STOP_UP=0.12
RESET_DD=0.15
BREAKOUT_DAYS=60
RSI_MIN=62
EMA_RATIO_MIN=1.00

CURRENT_LONG_NOTIONAL_BTC=0.1968
CURRENT_LONG_ENTRY=75966.1
CURRENT_LONG_LIQ=46837.5
CURRENT_LONG_FLOOR=42600.0

@dataclass(frozen=True)
class Policy:
    mode:str                 # static20, structure, drawdown, hybrid
    initial_fraction:float   # usually 5%
    stage2_fraction:float    # cumulative target, usually 10%
    stage3_fraction:float    # cumulative target, usually 20%
    stage2_dd:float
    stage3_dd:float
    starter_timeout:int      # 0 disables; otherwise close starter if stage2 absent
    invalidation_up:float    # 0 disables; close starter if close > trigger*(1+x)


def il(ds,x):
    for i,d in enumerate(ds):
        if d>=x:return i
    return len(ds)
def ir(ds,x):
    for i in range(len(ds)-1,-1,-1):
        if ds[i]<=x:return i
    return -1

def fee_btc(face,px): return face*FEE/px

def equivalent_entry(lots):
    face=sum(x['face'] for x in lots)
    inv=sum(x['face']/x['entry'] for x in lots)
    return face/inv if face>0 and inv>0 else None

def face_left(pos): return sum(x['face'] for x in pos['lots'])

def pnl_mtm(pos,px):
    if not pos:return 0.0
    return sum(x['face']*(1/px-1/x['entry']) for x in pos['lots'])

def close_face(pos,face,px,realized):
    face=min(face,face_left(pos))
    if face<=1e-12:return realized,0.0
    ex=px*(1+SLIP) # adverse buyback for short
    left=face; net=0.0; new=[]
    # FIFO lots. PnL equivalently aggregates, FIFO only records remaining cost basis.
    for lot in pos['lots']:
        if left<=1e-12:
            new.append(lot);continue
        q=min(left,lot['face'])
        net += q*(1/ex-1/lot['entry']) - fee_btc(q,ex)
        rem=lot['face']-q
        if rem>1e-12:new.append({'face':rem,'entry':lot['entry']})
        left-=q
    pos['lots']=new;realized+=net
    return realized,net

def add_face(pos,face,raw_px,realized):
    if face<=1e-12:return realized,0.0
    entry=raw_px*(1-SLIP) # adverse entry for short
    f=fee_btc(face,entry);realized-=f
    pos['lots'].append({'face':face,'entry':entry});pos['rpnl']-=f
    return realized,entry

def refresh_levels(pos):
    ae=equivalent_entry(pos['lots'])
    if ae is None:return
    pos['avg_entry']=ae
    pos['tp']=[ae*(1-d) for d in TP_DD]
    pos['stop']=ae*(1+STOP_UP)

def structure_stage2(i,op,hi,lo,cl,r14):
    if i<1:return False
    rr=r14[i];rp=r14[i-1]
    return cl[i]<op[i] and cl[i]<cl[i-1] and rr is not None and rp is not None and rr<rp

def structure_stage3(i,op,hi,lo,cl,r14):
    if i<3:return False
    return cl[i] < min(lo[i-3:i])

def should_stage(policy,stage,i,pos,op,hi,lo,cl,r14):
    peak=pos['peak']
    dd=(peak-cl[i])/peak if peak>0 else 0
    if stage==2:
        struct=structure_stage2(i,op,hi,lo,cl,r14); draw=dd>=policy.stage2_dd
    else:
        struct=structure_stage3(i,op,hi,lo,cl,r14); draw=dd>=policy.stage3_dd
    if policy.mode=='structure':return struct
    if policy.mode=='drawdown':return draw
    if policy.mode=='hybrid':return struct and draw
    return False

def sim(ds,op,hi,lo,cl,e200,r14,p:Policy,start,end):
    s,e=il(ds,start),ir(ds,end)
    realized=0.0;pos=None;setup=None;pending=[];rearm=True
    trades=[];equity_peak=CORE_BTC*cl[s];maxdd=0;hp=cl[s];hdd=0;worst=CORE_BTC
    max_margin=0.0; adds=0; timeout_exits=0; invalid_exits=0

    def schedule(kind,target_fraction,signal_i):
        pending.append({'kind':kind,'target_fraction':target_fraction,'signal_i':signal_i})

    for i in range(s,e+1):
        # Execute staged opens/adds or de-risk closes from yesterday's close signal.
        if pending:
            actions=pending;pending=[]
            for a in actions:
                if a['kind'] in ('OPEN','ADD'):
                    total_before=max(1e-9,CORE_BTC+realized)
                    target_face=a['target_fraction']*total_before*op[i]
                    current=face_left(pos) if pos else 0.0
                    add=max(0.0,target_face-current)
                    if add>1e-10:
                        if pos is None:
                            pos={'lots':[],'opened':ds[i],'trigger_px':op[i],'trigger_i':i,'stage':1,
                                 'peak':hi[i],'tp_done':[False]*3,'rpnl':0.0,'max_fraction':a['target_fraction']}
                        realized,_=add_face(pos,add,op[i],realized)
                        pos['max_fraction']=max(pos['max_fraction'],a['target_fraction'])
                        if a['kind']=='ADD':adds+=1
                        refresh_levels(pos)
                elif a['kind']=='CLOSE' and pos is not None:
                    realized,r=close_face(pos,face_left(pos),op[i],realized);pos['rpnl']+=r
                    trades.append({'opened':pos['opened'],'closed':ds[i],'reason':a.get('reason','DERISK'),
                                   'avg_entry':pos.get('avg_entry'),'exit':op[i],'pnl_btc':pos['rpnl'],'max_fraction':pos['max_fraction']})
                    if a.get('reason')=='TIMEOUT':timeout_exits+=1
                    if a.get('reason')=='INVALID':invalid_exits+=1
                    pos=None

        # Position risk / TP logic. Conservative stop-first sequencing.
        if pos is not None:
            pos['peak']=max(pos['peak'],hi[i])
            refresh_levels(pos)
            if hi[i]>=pos['stop']:
                realized,r=close_face(pos,face_left(pos),pos['stop'],realized);pos['rpnl']+=r
                trades.append({'opened':pos['opened'],'closed':ds[i],'reason':'STOP','avg_entry':pos['avg_entry'],
                               'exit':pos['stop'],'pnl_btc':pos['rpnl'],'max_fraction':pos['max_fraction']})
                pos=None
            else:
                total_face=face_left(pos)
                # TP fractions apply to current total hedge when first triggered.
                for k,(lvl,w) in enumerate(zip(pos['tp'],TP_WEIGHTS)):
                    if pos is None:break
                    if not pos['tp_done'][k] and lo[i]<=lvl:
                        q=total_face*w
                        realized,r=close_face(pos,q,lvl,realized);pos['rpnl']+=r;pos['tp_done'][k]=True

        # Setup lifecycle / runner closure after meaningful drawdown.
        if setup is not None:
            setup['peak']=max(setup['peak'],hi[i])
            if lo[i]<=setup['peak']*(1-RESET_DD):
                if pos is not None and face_left(pos)>0:
                    realized,r=close_face(pos,face_left(pos),cl[i],realized);pos['rpnl']+=r
                    trades.append({'opened':pos['opened'],'closed':ds[i],'reason':'RESET_RUNNER','avg_entry':pos.get('avg_entry'),
                                   'exit':cl[i],'pnl_btc':pos['rpnl'],'max_fraction':pos['max_fraction']})
                    pos=None
                setup=None;pending=[];rearm=True

        # Freeze Fib structure after breakout.
        if rearm and setup is None and i>=s+max(BREAKOUT_DAYS,180):
            ph=max(cl[i-BREAKOUT_DAYS:i])
            if cl[i]>ph:
                l180=min(cl[i-180:i])
                if ph/l180>=1.20:
                    setup={'targets':{f:l180+f*(ph-l180) for f in FIBS},'triggered':set(),'peak':hi[i]}
                    rearm=False

        # New hedge starter signal.
        if setup is not None and pos is None and not pending and i<e:
            er=e200[i];rr=r14[i]
            if er and rr is not None and rr>=RSI_MIN and cl[i]/er>=EMA_RATIO_MIN:
                for f in FIBS:
                    if f not in setup['triggered'] and cl[i]>=setup['targets'][f]:
                        setup['triggered'].add(f)
                        target=0.20 if p.mode=='static20' else p.initial_fraction
                        schedule('OPEN',target,i)
                        break

        # Dynamic stage-up / de-risk signals at close, execute next open.
        if pos is not None and i<e and p.mode!='static20' and not pending:
            age=i-pos['trigger_i']
            if pos['max_fraction'] < p.stage2_fraction-1e-9 and should_stage(p,2,i,pos,op,hi,lo,cl,r14):
                schedule('ADD',p.stage2_fraction,i);pos['stage']=2
            elif pos['max_fraction'] >= p.stage2_fraction-1e-9 and pos['max_fraction'] < p.stage3_fraction-1e-9 and should_stage(p,3,i,pos,op,hi,lo,cl,r14):
                schedule('ADD',p.stage3_fraction,i);pos['stage']=3
            elif pos['max_fraction'] <= p.initial_fraction+1e-9:
                if p.invalidation_up>0 and cl[i] > pos['trigger_px']*(1+p.invalidation_up):
                    pending.append({'kind':'CLOSE','target_fraction':0,'signal_i':i,'reason':'INVALID'})
                elif p.starter_timeout>0 and age>=p.starter_timeout:
                    pending.append({'kind':'CLOSE','target_fraction':0,'signal_i':i,'reason':'TIMEOUT'})

        # Margin / equity diagnostics. Effective leverage affects required margin, not PnL.
        tb=CORE_BTC+realized+pnl_mtm(pos,cl[i]);worst=min(worst,tb)
        if pos is not None:
            notional_btc=face_left(pos)/cl[i]
            max_margin=max(max_margin,notional_btc/EFFECTIVE_SHORT_LEVERAGE)
        eq=tb*cl[i];equity_peak=max(equity_peak,eq);maxdd=max(maxdd,(equity_peak-eq)/equity_peak if equity_peak else 0)
        hp=max(hp,cl[i]);hdd=max(hdd,(hp-cl[i])/hp if hp else 0)

    if pos is not None and face_left(pos)>0:
        realized,r=close_face(pos,face_left(pos),cl[e],realized);pos['rpnl']+=r
        trades.append({'opened':pos['opened'],'closed':ds[e],'reason':'END','avg_entry':pos.get('avg_entry'),
                       'exit':cl[e],'pnl_btc':pos['rpnl'],'max_fraction':pos['max_fraction']})

    total=CORE_BTC+realized
    return {'start':ds[s],'end':ds[e],'total_btc':total,'hedge_realized_btc':realized,
            'relative_to_hodl_btc_pct':(total-1)*100,'trades':len(trades),
            'profitable_trades':sum(1 for t in trades if t['pnl_btc']>0),
            'stops':sum(1 for t in trades if t['reason']=='STOP'),'adds':adds,
            'timeout_exits':timeout_exits,'invalidation_exits':invalid_exits,
            'max_drawdown_pct':maxdd*100,'hodl_max_drawdown_pct':hdd*100,
            'worst_total_btc':worst,'max_short_margin_btc_at_8x':max_margin,'trade_events':trades}

def policy_dict(p):return asdict(p)

def capital_matrix():
    rows=[]
    for longL in (3,4,5):
        long_margin=CURRENT_LONG_NOTIONAL_BTC/longL
        for shortL in (7,8):
            short_margin=0.20/shortL
            rows.append({'long_leverage':longL,'short_effective_leverage':shortL,
                         'long_margin_btc':long_margin,'full_20pct_short_margin_btc':short_margin,
                         'combined_margin_btc':long_margin+short_margin})
    return rows

def main():
    ds,op,hi,lo,cl=ohlcmod.fetch_ohlc();e200=base.ema(cl,200);r14=base.rsi(cl,14)
    tr0,tr1='2020-05-12','2022-12-31';topd='2021-11-10';va0,va1='2023-01-01','2025-12-31'

    policies=[Policy('static20',0.20,0.20,0.20,0,0,0,0)]
    for vals in itertools.product(
        ('structure','drawdown','hybrid'),
        (0.05,),
        (0.10,),
        (0.20,),
        (0.02,0.03),
        (0.04,0.06),
        (0,5,10),
        (0,0.04,0.06),
    ):
        policies.append(Policy(*vals))

    rows=[]
    for p in policies:
        tr=sim(ds,op,hi,lo,cl,e200,r14,p,tr0,tr1)
        tp=sim(ds,op,hi,lo,cl,e200,r14,p,tr0,topd)
        if tr['trades']<2:continue
        # Training-only score: BTC growth, bull participation, ruin control and churn discipline.
        bull_short=max(0,0.985-tp['total_btc'])
        ruin=max(0,0.92-tr['worst_total_btc'])
        churn=0.0008*tr['stops']+0.0003*(tr['timeout_exits']+tr['invalidation_exits'])
        score=tr['total_btc']-2*bull_short-4*ruin-churn
        rows.append((score,tr['total_btc'],p,tr,tp))
    rows.sort(key=lambda x:(x[0],x[1]),reverse=True)
    if not rows:raise RuntimeError('no policies traded')
    _,_,bp,tr,tp=rows[0]
    va=sim(ds,op,hi,lo,cl,e200,r14,bp,va0,va1)
    co=sim(ds,op,hi,lo,cl,e200,r14,bp,tr0,va1)
    static=next(p for p in policies if p.mode=='static20')
    static_tr=sim(ds,op,hi,lo,cl,e200,r14,static,tr0,tr1)
    static_va=sim(ds,op,hi,lo,cl,e200,r14,static,va0,va1)
    static_co=sim(ds,op,hi,lo,cl,e200,r14,static,tr0,va1)

    top20=[]
    for rank,x in enumerate(rows[:20],1):
        vr=sim(ds,op,hi,lo,cl,e200,r14,x[2],va0,va1)
        top20.append({'rank':rank,'policy':policy_dict(x[2]),'train_total_btc':x[3]['total_btc'],
                      'validation_total_btc':vr['total_btc'],'validation_stops':vr['stops']})

    out={'method':{'name':'MERIDIAN Bull Compound v0.4.2 Staged Hedge Sizing','data':'Binance Data Vision BTCUSDT daily OHLC',
                   'train':[tr0,tr1],'validation':[va0,va1],'policies_tested':len(policies),
                   'base_trigger_locked_from':'v0.4.1','effective_short_leverage':EFFECTIVE_SHORT_LEVERAGE,
                   'fee_bps':FEE*10000,'slippage_bps':SLIP*10000,'funding':'excluded'},
         'best_policy_locked_from_train':policy_dict(bp),'train_result':tr,'train_bull_checkpoint':tp,
         'validation_result':va,'continuous_result':co,
         'static20_baseline':{'train':static_tr,'validation':static_va,'continuous':static_co},
         'top20_robustness':{'validation_beat_hodl_count':sum(1 for x in top20 if x['validation_total_btc']>1),
                             'median_validation_total_btc':statistics.median(x['validation_total_btc'] for x in top20),'rows':top20},
         'capital_efficiency_matrix':capital_matrix(),
         'current_long':{'notional_btc':CURRENT_LONG_NOTIONAL_BTC,'entry':CURRENT_LONG_ENTRY,'liq':CURRENT_LONG_LIQ,'floor':CURRENT_LONG_FLOOR}}
    Path('bull-compound-hedge-v4-2.json').write_text(json.dumps(out,indent=2),encoding='utf-8')

    def line(label,r):
        return f"| {label} | {r['total_btc']:.5f} | {r['relative_to_hodl_btc_pct']:+.2f}% | {r['trades']} | {r['profitable_trades']} | {r['stops']} | {r['adds']} | {r['max_drawdown_pct']:.2f}% |"
    lines=['# MERIDIAN Bull Compound v0.4.2 — staged hedge sizing','',
           '> Core BTC is never sold. Base Fib/RSI/EMA trigger is frozen from v0.4.1; only hedge staging/de-risk policy is trained.','',
           '## Best policy selected on 2020–2022 only',
           f'- Mode: **{bp.mode}**',
           f'- Hedge stages: **{bp.initial_fraction*100:.0f}% → {bp.stage2_fraction*100:.0f}% → {bp.stage3_fraction*100:.0f}%**',
           f'- Stage drawdown gates: {bp.stage2_dd*100:.0f}% / {bp.stage3_dd*100:.0f}%',
           f'- Starter timeout: {bp.starter_timeout if bp.starter_timeout else "off"} days; invalidation: {bp.invalidation_up*100:.0f}% above trigger' if bp.invalidation_up else f'- Starter timeout: {bp.starter_timeout if bp.starter_timeout else "off"} days; invalidation: off',
           f'- Effective short leverage for margin diagnostics: **{EFFECTIVE_SHORT_LEVERAGE:.0f}×**','',
           '## Results','| Period | BTC end | vs HODL | Trades | Profitable | Stops | Adds | Max DD |','|---|---:|---:|---:|---:|---:|---:|---:|',
           line('TRAIN 2020–2022',tr),line('OOS 2023–2025',va),line('Continuous 2020–2025',co),'',
           '## Static 20% baseline with same trigger/TP/SL','| Period | BTC end | vs HODL | Trades | Profitable | Stops | Adds | Max DD |','|---|---:|---:|---:|---:|---:|---:|---:|',
           line('TRAIN static20',static_tr),line('OOS static20',static_va),line('Continuous static20',static_co),'',
           f"2021-11-10 bull checkpoint for staged winner: **{tp['total_btc']:.5f} BTC** ({tp['relative_to_hodl_btc_pct']:+.2f}% vs HODL).",
           f"Top-20 training policies beating HODL OOS: **{sum(1 for x in top20 if x['validation_total_btc']>1)}/{len(top20)}**; median OOS **{statistics.median(x['validation_total_btc'] for x in top20):.5f} BTC**.",'',
           '## Capital efficiency at full 20% hedge','| Long leverage | Short effective leverage | Long margin | Short margin | Combined margin |','|---:|---:|---:|---:|---:|']
    for r in capital_matrix():
        lines.append(f"| {r['long_leverage']}× | {r['short_effective_leverage']}× | {r['long_margin_btc']:.5f} BTC | {r['full_20pct_short_margin_btc']:.5f} BTC | {r['combined_margin_btc']:.5f} BTC |")
    Path('bull-compound-hedge-v4-2.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('\n'.join(lines))

if __name__=='__main__':main()
