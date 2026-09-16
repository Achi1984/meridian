#!/usr/bin/env python3
"""MERIDIAN Bull Compound v0.4 — 1 BTC core + inverse COIN-M hedge.

Research only. The 1 BTC core is never sold. A synthetic inverse COIN-M short
is opened only in bull-market overextension zones. Realized hedge PnL is kept
in BTC, so profitable hedges compound BTC directly. Losses reduce BTC-equivalent
wealth; there is no free cash account.

Signals are selected on 2020-2022 only and validated untouched on 2023-2025.
Daily OHLC is Binance Data Vision BTCUSDT. The hedge model uses inverse-futures
PnL: face_usd * (1/exit - 1/entry) for a short. Funding is excluded because a
clean historical funding series is not part of this test; fees and slippage are
included. If stop and TP are both touched in one day, the stop is assumed first
(conservative sequencing).
"""
from __future__ import annotations
import itertools, json, statistics
from dataclasses import dataclass, asdict
from pathlib import Path
import bull_compound_backtest as base
import bull_compound_backtest_v3 as ohlcmod

FEE = 0.001      # 10 bps each transaction
SLIP = 0.0005    # 5 bps adverse execution each transaction
CORE_BTC = 1.0
TP_WEIGHTS = (0.25, 0.30, 0.25)  # 20% runner remains after TP3


@dataclass(frozen=True)
class P:
    breakout_days: int
    fibs: tuple[float, float, float]
    rsi_min: int
    ema_ratio_min: float
    hedge_fraction: float
    tp_drawdowns: tuple[float, float, float]
    stop_up: float
    reset_drawdown: float


def il(ds, x):
    for i,d in enumerate(ds):
        if d >= x: return i
    return len(ds)

def ir(ds, x):
    for i in range(len(ds)-1,-1,-1):
        if ds[i] <= x: return i
    return -1


def pnl_btc_short(face_usd: float, entry: float, exit_: float) -> float:
    return face_usd * (1.0/exit_ - 1.0/entry)


def fee_btc(face_usd: float, px: float) -> float:
    return face_usd * FEE / px


def mtm_btc(pos, px: float) -> float:
    if not pos: return 0.0
    return pnl_btc_short(pos['face_left'], pos['entry'], px)


def close_face(pos, face: float, px: float, realized_btc: float):
    face = min(face, pos['face_left'])
    if face <= 0: return realized_btc, 0.0
    exit_px = px * (1.0 + SLIP)  # adverse for short buyback
    pnl = pnl_btc_short(face, pos['entry'], exit_px)
    fee = fee_btc(face, exit_px)
    realized_btc += pnl - fee
    pos['face_left'] -= face
    return realized_btc, pnl - fee


