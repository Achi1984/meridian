"""Prospective BTC X-Perps paper comparison driven by the USD round's committed v3 fills."""
import argparse
import json
import sqlite3
import time
from contextlib import closing
from datetime import datetime
from decimal import Decimal as D
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

INST = 'BTC-USD_UM_XPERP-310404'
STEP = 600
SLIP = D('.001')
FEE = D('.0005')


def public(path, **params):
    url = 'https://eea.okx.com/api/v5/' + path + '?' + urlencode(dict(instId=INST, **params))
    with urlopen(Request(url, headers={'User-Agent': 'MeridianPaper/1.0'}), timeout=6) as response:
        payload = json.load(response)
    if payload['code'] != '0' or not payload['data']:
        raise ValueError('unavailable ' + path)
    return payload['data']


def fill(book, decision, now, side, target, unit, lot, minimum):
    ts = int(book['ts']) / 1000
    if not decision <= ts <= now or now-ts > 5 or now-decision > 20:
        raise ValueError('unpaired quote time')
    price, size = map(D, book['asks' if side == 'BUY' else 'bids'][0][:2])
    bid, ask = D(book['bids'][0][0]), D(book['asks'][0][0])
    if not 0 < bid <= ask:
        raise ValueError('invalid book')
    price *= 1+SLIP if side == 'BUY' else 1-SLIP
    contracts = (target / (unit*price) // lot)*lot if side == 'BUY' else target
    if contracts < minimum or contracts > size:
        raise ValueError('insufficient executable size')
    return contracts, price, int(book['ts'])


def funding(entry, exit_ms, quantity):
    # A completed history interval must extend back through entry. Retry delayed settlements.
    current = public('public/funding-rate')[0]
    rows = public('public/funding-rate-history', limit=100)
    times = [int(row['fundingTime']) for row in rows]
    if min(times) > entry or int(current['fundingTime']) <= exit_ms:
        raise ValueError('funding coverage incomplete')
    # History can lag the schedule rollover. Require the last scheduled boundary when crossed.
    total = D(0)
    for row in rows:
        at = int(row['fundingTime'])
        if entry < at <= exit_ms:
            candles = public('market/history-mark-price-candles', bar='1m', after=at+1, limit=2)
            candle = next(c for c in candles if int(c[0]) == at)
            total += quantity * D(candle[1]) * D(row['realizedRate'])
    return total, times


def process(db, source, spec):
    last = db.execute('select max(slot) from observations').fetchone()[0]
    now = time.time()
    since = int(now)//STEP*STEP-1 if last is None else last
    for slot, raw in source.execute('select slot,record from slots where slot>? and record is not null order by slot',(since,)):
        r = json.loads(raw)
        arm = r['report']['arms']['v3']
        event = arm['execution']
        result = dict(event=event, status='OBSERVED')
        if event in ('PAPER_BUY','PAPER_SELL'):
            try:
                decision = datetime.fromisoformat(r['report']['publishedAt']).timestamp()
                if time.time()-decision > 20:
                    raise ValueError('missed paired execution window')
                side = 'BUY' if event == 'PAPER_BUY' else 'SELL'
                opening = None
                if side == 'SELL':
                    row = db.execute("select data from observations where event='PAPER_BUY' order by slot desc limit 1").fetchone()
                    opening = json.loads(row[0]) if row else {}
                    if opening.get('status') != 'FILLED':
                        raise ValueError('no paired entry')
                unit, lot, minimum = spec
                if opening is None:
                    spot_qty = D(r['states']['v3']['btc'])
                    target = spot_qty * D(str(r['fillBook']['ask'])) * (1+SLIP)
                    schedule = public('public/funding-rate')[0]
                else:
                    target = D(opening['contracts'])
                book = public('market/books', sz=1)[0]
                while int(book['ts'])/1000 < decision and time.time()-decision < 15:
                    time.sleep(0.5)
                    book = public('market/books', sz=1)[0]
                contracts, price, ts = fill(book, decision, time.time(), side, target, unit, lot, minimum)
                result.update(status='FILLED', contracts=str(contracts), price=str(price), ts=ts)
                if opening is None:
                    next_at = int(schedule['fundingTime'])
                    if next_at <= ts:
                        raise ValueError('stale funding schedule')
                    result.update(nextFunding=next_at, nominalUsd=str(target), executedUsd=str(contracts*unit*price))
                else:
                    qty = contracts*unit
                    entry_price = D(opening['price'])
                    pnl = qty*(price-entry_price-FEE*(price+entry_price))
                    result.update(beforeFundingUsd=str(pnl), entryTs=opening['ts'], nextFunding=opening['nextFunding'])
                    if ts < opening['nextFunding']:
                        result.update(netUsd=str(pnl), fundingUsd='0')
                    else:
                        result['status'] = 'FUNDING_PENDING'
            except (ValueError, KeyError, IndexError, ArithmeticError, OSError) as exc:
                result.update(status='UNPAIRED', reason=str(exc)[:120])
        with db:
            db.execute('insert into observations values(?,?,?)',(slot,event,json.dumps(result)))
    for slot, raw in db.execute("select slot,data from observations where event='PAPER_SELL' and json_extract(data,'$.status')='FUNDING_PENDING'").fetchall():
        r = json.loads(raw)
        charge, times = funding(r['entryTs'], r['ts'], D(r['contracts'])*spec[0])
        if r['nextFunding'] not in times:
            continue
        r.update(status='FILLED', fundingUsd=str(charge), netUsd=str(D(r['beforeFundingUsd'])-charge))
        with db:
            db.execute('update observations set data=? where slot=?',(json.dumps(r),slot))


def summary(db):
    records = [json.loads(row[0]) for row in db.execute('select data from observations order by slot')]
    closes = [r for r in records if 'netUsd' in r]
    return dict(startUsd=1000, observed=len(records), pairedClosed=len(closes),
                realizedBalanceUsd=float(D(1000)+sum(D(r['netUsd']) for r in closes)),
                unpaired=sum(r['status']=='UNPAIRED' for r in records),
                fundingPending=sum(r['status']=='FUNDING_PENDING' for r in records),
                last=records[-1] if records else None)


def run(directory):
    instrument = public('public/instruments',instType='FUTURES')[0]
    if (instrument['instId'], instrument['state'], instrument['ctValCcy']) != (INST,'live','BTC'):
        raise ValueError('unexpected contract')
    spec = (D(instrument['ctVal'])*D(instrument['ctMult']), D(instrument['lotSz']), D(instrument['minSz']))
    with closing(sqlite3.connect((directory/'round.sqlite').as_uri()+'?mode=ro',uri=True)) as source, closing(sqlite3.connect(directory/'xperp.sqlite')) as db:
        start = source.execute('select start from pilot where id=1').fetchone()[0]
        db.execute('create table if not exists observations(slot integer primary key,event text,data text)')
        while time.time() < start+7*86400+STEP:
            try:
                process(db,source,spec)
            except (OSError, ValueError, ArithmeticError, StopIteration, sqlite3.Error) as exc:
                print(type(exc).__name__,str(exc)[:120],flush=True)
            time.sleep(2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--status', action='store_true')
    args = parser.parse_args()
    directory = args.directory.resolve()
    if args.status:
        with closing(sqlite3.connect((directory/'xperp.sqlite').as_uri()+'?mode=ro',uri=True)) as db:
            print(json.dumps(summary(db)))
    else:
        run(directory)
