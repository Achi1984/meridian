#!/usr/bin/env python3
"""MERIDIAN Bull Compound v0.2 — no-lookahead walk-forward research.

This is a MERIDIAN interpretation of a bull-market partial-profit/reload idea,
not a claim about any third party's exact strategy.

The model freezes a Fibonacci projection when BTC breaks a prior N-day high
after a meaningful trailing impulse. Profits are partially sold at later Fib
extensions under RSI/EMA200 overextension gates; each sale immediately places
three lower reload limits. Selection is done only on 2020-2022. Parameters are
then locked and evaluated untouched on 2023-2025.
"""
from __future__ import annotations

import itertools
import json
import statistics
from dataclasses import dataclass, asdict
from pathlib import Path

import bull_compound_backtest as base

FEE = base.FEE
SLIPPAGE = base.SLIPPAGE
RESERVE_CAP = base.RESERVE_CAP
RELOAD_WEIGHTS = base.RELOAD_WEIGHTS


@dataclass(frozen=True)
class P:
    breakout_days: int
    fibs: tuple[float, float, float]
    rsi_min: int
    ema_ratio_min: float
    sell_fraction: float
    reload_drawdowns: tuple[float, float, float]
    reset_drawdown: float


@dataclass
class Order:
    target: float
    budget: float
    filled: bool = False


def idx_left(ds, x):
    for i, d in enumerate(ds):
        if d >= x: return i
    return len(ds)


def idx_right(ds, x):
    for i in range(len(ds)-1, -1, -1):
        if ds[i] <= x: return i
    return -1


def sim(ds, ps, e200, r14, p: P, start, end):
    s, e = idx_left(ds, start), idx_right(ds, end)
    btc, cash = 1.0, 0.0
    orders=[]; sales=[]; reloads=[]
    setup=None; pending=None; rearm=True
    strategy_peak=ps[s]; maxdd=0.0; hodl_peak=ps[s]; hodldd=0.0
    minbtc=1.0; costs=0.0; sale_usd=0.0; reload_usd=0.0

    for i in range(s, e+1):
        px=ps[i]

        # Execute yesterday's extension sell signal at today's close.
        if pending is not None:
            eq=btc*px+cash
            room=max(0.0, RESERVE_CAP*eq-cash)
            qty=min(btc*p.sell_fraction, room/px if px>0 else 0.0)
            if qty>1e-10:
                ex=px*(1-SLIPPAGE); gross=qty*ex; fee=gross*FEE; proceeds=gross-fee
                btc-=qty; cash+=proceeds; minbtc=min(minbtc,btc); sale_usd+=proceeds
                costs+=qty*px*SLIPPAGE+fee
                for dd,w in zip(p.reload_drawdowns,RELOAD_WEIGHTS):
                    orders.append(Order(ex*(1-dd),proceeds*w))
                sales.append({"date":ds[i],"close":round(px,2),"fib":pending,"btc_sold":round(qty,8),"proceeds":round(proceeds,2)})
            pending=None

        # Pre-placed limits. Using DAILY CLOSE <= limit is conservative vs intraday lows.
        for o in orders:
            if o.filled or cash<=1e-9: continue
            if px<=o.target:
                budget=min(o.budget,cash); ex=o.target*(1+SLIPPAGE); fee=budget*FEE
                q=(budget-fee)/ex; btc+=q; cash-=budget; o.filled=True; reload_usd+=budget
                costs+=budget*SLIPPAGE+fee
                reloads.append({"date":ds[i],"close":round(px,2),"limit":round(o.target,2),"btc_bought":round(q,8),"budget":round(budget,2)})

        eq=btc*px+cash; strategy_peak=max(strategy_peak,eq)
        maxdd=max(maxdd,(strategy_peak-eq)/strategy_peak if strategy_peak else 0)
        hodl_peak=max(hodl_peak,px); hodldd=max(hodldd,(hodl_peak-px)/hodl_peak if hodl_peak else 0)

        # Setup lifecycle. A >= reset drawdown arms a fresh structure.
        if setup is not None:
            setup["peak"]=max(setup["peak"],px)
            if px <= setup["peak"]*(1-p.reset_drawdown):
                setup=None; rearm=True; pending=None

        # Freeze a new impulse at a breakout of the PRIOR N-day high.
        n=p.breakout_days
        if rearm and setup is None and i>=s+max(n,180):
            prior_high=max(ps[i-n:i])
            if px>prior_high:
                look=ps[i-180:i]
                lo=min(look); hi=prior_high
                # Demand a real prior impulse, avoiding tiny-range pseudo setups.
                if hi/lo>=1.20:
                    targets={f: lo+f*(hi-lo) for f in p.fibs}
                    setup={"lo":lo,"hi":hi,"targets":targets,"sold":set(),"peak":px,"date":ds[i]}
                    rearm=False

        # Close-confirmed overextension -> sell next day.
        if setup is not None and pending is None and i<e:
            er=e200[i]; rr=r14[i]
            if er and rr is not None and rr>=p.rsi_min and px/er>=p.ema_ratio_min:
                for f in p.fibs:
                    if f not in setup["sold"] and px>=setup["targets"][f]:
                        setup["sold"].add(f); pending=f; break

    ep=ps[e]; eq=btc*ep+cash; beq=eq/ep
    return {
        "start":ds[s],"end":ds[e],"start_price":ps[s],"end_price":ep,
        "btc":btc,"cash":cash,"equity":eq,"btc_equivalent":beq,"relative_to_hodl":beq-1,
        "max_drawdown_pct":maxdd*100,"hodl_max_drawdown_pct":hodldd*100,
        "sells":len(sales),"reloads":len(reloads),"sale_usd":sale_usd,"reload_usd":reload_usd,
        "cost_drag_est_usd":costs,"end_cash_pct":cash/eq*100 if eq else 0,"min_btc":minbtc,
        "sale_events":sales,"reload_events":reloads,
    }


