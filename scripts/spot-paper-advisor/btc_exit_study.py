"""Paired BTC/USD paper exits from recorded fills. No market or order API calls."""
import argparse
from collections import Counter
from contextlib import closing
from datetime import datetime
from decimal import Decimal
import json
from pathlib import Path
import sqlite3

from pair_report import valid_replay_candle
from swing_indicators import EMA
from usd_pullback import usable_book
from worker import FEE, SLIP, STEP, iso


def hourly_signals(history, slot):
    end = slot - slot % 3600
    bars = []
    for timestamp in range(end-3600, end-121*3600, -3600):
        if timestamp not in history:
            break
        bars.append(history[timestamp])
    bars.reverse()
    if len(bars) < 23:
        return 'unknown', None
    ranges = [max(b[2]-b[3], abs(b[2]-prev[4]), abs(b[3]-prev[4])) for prev,b in zip(bars,bars[1:])]
    atr = sum(ranges[:22])/22
    for value in ranges[22:]:
        atr += (value-atr)/22
    stop = bars[-1][4] <= max(b[2] for b in bars[-22:])-3*atr
    trend, fast, slow, signal = [EMA(n) for n in (13,12,26,9)]
    previous = None
    color = 'unknown'
    for bar in bars:
        level, a, b = [line.update(bar[4]) for line in (trend,fast,slow)]
        if b is None:
            continue
        macd = a-b
        smooth = signal.update(macd)
        if smooth is None:
            continue
        hist = macd-smooth
        if previous:
            color = ('red' if level < previous[0] and hist < previous[1] else
                     'green' if level > previous[0] and hist > previous[1] else 'neutral')
        previous = level,hist
    return color, stop


class ExitStudy:
    def __init__(self):
        self.last = -1
        self.history = {}
        self.positions = {}
        self.closed = []
        self.missing_slots = 0

    def read(self, db):
        for slot, raw in db.execute('SELECT slot,record FROM slots WHERE slot>? ORDER BY slot',(self.last,)):
            if self.last >= 0:
                self.missing_slots += (slot-self.last)//STEP-1
            self.last = slot
            if raw is None:
                self.missing_slots += 1
                continue
            record = json.loads(raw)
            report = record['report']
            if report['pair'] != 'BTC/USD' or report['at'] != iso(slot) or report['schema'] != 'MERIDIAN_USD_ROUND_V1':
                raise ValueError('Unexpected BTC journal')
            for bar in (record.get('snapshot') or {}).get('hour', []):
                t = bar[0]
                if t % 3600 == 0 and t+3600 <= slot and valid_replay_candle(bar,t):
                    self.history[t] = bar
            self.history = {t:b for t,b in self.history.items() if t >= slot-121*3600}
            color,stop = hourly_signals(self.history,slot)
            now = datetime.fromisoformat(report['publishedAt']).timestamp()
            book = usable_book(record.get('fillBook'),now,slot)
            for arm in ('v3','v4'):
                result = report['arms'][arm]['execution']
                state = record['states'][arm]
                if result == 'PAPER_BUY':
                    if arm in self.positions:
                        raise ValueError('Double entry')
                    self.positions[arm] = dict(entryAt=slot,elder=color,qty=Decimal(state['btc']),
                        cost=Decimal(state['entryCostUsd']),cash=Decimal(state['cash']),early=None,observed=False)
                    continue
                p = self.positions.get(arm)
                if p is None:
                    if result == 'PAPER_SELL':
                        raise ValueError('Missing original entry')
                    continue
                if stop is not None and result != 'PAPER_SELL':
                    p['observed'] = True
                if result == 'PAPER_SELL':
                    base = Decimal(state['cash'])-p['cash']-p['cost']
                    early = p['early']
                    self.closed.append(dict(arm=arm,entryAt=p['entryAt'],elder=p['elder'],chandelierObserved=p['observed'],exitAt=slot,
                        alternativeExitAt=early[0] if early else slot,baseNetUsd=float(base),
                        alternativeNetUsd=float(early[1] if early else base)))
                    del self.positions[arm]
                elif (stop and p['early'] is None and book and now < slot+90
                      and Decimal(str(book['bidSize'])) >= p['qty']):
                    net = p['qty']*Decimal(str(book['bid']))*(1-SLIP)*(1-FEE)-p['cost']
                    p['early'] = slot,net
        return dict(asOf=iso(self.last) if self.last>=0 else None,missingSlots=self.missing_slots,
            arms={arm:self.summary(arm) for arm in ('v3','v4')})

    def summary(self, arm):
        rows = [r for r in self.closed if r['arm']==arm]
        return dict(closed=len(rows),openOriginal=arm in self.positions,
            withChandelierObservation=sum(r['chandelierObserved'] for r in rows),
            earlierExits=sum(r['alternativeExitAt']<r['exitAt'] for r in rows),
            originalNetUsd=round(sum(r['baseNetUsd'] for r in rows),8),
            alternativeNetUsd=round(sum(r['alternativeNetUsd'] for r in rows),8),
            elderAtClosedEntries=dict(Counter(r['elder'] for r in rows)))


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ledger',type=Path)
    args=parser.parse_args()
    with closing(sqlite3.connect(args.ledger.resolve().as_uri()+'?mode=ro',uri=True)) as db:
        study=ExitStudy()
        print(json.dumps(dict(summary=study.read(db),trades=study.closed),allow_nan=False))
