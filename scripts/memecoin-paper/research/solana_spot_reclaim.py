"""Offline, long-only five-minute Solana pool replay; input quotes and volume in USD."""
import argparse
from collections import Counter
from datetime import date
import json
from math import isfinite
from pathlib import Path
from statistics import median

DAY = 86400
STEP = 300


def validate(rows):
    previous = -1
    for t, o, h, low, c, volume in rows:
        if not isinstance(t, int) or t <= previous or t % STEP:
            raise ValueError('Expected unique ascending five-minute timestamps')
        if not all(isfinite(v) for v in (o, h, low, c, volume)) or not (
                0 < low <= min(o, c) <= max(o, c) <= h and volume >= 0):
            raise ValueError('Invalid USD OHLCV')
        previous = t


def entry_signal(history, bar, volume_multiple):
    if len(history) != 12 or bar[0]-history[0][0] != 12*STEP:
        return False
    floor = min(b[3] for b in history)
    return (bar[3] < floor < bar[4] and bar[5] >= 8000 and
            bar[5] >= volume_multiple * median(b[5] for b in history))


def replay(rows, start, end, volume_multiple, side_cost):
    cash = peak = 1000.
    drawdown = 0.
    position = None
    last_day = None
    trades, reasons = [], Counter()
    for i, bar in enumerate(rows):
        t, mid = bar[:2]
        if t < start:
            continue
        if t >= end:
            break
        day = t//DAY
        previous = rows[i-1] if i else None
        held_at_open = position is not None
        if held_at_open:
            opened, qty, cost, stop, target = position
            if day != opened//DAY:
                reason = 'overnightGap'
            elif t-opened >= 3600:
                reason = 'time'
            elif previous[4] <= stop:
                reason = 'stop'
            elif previous[4] >= target:
                reason = 'target'
            else:
                reason = None
            if reason:
                proceeds = qty*mid*(1-side_cost)-.05
                cash += proceeds
                trades.append(proceeds-cost)
                reasons[reason] += 1
                position = None
        if (not held_at_open and last_day != day and i >= 13 and previous[0]+STEP == t
                and 3900 <= t%DAY <= 20*3600 and mid > previous[3]
                and entry_signal(rows[i-13:i-1], previous, volume_multiple)):
            cost = min(80., .08*cash)
            qty = (cost-.05)/(mid*(1+side_cost))
            stop = max(previous[3], .94*mid)
            position = t, qty, cost, stop, mid+2*(mid-stop)
            cash -= cost
            last_day = day
        equity = cash if position is None else cash+position[1]*mid*(1-side_cost)-.05
        peak = max(peak, equity)
        drawdown = max(drawdown, 100*(1-equity/peak))
    if position is not None:
        raise ValueError('Incomplete exit coverage at end of replay')
    return dict(net=cash-1000, trades=len(trades), wins=sum(x>0 for x in trades),
                mean=sum(trades)/len(trades) if trades else None, maxDrawdownPct=drawdown,
                best=max(trades, default=None), exits=dict(reasons))


def evaluate(packet, start, end):
    rows = packet['rows']
    validate(rows)
    if start % DAY or end % DAY or end <= start:
        raise ValueError('Expected half-open UTC day range')
    sampled = [b for b in rows if start <= b[0] < end]
    if not sampled or sampled[0][0]//DAY != start//DAY or sampled[-1][0]//DAY != end//DAY-1:
        raise ValueError('Incomplete requested date coverage')
    return dict(pool=packet['pool'], mint=packet['mint'], candles=len(sampled),
                missingSlots=(end-start)//STEP-len(sampled),
                arms={f'volume{v}_bps{bps}':replay(rows,start,end,v,bps/10000)
                      for v in (0,2) for bps in (50,100)})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('packet',type=Path, help='JSON with pool, mint and sorted rows [UTC seconds,O,H,L,C,USD volume]')
    parser.add_argument('start',type=date.fromisoformat)
    parser.add_argument('end',type=date.fromisoformat)
    args = parser.parse_args()
    epoch = date(1970,1,1)
    print(json.dumps(evaluate(json.loads(args.packet.read_text()), (args.start-epoch).days*DAY,
                              (args.end-epoch).days*DAY),indent=2))
