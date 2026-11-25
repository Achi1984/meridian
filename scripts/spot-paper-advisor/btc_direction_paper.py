"""Bounded public-market BTC perpetual paper comparison; values are in USDT."""
import argparse
import json
import time
from decimal import Decimal as D
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from btc_exit_study import hourly_signals
from xperp_pair import FEE, SLIP

INST = 'BTC-USDT-SWAP'
NOTIONAL = D('100')
HOUR = 3600
ARMS = {'short': ('red', -1), 'long': ('green', 1)}


def market(path, **params):
    url = 'https://www.okx.com/api/v5/' + path + '?' + urlencode(dict(instId=INST, **params))
    with urlopen(Request(url, headers={'User-Agent': 'MeridianPaper/1'}), timeout=8) as resp:
        data = json.load(resp)
    if data['code'] != '0' or not data['data']:
        raise ValueError('Unavailable ' + path)
    return data['data']


def signals(slot):
    bars = {}
    for row in market('market/candles', bar='1H', limit=125):
        t = int(row[0]) // 1000
        if row[-1] == '1' and t + HOUR <= slot:
            bars[t] = [t, *map(float, row[1:5])]
    colors = [hourly_signals(bars, end)[0] for end in (slot-HOUR, slot)]
    if 'unknown' in colors:
        raise ValueError('missing confirmed hourly history')
    return colors


def observe_book(after):
    for _ in range(8):
        book = market('market/books', sz=1)[0]
        now = time.time()
        ts = int(book['ts']) / 1000
        if after < ts <= now and now-ts <= 5:
            bid, ask = D(book['bids'][0][0]), D(book['asks'][0][0])
            if 0 < bid <= ask:
                return book
        time.sleep(.6)
    raise ValueError('missing subsequent book')


def update(account, color, sign, colors, slot, book, spec, next_funding):
    pos = account['open']
    if pos:
        if colors[-1] == color and slot-pos['slot'] < 6*HOUR:
            return
    elif colors != [color, color]:
        return
    buy = sign < 0 if pos else sign > 0
    raw, available = map(D, book['asks' if buy else 'bids'][0][:2])
    price = raw * (1 + SLIP if buy else 1 - SLIP)
    unit, lot, minimum = spec
    contracts = D(pos['contracts']) if pos else (NOTIONAL/(price*unit)//lot)*lot
    if not minimum <= contracts <= available:
        return
    ts = int(book['ts'])
    if not pos:
        if ts >= next_funding:
            return
        account['open'] = dict(slot=slot, at=ts, price=str(price), contracts=str(contracts),
                               nextFunding=next_funding)
        return
    qty = unit*contracts
    entry = D(pos['price'])
    gross = sign*qty*(price-entry)
    fees = FEE*qty*(price+entry)
    account['closed'].append(dict(entry=pos, at=ts, price=str(price), gross=str(gross),
                                  fees=str(fees), funding='0' if ts < pos['nextFunding'] else None))
    account['open'] = None


def settle(trade, sign, unit):
    if trade['funding'] is not None:
        return
    pos = trade['entry']
    history = market('public/funding-rate-history', limit=100)
    rows = {int(r['fundingTime']):r for r in history}
    current = int(market('public/funding-rate')[0]['fundingTime'])
    if pos['nextFunding'] not in rows or min(rows) > pos['at'] or current <= trade['at']:
        return
    total = D(0)
    for at, row in sorted(rows.items()):
        if pos['at'] < at <= trade['at']:
            candles = market('market/history-mark-price-candles', bar='1m', after=at+1, limit=2)
            mark = next(D(c[1]) for c in candles if int(c[0]) == at)
            total -= sign * D(pos['contracts']) * unit * mark * D(row['realizedRate'])
    trade['funding'] = str(total)


def run(directory, segment):
    directory.mkdir(exist_ok=True)
    file = directory/'state.json'
    if segment == 1:
        if file.exists():
            raise ValueError('existing run')
        state = dict(start=int(time.time()), cashBenchmark='1000', observations=[], accounts={
            n+delay:dict(open=None, closed=[]) for n in ARMS for delay in ('','Delayed')})
    else:
        state = json.loads(file.read_text())
    end = state['start'] + segment*4*HOUR
    def save():
        tmp = file.with_suffix('.tmp')
        tmp.write_text(json.dumps(state))
        tmp.replace(file)
    spec_row = market('public/instruments', instType='SWAP')[0]
    if (spec_row['instId'], spec_row['state'], spec_row['ctType'], spec_row['ctValCcy']) != (INST,'live','linear','BTC'):
        raise ValueError('unexpected contract')
    spec = D(spec_row['ctVal'])*D(spec_row['ctMult'] or '1'), D(spec_row['lotSz']), D(spec_row['minSz'])
    state.update(instrument=INST, notionalUsdt=str(NOTIONAL), initialPerAccount='1000',
                 feePerSide=str(FEE), slippagePerSide=str(SLIP))
    now = time.time()
    warmup = dict(at=int(now), colors=signals(int(now)//HOUR*HOUR), book=observe_book(now))
    state.setdefault('segmentWarmups', []).append(warmup)
    save()
    print('Paper collector ready', INST, spec, warmup['colors'], flush=True)
    last = state['observations'][-1]['slot'] if state['observations'] else state['start']//HOUR*HOUR
    while time.time() < end:
        slot = last + HOUR
        time.sleep(max(0, min(end, slot+2)-time.time()))
        if time.time() >= end:
            break
        row = dict(slot=slot)
        try:
            if time.time()-slot > 90:
                raise ValueError('missed hourly decision')
            colors = signals(slot)
            row['colors'] = colors
            next_at = int(market('public/funding-rate')[0]['fundingTime'])
            after = time.time()
            for delay in ('','Delayed'):
                book = observe_book(after)
                row['book'+delay] = book
                for arm, (color, sign) in ARMS.items():
                    update(state['accounts'][arm+delay], color, sign, colors, slot, book, spec, next_at)
                after = int(book['ts'])/1000
        except (ValueError, OSError, ArithmeticError, IndexError, KeyError) as exc:
            row['error'] = str(exc)[:160]
        for name, account in state['accounts'].items():
            for trade in account['closed']:
                try:
                    settle(trade, ARMS[name.removesuffix('Delayed')][1], spec[0])
                except (ValueError, OSError, ArithmeticError, IndexError, KeyError, StopIteration):
                    pass
            account['realizedBalanceUsdt'] = (str(D(1000)+sum(D(t['gross'])-D(t['fees'])+D(t['funding'])
                for t in account['closed'])) if all(t['funding'] is not None for t in account['closed']) else None)
        state['observations'].append(row)
        save()
        print(json.dumps(row), flush=True)
        last = slot


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('segment', type=int, choices=(1,2))
    args = parser.parse_args()
    run(args.directory, args.segment)
