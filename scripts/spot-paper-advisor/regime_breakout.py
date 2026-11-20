"""Offline BTCUSDT regime comparison. Input layout: YEAR/{spot,klines,markPriceKlines,fundingRate}."""
import argparse
from collections import deque
from datetime import datetime, timezone
from itertools import groupby
import json
from math import floor
from pathlib import Path

from breakout_perp_history import FUNDING_STEP, SLIPPAGE_BPS_PER_SIDE, load_market
from reclaim_history import candles
from worker import DAY, STEP
from swing_indicators import DailyIndicators, confirmed_entry_target


def regime(closes):
    if len(closes) < 60 or any(value is None for value in closes):
        return 0
    average = sum(closes[-50:]) / 50
    older = sum(closes[-60:-10]) / 50
    if closes[-1] > average > older:
        return 1
    if closes[-1] < average < older:
        return -1
    return 0


class Account:
    def __init__(self):
        self.quantity = self.entry = self.net = self.cost = self.funding = 0.
        self.trades = self.wins = self.missing_funding = 0
        self.side_net = {1: 0., -1: 0.}
        self.best_trade = None
        self.peak, self.drawdown = 1000., 0.

    def fill_cost(self, signed_qty, mid):
        buy = signed_qty > 0
        sign = 1 if buy else -1
        fill = mid * (1 + sign * .0001) * (1 + sign * SLIPPAGE_BPS_PER_SIDE / 10000)
        return abs(signed_qty) * (sign * (fill - mid) + fill * .0005)

    def settle(self, rate, mark, mid):
        if self.quantity:
            if mark is None or rate is None:
                self.missing_funding += 1
                charge = abs(self.quantity) * mid * .001
            else:
                charge = self.quantity * mark * rate
            self.net -= charge
            self.funding += charge

    def target(self, side, mid):
        if side == (1 if self.quantity > 0 else -1 if self.quantity < 0 else 0):
            return
        if self.quantity:
            fee = self.fill_cost(-self.quantity, mid)
            self.cost += fee
            self.net += self.quantity * (mid - self.entry) - fee
            self.trades += 1
            trade_net = self.net - self.before_entry
            self.side_net[1 if self.quantity > 0 else -1] += trade_net
            self.best_trade = trade_net if self.best_trade is None else max(self.best_trade, trade_net)
            self.wins += trade_net > 0
            self.quantity = 0.
        if side:
            self.before_entry = self.net
            self.quantity = side * floor(100 / mid * 1e8) / 1e8
            self.entry = mid
            fee = self.fill_cost(self.quantity, mid)
            self.cost += fee
            self.net -= fee

    def mark(self, mid):
        equity = 1000 + self.net + self.quantity * (mid - self.entry)
        self.peak = max(self.peak, equity)
        self.drawdown = max(self.drawdown, 100 * (1 - equity / self.peak))

    def result(self):
        return dict(longNet=self.side_net[1], shortNet=self.side_net[-1], bestTrade=self.best_trade,
                    net=self.net, closed=self.trades, wins=self.wins, feesSpreadSlippage=self.cost,
                    fundingPaid=self.funding, missingFundingCharges=self.missing_funding,
                    drawdownPct=self.drawdown, mean=self.net/self.trades if self.trades else None)


def signals(bars, previous_low):
    """Key each decision by its next open. Only consume completed ten-minute bars."""
    opening = bars[:6]
    high = max(b[2] for b in opening)
    low = min(b[3] for b in opening)
    midpoint = (high + low) / 2
    swept = reclaimed = False
    for i, bar in enumerate(bars[:-1]):
        if previous_low is not None:
            swept |= bar[3] < previous_low
            reclaimed |= swept and bar[4] > previous_low
        if i < 6:
            continue
        previous = bars[i-1][4]
        direction = int(previous <= high < bar[4]) - int(previous >= low > bar[4])
        yield bars[i+1][0], (direction, reclaimed, bar[4], midpoint)


