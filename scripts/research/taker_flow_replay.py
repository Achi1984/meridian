"""Pair archived OKX breakout outcomes with time-aligned Binance USD-M taker flow."""
import argparse
import csv
import hashlib
import io
import json
import statistics
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen
from time import sleep

from top100_paper import HOUR, FEE, SLIP, ok


def download(url):
    for attempt in range(3):
        try:
            with urlopen(url, timeout=15) as response:
                return response.read()
        except OSError:
            if attempt == 2:
                raise
            sleep(1 + attempt)


def archive(job):
    asset, day = job
    symbol = asset + 'USDT'
    name = f'{symbol}-1h-{day}.zip'
    url = f'https://data.binance.vision/data/futures/um/daily/klines/{symbol}/1h/{name}'
    raw = download(url)
    digest = hashlib.sha256(raw).hexdigest()
    if digest != download(url + '.CHECKSUM').decode().split()[0]:
        raise ValueError('checksum mismatch: ' + name)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        with z.open(name[:-4]+'.csv') as stream:
            rows = list(csv.DictReader(io.TextIOWrapper(stream)))
    shares = {}
    for r in rows:
        t = int(r['open_time']) // 1000
        share = float(r['taker_buy_quote_volume']) / float(r['quote_volume'])
        if not 0 <= share <= 1:
            raise ValueError('invalid volume share')
        shares[t] = share
    midnight = int(datetime.combine(day,datetime.min.time(),timezone.utc).timestamp())
    if set(shares) != set(range(midnight,midnight+24*HOUR,HOUR)):
        raise ValueError('incomplete archive: ' + name)
    return asset, shares, name, digest


def classify(shares, event):
    # One decision hour has elapsed by entry, so test persistence using that hour.
    signal = event['at']
    prior = [shares[signal-i*24*HOUR] for i in range(1,8)]
    direction = event['side']
    return direction*(shares[signal] - statistics.median(prior)) > 0 and direction*(shares[signal]-.5) > 0


def replay(source):
    begin = datetime.fromtimestamp(source['begin'],timezone.utc).date()-timedelta(days=7)
    end = datetime.fromtimestamp(source['end'],timezone.utc).date()
    jobs = [(asset,begin+timedelta(days=i)) for asset in ('BTC','ETH') for i in range((end-begin).days)]
    data = {'BTC':{},'ETH':{}}
    checks = {}
    with ThreadPoolExecutor(max_workers=5) as pool:
        for asset, shares, name, digest in pool.map(archive,jobs):
            data[asset].update(shares)
            checks[name] = digest
    rates = {}
    for asset in data:
        name = asset+'-USDT-SWAP'
        rows = ok('public/funding-rate-history', instId=name, limit=100,
                  after=(source['end']+24*HOUR)*1000)
        rates[asset] = {int(r['fundingTime'])//1000:float(r['realizedRate']) for r in rows if r['instId']==name}
        for t in range(source['begin'],source['end'],8*HOUR):
            if t not in rates[asset]:
                raise ValueError('missing expected funding observation')
    groups = {}
    ledger = []
    cost = float(200*(FEE+SLIP))
    for event in source['signals']:
        passes = classify(data[event['asset']],event)
        # Saved returns use OKX opens. Assume execution just after boundary settlement.
        entry = event['at']+HOUR
        funding = sum(v for t,v in rates[event['asset']].items() if entry<t<=entry+3*HOUR)
        net = event['grossPct']-cost-100*event['side']*funding
        ledger.append(dict(asset=event['asset'],signalHour=event['at'],direction=event['side'],
                           period=event['period'],passed=passes,netPct=net))
        for group in ['all','pass' if passes else 'reject']:
            key = (event['period'], 'long' if event['side']==1 else 'short', group)
            groups.setdefault(key,[]).append((event['grossPct'], net))
    return dict(archiveSHA256=checks, assumedRoundTripCostPct=cost, signals=ledger,
                fundingModel='realized OKX rate on entry notional, settlement before boundary fills',
                summary={' '.join(k):dict(n=len(v),meanGrossPct=statistics.mean(x for x,y in v),
                meanNetPct=statistics.mean(y for x,y in v)) for k,v in sorted(groups.items())})


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source', type=Path)
    p.add_argument('output', type=Path)
    args = p.parse_args()
    args.output.write_text(json.dumps(replay(json.loads(args.source.read_text())),indent=2)+'\n')
