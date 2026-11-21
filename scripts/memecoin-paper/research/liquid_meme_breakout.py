"""Offline Binance spot replay. Each symbol uses a separate 1,000 USDT paper account."""
import argparse
import csv
from datetime import datetime, timezone
from io import TextIOWrapper
from pathlib import Path
from statistics import median
from zipfile import ZipFile

STEP = 900


def bars(root, symbol):
    result = {}
    for path in sorted(root.glob(f'{symbol}-15m-*.zip')):
        with ZipFile(path) as packet, packet.open(path.stem+'.csv') as stream:
            for r in csv.reader(TextIOWrapper(stream)):
                at = int(r[0]) // 1_000_000
                o, h, low, close = map(float, r[1:5])
                volume = float(r[7])
                if at in result or at % STEP or not (0 < low <= min(o,close) <= max(o,close) <= h and volume >= 0):
                    raise ValueError(f'Invalid bar {at}')
                result[at] = (o,h,low,close,volume)
    return result


def replay(asset, btc, start, end, side_cost, strategy):
    cash = peak = 1000.
    drawdown = 0.
    pnls = []
    position = None
    for t in range(start, end, STEP):
        opening = asset[t][0]
        if position:
            entry_at, entry, qty = position
            last = asset[t-STEP][3]
            if last <= .97*entry or last >= 1.06*entry or t-entry_at >= 4*3600 or t+STEP == end:
                credit = qty*opening*(1-side_cost)
                cash += credit
                pnls.append(credit-80)
                position = None
        elif t >= start+96*STEP and t+17*STEP < end:
            history = [asset[t-i*STEP] for i in range(2,18)]
            last = asset[t-STEP]
            if strategy == 'rebound':
                buy = (last[2] <= .95 * asset[t-4*STEP][0]
                       and last[3] >= last[2] + .65*(last[1]-last[2])
                       and last[4] >= 2*median(bar[4] for bar in history))
            else:
                buy = (btc[t-STEP][3] > sum(btc[t-i*STEP][3] for i in range(1,97))/96
                    and last[3] > max(bar[1] for bar in history)
                    and last[4] >= 2*median(bar[4] for bar in history))
            if buy and last[4] >= 8000 and cash >= 80:
                cash -= 80
                position = t, opening, 80/(opening*(1+side_cost))
        equity = cash + (position[2]*asset[t][3]*(1-side_cost) if position else 0)
        peak = max(equity, peak)
        drawdown = max(drawdown, 100*(1-equity/peak))
    return len(pnls), sum(p > 0 for p in pnls), round(cash-1000,2), round(drawdown,2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    ref = bars(args.directory,'BTCUSDT')
    for symbol in ('BONKUSDT','WIFUSDT'):
        asset = bars(args.directory,symbol)
        for year, month, end_month in ((2025,1,7),(2025,7,13),(2026,1,7),(2026,7,11)):
            start,end = [int(datetime(year + (m-1)//12,(m-1)%12+1,1,tzinfo=timezone.utc).timestamp()) for m in (month,end_month)]
            if any(t not in asset or t not in ref for t in range(start,end,STEP)):
                raise ValueError('Incomplete aligned period')
            for strategy in ('breakout', 'rebound'):
                for cost in (0., .002, .004):
                    print(symbol, year, month, strategy, cost, replay(asset,ref,start,end,cost,strategy))
