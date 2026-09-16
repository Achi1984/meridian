#!/usr/bin/env python3
"""MERIDIAN Bull Compound v0.4.1 — smarter hedge activation + leverage safety.

Research only. The 1 BTC core is never sold. We optimize short-hedge activation,
hedge size, TP/SL structure and then evaluate effective short leverage separately
from notional. This matters because leverage changes margin/liquidation, while the
same notional produces essentially the same PnL before liquidation.

Training/selection: 2020-05-12..2022-12-31 only.
Untouched OOS validation: 2023-01-01..2025-12-31.
Data: Binance Data Vision BTCUSDT daily OHLC.
Funding excluded; 10 bps fee + 5 bps adverse slippage per transaction.
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
TP_WEIGHTS=(0.25,0.30,0.25) # 20% runner
SHORT_LEVERAGES=(6,7,8,9,10)
SHORT_SAFETY_BUFFER=0.02 # stop-to-bankruptcy price buffer target
CURRENT_SHORT_NOTIONAL_BTC=0.20
CURRENT_SHORT_TOTAL_MARGIN_BTC=0.02250
CURRENT_LONG_NOTIONAL_BTC=0.1968
CURRENT_LONG_ENTRY=75966.1
CURRENT_LONG_LIQ=46837.5
CURRENT_LONG_FLOOR=42600.0

@dataclass(frozen=True)
class P:
    breakout_days:int
    fibs:tuple[float,float,float]
    rsi_min:int
    ema_ratio_min:float
    confirmation:str
    hedge_fraction:float
    tp_drawdowns:tuple[float,float,float]
    stop_up:float
    reset_drawdown:float


def il(ds,x):
    for i,d in enumerate(ds):
        if d>=x:return i
    return len(ds)
def ir(ds,x):
    for i in range(len(ds)-1,-1,-1):
        if ds[i]<=x:return i
    return -1

def pnl_btc_short(face,entry,exit_):return face*(1.0/exit_-1.0/entry)
def fee_btc(face,px):return face*FEE/px

def mtm(pos,px):
    if not pos:return 0.0
    return pnl_btc_short(pos['face_left'],pos['entry'],px)

def close_face(pos,face,px,realized):
    face=min(face,pos['face_left'])
    if face<=0:return realized,0.0
    ex=px*(1+SLIP)
    net=pnl_btc_short(face,pos['entry'],ex)-fee_btc(face,ex)
    realized+=net;pos['face_left']-=face
    return realized,net

def confirm(mode,i,op,hi,lo,cl,r14):
    if mode=='none':return True
    if i<3:return False
    if mode=='red_close':return cl[i]<op[i] and cl[i]<cl[i-1]
    if mode=='break_3d_low':return cl[i]<min(lo[i-3:i])
    if mode=='rsi_roll':
        return r14[i] is not None and r14[i-1] is not None and r14[i]<r14[i-1] and cl[i]<cl[i-1]
    return False

def sim(ds,op,hi,lo,cl,e200,r14,p:P,start,end):
    s,e=il(ds,start),ir(ds,end)
    realized=0.0;pos=None;setup=None;candidate=None;pending_open=None;rearm=True
    trades=[];peak=CORE_BTC*cl[s];maxdd=0.0;hp=cl[s];hdd=0.0;worst=CORE_BTC
    for i in range(s,e+1):
        # Execute confirmed signal at next day's open.
        if pending_open is not None and pos is None:
            raw=op[i];entry=raw*(1-SLIP);tb=CORE_BTC+realized
            if tb>0:
                face=p.hedge_fraction*tb*raw
                entry_fee=fee_btc(face,entry);realized-=entry_fee
                pos={'entry':entry,'face_total':face,'face_left':face,
                     'tp':[entry*(1-d) for d in p.tp_drawdowns],'done':[False]*3,
                     'stop':entry*(1+p.stop_up),'opened':ds[i],'fib':pending_open,
                     'rpnl':-entry_fee}
            pending_open=None

        # Conservative intraday ordering: stop before TP if both touched.
        if pos is not None:
            if hi[i]>=pos['stop']:
                realized,r=close_face(pos,pos['face_left'],pos['stop'],realized);pos['rpnl']+=r
                trades.append({'opened':pos['opened'],'closed':ds[i],'reason':'STOP','entry':pos['entry'],'exit':pos['stop'],'pnl_btc':pos['rpnl']})
                pos=None
            else:
                for k,(lvl,w) in enumerate(zip(pos['tp'],TP_WEIGHTS)):
                    if pos is None:break
                    if not pos['done'][k] and lo[i]<=lvl:
                        realized,r=close_face(pos,pos['face_total']*w,lvl,realized);pos['rpnl']+=r;pos['done'][k]=True

        # Setup lifecycle / runner exit.
        if setup is not None:
            setup['peak']=max(setup['peak'],hi[i])
            if lo[i]<=setup['peak']*(1-p.reset_drawdown):
                if pos is not None and pos['face_left']>0:
                    realized,r=close_face(pos,pos['face_left'],cl[i],realized);pos['rpnl']+=r
                    trades.append({'opened':pos['opened'],'closed':ds[i],'reason':'RESET_RUNNER','entry':pos['entry'],'exit':cl[i],'pnl_btc':pos['rpnl']})
                    pos=None
                setup=None;candidate=None;pending_open=None;rearm=True

        # New structure after breakout.
        n=p.breakout_days
        if rearm and setup is None and i>=s+max(n,180):
            ph=max(cl[i-n:i])
            if cl[i]>ph:
                l180=min(cl[i-180:i])
                if ph/l180>=1.20:
                    setup={'targets':{f:l180+f*(ph-l180) for f in p.fibs},'triggered':set(),'peak':hi[i]}
                    rearm=False

        # Candidate activation: fib+overextension first, then optional reversal confirmation within 5 days.
        if candidate is not None and pos is None and pending_open is None:
            if i>candidate['expires']:
                candidate=None
            elif confirm(p.confirmation,i,op,hi,lo,cl,r14):
                pending_open=candidate['fib'];setup['triggered'].add(candidate['fib']);candidate=None

        if setup is not None and pos is None and pending_open is None and candidate is None and i<e:
            er=e200[i];rr=r14[i]
            if er and rr is not None and rr>=p.rsi_min and cl[i]/er>=p.ema_ratio_min:
                for f in p.fibs:
                    if f not in setup['triggered'] and cl[i]>=setup['targets'][f]:
                        if p.confirmation=='none':
                            pending_open=f;setup['triggered'].add(f)
                        else:
                            candidate={'fib':f,'expires':min(e,i+5)}
                        break

        tb=CORE_BTC+realized+mtm(pos,cl[i]);worst=min(worst,tb)
        eq=tb*cl[i];peak=max(peak,eq);maxdd=max(maxdd,(peak-eq)/peak if peak>0 else 0)
        hp=max(hp,cl[i]);hdd=max(hdd,(hp-cl[i])/hp if hp>0 else 0)

    if pos is not None and pos['face_left']>0:
        realized,r=close_face(pos,pos['face_left'],cl[e],realized);pos['rpnl']+=r
        trades.append({'opened':pos['opened'],'closed':ds[e],'reason':'END','entry':pos['entry'],'exit':cl[e],'pnl_btc':pos['rpnl']})
    total=CORE_BTC+realized
    return {'start':ds[s],'end':ds[e],'total_btc':total,'hedge_realized_btc':realized,
            'relative_to_hodl_btc_pct':(total-1)*100,'trades':len(trades),
            'profitable_trades':sum(1 for t in trades if t['pnl_btc']>0),
            'stops':sum(1 for t in trades if t['reason']=='STOP'),
            'max_drawdown_pct':maxdd*100,'hodl_max_drawdown_pct':hdd*100,
            'worst_total_btc':worst,'trade_events':trades}

def pd(p):
    d=asdict(p);d['fibs']=list(p.fibs);d['tp_drawdowns']=list(p.tp_drawdowns);return d

def leverage_safety(stop_up):
    rows=[]
    for L in SHORT_LEVERAGES:
        bankruptcy_up=1.0/(L-1.0)
        margin=CURRENT_SHORT_NOTIONAL_BTC/L
        safe=bankruptcy_up>=stop_up+SHORT_SAFETY_BUFFER
        rows.append({'effective_leverage':L,'bankruptcy_distance_up_pct':bankruptcy_up*100,
                     'required_margin_btc_for_0.20_notional':margin,
                     'stop_pct':stop_up*100,'target_buffer_pct':SHORT_SAFETY_BUFFER*100,
                     'passes_safety_rule':safe})
    return rows

def long_margin_matrix():
    out=[]
    observed_buffer=(CURRENT_LONG_ENTRY-CURRENT_LONG_LIQ)/CURRENT_LONG_ENTRY*100
    floor_dd=(CURRENT_LONG_ENTRY-CURRENT_LONG_FLOOR)/CURRENT_LONG_ENTRY*100
    for L in (3,4,5):
        out.append({'nominal_long_leverage':L,
                    'margin_btc_for_fixed_0.1968_btc_notional':CURRENT_LONG_NOTIONAL_BTC/L,
                    'note':'PnL unchanged for fixed notional; exact Pionex grid liquidation requires grid-specific engine/UI calibration.'})
    return {'rows':out,'current_observed_4x':{'entry':CURRENT_LONG_ENTRY,'liq':CURRENT_LONG_LIQ,
            'liq_buffer_down_pct':observed_buffer,'grid_floor':CURRENT_LONG_FLOOR,'floor_drawdown_pct':floor_dd,
            'liq_is_above_grid_floor':CURRENT_LONG_LIQ>CURRENT_LONG_FLOOR}}

def main():
    ds,op,hi,lo,cl=ohlcmod.fetch_ohlc();e200=base.ema(cl,200);r14=base.rsi(cl,14)
    tr0,tr1='2020-05-12','2022-12-31';topd='2021-11-10';va0,va1='2023-01-01','2025-12-31'
    grid=[P(*x) for x in itertools.product(
        (60,90),
        ((1.272,1.618,2.0),(1.618,2.0,2.618),(1.272,1.618,2.618)),
        (62,68,74),
        (1.00,1.10,1.20),
        ('none','red_close','break_3d_low','rsi_roll'),
        (0.05,0.10,0.15,0.20),
        ((0.04,0.08,0.12),(0.05,0.10,0.15),(0.08,0.13,0.21)),
        (0.08,0.10,0.12),
        (0.15,0.20),
    )]
    rows=[]
    for p in grid:
        tr=sim(ds,op,hi,lo,cl,e200,r14,p,tr0,tr1);tp=sim(ds,op,hi,lo,cl,e200,r14,p,tr0,topd)
        if tr['trades']<2:continue
        bull_short=max(0.0,0.97-tp['total_btc']);ruin=max(0.0,0.90-tr['worst_total_btc'])
        # Small stop penalty favors models that do not churn hedge losses.
        stop_pen=0.0015*tr['stops']
        score=tr['total_btc']-2*bull_short-4*ruin-stop_pen
        rows.append((score,tr['total_btc'],p,tr,tp))
    rows.sort(key=lambda x:(x[0],x[1]),reverse=True)
    if not rows:raise RuntimeError('no valid variants')
    _,_,bp,tr,tp=rows[0]
    va=sim(ds,op,hi,lo,cl,e200,r14,bp,va0,va1);co=sim(ds,op,hi,lo,cl,e200,r14,bp,tr0,va1)
    top20=[]
    for rank,x in enumerate(rows[:20],1):
        vr=sim(ds,op,hi,lo,cl,e200,r14,x[2],va0,va1)
        top20.append({'rank':rank,'params':pd(x[2]),'train_total_btc':x[3]['total_btc'],
                      'validation_total_btc':vr['total_btc'],'validation_stops':vr['stops']})
    lev=leverage_safety(bp.stop_up)
    safe=[x['effective_leverage'] for x in lev if x['passes_safety_rule']]
    out={'method':{'name':'MERIDIAN Bull Compound v0.4.1 Hedge Confirmation + Leverage Safety',
                   'data':'Binance Data Vision BTCUSDT daily OHLC','train':[tr0,tr1],'validation':[va0,va1],
                   'variants_tested':len(grid),'variants_with_trades':len(rows),'fee_bps':FEE*10000,
                   'slippage_bps':SLIP*10000,'funding':'excluded','confirmation_window_days':5,
                   'short_liquidation_safety_rule':'theoretical inverse-short bankruptcy distance >= stop distance + 2% price buffer'},
         'best_params_locked_from_train':pd(bp),'train_result':tr,'train_bull_checkpoint':tp,
         'validation_result':va,'continuous_result':co,
         'top20_robustness':{'validation_beat_hodl_count':sum(1 for x in top20 if x['validation_total_btc']>1),
                             'median_validation_total_btc':statistics.median(x['validation_total_btc'] for x in top20),'rows':top20},
         'short_leverage_safety':{'rows':lev,'highest_effective_leverage_passing':max(safe) if safe else None,
                                  'current_effective_leverage_from_0.20_notional_and_0.0225_margin':CURRENT_SHORT_NOTIONAL_BTC/CURRENT_SHORT_TOTAL_MARGIN_BTC},
         'long_leverage_margin_matrix':long_margin_matrix(),
         'previous_v4':{'train_total_btc':1.01863,'validation_total_btc':0.98438,'continuous_total_btc':1.03912}}
    Path('bull-compound-hedge-v4-1.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
    def pct(x):return f"{x:+.2f}%"
    lines=['# MERIDIAN Bull Compound v0.4.1 — activation + leverage safety','',
           '> Research-only. Core BTC is never sold. Short notional and effective leverage are separated.','',
           '## Locked rule selected on 2020–2022 only',
           f'- Breakout {bp.breakout_days}d; Fib {bp.fibs}; RSI14 ≥ {bp.rsi_min}; Close/EMA200 ≥ {bp.ema_ratio_min:.2f}',
           f'- Confirmation: **{bp.confirmation}** (max 5 days after Fib/overextension trigger)',
           f'- Hedge size: **{bp.hedge_fraction*100:.0f}%** of BTC-equivalent notional',
           f"- TPs: {', '.join(f'-{d*100:.0f}%' for d in bp.tp_drawdowns)}; stop +{bp.stop_up*100:.0f}%; runner 20%",'',
           '## Results','| Period | BTC end | vs HODL | Trades | Profitable | Stops | Max DD strategy | Max DD HODL |','|---|---:|---:|---:|---:|---:|---:|---:|']
    for label,r in [('TRAIN 2020–2022',tr),('OOS 2023–2025',va),('Continuous 2020–2025',co)]:
        lines.append(f"| {label} | {r['total_btc']:.5f} | {pct(r['relative_to_hodl_btc_pct'])} | {r['trades']} | {r['profitable_trades']} | {r['stops']} | {r['max_drawdown_pct']:.2f}% | {r['hodl_max_drawdown_pct']:.2f}% |")
    lines += ['',f"2021-11-10 bull checkpoint: **{tp['total_btc']:.5f} BTC** ({pct((tp['total_btc']-1)*100)} vs HODL).",
              f"Top-20 training models beating HODL OOS: **{sum(1 for x in top20 if x['validation_total_btc']>1)}/20**; median OOS **{statistics.median(x['validation_total_btc'] for x in top20):.5f} BTC**.",'',
              '## Short effective leverage safety','| Eff. leverage | Bankruptcy distance up | Margin for 0.20 BTC notional | Passes stop + 2% buffer |','|---:|---:|---:|:---:|']
    for x in lev:lines.append(f"| {x['effective_leverage']}× | +{x['bankruptcy_distance_up_pct']:.2f}% | {x['required_margin_btc_for_0.20_notional']:.5f} BTC | {'YES' if x['passes_safety_rule'] else 'NO'} |")
    lm=out['long_leverage_margin_matrix']
    lines += ['', '## Long nominal leverage at fixed 0.1968 BTC notional','| Long leverage | Required margin |','|---:|---:|']
    for x in lm['rows']:lines.append(f"| {x['nominal_long_leverage']}× | {x['margin_btc_for_fixed_0.1968_btc_notional']:.5f} BTC |")
    c=lm['current_observed_4x'];lines += ['',f"Observed current 4× Pionex grid: entry {c['entry']:.1f}, liq {c['liq']:.1f} = **{c['liq_buffer_down_pct']:.2f}% downside buffer**; grid floor {c['grid_floor']:.0f} = {c['floor_drawdown_pct']:.2f}% below entry. Exact 3×/5× grid liquidation is intentionally not fabricated; Pionex grid inventory/margin mechanics must be calibrated from the UI or a grid-specific engine."]
    Path('bull-compound-hedge-v4-1.md').write_text('\n'.join(lines)+'\n',encoding='utf-8');print('\n'.join(lines))

if __name__=='__main__':main()
