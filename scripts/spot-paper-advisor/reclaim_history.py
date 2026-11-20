"""Replay the fixed range-reclaim rule on local Binance monthly BTCUSDT 5m ZIPs."""
import argparse
import csv
from collections import Counter, deque
from datetime import datetime, timezone
from decimal import Decimal
from io import TextIOWrapper
import json
from pathlib import Path
from zipfile import ZipFile

import usd_pullback
import worker
from usd_pullback import paper_slot
from worker import DAY, STEP, execute, forced, initial, mark


def candles(paths):
    previous = None
    pair = []
    for path in sorted(paths):
        with ZipFile(path) as archive, archive.open(path.stem + '.csv') as raw:
            for row in csv.reader(TextIOWrapper(raw, encoding='ascii')):
                stamp = int(row[0])
                slot = stamp // (1_000_000 if stamp >= 10**15 else 1000)
                if slot % 300 or (previous is not None and slot <= previous):
                    raise ValueError(f'Invalid candle timestamp at {slot}')
                if previous is None or slot != previous+300:
                    pair.clear()
                previous = slot
                bar = [slot, *map(float, row[1:5])]
                if not pair and slot % STEP:
                    continue
                pair.append(bar)
                if len(pair) == 2:
                    a, b = pair
                    if a[0] % STEP:
                        raise ValueError('Misaligned ten-minute interval')
                    yield [a[0], a[1], max(a[2], b[2]), min(a[3], b[3]), b[4]]
                    pair.clear()



def breakout_slot(state, history, book, slot):
    day = slot-slot % DAY
    if forced(state, slot):
        action, reason = ('SELL' if state['opened'] is not None else 'HOLD'), 'DAY_CLOSE'
    elif not history or history[-1][0]+STEP != slot:
        action, reason = 'HOLD', 'CANDLES_UNAVAILABLE'
    elif state['opened'] is not None:
        action, reason = ('SELL', 'STOP_CLOSE') if history[-1][4] <= state['stop'] else ('HOLD', 'POSITION_OPEN')
    elif slot-day < 3600+STEP or state.get('entryDay') == day:
        action, reason = 'HOLD', 'WAIT'
    else:
        opening = [b for b in history if day <= b[0] < day+3600]
        if len(opening) != 6:
            action, reason = 'HOLD', 'CANDLES_UNAVAILABLE'
        else:
            high, low = max(b[2] for b in opening), min(b[3] for b in opening)
            if history[-1][4] > high and history[-2][4] <= high and history[-2][0] == slot-2*STEP:
                action, reason = 'BUY', 'BREAKOUT'
                state['stop'] = (high+low)/2
            else:
                action, reason = 'HOLD', 'WAIT_BREAKOUT'
    execution = execute(state, action, book, slot)
    if execution == 'PAPER_BUY':
        state['entryDay'] = day
    return dict(reason=reason, execution=execution, equityUsd=mark(state, book)['equityEur'])


def evaluate(paths, *, breakout=False):
    """Treat next bar open as mid, assume 2 bps total spread and sufficient size."""
    history = deque(maxlen=144 if breakout else 7)
    state = initial()
    years = {}
    previous_cash = peak = 1000.
    for bar in candles(paths):
        slot, mid = bar[:2]
        year = datetime.fromtimestamp(slot, timezone.utc).year
        stats = years.setdefault(year, dict(slots=0, missingSlots=0, closed=0, winners=0, grossWins=0.,
                                grossLosses=0., realizedUsdt=0., maxDrawdownPct=0., reasons=Counter()))
        book = dict(bid=mid*.9999, ask=mid*1.0001, bidSize=1., askSize=1.,
                    received=slot+1, askAt=slot+1, bidAt=slot+1)
        if breakout:
            result = breakout_slot(state, history, book, slot)
        else:
            result = paper_slot(state, dict(ten=list(history), book=book), book, slot, slot+1, reclaim=True)
        if history:
            stats['missingSlots'] += (slot-history[-1][0])//STEP-1
        stats['slots'] += 1
        stats['reasons'][result['reason']] += 1
        equity = result['equityUsd']
        peak = max(peak, equity)
        stats['maxDrawdownPct'] = max(stats['maxDrawdownPct'], 100*(1-equity/peak))
        if result['execution'] == 'PAPER_SELL':
            cash = float(Decimal(state['cash']))
            pnl = cash - previous_cash
            previous_cash = cash
            stats['closed'] += 1
            stats['winners'] += pnl > 0
            stats['grossWins'] += max(0, pnl)
            stats['grossLosses'] += max(0, -pnl)
            stats['realizedUsdt'] += pnl
        history.append(bar)
    return years


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--opening-breakout', action='store_true')
    parser.add_argument('--fee-bps', type=int, choices=(10, 50), default=50,
                        help='Fee per side for the isolated historical process')
    args = parser.parse_args()
    worker.FEE = usd_pullback.FEE = Decimal(args.fee_bps)/10000
    paths = list(args.directory.glob('BTCUSDT-5m-????-??.zip'))
    if not paths:
        parser.error('No monthly archives found')
    print(json.dumps(evaluate(paths, breakout=args.opening_breakout), indent=2))