def sim(ds, op, hi, lo, cl, e200, r14, p:P, start, end):
    s,e = il(ds,start), ir(ds,end)
    realized = 0.0
    pos = None
    setup = None
    pending_open = None
    rearm = True
    trades=[]
    equity_peak = CORE_BTC * cl[s]
    maxdd = 0.0
    hodl_peak = cl[s]
    hodldd = 0.0
    worst_total_btc = CORE_BTC
    stopped=0; profitable=0

    for i in range(s,e+1):
        # Execute yesterday's signal at today's open.
        if pending_open is not None and pos is None:
            raw_entry = op[i]
            entry = raw_entry * (1.0 - SLIP)  # adverse: short sells slightly lower
            total_btc_before = CORE_BTC + realized
            if total_btc_before > 0:
                face = p.hedge_fraction * total_btc_before * raw_entry
                entry_fee = fee_btc(face, entry)
                realized -= entry_fee
                pos = {
                    'entry': entry,
                    'raw_entry': raw_entry,
                    'face_total': face,
                    'face_left': face,
                    'tp_levels': [entry*(1-d) for d in p.tp_drawdowns],
                    'tp_done': [False,False,False],
                    'stop': entry*(1+p.stop_up),
                    'opened': ds[i],
                    'trigger_fib': pending_open,
                    'realized_trade_btc': -entry_fee,
                }
            pending_open = None

        # Intraday exit logic. Conservative ordering: stop first if both stop and TP hit.
        if pos is not None:
            if hi[i] >= pos['stop']:
                realized, rp = close_face(pos, pos['face_left'], pos['stop'], realized)
                pos['realized_trade_btc'] += rp
                trades.append({'opened':pos['opened'],'closed':ds[i],'reason':'STOP','fib':pos['trigger_fib'],
                               'entry':round(pos['entry'],2),'exit':round(pos['stop'],2),'pnl_btc':pos['realized_trade_btc']})
                stopped += 1
                pos = None
            else:
                for k,(lvl,w) in enumerate(zip(pos['tp_levels'],TP_WEIGHTS)):
                    if pos is None: break
                    if not pos['tp_done'][k] and lo[i] <= lvl:
                        face = pos['face_total'] * w
                        realized, rp = close_face(pos, face, lvl, realized)
                        pos['realized_trade_btc'] += rp
                        pos['tp_done'][k] = True

        # Setup lifecycle: reset after meaningful drawdown from setup peak.
        if setup is not None:
            setup['peak'] = max(setup['peak'], hi[i])
            reset_hit = lo[i] <= setup['peak'] * (1-p.reset_drawdown)
            if reset_hit:
                # Close the 20% runner (or any remainder) at today's close.
                if pos is not None and pos['face_left'] > 0:
                    realized, rp = close_face(pos, pos['face_left'], cl[i], realized)
                    pos['realized_trade_btc'] += rp
                    trades.append({'opened':pos['opened'],'closed':ds[i],'reason':'RESET_RUNNER','fib':pos['trigger_fib'],
                                   'entry':round(pos['entry'],2),'exit':round(cl[i],2),'pnl_btc':pos['realized_trade_btc']})
                    if pos['realized_trade_btc'] > 0: profitable += 1
                    pos = None
                setup = None
                rearm = True
                pending_open = None

        # Freeze a new fib structure after a close breakout of the prior N-day high.
        n=p.breakout_days
        if rearm and setup is None and i >= s + max(n,180):
            prior_high = max(cl[i-n:i])
            if cl[i] > prior_high:
                low180 = min(cl[i-180:i])
                if prior_high/low180 >= 1.20:
                    setup = {
                        'targets': {f:low180 + f*(prior_high-low180) for f in p.fibs},
                        'triggered': set(),
                        'peak': hi[i],
                    }
                    rearm = False

        # Signal after daily close, open at next day's open. Only one hedge at a time.
        if setup is not None and pos is None and pending_open is None and i < e:
            er=e200[i]; rr=r14[i]
            if er and rr is not None and rr >= p.rsi_min and cl[i]/er >= p.ema_ratio_min:
                for f in p.fibs:
                    if f not in setup['triggered'] and cl[i] >= setup['targets'][f]:
                        setup['triggered'].add(f)
                        pending_open = f
                        break

        # Mark-to-market wealth in USD.
        total_btc = CORE_BTC + realized + mtm_btc(pos, cl[i])
        worst_total_btc = min(worst_total_btc, total_btc)
        eq = total_btc * cl[i]
        equity_peak = max(equity_peak, eq)
        maxdd = max(maxdd, (equity_peak-eq)/equity_peak if equity_peak>0 else 0)
        hodl_peak = max(hodl_peak, cl[i])
        hodldd = max(hodldd, (hodl_peak-cl[i])/hodl_peak if hodl_peak>0 else 0)

    # Close remaining hedge at final close so endpoint is fully realized.
    if pos is not None and pos['face_left'] > 0:
        realized, rp = close_face(pos, pos['face_left'], cl[e], realized)
        pos['realized_trade_btc'] += rp
        trades.append({'opened':pos['opened'],'closed':ds[e],'reason':'END','fib':pos['trigger_fib'],
                       'entry':round(pos['entry'],2),'exit':round(cl[e],2),'pnl_btc':pos['realized_trade_btc']})
        if pos['realized_trade_btc'] > 0: profitable += 1
        pos=None

    total_btc = CORE_BTC + realized
    for t in trades:
        if t['reason']=='STOP' and t['pnl_btc']>0: profitable += 1
        elif t['reason'] not in ('STOP',) and t['pnl_btc']>0: pass
    # Count profitable trades directly for clean reporting.
    profitable = sum(1 for t in trades if t['pnl_btc'] > 0)
    return {
        'start':ds[s],'end':ds[e],'start_price':cl[s],'end_price':cl[e],
        'core_btc':CORE_BTC,'hedge_realized_btc':realized,'total_btc':total_btc,
        'relative_to_hodl_btc_pct':(total_btc-1.0)*100.0,
        'end_equity_usd':total_btc*cl[e],
        'max_drawdown_pct':maxdd*100.0,'hodl_max_drawdown_pct':hodldd*100.0,
        'trades':len(trades),'profitable_trades':profitable,'stops':stopped,
        'worst_total_btc':worst_total_btc,'trade_events':trades,
    }


