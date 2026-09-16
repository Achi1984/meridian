#!/usr/bin/env python3
"""MERIDIAN Bull Compound v0.4.4 — regime-gated 20% inverse hedge.

Research only. The 1 BTC core is never sold. The base hedge trigger, size and
TP/SL logic are frozen from v0.4.1. This test changes only *whether* a base
trigger is allowed to open a hedge, using higher-timeframe bull-regime and
momentum-loss gates. This keeps the research question narrow and reduces
parameter freedom.

Training/selection: 2020-05-12..2022-12-31 only.
Untouched OOS validation: 2023-01-01..2025-12-31.
Daily OHLC: Binance Data Vision BTCUSDT. Completed-week metrics use only fully
closed prior weeks. Funding excluded; 10 bps fee + 5 bps adverse slippage per
transaction. If stop and TP are both touched on one daily bar, stop is assumed
first (conservative).
"""
from __future__ import annotations

import json
import statistics
from dataclasses import dataclass, asdict
from datetime import date
from pathlib import Path

import bull_compound_backtest as base
import bull_compound_backtest_v3 as ohlcmod

FEE = 0.001
SLIP = 0.0005
CORE_BTC = 1.0
HEDGE_FRACTION = 0.20
FIBS = (1.618, 2.0, 2.618)
RSI_MIN = 62
EMA_RATIO_MIN = 1.00
BREAKOUT_DAYS = 60
TP_DD = (0.04, 0.08, 0.12)
TP_WEIGHTS = (0.25, 0.30, 0.25)  # 20% runner remains
STOP_UP = 0.12
RESET_DD = 0.15
EFFECTIVE_SHORT_LEVERAGE = 8.0
CANDIDATE_DAYS = 14


@dataclass(frozen=True)
class Gate:
    name: str
    require_bull_regime: bool
    momentum_mode: str


def il(ds, x):
    for i, d in enumerate(ds):
        if d >= x:
            return i
    return len(ds)


def ir(ds, x):
    for i in range(len(ds) - 1, -1, -1):
        if ds[i] <= x:
            return i
    return -1


def pnl_btc_short(face, entry, exit_):
    return face * (1.0 / exit_ - 1.0 / entry)


def fee_btc(face, px):
    return face * FEE / px


def mtm_btc(pos, px):
    if not pos:
        return 0.0
    return pnl_btc_short(pos['face_left'], pos['entry'], px)


def close_face(pos, face, px, realized):
    face = min(face, pos['face_left'])
    if face <= 0:
        return realized, 0.0
    ex = px * (1.0 + SLIP)
    net = pnl_btc_short(face, pos['entry'], ex) - fee_btc(face, ex)
    realized += net
    pos['face_left'] -= face
    return realized, net


def weekly_features(ds, cl):
    """Forward-fill features from the most recently *completed* ISO week."""
    # Build weekly closes in chronological order.
    weeks = []
    week_to_last = {}
    for i, d in enumerate(ds):
        dd = date.fromisoformat(d)
        key = (dd.isocalendar().year, dd.isocalendar().week)
        if not weeks or weeks[-1] != key:
            weeks.append(key)
        week_to_last[key] = i

    wcl = [cl[week_to_last[w]] for w in weeks]
    wema10 = base.ema(wcl, 10)
    wema30 = base.ema(wcl, 30)
    wrsi14 = base.rsi(wcl, 14)
    wpos = {w: k for k, w in enumerate(weeks)}

    out = []
    for i, d in enumerate(ds):
        dd = date.fromisoformat(d)
        key = (dd.isocalendar().year, dd.isocalendar().week)
        k = wpos[key] - 1  # previous completed week only
        if k < 0:
            out.append(None)
            continue
        prev_k = k - 1
        out.append({
            'close': wcl[k],
            'prev_close': wcl[prev_k] if prev_k >= 0 else None,
            'ema10': wema10[k],
            'ema30': wema30[k],
            'rsi14': wrsi14[k],
            'prev_rsi14': wrsi14[prev_k] if prev_k >= 0 else None,
        })
    return out


