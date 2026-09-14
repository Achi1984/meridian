"""Frozen walk-forward replay for PAIRS-OFFLINE-V1. Research only."""
import argparse
import hashlib
import itertools
import json
from pathlib import Path

import numpy as np

from pairs_scan import SYMBOLS, WINDOWS, estimate, validate

GROSS_USD = 2000.0
MAX_LOSS_USD = 100.0
MAX_HOLD_BARS = 42
COOLDOWN_BARS = 12
SCAN_EVERY_BARS = 6


def funding_map(data):
    result = {}
    first_at=int(data['series'][SYMBOLS[0]][0][0]); last_at=int(data['series'][SYMBOLS[0]][-1][0])
    for symbol in SYMBOLS:
        rows = data.get('funding', {}).get(symbol, [])
        parsed = [(int(row[0]), float(row[1]), float(row[2])) for row in rows]
        if any(not np.isfinite(rate) or not np.isfinite(mark) or mark <= 0 for _, rate, mark in parsed) or any(b[0] <= a[0] for a, b in zip(parsed, parsed[1:])):
            raise ValueError(f'{symbol}: invalid funding history')
        if not parsed or parsed[0][0]-first_at > 12*60*60*1000 or last_at-parsed[-1][0] > 12*60*60*1000:
            raise ValueError(f'{symbol}: incomplete funding coverage')
        if any(b[0]-a[0] > 12*60*60*1000 for a,b in zip(parsed,parsed[1:])):
            raise ValueError(f'{symbol}: funding gap')
        result[symbol] = parsed
    return result


def candidate(logs, a, b, end, costs_bps):
    # Cheap pre-screen first; unit-root and cointegration tests are only run when
    # an actual entry geometry and cost buffer exist at this timestamp.
    basics=[]
    for n in WINDOWS:
        y,x=logs[a][end-n:end],logs[b][end-n:end]
        alpha,beta=np.linalg.lstsq(np.column_stack([np.ones(n),x]),y,rcond=None)[0]
        residual=y-alpha-beta*x; scale=residual.std(ddof=2)
        if scale < 1e-8: return None
        basics.append({'beta':float(beta),'z':float((logs[a][end]-alpha-beta*logs[b][end])/scale),
                       'residual':float(logs[a][end]-alpha-beta*logs[b][end])})
    betas=[w['beta'] for w in basics]
    stable=min(betas)>0 and max(betas)/min(betas)<=1.25
    consistent=all(2.5<=w['z']<=4 for w in basics) or all(-4<=w['z']<=-2.5 for w in basics)
    edge=min(abs(w['residual'])/(1+abs(w['beta']))*10000 for w in basics)
    if not stable or not consistent or edge <= 2*costs_bps:
        return None
    windows = [estimate(logs[a][:end+1], logs[b][:end+1], n) for n in WINDOWS]
    betas = [w['beta'] for w in windows]
    stable = min(betas) > 0 and max(betas)/min(betas) <= 1.25
    consistent = all(2.5 <= w['z'] <= 4 for w in windows) or all(-4 <= w['z'] <= -2.5 for w in windows)
    edge = min(abs(w['residual'])/(1+abs(w['beta']))*10000 for w in windows)
    eligible = (all(w['integrated'] and w['pAdjusted'] <= .01 for w in windows)
                and stable and consistent and edge > 2*costs_bps)
    if not eligible:
        return None
    # Long-window fit is frozen at entry for honest future exit measurements.
    y, x = logs[a][end-750:end], logs[b][end-750:end]
    alpha, beta = np.linalg.lstsq(np.column_stack([np.ones(750), x]), y, rcond=None)[0]
    residual = y-alpha-beta*x
    return dict(a=a, b=b, alpha=float(alpha), beta=float(beta), scale=float(residual.std(ddof=2)),
                entryZ=windows[-1]['z'], signalStrength=min(abs(w['z']) for w in windows))


