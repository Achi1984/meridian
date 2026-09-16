#!/usr/bin/env python3
"""MERIDIAN Bull Compound v0.3 — OHLC validation using Binance Data Vision.

Research only. Parameters are selected exclusively on 2020-05-12..2022-12-31
and then locked for 2023-01-01..2025-12-31. Daily OHLC makes pre-placed reload
limit fills more realistic than the close-only v0.2 test.
"""
from __future__ import annotations
import csv, io, itertools, json, statistics, urllib.request, zipfile
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
import bull_compound_backtest as base

FEE=0.001
SLIP=0.0005
RESERVE_CAP=0.20
WEIGHTS=(0.30,0.35,0.35)

@dataclass(frozen=True)
class P:
    breakout_days:int
    fibs:tuple[float,float,float]
    rsi_min:int
    ema_ratio_min:float
    sell_fraction:float
    reload_drawdowns:tuple[float,float,float]
    reset_drawdown:float

@dataclass
class Order:
    target:float
    budget:float
    filled:bool=False


def fetch_ohlc():
    rows={}
    for y in range(2019,2026):
        for m in range(1,13):
            url=f"https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1d/BTCUSDT-1d-{y}-{m:02d}.zip"
            try:
                req=urllib.request.Request(url,headers={'User-Agent':'MERIDIAN-BULL-COMPOUND-OHLC/0.3'})
                with urllib.request.urlopen(req,timeout=30) as r: raw=r.read()
                with zipfile.ZipFile(io.BytesIO(raw)) as z:
                    name=z.namelist()[0]
                    text=z.read(name).decode('utf-8')
                for r in csv.reader(io.StringIO(text)):
                    if not r or not r[0].isdigit(): continue
                    ts=int(r[0]); ts=ts/1000 if ts<10**15 else ts/1_000_000
                    d=datetime.fromtimestamp(ts,tz=timezone.utc).date().isoformat()
                    rows[d]=(float(r[1]),float(r[2]),float(r[3]),float(r[4]))
            except Exception as e:
                print(f"WARN data {y}-{m:02d}: {e}")
    out=sorted((d,*v) for d,v in rows.items() if '2019-01-01'<=d<='2025-12-31')
    if len(out)<2400: raise RuntimeError(f"insufficient OHLC rows: {len(out)}")
    ds=[x[0] for x in out]; op=[x[1] for x in out]; hi=[x[2] for x in out]; lo=[x[3] for x in out]; cl=[x[4] for x in out]
    return ds,op,hi,lo,cl


def il(ds,x):
    for i,d in enumerate(ds):
        if d>=x:return i
    return len(ds)
def ir(ds,x):
    for i in range(len(ds)-1,-1,-1):
        if ds[i]<=x:return i
    return -1


def sim(ds,op,hi,lo,cl,e200,r14,p:P,start,end):
    s,e=il(ds,start),ir(ds,end)
    btc=1.0; cash=0.0; orders=[]; sales=[]; buys=[]; setup=None; pending=None; rearm=True
    eqpeak=cl[s]; maxdd=0.0; hp=cl[s]; hdd=0.0; minbtc=1.0; costs=0.0
    for i in range(s,e+1):
        px=cl[i]
        # prior close signal executes at today's open
        if pending is not None:
            fill=op[i]*(1-SLIP); eq=btc*op[i]+cash; room=max(0.0,RESERVE_CAP*eq-cash)
            qty=min(btc*p.sell_fraction,room/op[i] if op[i]>0 else 0.0)
            if qty>1e-10:
                gross=qty*fill; fee=gross*FEE; proceeds=gross-fee; btc-=qty; cash+=proceeds; minbtc=min(minbtc,btc); costs+=qty*op[i]*SLIP+fee
                for dd,w in zip(p.reload_drawdowns,WEIGHTS):orders.append(Order(fill*(1-dd),proceeds*w))
                sales.append({'date':ds[i],'open':round(op[i],2),'fib':pending,'btc_sold':round(qty,8),'proceeds':round(proceeds,2)})
            pending=None
        # pre-placed limit: intraday low reaching target fills it
        for o in orders:
            if o.filled or cash<=1e-9: continue
            if lo[i]<=o.target:
                budget=min(o.budget,cash); fill=o.target*(1+SLIP); fee=budget*FEE; q=(budget-fee)/fill
                btc+=q; cash-=budget; o.filled=True; costs+=budget*SLIP+fee
                buys.append({'date':ds[i],'low':round(lo[i],2),'limit':round(o.target,2),'btc_bought':round(q,8),'budget':round(budget,2)})
        eq=btc*px+cash; eqpeak=max(eqpeak,eq); maxdd=max(maxdd,(eqpeak-eq)/eqpeak)
        hp=max(hp,px); hdd=max(hdd,(hp-px)/hp)
        if setup is not None:
            setup['peak']=max(setup['peak'],hi[i])
            if lo[i]<=setup['peak']*(1-p.reset_drawdown): setup=None; rearm=True; pending=None
        n=p.breakout_days
        if rearm and setup is None and i>=s+max(n,180):
            prior_high=max(cl[i-n:i])
            if px>prior_high:
                low180=min(cl[i-180:i]); highref=prior_high
                if highref/low180>=1.20:
                    setup={'targets':{f:low180+f*(highref-low180) for f in p.fibs},'sold':set(),'peak':hi[i]}; rearm=False
        if setup is not None and pending is None and i<e:
            er=e200[i]; rr=r14[i]
            if er and rr is not None and rr>=p.rsi_min and px/er>=p.ema_ratio_min:
                for f in p.fibs:
                    if f not in setup['sold'] and px>=setup['targets'][f]: setup['sold'].add(f); pending=f; break
    ep=cl[e]; eq=btc*ep+cash; beq=eq/ep
    return {'start':ds[s],'end':ds[e],'start_price':cl[s],'end_price':ep,'btc':btc,'cash':cash,'equity':eq,'btc_equivalent':beq,'relative_to_hodl':beq-1,'max_drawdown_pct':maxdd*100,'hodl_max_drawdown_pct':hdd*100,'sells':len(sales),'reloads':len(buys),'end_cash_pct':cash/eq*100 if eq else 0,'min_btc':minbtc,'cost_drag_est_usd':costs,'sale_events':sales,'reload_events':buys}