def regime_and_momentum_ok(g: Gate, i, cl, e10, e50, e200, r14, wf):
    w = wf[i]
    if g.require_bull_regime:
        bull_daily = e50[i] is not None and e200[i] is not None and e50[i] > e200[i]
        bull_weekly = bool(w and w['ema10'] is not None and w['ema30'] is not None and w['ema10'] > w['ema30'])
        if not (bull_daily and bull_weekly):
            return False

    mode = g.momentum_mode
    if mode == 'none':
        return True
    if i < 5:
        return False

    daily_rsi_roll = (
        r14[i] is not None and r14[i - 3] is not None and
        r14[i] < r14[i - 3] and cl[i] < cl[i - 3]
    )
    daily_ema10_loss = e10[i] is not None and cl[i] < e10[i]
    daily_mom5_neg = cl[i] < cl[i - 5]
    weekly_down = bool(w and w['prev_close'] is not None and w['close'] < w['prev_close'])
    weekly_rsi_roll = bool(
        w and w['rsi14'] is not None and w['prev_rsi14'] is not None and
        w['rsi14'] < w['prev_rsi14']
    )

    if mode == 'daily_rsi_roll':
        return daily_rsi_roll
    if mode == 'daily_ema10_loss':
        return daily_ema10_loss
    if mode == 'daily_mom5_neg':
        return daily_mom5_neg
    if mode == 'weekly_down':
        return weekly_down
    if mode == 'weekly_rsi_roll':
        return weekly_rsi_roll
    if mode == 'daily_rsi_and_weekly_any':
        return daily_rsi_roll and (weekly_down or weekly_rsi_roll)
    if mode == 'daily_ema10_and_weekly_any':
        return daily_ema10_loss and (weekly_down or weekly_rsi_roll)
    if mode == 'daily_any_and_weekly_any':
        return (daily_rsi_roll or daily_ema10_loss or daily_mom5_neg) and (weekly_down or weekly_rsi_roll)
    return False


