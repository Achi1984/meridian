"""Paired fixed-barrier versus 18:00 UTC exits for frozen BTC/EUR breakout entries."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D
import argparse
import json
from pathlib import Path

from daytrade_lives import load


def trades(rows):
    for t in sorted(rows):
        if t.hour or not 2021 <= t.year <= 2026 or t >= datetime(2026,11,1,tzinfo=timezone.utc):
            continue
        step = timedelta(hours=6)
        if rows[t][3] > max(rows[t-i*step][1] for i in range(1,5)):
            yield t, rows[t+step][2], rows[t+3*step][2], [rows[t+i*step] for i in (1,2)]


def barrier_exit(bars, entry, fallback, optimistic=False):
    target, stop = entry*D('1.03'), entry*D('.985')
    for low, high, opening, close in bars:
        if opening <= stop:
            return opening, 'stop'
        if opening >= target:
            return target, 'target'
        if low <= stop and high >= target:
            return (target if optimistic else stop), 'ambiguous'
        if low <= stop:
            return stop, 'stop'
        if high >= target:
            return target, 'target'
    return fallback, 'time'


def minute_path(directory, t, coarse):
    start = int(t.timestamp())+21600
    rows = {}
    for block in range(3):
        path = directory / f'{t.date()}-{block}.json'
        if not path.is_file():
            return None
        for ts, lo, hi, op, cl, volume in json.loads(path.read_text(),parse_float=D):
            if start <= ts < start+43200:
                bar = tuple(map(D,(lo,hi,op,cl)))
                if ts % 60 or volume <= 0 or not 0 < lo <= min(op,cl) <= max(op,cl) <= hi or (ts in rows and rows[ts]!=bar):
                    raise ValueError(f'invalid minute {ts}')
                rows[ts] = bar
    keys = list(range(start,start+43200,60))
    if any(k not in rows for k in keys):
        return None
    ordered = [rows[k] for k in keys]
    for i in range(2):
        group = ordered[i*360:(i+1)*360]
        rebuilt = min(b[0] for b in group),max(b[1] for b in group),group[0][2],group[-1][3]
        if rebuilt != coarse[i]:
            return None
    return ordered


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('files',type=Path,nargs='+')
    p.add_argument('--minutes',type=Path)
    args = p.parse_args()
    rows = load(args.files)
    for year in range(2021,2027):
        records=[]
        for t,entry,closing,coarse in trades(rows):
            if t.year!=year:
                continue
            minute = minute_path(args.minutes,t,coarse) if args.minutes else None
            bars = minute or coarse
            price, reason = barrier_exit(bars,entry,closing)
            upper,_ = barrier_exit(bars,entry,closing,True)
            records.append((entry,closing,price,upper,max(b[1] for b in bars),reason,minute is not None))
        for fee in (D('.005'),D('.0075')):
            factor = D('.999')*(1-fee)/(D('1.001')*(1+fee))
            totals=[round(sum(100*(r[i]/r[0]*factor-1) for r in records),2) for i in (1,2,3)]
            print(year,fee,len(records),'time/stopFirst/targetFirst',*totals,'touchedBreakeven',
                  sum(r[4]*factor>=r[0] for r in records),'minuteVerified',sum(r[6] for r in records),
                  {reason:sum(r[5]==reason for r in records) for reason in ('stop','target','time','ambiguous')})
