"""Test pre-entry relative BTC volume on the existing 06:00 breakout; same 18:00 exit."""
from datetime import timedelta, datetime, timezone
from statistics import median
from decimal import Decimal as D
from pathlib import Path
import argparse
import json
from daytrade_lives import load
from exit_study import trades


def qualified(files):
    rows = load(files)
    volumes = {}
    for path in files:
        for ts, _, _, _, _, volume in json.loads(path.read_text(),parse_float=D):
            t = datetime.fromtimestamp(ts, timezone.utc)
            if t in volumes and volumes[t] != volume:
                raise ValueError(f'conflicting volume {t}')
            volumes[t] = volume
    for t, entry, close, _ in trades(rows):
        prior = [volumes[t-timedelta(days=i)] for i in range(1,21)]
        if volumes[t] >= 2*median(prior):
            yield t, entry, close


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('files', type=Path, nargs='+')
    selected = list(qualified(p.parse_args().files))
    for year in range(2021,2027):
        for fee in (D('.005'),D('.0075')):
            factor = D('.999')*(1-fee)/(D('1.001')*(1+fee))
            pnl = [100*(close/entry*factor-1) for t,entry,close in selected if t.year==year]
            print(year, fee, len(pnl), sum(v>0 for v in pnl), round(sum(pnl),2))
