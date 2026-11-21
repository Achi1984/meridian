"""Replay DOGEUSDT perpetual failed breakouts, closing before the next UTC hour."""
import argparse
from collections import deque, defaultdict
import csv
from datetime import datetime, timezone
from io import TextIOWrapper
import json
from pathlib import Path
from zipfile import ZipFile

from regime_breakout import Account


def bars(paths):
    for p in sorted(paths):
        with ZipFile(p) as archive, archive.open(p.stem+'.csv') as stream:
            for row in csv.reader(TextIOWrapper(stream)):
                if row[0] != 'open_time':
                    yield (int(row[0]) // 1000, *map(float, row[1:5]))


def signal(history):
    if len(history) < 13:
        return False
    previous = list(history)[:-1]
    high = max(b[2] for b in previous)
    last = history[-1]
    return previous[-1][4] >= 1.03 * previous[0][1] and last[2] > high > last[4]


def replay(series):
    history = deque(maxlen=13)
    rows = defaultdict(lambda: dict(trades=0, wins=0, net=0., gross=0., best=None, incomplete=0))
    active = None
    for bar in series:
        t, opening = bar[:2]
        if history and t != history[-1][0]+300:
            if t <= history[-1][0]:
                raise ValueError('unordered candles')
            if active:
                row['incomplete'] += 1
                active = None
            history.clear()
        if active:
            if t-start >= 1800 or opening >= active.entry*1.02:
                active.target(0, opening)
                row['trades'] += 1
                row['wins'] += active.wins
                row['net'] += active.net
                row['gross'] += active.net + active.cost
                row['best'] = active.net if row['best'] is None else max(row['best'],active.net)
                active = None
        elif t % 3600 + 1800 < 3600 and signal(history):
            start = t
            row = rows[datetime.fromtimestamp(t, timezone.utc).year]
            active = Account()
            active.target(-1, opening)
        history.append(bar)
    if active:
        row['incomplete'] += 1
    return dict(rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    files = sorted(parser.parse_args().directory.glob('DOGEUSDT-5m-????-??.zip'))
    if not files:
        parser.error('Expected monthly DOGEUSDT 5m futures ZIPs')
    print(json.dumps(replay(bars(files)), indent=2))