def replay(data, costs_bps):
    validate(data)
    if len(next(iter(data['series'].values()))) < 900:
        raise ValueError('At least 900 aligned candles required for walk-forward replay')
    if not np.isfinite(costs_bps) or costs_bps <= 0:
        raise ValueError('Positive round-trip costs required')
    # Collector stores candle open timestamps; decisions occur at the close.
    times = np.asarray(data['series'][SYMBOLS[0]])[:, 0].astype(np.int64)+14400000
    prices = {s: np.asarray(data['series'][s], dtype=float)[:, 1] for s in SYMBOLS}
    logs = {s: np.log(prices[s]) for s in SYMBOLS}
    funding = funding_map(data)
    trades, position, cooldown_until = [], None, -1
    entry_cost = GROSS_USD*costs_bps/20000

    def marked(pos, i):
        price_pnl = pos['qtyA']*(prices[pos['a']][i]-pos['entryA'])+pos['qtyB']*(prices[pos['b']][i]-pos['entryB'])
        fund_pnl = 0.0
        for symbol, qty in ((pos['a'], pos['qtyA']), (pos['b'], pos['qtyB'])):
            for at, rate, mark in funding[symbol]:
                if pos['entryAt'] < at <= times[i]:
                    # Positive funding: longs pay, shorts receive.
                    fund_pnl -= qty*mark*rate
        return price_pnl+fund_pnl-entry_cost, price_pnl, fund_pnl

    for i in range(750, len(times)):
        if position:
            z=(logs[position['a']][i]-position['alpha']-position['beta']*logs[position['b']][i])/position['scale']
            pnl, price_pnl, fund_pnl = marked(position, i)
            held=i-position['entryIndex']
            reason = ('STOP_USD' if pnl-entry_cost <= -MAX_LOSS_USD else
                      'STOP_Z' if abs(z) >= 5 else
                      'MEAN' if abs(z) <= .5 else
                      'TIME' if held >= MAX_HOLD_BARS else None)
            if reason:
                pnl -= entry_cost
                trades.append({**{k:position[k] for k in ('a','b','entryAt','entryZ')},
                    'exitAt':int(times[i]),'exitZ':float(z),'bars':held,'reason':reason,
                    'pricePnlUsd':price_pnl,'fundingPnlUsd':fund_pnl,
                    'costsUsd':2*entry_cost,'netPnlUsd':pnl})
                position=None; cooldown_until=i+COOLDOWN_BARS
            continue
        if i < cooldown_until or (i-750) % SCAN_EVERY_BARS:
            continue
        choices=[]
        for a,b in itertools.combinations(SYMBOLS,2):
            c=candidate(logs,a,b,i,costs_bps)
            if c: choices.append(c)
        if not choices:
            continue
        choice=max(choices,key=lambda c:(c['signalStrength'],c['a'],c['b']))
        beta=choice['beta']; short_a=choice['entryZ']>0
        weight_a=1/(1+beta); weight_b=beta/(1+beta)
        choice.update(entryIndex=i,entryAt=int(times[i]),entryA=prices[choice['a']][i],entryB=prices[choice['b']][i],
                      qtyA=(-1 if short_a else 1)*GROSS_USD*weight_a/prices[choice['a']][i],
                      qtyB=(1 if short_a else -1)*GROSS_USD*weight_b/prices[choice['b']][i])
        position=choice
    wins=sum(t['netPnlUsd']>0 for t in trades); gross_win=sum(max(0,t['netPnlUsd']) for t in trades)
    gross_loss=-sum(min(0,t['netPnlUsd']) for t in trades)
    return {'policy':'PAIRS-WALKFORWARD-V1','executionImpact':False,'asOf':data['asOf'],
      'parameters':{'grossUsd':GROSS_USD,'roundTripCostsBps':costs_bps,'maxLossUsd':MAX_LOSS_USD,
        'maxHoldBars':MAX_HOLD_BARS,'cooldownBars':COOLDOWN_BARS,'scanEveryBars':SCAN_EVERY_BARS},
      'closedTrades':len(trades),'winRate':wins/len(trades) if trades else None,
      'profitFactor':gross_win/gross_loss if gross_loss else None,
      'netPnlUsd':sum(t['netPnlUsd'] for t in trades),'trades':trades,
      'openAtEnd':bool(position),'limitation':'Candle-close simulation; no intrabar fills, order-book replay or profitability claim'}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('input'); parser.add_argument('--costs-bps',type=float,required=True)
    args=parser.parse_args(); raw=Path(args.input).read_bytes(); result=replay(json.loads(raw),args.costs_bps)
    result['inputSha256']=hashlib.sha256(raw).hexdigest()
    print(json.dumps(result,indent=2,allow_nan=False))