def pdict(p):
    d=asdict(p); d["fibs"]=list(p.fibs); d["reload_drawdowns"]=list(p.reload_drawdowns); return d


def main():
    ds,ps=base.load_prices(); e200=base.ema(ps,200); r14=base.rsi(ps,14)
    train0,train1="2020-05-12","2022-12-31"; topd="2021-11-10"; val0,val1="2023-01-01","2025-12-31"
    grid=[]
    for v in itertools.product(
        (60,90,120),
        ((1.272,1.618,2.0),(1.618,2.0,2.618),(1.272,1.618,2.618)),
        (62,68,74),
        (1.00,1.10,1.20),
        (0.025,0.05,0.075),
        ((0.05,0.10,0.15),(0.08,0.13,0.21),(0.10,0.15,0.20)),
        (0.15,0.20,0.25),
    ):
        grid.append(P(*v))

    rows=[]
    for p in grid:
        tr=sim(ds,ps,e200,r14,p,train0,train1); tp=sim(ds,ps,e200,r14,p,train0,topd)
        if tr["sells"]<1: continue
        # Training score only. Penalty prevents a model from looking good at the 2022 low
        # merely because it abandoned too much upside during the 2021 bull market.
        bull_shortfall=max(0.0,0.95-tp["btc_equivalent"])
        score=tr["btc_equivalent"]-2.0*bull_shortfall-0.002*tr["end_cash_pct"]
        rows.append((score,tr["btc_equivalent"],p,tr,tp))
    if not rows: raise RuntimeError("No trading variant found")
    rows.sort(key=lambda x:(x[0],x[1]),reverse=True)
    _,_,bp,tr,tp=rows[0]
    va=sim(ds,ps,e200,r14,bp,val0,val1); co=sim(ds,ps,e200,r14,bp,train0,val1)

    top20=[]
    for rank,x in enumerate(rows[:20],1):
        p=x[2]; vr=sim(ds,ps,e200,r14,p,val0,val1)
        top20.append({"rank":rank,"params":pdict(p),"train_btc_equivalent":x[3]["btc_equivalent"],"train_bull_checkpoint_btc_equivalent":x[4]["btc_equivalent"],"validation_btc_equivalent":vr["btc_equivalent"],"validation_sells":vr["sells"],"validation_reloads":vr["reloads"]})
    beat=sum(x["validation_btc_equivalent"]>1 for x in top20)
    med=statistics.median(x["validation_btc_equivalent"] for x in top20)

    out={
      "method":{"name":"MERIDIAN Bull Compound v0.2","claim":"MERIDIAN interpretation; not third-party exact rules","data":"CoinGecko BTC/USD daily close via viratsoft/btc-price-json","train":[train0,train1],"validation":[val0,val1],"variants_tested":len(grid),"variants_with_trades":len(rows),"fee_bps":FEE*10000,"slippage_bps":SLIPPAGE*10000,"reserve_cap_pct":RESERVE_CAP*100,"execution":"sell next daily close; reload counted only when daily close <= pre-placed limit"},
      "best_params_locked_from_train":pdict(bp),"train_result":tr,"train_bull_checkpoint":tp,"validation_result":va,"continuous_result":co,
      "top20_train_robustness":{"validation_beat_hodl_count":beat,"count":len(top20),"median_validation_btc_equivalent":med,"rows":top20}
    }
    Path("bull-compound-result.json").write_text(json.dumps(out,indent=2),encoding="utf-8")
    def pp(x):return f"{x*100:+.2f}%"
    lines=["# MERIDIAN Bull Compound v0.2 — walk-forward backtest","","> MERIDIAN research interpretation; not a claim about Bastian Keller's exact rules.","","## Locked rule selected on 2020–2022 only",f"- Breakout structure: prior {bp.breakout_days}-day high; Fib projection frozen from trailing 180-day impulse",f"- Fib targets: {', '.join(str(x) for x in bp.fibs)}",f"- Overextension: RSI14 ≥ {bp.rsi_min}, Close/EMA200 ≥ {bp.ema_ratio_min:.2f}",f"- Sell: {bp.sell_fraction*100:.1f}% of current BTC per Fib trigger; cash reserve cap {RESERVE_CAP*100:.0f}%",f"- Reload: {', '.join(f'-{x*100:.0f}%' for x in bp.reload_drawdowns)} using 30/35/35% of each sale",f"- Rearm after {bp.reset_drawdown*100:.0f}% drawdown from setup peak",f"- Costs: {FEE*10000:.0f} bps fee + {SLIPPAGE*10000:.0f} bps slippage per side","","## Results","| Period | End BTC-eq | vs 1 BTC HODL | BTC held | Cash | Sells/reloads | Max DD strat | Max DD HODL |","|---|---:|---:|---:|---:|---:|---:|---:|"]
    for label,r in [("TRAIN 2020-05-12→2022-12-31",tr),("OOS 2023→2025",va),("Continuous 2020→2025",co)]:
        lines.append(f"| {label} | {r['btc_equivalent']:.5f} | {pp(r['relative_to_hodl'])} | {r['btc']:.5f} | ${r['cash']:,.0f} | {r['sells']}/{r['reloads']} | {r['max_drawdown_pct']:.2f}% | {r['hodl_max_drawdown_pct']:.2f}% |")
    lines += ["",f"2021-11-10 bull checkpoint: {tp['btc_equivalent']:.5f} BTC-eq ({pp(tp['relative_to_hodl'])} vs HODL).",f"Top-20 TRAIN models beating HODL in untouched 2023–2025: **{beat}/{len(top20)}**; median OOS BTC-eq **{med:.5f}**.","","Close-only data is conservative for reloads: intraday limit touches that recovered before the daily close are ignored."]
    Path("bull-compound-result.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
    print("\n".join(lines))

if __name__=="__main__": main()