def evaluate(root, start, end, *, indicators=False):
    if start % DAY or end % DAY or end <= start:
        raise ValueError('Expected a nonempty half-open UTC day range')
    intraday = ('long', 'short', 'regime', 'regimeReclaim')
    accounts = {k: Account() for k in (*intraday, 'swing', 'swingLongOnly', 'buyHold')}
    daily = DailyIndicators() if indicators else None
    if daily:
        for key in (*daily.names, 'confirmedEntry'):
            accounts[key] = Account()
            accounts[key + 'LongOnly'] = Account()
    closes = deque(maxlen=60)
    previous_low = previous_day = last_mid = None
    excluded = warmup = total = 0
    for folder in sorted(root.glob('[0-9][0-9][0-9][0-9]')):
        paths = []
        for path in sorted((folder/'spot').glob('BTCUSDT-5m-????-??.zip')):
            month = datetime.strptime(path.stem[-7:], '%Y-%m').replace(tzinfo=timezone.utc).timestamp()
            if month < end and (indicators or month >= start - 93*DAY):
                paths.append(path)
        if not paths:
            continue
        first_month = datetime.fromtimestamp(start, timezone.utc).strftime('%Y-%m')
        traded_paths = [p for p in paths if p.stem[-7:] >= first_month]
        prices, marks, rates = load_market(traded_paths, folder)
        for day, group in groupby(candles(paths), key=lambda b: b[0] // DAY * DAY):
            bars = list(group)
            if previous_day is not None and day != previous_day + DAY:
                raise ValueError('Missing entire spot day')
            previous_day = day
            complete = len(bars) == DAY // STEP
            if start <= day < end:
                total += 1
                trend = regime(list(closes))
                warmup += len(closes) < 60 or None in closes
                full = complete and all(t in prices for t in range(day, day+DAY, STEP))
                # Intraday comparisons are conditional on common complete sessions.
                excluded += not full
                events = dict(signals(bars, previous_low)) if full else {}
                used = set()
                if any(accounts[k].quantity for k in intraday):
                    raise ValueError('Overnight intraday position')
                for slot in range(day, day+DAY, STEP):
                    mid = prices.get(slot)
                    if slot % FUNDING_STEP == 0:
                        reference = mid or marks.get(slot) or last_mid
                        for account in accounts.values():
                            account.settle(rates.get(slot), marks.get(slot), reference)
                    if mid is None:
                        continue
                    last_mid = mid
                    if slot == day + STEP:
                        accounts['swing'].target(trend, mid)
                        accounts['swingLongOnly'].target(max(0, trend), mid)
                        accounts['buyHold'].target(1, mid)
                        if daily:
                            targets = daily.targets(trend)
                            targets['confirmedEntry'] = confirmed_entry_target(
                                accounts['confirmedEntry'].quantity, trend, targets['trendThreeOfFour'])
                            for key, side in targets.items():
                                accounts[key].target(side, mid)
                                accounts[key + 'LongOnly'].target(max(0, side), mid)
                    if slot == day + DAY - STEP:
                        for k in intraday:
                            accounts[k].target(0, mid)
                    elif slot in events:
                        direction, reclaimed, close, stop = events[slot]
                        for k, allowed in zip(intraday, (1, -1, trend, trend)):
                            a = accounts[k]
                            if a.quantity and (close-stop)*a.quantity <= 0:
                                a.target(0, mid)
                            elif direction and direction == allowed and k not in used:
                                if k == 'regimeReclaim' and direction < 0 and reclaimed:
                                    continue
                                a.target(direction, mid)
                                used.add(k)
                    for account in accounts.values():
                        account.mark(mid)
            close = bars[-1][4] if bars[-1][0] == day+DAY-STEP else None
            closes.append(close)
            if daily:
                day_range = (min(b[3] for b in bars), max(b[2] for b in bars)) if complete else None
                daily.update(close, day_range)
            previous_low = min(b[3] for b in bars) if complete else None
    if total != (end-start)//DAY or last_mid is None:
        raise ValueError('Incomplete evaluation period')
    for account in accounts.values():
        account.target(0, last_mid)
        account.mark(last_mid)
    return dict(days=total, excludedIntradayDays=excluded, insufficientTrendDays=warmup,
                arms={k: a.result() for k, a in accounts.items()})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('start', help='Inclusive UTC date')
    parser.add_argument('end', help='Exclusive UTC date')
    parser.add_argument('--indicators', action='store_true',
                        help='Score individual and combined daily indicators; use all prior spot history for warmup')
    args = parser.parse_args()
    def stamp(date):
        return int(datetime.strptime(date, '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp())
    print(json.dumps(evaluate(args.root, stamp(args.start), stamp(args.end), indicators=args.indicators), indent=2))