def pd(p):
    d=asdict(p); d['fibs']=list(p.fibs); d['tp_drawdowns']=list(p.tp_drawdowns); return d


def main():
    ds,op,hi,lo,cl = ohlcmod.fetch_ohlc()
    e200=base.ema(cl,200); r14=base.rsi(cl,14)
    train0,train1='2020-05-12','2022-12-31'; topd='2021-11-10'; val0,val1='2023-01-01','2025-12-31'

    grid=[P(*x) for x in itertools.product(
        (60,90,120),
        ((1.272,1.618,2.0),(1.618,2.0,2.618),(1.272,1.618,2.618)),
        (62,68,74),
        (1.00,1.10,1.20),
        (0.05,0.10,0.15,0.20),
        ((0.04,0.08,0.12),(0.05,0.10,0.15),(0.08,0.13,0.21)),
        (0.08,0.12,0.16),
        (0.15,0.20),
    )]

    rows=[]
    for p in grid:
        tr=sim(ds,op,hi,lo,cl,e200,r14,p,train0,train1)
        tp=sim(ds,op,hi,lo,cl,e200,r14,p,train0,topd)
        if tr['trades'] < 2: continue
        # Training only: seek BTC growth but heavily penalize excessive bull-market drag.
        bull_short=max(0.0, 0.97-tp['total_btc'])
        ruin_pen=max(0.0, 0.90-tr['worst_total_btc'])
        score=tr['total_btc'] - 2.0*bull_short - 4.0*ruin_pen
        rows.append((score,tr['total_btc'],p,tr,tp))
    if not rows: raise RuntimeError('no hedge variants traded')
    rows.sort(key=lambda x:(x[0],x[1]),reverse=True)
    _,_,bp,tr,tp=rows[0]
    va=sim(ds,op,hi,lo,cl,e200,r14,bp,val0,val1)
    co=sim(ds,op,hi,lo,cl,e200,r14,bp,train0,val1)

    top20=[]
    for rank,x in enumerate(rows[:20],1):
        vr=sim(ds,op,hi,lo,cl,e200,r14,x[2],val0,val1)
        top20.append({'rank':rank,'params':pd(x[2]),'train_total_btc':x[3]['total_btc'],
                      'train_bull_checkpoint_total_btc':x[4]['total_btc'],
                      'validation_total_btc':vr['total_btc'],'validation_trades':vr['trades']})
    beat=sum(x['validation_total_btc']>1 for x in top20)
    med=statistics.median(x['validation_total_btc'] for x in top20)

    previous_v3={'train_btc_equivalent':1.04139,'validation_btc_equivalent':0.96801,'continuous_btc_equivalent':0.97003}
    out={
      'method':{
        'name':'MERIDIAN Bull Compound v0.4 Core + Inverse Hedge',
        'data':'Binance Data Vision BTCUSDT daily OHLC',
        'train':[train0,train1],'validation':[val0,val1],
        'variants_tested':len(grid),'variants_with_trades':len(rows),
        'core_btc_never_sold':CORE_BTC,'inverse_short_pnl_formula':'face_usd * (1/exit - 1/entry)',
        'fee_bps':FEE*10000,'slippage_bps':SLIP*10000,
        'funding':'excluded','intraday_conflict':'stop assumed before TP',
        'tp_weights_pct':[25,30,25],'runner_pct':20,
      },
      'best_params_locked_from_train':pd(bp),
      'train_result':tr,'train_bull_checkpoint':tp,'validation_result':va,'continuous_result':co,
      'top20_train_robustness':{'validation_beat_hodl_count':beat,'count':len(top20),'median_validation_total_btc':med,'rows':top20},
      'previous_sell_reload_v3':previous_v3,
    }
    Path('bull-compound-hedge-v4.json').write_text(json.dumps(out,indent=2),encoding='utf-8')

    def pp(x): return f"{x:+.2f}%"
    lines=['# MERIDIAN Bull Compound v0.4 — 1 BTC Core + inverse COIN-M hedge','',
           '> Research-only. The 1 BTC core is never sold. Hedge PnL is modeled in BTC; funding is excluded.','',
           '## Locked rule selected on 2020–2022 only',
           f'- Breakout structure: prior {bp.breakout_days}-day high; trailing 180-day Fib impulse',
           f"- Fib triggers: {', '.join(str(x) for x in bp.fibs)}",
           f'- Overextension: RSI14 ≥ {bp.rsi_min}; Close/EMA200 ≥ {bp.ema_ratio_min:.2f}',
           f'- Hedge notional: {bp.hedge_fraction*100:.0f}% of BTC-equivalent at entry',
           f"- TP drawdowns: {', '.join(f'-{x*100:.0f}%' for x in bp.tp_drawdowns)} closing 25%/30%/25%; 20% runner",
           f'- Stop: +{bp.stop_up*100:.0f}% above hedge entry; rearm after {bp.reset_drawdown*100:.0f}% drawdown',
           f'- Costs: {FEE*10000:.0f} bps fee + {SLIP*10000:.0f} bps slippage per transaction','',
           '## Results','| Period | Total BTC end | vs 1 BTC HODL | Hedge PnL BTC | Trades | Profitable | Stops | Max DD strategy | Max DD HODL |',
           '|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    for label,r in [('TRAIN 2020-05-12→2022-12-31',tr),('OOS 2023→2025',va),('Continuous 2020→2025',co)]:
        lines.append(f"| {label} | {r['total_btc']:.5f} | {pp(r['relative_to_hodl_btc_pct'])} | {r['hedge_realized_btc']:+.5f} | {r['trades']} | {r['profitable_trades']} | {r['stops']} | {r['max_drawdown_pct']:.2f}% | {r['hodl_max_drawdown_pct']:.2f}% |")
    lines += ['',f"2021-11-10 bull checkpoint: **{tp['total_btc']:.5f} BTC** ({pp(tp['relative_to_hodl_btc_pct'])} vs HODL).",
              f"Top-20 TRAIN models beating HODL OOS: **{beat}/{len(top20)}**; median OOS total BTC **{med:.5f}**.",'',
              '## Comparison to v0.3 Sell-&-Reload','| Model | OOS 2023–2025 | Continuous 2020–2025 |','|---|---:|---:|',
              f"| Sell-&-Reload v0.3 | {previous_v3['validation_btc_equivalent']:.5f} BTC-eq | {previous_v3['continuous_btc_equivalent']:.5f} BTC-eq |",
              f"| Core + Hedge v0.4 | {va['total_btc']:.5f} BTC | {co['total_btc']:.5f} BTC |",'',
              'Because the core BTC is never sold, the hedge cannot miss the upside through an unfilled cash reload. Its failure mode is different: repeated stopped shorts can consume BTC. Funding is not included and must be stress-tested separately before any live use.']
    Path('bull-compound-hedge-v4.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('\n'.join(lines))

if __name__=='__main__': main()