def pd(p):
    d=asdict(p);d['fibs']=list(p.fibs);d['reload_drawdowns']=list(p.reload_drawdowns);return d


def main():
    ds,op,hi,lo,cl=fetch_ohlc(); e200=base.ema(cl,200); r14=base.rsi(cl,14)
    a,b='2020-05-12','2022-12-31'; top='2021-11-10'; c,d='2023-01-01','2025-12-31'
    grid=[P(*x) for x in itertools.product((60,90,120),((1.272,1.618,2.0),(1.618,2.0,2.618),(1.272,1.618,2.618)),(62,68,74),(1.00,1.10,1.20),(0.025,0.05,0.075),((0.05,0.10,0.15),(0.08,0.13,0.21),(0.10,0.15,0.20)),(0.15,0.20,0.25))]
    rows=[]
    for p in grid:
        tr=sim(ds,op,hi,lo,cl,e200,r14,p,a,b); tp=sim(ds,op,hi,lo,cl,e200,r14,p,a,top)
        if tr['sells']<1:continue
        score=tr['btc_equivalent']-2*max(0,0.95-tp['btc_equivalent'])-0.002*tr['end_cash_pct']
        rows.append((score,tr['btc_equivalent'],p,tr,tp))
    rows.sort(key=lambda x:(x[0],x[1]),reverse=True);_,_,bp,tr,tp=rows[0]
    va=sim(ds,op,hi,lo,cl,e200,r14,bp,c,d);co=sim(ds,op,hi,lo,cl,e200,r14,bp,a,d)
    top20=[]
    for rank,x in enumerate(rows[:20],1):
        vr=sim(ds,op,hi,lo,cl,e200,r14,x[2],c,d);top20.append({'rank':rank,'params':pd(x[2]),'train_btc_equivalent':x[3]['btc_equivalent'],'validation_btc_equivalent':vr['btc_equivalent'],'validation_sells':vr['sells'],'validation_reloads':vr['reloads']})
    beat=sum(x['validation_btc_equivalent']>1 for x in top20);med=statistics.median(x['validation_btc_equivalent'] for x in top20)
    out={'method':{'name':'MERIDIAN Bull Compound v0.3 OHLC','data':'Binance Data Vision BTCUSDT daily OHLC','train':[a,b],'validation':[c,d],'variants_tested':len(grid),'variants_with_trades':len(rows),'fee_bps':FEE*10000,'slippage_bps':SLIP*10000,'reserve_cap_pct':RESERVE_CAP*100,'execution':'sell next-day open; pre-placed reload fills if daily low <= limit'},'best_params_locked_from_train':pd(bp),'train_result':tr,'train_bull_checkpoint':tp,'validation_result':va,'continuous_result':co,'top20_train_robustness':{'validation_beat_hodl_count':beat,'count':len(top20),'median_validation_btc_equivalent':med,'rows':top20}}
    Path('bull-compound-result-v3.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
    def pct(x):return f"{x*100:+.2f}%"
    lines=['# MERIDIAN Bull Compound v0.3 — Binance OHLC walk-forward','', '> Research-only MERIDIAN interpretation; not third-party exact rules.','', '## Locked rule selected on 2020–2022 only',f'- Breakout: prior {bp.breakout_days}-day high; frozen trailing-180d Fib impulse',f"- Fibs: {', '.join(str(x) for x in bp.fibs)}",f'- RSI14 ≥ {bp.rsi_min}; Close/EMA200 ≥ {bp.ema_ratio_min:.2f}',f'- Sell {bp.sell_fraction*100:.1f}% BTC per Fib; reserve cap 20%',f"- Reload {', '.join(f'-{x*100:.0f}%' for x in bp.reload_drawdowns)} (30/35/35)",f'- Rearm after {bp.reset_drawdown*100:.0f}% drawdown',f'- Costs: {FEE*10000:.0f} bps fee + {SLIP*10000:.0f} bps slippage each side','', '## Results','| Period | BTC-eq | vs HODL | BTC held | Cash | Sells/reloads | Max DD strat | Max DD HODL |','|---|---:|---:|---:|---:|---:|---:|---:|']
    for label,r in [('TRAIN 2020-05-12→2022-12-31',tr),('OOS 2023→2025',va),('Continuous 2020→2025',co)]:lines.append(f"| {label} | {r['btc_equivalent']:.5f} | {pct(r['relative_to_hodl'])} | {r['btc']:.5f} | ${r['cash']:,.0f} | {r['sells']}/{r['reloads']} | {r['max_drawdown_pct']:.2f}% | {r['hodl_max_drawdown_pct']:.2f}% |")
    lines += ['',f"2021-11-10 bull checkpoint: {tp['btc_equivalent']:.5f} BTC-eq ({pct(tp['relative_to_hodl'])}).",f"Top-20 TRAIN models beating HODL OOS: **{beat}/{len(top20)}**; median OOS BTC-eq **{med:.5f}**."]
    Path('bull-compound-result-v3.md').write_text('\n'.join(lines)+'\n',encoding='utf-8');print('\n'.join(lines))
if __name__=='__main__':main()
