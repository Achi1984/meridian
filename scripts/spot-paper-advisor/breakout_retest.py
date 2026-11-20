"""Replay one confirmed entry against each original first-hour breakout."""
import argparse
from collections import Counter, deque
from datetime import datetime, timezone
import json
from pathlib import Path

from breakout_perp_history import FUNDING_STEP, load_market, paired_trade
from reclaim_history import breakout_slot, candles
from worker import DAY, STEP, initial


def confirms(bar, level, elapsed):
    return 1 <= elapsed <= 3 and bar[3] <= level < bar[4]


def evaluate(paths, root):
    if not paths:
        raise ValueError('No monthly spot archives')
    prices, marks, rates = market = load_market(paths, root)
    history, state = deque(maxlen=144), initial()
    stats = {key: dict(net=0., closed=0, peak=1000., maxDrawdownPct=0., monthly=Counter())
             for key in ('original', 'confirmed')}
    events = []
    excluded_days = set()
    current = None
    for bar in candles(paths):
        slot, mid = bar[:2]
        month = datetime.fromtimestamp(slot, timezone.utc).strftime('%Y-%m')
        for arm in stats.values():
            arm['monthly'].setdefault(month, 0)
        day = slot-slot%DAY
        if any(at not in marks or at not in rates for at in range(day, day+DAY, FUNDING_STEP)):
            excluded_days.add(day)
            if current:
                raise ValueError('Open position at excluded day boundary')
            history.clear()
            continue
        book = dict(bid=mid*.9999, ask=mid*1.0001, bidSize=1., askSize=1.)
        execution = breakout_slot(state, history, book, slot)['execution']
        if execution == 'PAPER_BUY':
            qty = int(100/(mid*1.0001*1.001*1.001)*1e8)/1e8
            level = max(b[2] for b in history if slot-slot%DAY <= b[0] < slot-slot%DAY+3600)
            current = dict(level=level, original=(slot,mid,qty), confirmed=None)
        elif current and execution != 'PAPER_SELL' and current['confirmed'] is None:
            opened, _, qty = current['original']
            elapsed = (slot-opened)//STEP
            observed = [b[0] for b in history if b[0] >= opened] if elapsed <= 3 else []
            if (1 <= elapsed <= 3 and observed == list(range(opened, slot, STEP))
                    and confirms(history[-1], current['level'], elapsed)):
                current['confirmed'] = slot, mid, qty
        if current:
            closed = execution == 'PAPER_SELL'
            record = dict(signal=current['original'][0], exit=slot) if closed else None
            for key, arm in stats.items():
                entry = current[key]
                if not entry:
                    continue
                row = paired_trade(entry, slot, mid, *market)
                if row is None:
                    raise ValueError(f'Missing market coverage for {key} at {slot}')
                equity = 1000+arm['net']+row['futuresNet']
                arm['peak'] = max(arm['peak'], equity)
                arm['maxDrawdownPct'] = max(arm['maxDrawdownPct'],100*(1-equity/arm['peak']))
                if closed:
                    arm['net'] += row['futuresNet']
                    arm['closed'] += 1
                    arm['monthly'][month] += 1
                    record[key] = dict(entry=entry[0], futuresEntryMid=prices[entry[0]], net=row['futuresNet'])
            if closed:
                events.append(record)
                current = None
        history.append(bar)
    if current:
        raise ValueError('Unclosed breakout at end of input')
    for arm in stats.values():
        del arm['peak']
        arm['meanNet'] = arm['net']/arm['closed'] if arm['closed'] else None
    skipped = [e['original']['net'] for e in events if 'confirmed' not in e]
    better = sum(e['confirmed']['futuresEntryMid'] < e['original']['futuresEntryMid']
                 for e in events if 'confirmed' in e)
    return dict(arms=stats, excludedDays=sorted(excluded_days), avoidedLosses=sum(x<0 for x in skipped), missedWins=sum(x>0 for x in skipped),
                avoidedLossUsdt=-sum(x for x in skipped if x<0), missedWinUsdt=sum(x for x in skipped if x>0),
                improvedEntries=better, events=events)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('spot', type=Path)
    parser.add_argument('futures', type=Path)
    args = parser.parse_args()
    print(json.dumps(evaluate(sorted(args.spot.glob('BTCUSDT-5m-????-??.zip')), args.futures)))
