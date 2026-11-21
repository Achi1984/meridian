"""Same-day BTC/EUR paired research on Coinbase one-hour candle batches."""
import argparse
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal as D
from pathlib import Path


def load(paths):
    candles = {}
    for path in paths:
        for ts, low, high, opening, close, volume in json.loads(path.read_text(),parse_float=D):
            if type(ts) is not int or ts % 3600 or not 0 < low <= min(opening,close) <= max(opening,close) <= high or volume <= 0:
                raise ValueError(f'invalid hourly candle at {ts}')
            bar = tuple(map(D,(low,high,opening,close)))
            if ts in candles and candles[ts] != bar:
                raise ValueError(f'conflicting prices at {ts}')
            candles[ts] = bar
    return candles


def signals(candles, start, end):
    trades = []
    skipped = []
    day = start
    while day < end:
        t = int(datetime.combine(day,datetime.min.time(),timezone.utc).timestamp())
        if any(t+i*3600 not in candles for i in range(-24,19)):
            skipped.append(str(day))
        else:
            def bar(h):
                return candles[t+h*3600]
            level = max(bar(h)[1] for h in range(-24,0))
            if bar(5)[3] > level:
                entry = None
                for h in range(6,17):
                    low, _, _, close = bar(h)
                    if low <= level < close:
                        entry = bar(h+1)[2]
                        break
                trades.append((day,bar(6)[2],entry,bar(18)[2]))
        day += timedelta(days=1)
    return trades, skipped


def summarize(pairs,fee,slip):
    cash = peak = D(1000)
    dd = D(0)
    wins = 0
    for entry, exit_price in pairs:
        change = min(D(100),cash)*(exit_price*(1-slip)*(1-fee)/(entry*(1+slip)*(1+fee))-1)
        cash += change
        wins += int(change > 0)
        peak = max(peak,cash)
        dd = max(dd,peak-cash)
    return dict(trades=len(pairs),wins=wins,net=round(cash-1000,2),lives=round(cash/1000,5),closed_drawdown=round(dd,2))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('start',type=date.fromisoformat)
    parser.add_argument('end',type=date.fromisoformat,help='exclusive')
    parser.add_argument('files',nargs='+',type=Path)
    args=parser.parse_args()
    if args.end<=args.start:
        parser.error('end must be later than start')
    trades, skipped = signals(load(args.files),args.start,args.end)
    print('Excluded incomplete sessions:',len(skipped),json.dumps(skipped))
    arms={'immediate':[(a,x) for _,a,b,x in trades],
          'retest':[(b,x) for _,a,b,x in trades if b is not None],
          'immediate_on_retest_days_diagnostic':[(a,x) for _,a,b,x in trades if b is not None]}
    for name,pairs in arms.items():
        for fee,slip in [(D(0),D(0)),(D('.005'),D('.001')),(D('.0075'),D('.001'))]:
            print(name,fee,slip,json.dumps(summarize(pairs,fee,slip),default=str))
