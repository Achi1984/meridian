"""Offline BTC trend reference. Input is Kraken daily OHLC, headerless, UTC."""
import argparse
import csv
import io
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

DAY = timedelta(days=1)
HORIZONS = (30, 90, 180)


def target(score, holding):
    if score == 2:
        return holding
    return score == 3


def load_bars(paths):
    bars = {}
    data = b''.join(path.read_bytes() for path in paths)
    for ts, op, high, low, close, vol, trades in csv.reader(io.StringIO(data.decode())):
        timestamp = int(ts)
        d = datetime.fromtimestamp(timestamp, timezone.utc).date()
        op, high, low, close = map(Decimal, (op, high, low, close))
        if timestamp % 86400 or d in bars or not 0 < low <= min(op, close) <= max(op, close) <= high:
            raise ValueError(f'invalid daily candle {d}')
        bars[d] = op, close
    return bars


def run(bars, begin, end, mode, fee):
    cash = peak = Decimal(1000)
    qty = drawdown = Decimal(0)
    trips = 0
    # Require an uninterrupted UTC calendar, including signal history.
    d = begin - 181 * DAY
    while d < end:
        if d not in bars:
            raise ValueError(f'missing UTC day {d}')
        d += DAY
    d = begin
    while d < end:
        opening, closing = bars[d]
        if d.day == 1:
            last = bars[d-DAY][1]
            positives = {h: last > bars[d-(h+1)*DAY][1] for h in HORIZONS}
            desired = {'score': target(sum(positives.values()), bool(qty)),
                       '90d': positives[90], 'hold': True, 'cash': False}[mode]
            if desired and not qty:
                budget = min(Decimal(100), cash)
                qty = budget / (opening * Decimal('1.001') * (1 + fee))
                cash -= budget
            elif qty and not desired:
                cash += qty * opening * Decimal('0.999') * (1-fee)
                qty = Decimal(0)
                trips += 1
        equity = cash + qty * closing * Decimal('0.999') * (1-fee)
        peak = max(peak, equity)
        drawdown = max(drawdown, peak-equity)
        d += DAY
    return round(equity - 1000, 2), round(drawdown, 2), trips, bool(qty)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('parts', type=Path, nargs='+', help='ordered parts of one Kraken daily CSV')
    bars = load_bars(parser.parse_args().parts)
    for start, end in [(2016, 2020), (2020, 2024), (2024, 2026)]:
        for fee in map(Decimal, ['0.005','0.0075']):
            for mode in ('score','90d','hold','cash'):
                print(start, end-1, fee, mode, *run(bars,date(start,1,1),date(end,1,1),mode,fee))
