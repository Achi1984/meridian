#!/usr/bin/env python3
"""MERIDIAN v0.4.7 — joint long-grid / short-hedge dynamic-margin stress test.

Purpose
-------
Model the user's current *mechanics* as a coupled system rather than two isolated
positions:
  • 4x BTC COIN-M long-grid snapshot analogue;
  • inverse BTC short hedge;
  • short TP1/TP2/TP3 release margin + realise BTC PnL;
  • released BTC can be transferred into long Dynamic Margin;
  • long liquidation is recalculated after every transfer.

This is deliberately a *survival/capital-flow* backtest, not a full Pionex grid
PnL replica. The long liquidation sensitivity is calibrated from one observed
Pionex snapshot, so changing grid inventory/order state is not reconstructed.
Short PnL/funding uses inverse-contract arithmetic, Binance historical funding
(proxy for Pionex), fees and adverse slippage.

Historical market trigger remains the frozen v0.4.1 Fib/RSI/EMA trigger. The
short exit ladder is changed to the user's CURRENT live-style ladder, expressed
as ratios to entry: TP1 74,800, TP2 72,500, TP3 70,000 from 75,784.8; 25% each,
25% runner; live-style stop 83,200 from 75,784.8.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import bull_compound_backtest as base
import bull_compound_backtest_v3 as ohlcmod
import bull_compound_hedge_v4_6 as v46
import bull_compound_hedge_v4_5 as v45

# Frozen trigger / execution assumptions
FEE = 0.001
SLIP = 0.0005
FIBS = (1.618, 2.0, 2.618)
RSI_MIN = 62
EMA_RATIO_MIN = 1.00
BREAKOUT_DAYS = 60
RESET_DD = 0.15

# Current live-style short ratios
LIVE_SHORT_ENTRY = 75784.8
TP_RATIOS = (74800.0 / LIVE_SHORT_ENTRY, 72500.0 / LIVE_SHORT_ENTRY, 70000.0 / LIVE_SHORT_ENTRY)
TP_WEIGHTS = (0.25, 0.25, 0.25)  # 25% runner
STOP_RATIO = 83200.0 / LIVE_SHORT_ENTRY
SHORT_NOTIONAL_BTC = 0.20

# Current long-grid snapshot ratios / calibration
LIVE_LONG_ENTRY = 75966.1
LIVE_LONG_LIQ = 46837.5
LIVE_LONG_FLOOR = 42600.0
LIVE_LONG_TP = 86000.0
LONG_BASE_MARGIN_BTC = 0.0492
LONG_FLOOR_RATIO = LIVE_LONG_FLOOR / LIVE_LONG_ENTRY
LONG_TP_RATIO = LIVE_LONG_TP / LIVE_LONG_ENTRY
LONG_LIQ_RATIO = LIVE_LONG_LIQ / LIVE_LONG_ENTRY
# Snapshot effective liquidation face scales linearly with episode entry.
LIVE_LONG_EFFECTIVE_FACE_USD = LONG_BASE_MARGIN_BTC / (1 / LIVE_LONG_LIQ - 1 / LIVE_LONG_ENTRY)
LONG_EFFECTIVE_FACE_BTC = LIVE_LONG_EFFECTIVE_FACE_USD / LIVE_LONG_ENTRY


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


def short_pnl_btc(face_usd, entry, exit_):
    return face_usd * (1.0 / exit_ - 1.0 / entry)


def short_fee_btc(face_usd, px):
    return face_usd * FEE / px


def long_liq(entry, total_margin_btc):
    face = LONG_EFFECTIVE_FACE_BTC * entry
    return 1.0 / (1.0 / entry + total_margin_btc / face)


def margin_needed_for_liq(entry, target_liq):
    face = LONG_EFFECTIVE_FACE_BTC * entry
    return max(0.0, face * (1.0 / target_liq - 1.0 / entry))


@dataclass(frozen=True)
class Policy:
    name: str
    transfer_source: str  # none, pnl_only, all_released
    target_buffer_below_floor: float  # e.g. 0.05 => target liq 5% below grid floor


def sim(ds, op, hi, lo, cl, e200, r14, fday, start, end, leverage, policy: Policy):
    s, e = il(ds, start), ir(ds, end)
    setup = None
    rearm = True
    pending_open = False
    long = None
    short = None

    cycles = []
    current = None
    total_short_funding = 0.0
    total_short_pnl = 0.0
    total_freed_margin = 0.0
    total_transferred = 0.0
    external_topup_for_rehedge = 0.0
    tp_counts = [0, 0, 0]
    short_stops = 0
    short_resets = 0
    short_opens = 0
    max_dynamic = 0.0
    min_liq_ratio = LONG_LIQ_RATIO

    # Within each long cycle, free buckets come from short cashflows.
    free_margin_bucket = 0.0
    free_profit_bucket = 0.0

    def target_liq_for_long(L):
        return L['floor'] * (1.0 - policy.target_buffer_below_floor)

    def transfer_if_possible():
        nonlocal free_margin_bucket, free_profit_bucket, total_transferred, max_dynamic, min_liq_ratio
        if long is None or policy.transfer_source == 'none':
            return 0.0
        target = target_liq_for_long(long)
        target_total_margin = margin_needed_for_liq(long['entry'], target)
        need = max(0.0, target_total_margin - long['margin'])
        if need <= 1e-12:
            return 0.0
        if policy.transfer_source == 'pnl_only':
            take = min(need, max(0.0, free_profit_bucket))
            free_profit_bucket -= take
        else:
            avail = max(0.0, free_profit_bucket) + max(0.0, free_margin_bucket)
            take = min(need, avail)
            # Consume profit first, then released margin.
            a = min(take, max(0.0, free_profit_bucket))
            free_profit_bucket -= a
            b = take - a
            free_margin_bucket -= b
        if take > 0:
            long['margin'] += take
            long['dynamic'] += take
            total_transferred += take
            max_dynamic = max(max_dynamic, long['dynamic'])
            long['liq'] = long_liq(long['entry'], long['margin'])
            min_liq_ratio = min(min_liq_ratio, long['liq'] / long['entry'])
            if current is not None:
                current['transfers'].append({'date': ds[i], 'btc': take, 'new_liq': long['liq']})
        return take

    def release_short_fraction(face_to_close, raw_px, reason):
        nonlocal short, free_margin_bucket, free_profit_bucket
        nonlocal total_short_pnl, total_freed_margin, short_stops, short_resets
        if short is None:
            return 0.0
        face_to_close = min(face_to_close, short['face_left'])
        if face_to_close <= 1e-12:
            return 0.0
        ex = raw_px * (1.0 + SLIP)  # adverse short buyback
        pnl = short_pnl_btc(face_to_close, short['entry'], ex) - short_fee_btc(face_to_close, ex)
        frac = face_to_close / short['face_total']
        released_margin = short['margin_total'] * frac
        short['face_left'] -= face_to_close
        short['margin_left'] -= released_margin
        short['rpnl'] += pnl
        free_margin_bucket += released_margin
        free_profit_bucket += pnl
        total_short_pnl += pnl
        total_freed_margin += released_margin
        if reason == 'STOP': short_stops += 1
        if reason == 'RESET': short_resets += 1
        return pnl

    def close_short_all(raw_px, reason):
        nonlocal short
        if short is None:
            return
        release_short_fraction(short['face_left'], raw_px, reason)
        if current is not None:
            current['short_closures'].append({'date': ds[i], 'reason': reason, 'rpnl_btc': short['rpnl']})
        short = None
        transfer_if_possible()

    def open_short(raw_px):
        nonlocal short, short_opens, free_margin_bucket, free_profit_bucket, external_topup_for_rehedge
        margin_req = SHORT_NOTIONAL_BTC / leverage
        # First short of a new cycle is part of the initial capital package.
        is_initial = current is not None and current['short_opens'] == 0
        if not is_initial:
            available = max(0.0, free_margin_bucket) + max(0.0, free_profit_bucket)
            use = min(margin_req, available)
            a = min(use, max(0.0, free_margin_bucket)); free_margin_bucket -= a
            b = use - a; free_profit_bucket -= b
            external_topup_for_rehedge += max(0.0, margin_req - use)
        entry = raw_px * (1.0 - SLIP)
        face = SHORT_NOTIONAL_BTC * raw_px
        entry_fee = short_fee_btc(face, entry)
        free_profit_bucket -= entry_fee
        total_short_pnl_local = -entry_fee
        short = {
            'entry': entry, 'face_total': face, 'face_left': face,
            'margin_total': margin_req, 'margin_left': margin_req,
            'tp': [entry * x for x in TP_RATIOS], 'tp_done': [False] * 3,
            'stop': entry * STOP_RATIO, 'rpnl': total_short_pnl_local,
        }
        short_opens += 1
        if current is not None: current['short_opens'] += 1

    for i in range(s, e + 1):
        # Execute base trigger at next open. If no long exists, start paired cycle.
        if pending_open:
            if long is None:
                le = op[i] * (1.0 + SLIP)
                long = {
                    'entry': le,
                    'margin': LONG_BASE_MARGIN_BTC,
                    'dynamic': 0.0,
                    'liq': long_liq(le, LONG_BASE_MARGIN_BTC),
                    'floor': le * LONG_FLOOR_RATIO,
                    'tp': le * LONG_TP_RATIO,
                }
                current = {
                    'opened': ds[i], 'entry': le, 'initial_liq': long['liq'], 'floor': long['floor'],
                    'short_opens': 0, 'transfers': [], 'short_closures': [], 'outcome': None,
                    'min_price': le, 'max_dynamic': 0.0,
                }
                free_margin_bucket = 0.0
                free_profit_bucket = 0.0
            if short is None:
                open_short(op[i])
            pending_open = False

        if current is not None:
            current['min_price'] = min(current['min_price'], lo[i])

        # Conservative long risk ordering: gap/intraday liquidation before same-day short TP rescue.
        if long is not None:
            if op[i] <= long['liq'] or lo[i] <= long['liq']:
                if short is not None:
                    close_short_all(max(op[i], long['liq']), 'LONG_LIQ')
                current['outcome'] = 'LIQ'
                current['closed'] = ds[i]
                current['final_liq'] = long['liq']
                current['dynamic_margin'] = long['dynamic']
                current['free_margin_bucket'] = free_margin_bucket
                current['free_profit_bucket'] = free_profit_bucket
                cycles.append(current)
                long = None; current = None; short = None
                free_margin_bucket = 0.0; free_profit_bucket = 0.0
                setup = None; rearm = True; pending_open = False
                continue

        # Short stop first, then TPs on same bar.
        if short is not None:
            if hi[i] >= short['stop']:
                sx = max(short['stop'], op[i])
                close_short_all(sx, 'STOP')
            else:
                for k, (lvl, w) in enumerate(zip(short['tp'], TP_WEIGHTS)):
                    if short is None: break
                    if not short['tp_done'][k] and lo[i] <= lvl:
                        face_close = short['face_total'] * w
                        release_short_fraction(face_close, lvl, f'TP{k+1}')
                        short['tp_done'][k] = True
                        tp_counts[k] += 1
                        transfer_if_possible()

        # Funding proxy: positive rate => short receives.
        if short is not None and ds[i] in fday:
            for ev in fday[ds[i]]:
                px = ev.get('mark', 0.0) or cl[i]
                fb = (short['face_left'] / px) * ev['rate']
                free_profit_bucket += fb
                short['rpnl'] += fb
                total_short_funding += fb
            transfer_if_possible()

        # Long TP ends paired cycle. Dynamic/base margin is simply released; grid PnL is NOT modeled.
        if long is not None and hi[i] >= long['tp']:
            if short is not None:
                close_short_all(long['tp'], 'LONG_TP')
            current['outcome'] = 'TP'
            current['closed'] = ds[i]
            current['final_liq'] = long['liq']
            current['dynamic_margin'] = long['dynamic']
            current['free_margin_bucket'] = free_margin_bucket
            current['free_profit_bucket'] = free_profit_bucket
            cycles.append(current)
            long = None; current = None; short = None
            free_margin_bucket = 0.0; free_profit_bucket = 0.0
            setup = None; rearm = True; pending_open = False
            continue

        # Existing market-structure reset closes the hedge runner, not the long.
        if setup is not None:
            setup['peak'] = max(setup['peak'], hi[i])
            if lo[i] <= setup['peak'] * (1.0 - RESET_DD):
                if short is not None:
                    close_short_all(cl[i], 'RESET')
                setup = None; rearm = True; pending_open = False

        # Frozen v0.4.1 trigger; if long is already alive this can re-open a fresh hedge.
        if rearm and setup is None and i >= s + max(BREAKOUT_DAYS, 180):
            ph = max(cl[i - BREAKOUT_DAYS:i])
            if cl[i] > ph:
                l180 = min(cl[i - 180:i])
                if ph / l180 >= 1.20:
                    setup = {'targets': {f: l180 + f * (ph - l180) for f in FIBS}, 'triggered': set(), 'peak': hi[i]}
                    rearm = False
        if setup is not None and short is None and pending_open is False and i < e:
            er = e200[i]; rr = r14[i]
            if er and rr is not None and rr >= RSI_MIN and cl[i] / er >= EMA_RATIO_MIN:
                for f in FIBS:
                    if f not in setup['triggered'] and cl[i] >= setup['targets'][f]:
                        setup['triggered'].add(f); pending_open = True; break

        if long is not None:
            current['max_dynamic'] = max(current['max_dynamic'], long['dynamic'])

    # End-of-data: record open cycle without pretending it closed.
    if long is not None and current is not None:
        if short is not None:
            close_short_all(cl[e], 'END')
        current['outcome'] = 'OPEN_END'
        current['closed'] = ds[e]
        current['final_liq'] = long['liq']
        current['dynamic_margin'] = long['dynamic']
        current['free_margin_bucket'] = free_margin_bucket
        current['free_profit_bucket'] = free_profit_bucket
        cycles.append(current)

    liqs = sum(c['outcome'] == 'LIQ' for c in cycles)
    tps = sum(c['outcome'] == 'TP' for c in cycles)
    below_floor = sum(c.get('final_liq', 1e99) < c['floor'] for c in cycles)
    target_ratio = LONG_FLOOR_RATIO * (1.0 - policy.target_buffer_below_floor)
    target_achieved = sum(c.get('final_liq', 1e99) / c['entry'] <= target_ratio + 1e-9 for c in cycles)
    return {
        'start': ds[s], 'end': ds[e], 'policy': policy.__dict__, 'effective_short_leverage': leverage,
        'cycles': len(cycles), 'long_tp_cycles': tps, 'long_liquidations': liqs,
        'cycles_liq_below_grid_floor': below_floor, 'cycles_target_achieved': target_achieved,
        'short_opens': short_opens, 'short_stops': short_stops, 'short_resets': short_resets,
        'tp1_hits': tp_counts[0], 'tp2_hits': tp_counts[1], 'tp3_hits': tp_counts[2],
        'short_realized_pnl_btc_ex_funding': total_short_pnl,
        'short_funding_btc': total_short_funding,
        'freed_short_margin_btc': total_freed_margin,
        'transferred_to_long_btc': total_transferred,
        'max_dynamic_margin_btc': max_dynamic,
        'min_long_liq_ratio': min_liq_ratio,
        'external_topup_for_rehedge_btc': external_topup_for_rehedge,
        'cycle_events': cycles,
    }


def current_ladder_snapshot(leverage):
    """Deterministic current-position ladder: what TP1/2/3 would do to long liq."""
    short_entry = LIVE_SHORT_ENTRY
    face_total = SHORT_NOTIONAL_BTC * short_entry
    long_margin = LONG_BASE_MARGIN_BTC
    rows = []
    cumulative = 0.0
    margin_total = SHORT_NOTIONAL_BTC / leverage
    for k, tp in enumerate((74800.0, 72500.0, 70000.0), 1):
        face = face_total * 0.25
        ex = tp * (1.0 + SLIP)
        pnl = short_pnl_btc(face, short_entry, ex) - short_fee_btc(face, ex)
        freed = margin_total * 0.25
        cash = freed + pnl
        cumulative += cash
        long_margin += cash
        liq = long_liq(LIVE_LONG_ENTRY, long_margin)
        rows.append({'tp': k, 'short_price': tp, 'freed_margin_btc': freed, 'realized_short_pnl_btc': pnl,
                     'cash_from_step_btc': cash, 'cumulative_cash_btc': cumulative,
                     'estimated_long_liq_if_all_transferred': liq})
    return rows


def main():
    ds, op, hi, lo, cl = ohlcmod.fetch_ohlc()
    e200 = base.ema(cl, 200); r14 = base.rsi(cl, 14)
    funding, coverage = v46.hybrid_funding(); fday = v45.funding_by_day(funding)

    policies = [
        Policy('no_transfer', 'none', 0.0),
        Policy('pnl_only_floor', 'pnl_only', 0.0),
        Policy('all_released_floor', 'all_released', 0.0),
        Policy('all_released_floor_minus5pct', 'all_released', 0.05),
    ]
    leverages = (7.0, 8.0, SHORT_NOTIONAL_BTC / 0.02250)
    periods = [('TRAIN', '2020-05-12', '2022-12-31'), ('OOS', '2023-01-01', '2025-12-31'), ('FULL', '2020-05-12', '2025-12-31')]
    tests = []
    for L in leverages:
        for p in policies:
            row = {'leverage': L, 'policy': p.__dict__}
            for label, a, b in periods:
                row[label.lower()] = sim(ds, op, hi, lo, cl, e200, r14, fday, a, b, L, p)
            tests.append(row)

    out = {
        'method': {
            'name': 'MERIDIAN v0.4.7 Joint Long-Short Dynamic Margin Stress Test',
            'long_model': 'Pionex snapshot-calibrated liquidation sensitivity; NOT full grid PnL engine',
            'short_model': 'inverse short, current live-style 25/25/25 TP ladder + 25% runner, live-style stop ratio',
            'funding': 'v0.4.6 hybrid Binance COIN-M/USD-M proxy',
            'funding_coverage_pct': coverage['coverage_pct'],
            'fees_bps': FEE * 10000, 'slippage_bps': SLIP * 10000,
            'long_floor_ratio': LONG_FLOOR_RATIO, 'long_initial_liq_ratio': LONG_LIQ_RATIO,
            'long_tp_ratio': LONG_TP_RATIO, 'short_stop_ratio': STOP_RATIO,
        },
        'tests': tests,
        'current_ladder_8x': current_ladder_snapshot(8.0),
        'current_ladder_8_89x': current_ladder_snapshot(SHORT_NOTIONAL_BTC / 0.02250),
    }
    Path('bull-compound-joint-v4-7.json').write_text(json.dumps(out, indent=2), encoding='utf-8')

    lines = [
        '# MERIDIAN v0.4.7 — joint Long/Short Dynamic-Margin stress test', '',
        '> This is a survival/capital-flow model. Long liquidation sensitivity is calibrated from the current Pionex snapshot; exact grid inventory PnL is not reconstructed.', '',
        '## Full 2020–2025',
        '| Short eff. L | Policy | Long cycles | Long liq | Long TP | TP1/2/3 | Transfer to long | Max dynamic | Re-hedge top-up |',
        '|---:|---|---:|---:|---:|---|---:|---:|---:|',
    ]
    for x in tests:
        r = x['full']
        lines.append(f"| {x['leverage']:.2f}x | {x['policy']['name']} | {r['cycles']} | {r['long_liquidations']} | {r['long_tp_cycles']} | {r['tp1_hits']}/{r['tp2_hits']}/{r['tp3_hits']} | {r['transferred_to_long_btc']:.5f} BTC | {r['max_dynamic_margin_btc']:.5f} | {r['external_topup_for_rehedge_btc']:.5f} |")
    lines += ['', '## Untouched OOS 2023–2025',
              '| Short eff. L | Policy | Long cycles | Long liq | Target achieved | Transfer | Re-hedge top-up |',
              '|---:|---|---:|---:|---:|---:|---:|']
    for x in tests:
        r = x['oos']
        lines.append(f"| {x['leverage']:.2f}x | {x['policy']['name']} | {r['cycles']} | {r['long_liquidations']} | {r['cycles_target_achieved']} | {r['transferred_to_long_btc']:.5f} | {r['external_topup_for_rehedge_btc']:.5f} |")
    lines += ['', '## Current ladder — if freed margin + realised TP PnL is immediately transferred',
              '| Eff short L | TP | BTC from step | Cum. BTC transferred | Est. long liq |',
              '|---:|---:|---:|---:|---:|']
    for L, rows in ((8.0, out['current_ladder_8x']), (SHORT_NOTIONAL_BTC/0.02250, out['current_ladder_8_89x'])):
        for r in rows:
            lines.append(f"| {L:.2f}x | TP{r['tp']} @ ${r['short_price']:,.0f} | {r['cash_from_step_btc']:.5f} | {r['cumulative_cash_btc']:.5f} | ${r['estimated_long_liq_if_all_transferred']:,.0f} |")
    Path('bull-compound-joint-v4-7.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
