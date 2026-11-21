"""BTC/EUR offline monthly walk-forward evaluation of two same-day long strategies."""
import argparse
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal as D
from pathlib import Path

DAY = timedelta(days=1)
RULES = ('breakout', 'recovery')


def load(paths):
    rows = {}
    for path in paths:
        for ts, low, high, opening, close, volume in json.loads(path.read_text(), parse_float=D):
            if not isinstance(ts, int) or ts % 21600 or not 0 < low <= min(opening, close) <= max(opening, close) <= high or volume <= 0:
                raise ValueError(f'invalid six-hour candle {ts}')
            key = datetime.fromtimestamp(ts, timezone.utc)
            value = tuple(map(D, (low, high, opening, close)))
            if key in rows and rows[key] != value:
                raise ValueError(f'conflicting candle {key}')
            rows[key] = value
    return rows


def evaluate(rows, start, end, fee):
    if start.day != 1 or end.day != 1 or start >= end:
        raise ValueError('whole calendar months required')
    # All windows must be complete. Never let a missing-data day become a no-trade.
    d = start - 181 * DAY
    daily = {}
    while d < end:
        daily[d] = [rows[datetime(d.year, d.month, d.day, h, tzinfo=timezone.utc)] for h in (0,6,12,18)]
        d += DAY
    returns = {}
    d = start - 180 * DAY
    while d < end:
        prior = daily[d-DAY]
        first, entry, _, exit_bar = daily[d]
        floor = min(x[0] for x in prior)
        ceiling = max(x[1] for x in prior)
        multiple = exit_bar[2] * D('.999') * (1-fee) / (entry[2] * D('1.001') * (1+fee))
        returns[d] = {'breakout': multiple-1 if first[3] > ceiling else None,
                      'recovery': multiple-1 if first[0] < floor < first[3] else None}
        # Fixed primary-cost volatility hurdle in both fee scenarios.
        recent = daily.get(d-7*DAY)
        if recent is not None:
            ranges = sorted((max(x[1] for x in daily[d-i*DAY])-min(x[0] for x in daily[d-i*DAY])) / daily[d-i*DAY][-1][3] for i in range(1,8))
            high, low = first[1], first[0]
            confirmed = high > low and (first[3]-low) / (high-low) >= D('.75')
            returns[d]['vol_breakout'] = returns[d]['breakout'] if confirmed and ranges[3] >= D('.036') else None
        d += DAY
    result = {}
    for mode in (*RULES,'adaptive','vol_breakout'):
        cash = peak = D(1000)
        dd = D(0)
        trips = wins = active_months = 0
        annual = {}
        d = start
        while d < end:
            if d.day == 1:
                chosen = mode
                if mode == 'adaptive':
                    scores = {}
                    for rule in RULES:
                        history = [returns[d-i*DAY][rule] for i in range(1,181)]
                        trades = [r for r in history if r is not None]
                        if len(trades) >= 5 and sum(trades) > 0:
                            scores[rule] = sum(trades)
                    chosen = max(scores, key=scores.get) if scores else None
                active_months += int(chosen is not None)
            r = returns[d].get(chosen)
            if r is not None:
                pnl = min(D(100),cash) * r
                cash += pnl
                annual[d.year] = annual.get(d.year,D(0)) + pnl
                trips += 1
                wins += int(r > 0)
                peak = max(peak,cash)
                dd = max(dd,peak-cash)
            d += DAY
        result[mode] = dict(net_eur=round(cash-1000,2), lives=round(cash/1000,5),
                            trades=trips, wins=wins, max_closed_drawdown_eur=round(dd,2),
                            active_months=active_months, annual={y:round(v,2) for y,v in annual.items()})
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('start',type=date.fromisoformat)
    p.add_argument('end',type=date.fromisoformat)
    p.add_argument('files',type=Path,nargs='+')
    args = p.parse_args()
    rows = load(args.files)
    for cost in (D('.005'),D('.0075')):
        print(json.dumps(evaluate(rows,args.start,args.end,cost),default=str), cost)
