"""Fetch five-minute USD bars for the two fixed Solana research pools into a local JSON packet."""
import argparse
from datetime import date
import json
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from solana_spot_reclaim import DAY, validate

WSOL = 'So11111111111111111111111111111111111111112'
POOLS = {
    'BONK': ('5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'),
    'WIF': ('EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx', 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm')
}


def fetch(token, start, end):
    if start >= end:
        raise ValueError('Expected a nonempty interval')
    pool, mint = POOLS[token]
    endpoint = f'https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/ohlcv/minute'
    rows = {}
    cursor = end
    while cursor >= start:
        params = dict(aggregate=5, limit=1000, currency='usd', token='base', before_timestamp=cursor)
        request = Request(endpoint+'?'+urlencode(params), headers={'User-Agent':'Meridian-offline-research'})
        for attempt in range(4):
            try:
                with urlopen(request, timeout=30) as response:
                    packet = json.load(response)
                break
            except HTTPError as error:
                if error.code != 429 or attempt == 3:
                    raise
                delay = error.headers.get('Retry-After', '')
                time.sleep(max(60, int(delay)) if delay.isdigit() else 60)
        meta = packet['meta']
        if meta['base']['address'] != mint or meta['quote']['address'] != WSOL:
            raise ValueError('Unexpected pool token identities')
        batch = packet['data']['attributes']['ohlcv_list']
        if not batch:
            break
        oldest = min(b[0] for b in batch)
        if oldest >= cursor:
            raise ValueError('Pagination did not advance')
        for row in batch:
            at = row[0]
            if start <= at < end:
                if at in rows and rows[at] != row:
                    raise ValueError('Conflicting historical bars')
                rows[at] = row
        cursor = oldest-1
        if cursor >= start:
            time.sleep(7)
    ordered = [rows[t] for t in sorted(rows)]
    validate(ordered)
    return dict(pool=pool, mint=mint, rows=ordered)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('symbol',choices=POOLS)
    parser.add_argument('start',type=date.fromisoformat)
    parser.add_argument('end',type=date.fromisoformat)
    parser.add_argument('output',type=Path)
    args = parser.parse_args()
    epoch = date(1970,1,1)
    data = fetch(args.symbol,(args.start-epoch).days*DAY,(args.end-epoch).days*DAY)
    with args.output.open('x') as out:
        json.dump(data,out,separators=(',',':'))
