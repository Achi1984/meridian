#!/usr/bin/env python3
"""MERIDIAN Bull Compound v0.4.5 — funding + liquidation realism audit.

Research only. The BTC core is never sold. This keeps the v0.4.1 static 20%
COIN-M-style hedge trigger/TP/SL frozen and adds two realism layers:
1) historical BTCUSD_PERP COIN-M funding from Binance as a proxy for Pionex;
2) a Pionex-calibrated liquidation-distance approximation using the user's
   observed current short (entry/liquidation/effective margin).

Daily OHLC cannot reconstruct exact intraday ordering of every 8h funding event,
so funding is applied to the end-of-day remaining hedge notional. A conservative
variant charges negative funding on the day's starting notional and credits
positive funding only on the day's ending notional.
"""
from __future__ import annotations

import json, statistics, time, urllib.parse, urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import bull_compound_backtest as base
import bull_compound_backtest_v3 as ohlcmod

FEE=0.001
SLIP=0.0005
CORE_BTC=1.0
HEDGE_FRACTION=0.20
FIBS=(1.618,2.0,2.618)
RSI_MIN=62
EMA_RATIO_MIN=1.00
BREAKOUT_DAYS=60
TP_DD=(0.04,0.08,0.12)
TP_WEIGHTS=(0.25,0.30,0.25)
STOP_UP=0.12
RESET_DD=0.15

# Observed current Pionex short used only to calibrate an approximate maintenance haircut.
OBS_SHORT_ENTRY=75784.8
OBS_SHORT_LIQ=85007.9
OBS_SHORT_NOTIONAL_BTC=0.20
OBS_SHORT_TOTAL_MARGIN_BTC=0.02250

# Observed current Pionex 4x long grid snapshot.
OBS_LONG_ENTRY=75966.1
OBS_LONG_LIQ=46837.5
OBS_LONG_MARGIN_BTC=0.0492
OBS_LONG_NOTIONAL_BTC=0.1968
OBS_LONG_FLOOR=42600.0


def il(ds,x):
    for i,d in enumerate(ds):
        if d>=x:return i
    return len(ds)
def ir(ds,x):
    for i in range(len(ds)-1,-1,-1):
        if ds[i]<=x:return i
    return -1

def pnl_btc_short(face,entry,exit_): return face*(1/exit_-1/entry)
def fee_btc(face,px): return face*FEE/px

def fetch_coinm_funding(start='2020-05-12',end='2025-12-31'):
    """Fetch Binance COIN-M BTCUSD_PERP funding history via public DAPI."""
    def ms(d, endday=False):
        dt=datetime.fromisoformat(d).replace(tzinfo=timezone.utc)
        if endday: dt=dt.replace(hour=23,minute=59,second=59)
        return int(dt.timestamp()*1000)
    start_ms,end_ms=ms(start),ms(end,True)
    cur=start_ms; rows=[]
    while cur<=end_ms:
        q=urllib.parse.urlencode({'symbol':'BTCUSD_PERP','startTime':cur,'endTime':end_ms,'limit':1000})
        url='https://dapi.binance.com/dapi/v1/fundingRate?'+q
        req=urllib.request.Request(url,headers={'User-Agent':'MERIDIAN-RESEARCH/0.4.5'})
        with urllib.request.urlopen(req,timeout=30) as r:
            batch=json.loads(r.read().decode('utf-8'))
        if not isinstance(batch,list): raise RuntimeError(f'funding API response: {batch}')
        if not batch: break
        rows.extend(batch)
        nxt=int(batch[-1]['fundingTime'])+1
        if nxt<=cur: break
        cur=nxt
        if len(batch)<1000: break
        time.sleep(0.05)
    out=[]
    for x in rows:
        t=int(x['fundingTime']); rate=float(x['fundingRate']); mark=float(x.get('markPrice') or 0)
        d=datetime.fromtimestamp(t/1000,tz=timezone.utc).date().isoformat()
        if start<=d<=end: out.append({'time':t,'date':d,'rate':rate,'mark':mark})
    if len(out)<1000: raise RuntimeError(f'insufficient funding rows: {len(out)}')
    return out


def funding_by_day(rows):
    out={}
    for x in rows: out.setdefault(x['date'],[]).append(x)
    return out