def sim(ds, op, hi, lo, cl, e10, e50, e200, r14, wf, g: Gate, start, end):
    s, e = il(ds, start), ir(ds, end)
    realized = 0.0
    pos = None
    setup = None
    candidate = None
    pending_open = None
    rearm = True
    trades = []
    rejected = 0
    expired = 0
    equity_peak = CORE_BTC * cl[s]
    maxdd = 0.0
    hodl_peak = cl[s]
    hodldd = 0.0
    worst_total = CORE_BTC
    max_short_margin = 0.0

    for i in range(s, e + 1):
        # Execute previous close signal at next open.
        if pending_open is not None and pos is None:
            raw = op[i]
            entry = raw * (1.0 - SLIP)
            total_before = CORE_BTC + realized
            face = HEDGE_FRACTION * max(total_before, 0.0) * raw
            if face > 0:
                entry_fee = fee_btc(face, entry)
                realized -= entry_fee
                pos = {
                    'entry': entry,
                    'face_total': face,
                    'face_left': face,
                    'tp': [entry * (1 - d) for d in TP_DD],
                    'tp_done': [False, False, False],
                    'stop': entry * (1 + STOP_UP),
                    'opened': ds[i],
                    'fib': pending_open,
                    'rpnl': -entry_fee,
                }
            pending_open = None

        # Stop first if stop and TP occur on the same daily bar.
        if pos is not None:
            if hi[i] >= pos['stop']:
                realized, r = close_face(pos, pos['face_left'], pos['stop'], realized)
                pos['rpnl'] += r
                trades.append({'opened': pos['opened'], 'closed': ds[i], 'reason': 'STOP',
                               'entry': pos['entry'], 'exit': pos['stop'], 'pnl_btc': pos['rpnl']})
                pos = None
            else:
                for k, (lvl, wgt) in enumerate(zip(pos['tp'], TP_WEIGHTS)):
                    if pos is None:
                        break
                    if not pos['tp_done'][k] and lo[i] <= lvl:
                        q = pos['face_total'] * wgt
                        realized, r = close_face(pos, q, lvl, realized)
                        pos['rpnl'] += r
                        pos['tp_done'][k] = True

        # Reset after meaningful drawdown; close runner/remainder.
        if setup is not None:
            setup['peak'] = max(setup['peak'], hi[i])
            if lo[i] <= setup['peak'] * (1 - RESET_DD):
                if pos is not None and pos['face_left'] > 0:
                    realized, r = close_face(pos, pos['face_left'], cl[i], realized)
                    pos['rpnl'] += r
                    trades.append({'opened': pos['opened'], 'closed': ds[i], 'reason': 'RESET_RUNNER',
                                   'entry': pos['entry'], 'exit': cl[i], 'pnl_btc': pos['rpnl']})
                    pos = None
                setup = None
                candidate = None
                pending_open = None
                rearm = True

        # Freeze new Fib structure after prior 60-day breakout.
        if rearm and setup is None and i >= s + max(BREAKOUT_DAYS, 180):
            prior_high = max(cl[i - BREAKOUT_DAYS:i])
            if cl[i] > prior_high:
                low180 = min(cl[i - 180:i])
                if prior_high / low180 >= 1.20:
                    setup = {
                        'targets': {f: low180 + f * (prior_high - low180) for f in FIBS},
                        'triggered': set(),
                        'peak': hi[i],
                    }
                    rearm = False

        # Existing candidate waits for gate confirmation, using information available at close.
        if candidate is not None and pos is None and pending_open is None:
            if i > candidate['expires']:
                expired += 1
                candidate = None
            elif regime_and_momentum_ok(g, i, cl, e10, e50, e200, r14, wf):
                setup['triggered'].add(candidate['fib'])
                pending_open = candidate['fib']
                candidate = None

        # Base Fib/overextension trigger is frozen from v0.4.1.
        if setup is not None and pos is None and pending_open is None and candidate is None and i < e:
            er = e200[i]
            rr = r14[i]
            if er and rr is not None and rr >= RSI_MIN and cl[i] / er >= EMA_RATIO_MIN:
                for f in FIBS:
                    if f not in setup['triggered'] and cl[i] >= setup['targets'][f]:
                        if g.name == 'baseline_none':
                            setup['triggered'].add(f)
                            pending_open = f
                        else:
                            # If regime already invalid, reject immediately; otherwise wait for momentum loss.
                            if g.require_bull_regime and not regime_and_momentum_ok(
                                Gate('regime_probe', True, 'none'), i, cl, e10, e50, e200, r14, wf
                            ):
                                setup['triggered'].add(f)
                                rejected += 1
                            else:
                                candidate = {'fib': f, 'expires': min(e, i + CANDIDATE_DAYS)}
                        break

        total_btc = CORE_BTC + realized + mtm_btc(pos, cl[i])
        worst_total = min(worst_total, total_btc)
        if pos is not None:
            notional_btc = pos['face_left'] / cl[i]
            max_short_margin = max(max_short_margin, notional_btc / EFFECTIVE_SHORT_LEVERAGE)
        eq = total_btc * cl[i]
        equity_peak = max(equity_peak, eq)
        maxdd = max(maxdd, (equity_peak - eq) / equity_peak if equity_peak else 0.0)
        hodl_peak = max(hodl_peak, cl[i])
        hodldd = max(hodldd, (hodl_peak - cl[i]) / hodl_peak if hodl_peak else 0.0)

    if pos is not None and pos['face_left'] > 0:
        realized, r = close_face(pos, pos['face_left'], cl[e], realized)
        pos['rpnl'] += r
        trades.append({'opened': pos['opened'], 'closed': ds[e], 'reason': 'END',
                       'entry': pos['entry'], 'exit': cl[e], 'pnl_btc': pos['rpnl']})

    total = CORE_BTC + realized
    return {
        'start': ds[s], 'end': ds[e], 'total_btc': total,
        'relative_to_hodl_btc_pct': (total - 1.0) * 100.0,
        'hedge_realized_btc': realized, 'trades': len(trades),
        'profitable_trades': sum(1 for t in trades if t['pnl_btc'] > 0),
        'stops': sum(1 for t in trades if t['reason'] == 'STOP'),
        'rejected_base_triggers': rejected, 'expired_candidates': expired,
        'max_drawdown_pct': maxdd * 100.0, 'hodl_max_drawdown_pct': hodldd * 100.0,
        'worst_total_btc': worst_total, 'max_short_margin_btc_at_8x': max_short_margin,
        'trade_events': trades,
    }


