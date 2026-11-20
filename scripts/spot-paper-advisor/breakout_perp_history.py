"""Compare the same BTCUSDT spot breakout trades on spot and USDT perpetual futures."""
import argparse
from collections import Counter, deque
import csv
from datetime import datetime, timezone
from io import TextIOWrapper
import json
from pathlib import Path
from zipfile import ZipFile

from reclaim_history import breakout_slot, candles
from worker import initial

SLIPPAGE_BPS_PER_SIDE = 10
FUNDING_STEP = 8 * 3600


def archive_rows(path):
    with ZipFile(path) as archive, archive.open(path.stem + '.csv') as raw:
        yield from csv.DictReader(TextIOWrapper(raw, encoding='ascii'))


def load_market(spot_paths, root):
    prices, marks, rates = {}, {}, {}
    for spot_path in spot_paths:
        for kind, table in [('klines', prices), ('markPriceKlines', marks)]:
            for row in archive_rows(root/kind/spot_path.name):
                at = int(row['open_time'])//1000
                if at % (600 if kind == 'klines' else FUNDING_STEP) == 0:
                    price = float(row['open'])
                    if not 0 < price < float('inf') or at in table:
                        raise ValueError('invalid or duplicate opening price')
                    table[at] = price
        for row in archive_rows(root/'fundingRate'/spot_path.name.replace('-5m-', '-fundingRate-')):
            ts = int(row['calc_time'])
            at = round(ts/(1000*FUNDING_STEP))*FUNDING_STEP
            rate = float(row['last_funding_rate'])
            if (int(row['funding_interval_hours']) != 8 or abs(at*1000-ts) >= 60000
                    or at in rates or not -1 < rate < 1):
                raise ValueError('unsupported funding schedule or rate')
            rates[at] = rate
    return prices, marks, rates


def paired_trade(entry, exit_slot, spot_exit, prices, marks, rates):
    opened, spot_open, quantity = entry
    if opened not in prices or exit_slot not in prices:
        return None
    funding = 0.
    # Model both fills just after the scheduled funding event on a boundary.
    for at in range((opened//FUNDING_STEP+1)*FUNDING_STEP, exit_slot+1, FUNDING_STEP):
        if at not in marks or at not in rates:
            return None
        funding += quantity*marks[at]*rates[at]
    slippage = SLIPPAGE_BPS_PER_SIDE / 10000
    buy, sell = 1.0001*(1+slippage), .9999*(1-slippage)
    spot = quantity*(spot_exit*sell*.999-spot_open*buy*1.001)
    gross = quantity*(prices[exit_slot]-prices[opened])
    future = quantity*(prices[exit_slot]*sell*.9995-prices[opened]*buy*1.0005)-funding
    no_slip = quantity*(prices[exit_slot]*.9999*.9995-prices[opened]*1.0001*1.0005)-funding
    return dict(spotNet=spot, futuresNet=future, futuresMidMove=gross, fundingPaid=funding,
                futuresNetZeroSlippage=no_slip)


def evaluate(spot_paths, root):
    prices, marks, rates = load_market(spot_paths, root)
    history, state, years = deque(maxlen=144), initial(), {}
    entry = None
    for bar in candles(spot_paths):
        slot, mid = bar[:2]
        book = dict(bid=mid*.9999, ask=mid*1.0001, bidSize=1., askSize=1.)
        result = breakout_slot(state, history, book, slot)
        if result['execution'] == 'PAPER_BUY':
            # Equal BTC quantity on both venues, 100 USDT spot entry including costs.
            entry = slot, mid, int(100/(mid*1.0001*1.001*1.001)*1e8)/1e8
        elif result['execution'] == 'PAPER_SELL':
            year = datetime.fromtimestamp(slot, timezone.utc).year
            stats = years.setdefault(year, Counter())
            row = paired_trade(entry, slot, mid, prices, marks, rates)
            if row is None:
                stats['excluded'] += 1
            else:
                stats.update(row)
                stats['paired'] += 1
                stats['futuresWins'] += row['futuresNet'] > 0
            entry = None
        history.append(bar)
    return years


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('spot_directory', type=Path)
    parser.add_argument('futures_directory', type=Path, help='Contains klines, markPriceKlines, fundingRate')
    args = parser.parse_args()
    paths = sorted(args.spot_directory.glob('BTCUSDT-5m-????-??.zip'))
    if not paths:
        parser.error('No monthly spot archives')
    print(json.dumps(evaluate(paths, args.futures_directory), indent=2))