def calibration():
    effL=OBS_SHORT_NOTIONAL_BTC/OBS_SHORT_TOTAL_MARGIN_BTC
    bank=1/(effL-1)
    obs=OBS_SHORT_LIQ/OBS_SHORT_ENTRY-1
    haircut=bank-obs
    return effL,bank,obs,haircut


def liq_distance_for_leverage(L,haircut):
    return max(0.0,1/(L-1)-haircut)


def close_face(pos,face,px,realized):
    face=min(face,pos['face_left'])
    if face<=0:return realized,0.0
    ex=px*(1+SLIP)
    net=pnl_btc_short(face,pos['entry'],ex)-fee_btc(face,ex)
    realized+=net;pos['face_left']-=face
    return realized,net


def mtm(pos,px):
    return 0.0 if not pos else pnl_btc_short(pos['face_left'],pos['entry'],px)


def sim(ds,op,hi,lo,cl,e200,r14,fday,start,end,effective_leverage=8.0,funding_mode='eod'):
    s,e=il(ds,start),ir(ds,end)
    _,_,_,haircut=calibration()
    liq_up=liq_distance_for_leverage(effective_leverage,haircut)
    realized=0.0; funding_total=0.0;pos=None;setup=None;pending=None;rearm=True
    trades=[];liq_events=0;peak=CORE_BTC*cl[s];maxdd=0;hp=cl[s];hdd=0;worst=CORE_BTC;max_margin=0

    for i in range(s,e+1):
        # Execute prior close signal at today's open.
        if pending is not None and pos is None:
            raw=op[i]; entry=raw*(1-SLIP); tb=CORE_BTC+realized
            face=HEDGE_FRACTION*max(tb,0)*raw
            if face>0:
                ef=fee_btc(face,entry);realized-=ef
                pos={'entry':entry,'face_total':face,'face_left':face,'start_face_day':face,
                     'tp':[entry*(1-d) for d in TP_DD],'done':[False]*3,
                     'stop':entry*(1+STOP_UP),'liq':entry*(1+liq_up),
                     'opened':ds[i],'rpnl':-ef,'funding':0.0}
            pending=None

        start_face=pos['face_left'] if pos else 0.0

        # Gap liquidation check first; otherwise stop precedes TPs on same daily bar.
        if pos is not None:
            if op[i]>=pos['liq']:
                ex=op[i]*(1+SLIP)
                realized,r=close_face(pos,pos['face_left'],ex,realized);pos['rpnl']+=r
                liq_events+=1;trades.append({'opened':pos['opened'],'closed':ds[i],'reason':'LIQ_GAP','pnl_btc':pos['rpnl'],'funding_btc':pos['funding']});pos=None
            elif hi[i]>=pos['liq'] and pos['stop']>=pos['liq']:
                realized,r=close_face(pos,pos['face_left'],pos['liq'],realized);pos['rpnl']+=r
                liq_events+=1;trades.append({'opened':pos['opened'],'closed':ds[i],'reason':'LIQ','pnl_btc':pos['rpnl'],'funding_btc':pos['funding']});pos=None
            elif hi[i]>=pos['stop']:
                # Gap-aware stop: if open is above stop but below liquidation, execute at open.
                sx=max(pos['stop'],op[i])
                realized,r=close_face(pos,pos['face_left'],sx,realized);pos['rpnl']+=r
                trades.append({'opened':pos['opened'],'closed':ds[i],'reason':'STOP','pnl_btc':pos['rpnl'],'funding_btc':pos['funding']});pos=None
            else:
                for k,(lvl,w) in enumerate(zip(pos['tp'],TP_WEIGHTS)):
                    if pos is None:break
                    if not pos['done'][k] and lo[i]<=lvl:
                        realized,r=close_face(pos,pos['face_total']*w,lvl,realized);pos['rpnl']+=r;pos['done'][k]=True

        # Funding proxy. Positive rate means shorts receive; negative means shorts pay.
        if pos is not None and ds[i] in fday:
            end_face=pos['face_left']
            for ev in fday[ds[i]]:
                px=ev['mark'] if ev['mark']>0 else cl[i]
                rate=ev['rate']
                if funding_mode=='conservative':
                    face=end_face if rate>=0 else max(start_face,end_face)
                else:
                    face=end_face
                fb=face/px*rate
                realized+=fb;funding_total+=fb;pos['rpnl']+=fb;pos['funding']+=fb

        # Reset after meaningful drawdown; close runner/remainder.
        if setup is not None:
            setup['peak']=max(setup['peak'],hi[i])
            if lo[i]<=setup['peak']*(1-RESET_DD):
                if pos is not None and pos['face_left']>0:
                    realized,r=close_face(pos,pos['face_left'],cl[i],realized);pos['rpnl']+=r
                    trades.append({'opened':pos['opened'],'closed':ds[i],'reason':'RESET_RUNNER','pnl_btc':pos['rpnl'],'funding_btc':pos['funding']});pos=None
                setup=None;pending=None;rearm=True

        # Frozen v0.4.1 structure/trigger.
        if rearm and setup is None and i>=s+max(BREAKOUT_DAYS,180):
            ph=max(cl[i-BREAKOUT_DAYS:i])
            if cl[i]>ph:
                l180=min(cl[i-180:i])
                if ph/l180>=1.20:
                    setup={'targets':{f:l180+f*(ph-l180) for f in FIBS},'triggered':set(),'peak':hi[i]};rearm=False
        if setup is not None and pos is None and pending is None and i<e:
            er=e200[i];rr=r14[i]
            if er and rr is not None and rr>=RSI_MIN and cl[i]/er>=EMA_RATIO_MIN:
                for f in FIBS:
                    if f not in setup['triggered'] and cl[i]>=setup['targets'][f]:
                        setup['triggered'].add(f);pending=f;break

        tb=CORE_BTC+realized+mtm(pos,cl[i]);worst=min(worst,tb)
        if pos is not None:
            max_margin=max(max_margin,(pos['face_left']/cl[i])/effective_leverage)
        eq=tb*cl[i];peak=max(peak,eq);maxdd=max(maxdd,(peak-eq)/peak if peak else 0)
        hp=max(hp,cl[i]);hdd=max(hdd,(hp-cl[i])/hp if hp else 0)

    if pos is not None and pos['face_left']>0:
        realized,r=close_face(pos,pos['face_left'],cl[e],realized);pos['rpnl']+=r
        trades.append({'opened':pos['opened'],'closed':ds[e],'reason':'END','pnl_btc':pos['rpnl'],'funding_btc':pos['funding']})
    total=CORE_BTC+realized
    return {'start':ds[s],'end':ds[e],'effective_short_leverage':effective_leverage,'funding_mode':funding_mode,
            'total_btc':total,'relative_to_hodl_btc_pct':(total-1)*100,'hedge_realized_btc':realized,
            'funding_btc':funding_total,'trades':len(trades),'profitable_trades':sum(t['pnl_btc']>0 for t in trades),
            'stops':sum(t['reason']=='STOP' for t in trades),'liquidations':liq_events,
            'max_drawdown_pct':maxdd*100,'hodl_max_drawdown_pct':hdd*100,'worst_total_btc':worst,
            'max_short_margin_btc':max_margin,'liq_distance_up_pct':liq_up*100,'stop_to_liq_buffer_pct':(liq_up-STOP_UP)*100,
            'trade_events':trades}


