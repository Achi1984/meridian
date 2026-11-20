"""Offline ETH/BTC relative shock, equal initial USDT notional on two perpetuals."""
import argparse
from collections import Counter
from datetime import date, timezone, datetime
from itertools import groupby
from math import log, log1p
from pathlib import Path
import json

from breakout_perp_history import FUNDING_STEP, load_market
from reclaim_history import candles
from regime_breakout import Account
from worker import DAY, STEP

SHOCK = log1p(.03)


def days(paths):
    for day, group in groupby(candles(paths), key=lambda b: b[0] // DAY * DAY):
        yield day, {b[0]: b[4] for b in group}


class Pair:
    def __init__(self):
        self.legs = [Account(), Account()]
        self.peak = 1000.
        self.drawdown = self.before = 0.
        self.trades = self.wins = 0
        self.best = None

    def fill(self, eth_side, mids):
        if eth_side:
            self.before = sum(a.net for a in self.legs)
        for account, side, mid in zip(self.legs, (eth_side, -eth_side), mids):
            account.target(side, mid, entry_notional=50)
        if not eth_side:
            result = sum(a.net for a in self.legs) - self.before
            self.trades += 1
            self.wins += result > 0
            self.best = result if self.best is None else max(self.best, result)

    def mark(self, mids):
        equity = 1000 + sum(a.net + a.quantity*(mid-a.entry) for a, mid in zip(self.legs, mids))
        self.peak = max(self.peak, equity)
        self.drawdown = max(self.drawdown, 100*(1-equity/self.peak))

    def result(self):
        net = sum(a.net for a in self.legs)
        return dict(net=net, trades=self.trades, wins=self.wins, best=self.best,
                    mean=net/self.trades if self.trades else None, maxDrawdownPct=self.drawdown,
                    executionCost=sum(a.cost for a in self.legs), fundingPaid=sum(a.funding for a in self.legs),
                    imputedFunding=sum(a.missing_funding for a in self.legs))


def exit_reason(current, anchor, shock, age):
    remaining = (current-anchor)/shock
    if remaining <= .5:
        return 'halfReverted'
    if remaining >= 1.5:
        return 'extended'
    if age >= 3*3600:
        return 'timeout'
    return None


def session(day, ratios, markets, accounts, exits):
    opened = None
    for slot in range(day, day+DAY, STEP):
        mids = [market[0][slot] for market in markets]
        if slot % FUNDING_STEP == 0:
            for pair in accounts:
                for leg, mid, (_, marks, rates) in zip(pair.legs, mids, markets):
                    leg.settle(rates.get(slot), marks.get(slot), mid)
        prev = slot - STEP
        if opened is not None:
            reason = 'dayClose' if slot == day+DAY-STEP else exit_reason(ratios[prev], anchor, shock, slot-opened)
            if reason:
                for pair in accounts:
                    pair.fill(0, mids)
                exits[reason] += 1
                for pair in accounts:
                    pair.mark(mids)
                break
        elif prev-3600 >= day and slot < day+DAY-STEP:
            anchor = ratios[prev-3600]
            shock = ratios[prev] - anchor
            if abs(shock) >= SHOCK:
                side = -1 if shock > 0 else 1
                for pair, direction in zip(accounts, (side, -side)):
                    pair.fill(direction, mids)
                opened = slot
        for pair in accounts:
            pair.mark(mids)


def evaluate(eth_root, btc_root, start, end):
    if start % DAY or end % DAY or end <= start:
        raise ValueError('Expected a nonempty UTC day range')
    accounts, exits = [Pair(), Pair()], Counter()
    skipped = total = 0
    cursor = datetime.fromtimestamp(start, timezone.utc).date().replace(day=1)
    while cursor.isoformat() < datetime.fromtimestamp(end, timezone.utc).date().isoformat():
        paths = [root/str(cursor.year)/'spot'/f'{symbol}-5m-{cursor:%Y-%m}.zip'
                 for root,symbol in ((eth_root,'ETHUSDT'), (btc_root,'BTCUSDT'))]
        markets = [load_market([p], p.parents[1]) for p in paths]
        daily = [dict(days([p])) for p in paths]
        next_month = date(cursor.year + int(cursor.month == 12), cursor.month % 12 + 1, 1)
        first = max(start, (cursor-date(1970,1,1)).days*DAY)
        last = min(end, (next_month-date(1970,1,1)).days*DAY)
        for day in range(first, last, DAY):
            total += 1
            eth, btc = [series.get(day, {}) for series in daily]
            slots = range(day,day+DAY,STEP)
            if any(t not in eth or t not in btc or t not in markets[0][0] or t not in markets[1][0] for t in slots):
                skipped += 1
                continue
            session(day, {t:log(eth[t]/btc[t]) for t in slots}, markets, accounts, exits)
        cursor = next_month
    return dict(days=total, excludedDays=skipped, exits=exits, reversion=accounts[0].result(),
                continuation=accounts[1].result())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('eth_root', type=Path)
    parser.add_argument('btc_root', type=Path)
    parser.add_argument('start', type=date.fromisoformat)
    parser.add_argument('end', type=date.fromisoformat)
    args = parser.parse_args()
    epoch = date(1970,1,1)
    print(json.dumps(evaluate(args.eth_root, args.btc_root, (args.start-epoch).days*DAY,
                              (args.end-epoch).days*DAY), indent=2))