def main():
    ds, op, hi, lo, cl = ohlcmod.fetch_ohlc()
    e10 = base.ema(cl, 10)
    e50 = base.ema(cl, 50)
    e200 = base.ema(cl, 200)
    r14 = base.rsi(cl, 14)
    wf = weekly_features(ds, cl)

    tr0, tr1 = '2020-05-12', '2022-12-31'
    topd = '2021-11-10'
    va0, va1 = '2023-01-01', '2025-12-31'

    gates = [
        Gate('baseline_none', False, 'none'),
        Gate('bull_only', True, 'none'),
        Gate('bull_daily_rsi_roll', True, 'daily_rsi_roll'),
        Gate('bull_daily_ema10_loss', True, 'daily_ema10_loss'),
        Gate('bull_daily_mom5_neg', True, 'daily_mom5_neg'),
        Gate('bull_weekly_down', True, 'weekly_down'),
        Gate('bull_weekly_rsi_roll', True, 'weekly_rsi_roll'),
        Gate('bull_daily_rsi_and_weekly_any', True, 'daily_rsi_and_weekly_any'),
        Gate('bull_daily_ema10_and_weekly_any', True, 'daily_ema10_and_weekly_any'),
        Gate('bull_daily_any_and_weekly_any', True, 'daily_any_and_weekly_any'),
    ]

    rows = []
    for g in gates:
        tr = sim(ds, op, hi, lo, cl, e10, e50, e200, r14, wf, g, tr0, tr1)
        tp = sim(ds, op, hi, lo, cl, e10, e50, e200, r14, wf, g, tr0, topd)
        if tr['trades'] < 2:
            continue
        # Training-only selection: favor BTC growth, preserve bull participation, penalize stop churn.
        bull_short = max(0.0, 0.985 - tp['total_btc'])
        ruin = max(0.0, 0.92 - tr['worst_total_btc'])
        churn = 0.0010 * tr['stops']
        score = tr['total_btc'] - 2.0 * bull_short - 4.0 * ruin - churn
        rows.append((score, tr['total_btc'], g, tr, tp))

    rows.sort(key=lambda x: (x[0], x[1]), reverse=True)
    if not rows:
        raise RuntimeError('No gate policy traded enough times')

    _, _, best, train, train_top = rows[0]
    valid = sim(ds, op, hi, lo, cl, e10, e50, e200, r14, wf, best, va0, va1)
    continuous = sim(ds, op, hi, lo, cl, e10, e50, e200, r14, wf, best, tr0, va1)

    policy_table = []
    for rank, (_, _, g, tr, tp) in enumerate(rows, 1):
        vr = sim(ds, op, hi, lo, cl, e10, e50, e200, r14, wf, g, va0, va1)
        policy_table.append({
            'rank_train': rank, 'gate': asdict(g),
            'train_total_btc': tr['total_btc'], 'train_stops': tr['stops'],
            'train_bull_checkpoint_btc': tp['total_btc'],
            'oos_total_btc': vr['total_btc'], 'oos_stops': vr['stops'],
            'oos_trades': vr['trades'], 'oos_max_drawdown_pct': vr['max_drawdown_pct'],
        })

    baseline = next(x for x in policy_table if x['gate']['name'] == 'baseline_none')
    out = {
        'method': {
            'name': 'MERIDIAN Bull Compound v0.4.4 Regime Gate',
            'data': 'Binance Data Vision BTCUSDT daily OHLC',
            'train': [tr0, tr1], 'validation': [va0, va1],
            'base_trigger': 'frozen v0.4.1 Fib/RSI/EMA trigger',
            'hedge_fraction': HEDGE_FRACTION,
            'effective_short_leverage_diagnostic': EFFECTIVE_SHORT_LEVERAGE,
            'candidate_window_days': CANDIDATE_DAYS,
            'fees_bps': FEE * 10000, 'slippage_bps': SLIP * 10000,
            'funding': 'excluded',
            'weekly_metrics': 'previous fully completed ISO week only',
        },
        'best_gate_locked_from_train': asdict(best),
        'train_result': train,
        'train_bull_checkpoint': train_top,
        'validation_result': valid,
        'continuous_result': continuous,
        'baseline_static20_v4_1_like': baseline,
        'policy_table': policy_table,
        'robustness': {
            'gated_policies_beating_hodl_oos': sum(1 for x in policy_table if x['gate']['name'] != 'baseline_none' and x['oos_total_btc'] > 1.0),
            'gated_policy_count': sum(1 for x in policy_table if x['gate']['name'] != 'baseline_none'),
            'median_gated_oos_btc': statistics.median(x['oos_total_btc'] for x in policy_table if x['gate']['name'] != 'baseline_none'),
        },
    }
    Path('bull-compound-hedge-v4-4.json').write_text(json.dumps(out, indent=2), encoding='utf-8')

    def pct(x):
        return f"{x:+.2f}%"

    lines = [
        '# MERIDIAN Bull Compound v0.4.4 — regime-gated hedge', '',
        '> Core BTC never sold. Base Fib/RSI/EMA trigger and static 20% hedge are frozen; only ON/OFF regime gating is tested.', '',
        '## Training-selected gate',
        f'- Gate: **{best.name}**',
        f'- Bull-regime requirement: {best.require_bull_regime}',
        f'- Momentum-loss rule: **{best.momentum_mode}**',
        f'- Candidate window after base trigger: {CANDIDATE_DAYS} days',
        f'- Short effective leverage diagnostic: {EFFECTIVE_SHORT_LEVERAGE:.0f}x', '',
        '## Selected policy results',
        '| Period | BTC end | vs HODL | Trades | Profitable | Stops | Rejected | Expired | Max DD |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ]
    for label, r in [('TRAIN 2020–2022', train), ('OOS 2023–2025', valid), ('Continuous 2020–2025', continuous)]:
        lines.append(
            f"| {label} | {r['total_btc']:.5f} | {pct(r['relative_to_hodl_btc_pct'])} | "
            f"{r['trades']} | {r['profitable_trades']} | {r['stops']} | {r['rejected_base_triggers']} | "
            f"{r['expired_candidates']} | {r['max_drawdown_pct']:.2f}% |"
        )
    lines += [
        '', f"2021-11-10 bull checkpoint: **{train_top['total_btc']:.5f} BTC** ({pct((train_top['total_btc']-1)*100)}).", '',
        '## All policies — untouched OOS 2023–2025',
        '| Train rank | Gate | Train BTC | OOS BTC | OOS trades | OOS stops | OOS Max DD |',
        '|---:|---|---:|---:|---:|---:|---:|',
    ]
    for x in policy_table:
        lines.append(
            f"| {x['rank_train']} | {x['gate']['name']} | {x['train_total_btc']:.5f} | {x['oos_total_btc']:.5f} | "
            f"{x['oos_trades']} | {x['oos_stops']} | {x['oos_max_drawdown_pct']:.2f}% |"
        )
    lines += [
        '',
        f"Gated policies beating 1 BTC HODL OOS: **{out['robustness']['gated_policies_beating_hodl_oos']}/{out['robustness']['gated_policy_count']}**.",
        f"Median gated OOS endpoint: **{out['robustness']['median_gated_oos_btc']:.5f} BTC**.",
    ]
    Path('bull-compound-hedge-v4-4.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