def long_snapshot_stress():
    # Calibrate a local inverse-position equivalent face from the observed live grid snapshot.
    # This is a snapshot sensitivity model only; grid inventory changes invalidate a static face assumption.
    face_eff=OBS_LONG_MARGIN_BTC/(1/OBS_LONG_LIQ-1/OBS_LONG_ENTRY)
    rows=[]
    for target in (OBS_LONG_FLOOR,41000,40000,38000,35000):
        req=face_eff*(1/target-1/OBS_LONG_ENTRY)
        rows.append({'target_liq':target,'estimated_total_margin_btc':req,'estimated_additional_margin_btc':max(0,req-OBS_LONG_MARGIN_BTC)})
    return {'calibrated_effective_face_usd':face_eff,'snapshot_only':True,'rows':rows}


def main():
    ds,op,hi,lo,cl=ohlcmod.fetch_ohlc();e200=base.ema(cl,200);r14=base.rsi(cl,14)
    funding=fetch_coinm_funding();fday=funding_by_day(funding)
    tr0,tr1='2020-05-12','2022-12-31';va0,va1='2023-01-01','2025-12-31'
    effL,bank,obs,haircut=calibration()
    tests=[]
    for L in (7.0,8.0,effL,9.0):
        for fm in ('eod','conservative'):
            tests.append({'train':sim(ds,op,hi,lo,cl,e200,r14,fday,tr0,tr1,L,fm),
                          'oos':sim(ds,op,hi,lo,cl,e200,r14,fday,va0,va1,L,fm),
                          'continuous':sim(ds,op,hi,lo,cl,e200,r14,fday,tr0,va1,L,fm)})
    out={'method':{'name':'MERIDIAN Bull Compound v0.4.5 Funding + Liquidation Realism Audit',
                   'funding_source':'Binance COIN-M BTCUSD_PERP funding as Pionex proxy','funding_events':len(funding),
                   'fees_bps':FEE*10000,'slippage_bps':SLIP*10000,'core_btc':CORE_BTC,'hedge_fraction':HEDGE_FRACTION},
         'pionex_short_calibration':{'observed_effective_leverage':effL,'theoretical_bankruptcy_up_pct':bank*100,
                                    'observed_liq_up_pct':obs*100,'calibrated_maintenance_haircut_pct_points':haircut*100},
         'tests':tests,'long_grid_snapshot_stress':long_snapshot_stress(),
         'baseline_without_funding_v4_1':{'train_btc':1.01863,'oos_btc':0.98438,'continuous_btc':1.03912}}
    Path('bull-compound-hedge-v4-5.json').write_text(json.dumps(out,indent=2),encoding='utf-8')

    lines=['# MERIDIAN Bull Compound v0.4.5 — funding + liquidation realism','',
           '> Static 20% hedge frozen. Historical Binance COIN-M funding is a proxy for Pionex; liquidation is calibrated from the observed current Pionex short.','',
           f"Funding events loaded: **{len(funding)}**. Current-short calibration: effective {effL:.2f}x, theoretical bankruptcy +{bank*100:.2f}%, observed liquidation +{obs*100:.2f}%, maintenance haircut ≈ {haircut*100:.2f} percentage points.",'',
           '## Continuous 2020–2025',
           '| Eff short leverage | Funding treatment | BTC end | vs HODL | Funding BTC | Liq buffer above +12% stop | Liquidations | Max DD |',
           '|---:|---|---:|---:|---:|---:|---:|---:|']
    for x in tests:
        r=x['continuous'];lines.append(f"| {r['effective_short_leverage']:.2f}x | {r['funding_mode']} | {r['total_btc']:.5f} | {r['relative_to_hodl_btc_pct']:+.2f}% | {r['funding_btc']:+.5f} | {r['stop_to_liq_buffer_pct']:+.2f} pp | {r['liquidations']} | {r['max_drawdown_pct']:.2f}% |")
    lines+=['','## OOS 2023–2025','| Eff short leverage | Funding treatment | BTC end | vs HODL | Funding BTC | Stops | Liq | Max DD |','|---:|---|---:|---:|---:|---:|---:|---:|']
    for x in tests:
        r=x['oos'];lines.append(f"| {r['effective_short_leverage']:.2f}x | {r['funding_mode']} | {r['total_btc']:.5f} | {r['relative_to_hodl_btc_pct']:+.2f}% | {r['funding_btc']:+.5f} | {r['stops']} | {r['liquidations']} | {r['max_drawdown_pct']:.2f}% |")
    ls=out['long_grid_snapshot_stress']
    lines+=['','## Current 4x long-grid snapshot sensitivity','This is a local calibration to the observed Pionex entry/liquidation only; it is not a full grid-liquidation formula.','| Target liquidation | Est. total margin | Est. additional margin vs 0.0492 BTC |','|---:|---:|---:|']
    for r in ls['rows']:lines.append(f"| ${r['target_liq']:,.0f} | {r['estimated_total_margin_btc']:.5f} BTC | {r['estimated_additional_margin_btc']:.5f} BTC |")
    Path('bull-compound-hedge-v4-5.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('\n'.join(lines))

if __name__=='__main__':main()
