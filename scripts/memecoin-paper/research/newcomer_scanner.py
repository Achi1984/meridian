"""Volume leaderboards for a sampled universe of new Solana launchpad mints."""
import time
from math import ceil
from itertools import chain
from datetime import datetime
from urllib.error import HTTPError

from meme_paper_account import FEE, UNIT
from new_pool_watch import ADDRESS, GT, SIZE, USDC, WSOL, get, number, snapshot, spot_quote
from newcomer_research import ERRORS

WINDOWS = (5, 10, 30, 60)
TOKENS = 'https://api.jup.ag/tokens/v2'


def timestamp(value):
    date = datetime.fromisoformat(value)
    if date.tzinfo is None:
        raise ValueError('missing timestamp offset')
    return date.timestamp()


def sample(end, fetch, warn=None):
    # Combine active and freshly launched mints; a recently migrated pool alone
    # cannot establish mint age. Use the first pool timestamp from Jupiter.
    mints = {}
    for source in ('recent', 'toptraded/5m', 'toptraded/1h'):
        for token in fetch(f'{TOKENS}/{source}?limit=100', 120):
            first = token.get('firstPool') or {}
            if first.get('createdAt') and 0 <= end-timestamp(first['createdAt']) <= 86400:
                mints[token['id']] = token
    pools = {}
    # Active mints can have aged out of the launch feed. Also resolve their
    # original pools in provider-supported batches of at most 30 addresses.
    addresses = sorted({t['firstPool']['id'] for t in mints.values()
                        if ADDRESS.fullmatch(t['firstPool'].get('id', ''))})
    pages = (f'{GT}/new_pools?page={page}' for page in (1, 2, 3))
    batches = (GT+'/pools/multi/'+','.join(addresses[i:i+30])
               for i in range(0, len(addresses), 30))
    feeds = chain((('newPools', u) for u in pages), (('firstPool', u) for u in batches),
                  [('trending', GT+'/trending_pools?page=1')])
    sources = {}
    for source, url in feeds:
        try:
            items = fetch(url, 120)['data']
        except ERRORS as exc:
            if source != 'trending' or warn is None:
                raise
            warn('scannerSourceUnavailable', source=source, reason=type(exc).__name__,
                 status=getattr(exc, 'code', None))
            continue
        for item in items:
            try:
                row = snapshot(item)
            except ERRORS:
                continue
            mint = row['mint']
            if (row['quote'] not in (USDC, WSOL) or mint in (USDC, WSOL)
                    or row['dex'] not in ('pump-fun', 'pumpswap')
                    or row['liquidity'] < 5000 or timestamp(row['created']) >= end):
                continue
            sources.setdefault(mint, set()).add(source)
            if mint not in pools or (row['liquidity'], row['pool']) > (pools[mint]['liquidity'], pools[mint]['pool']):
                pools[mint] = row
    missing = sorted(pools.keys() - mints.keys())
    for i in range(0, len(missing), 100):
        query = ','.join(missing[i:i+100])
        for token in fetch(f'{TOKENS}/search?query={query}', 120):
            mints[token['id']] = token
    eligible = []
    for mint, row in pools.items():
        token = mints.get(mint, {})
        first = (token.get('firstPool') or {}).get('createdAt')
        if first and 0 <= end-timestamp(first) <= 86400:
            row.update(symbol=token.get('symbol'), firstPoolAt=first, discoverySources=sorted(sources[mint]))
            eligible.append(row)
    return eligible


def metrics(row, candles, trades, end):
    # Missing minutes after pool creation are unknown; request empty candles
    # explicitly and never fill provider gaps with invented volume.
    bars = {}
    for at, op, high, low, close, volume in candles:
        if at in bars or at % 60:
            raise ValueError('invalid candle timestamp')
        bars[at] = number(op), number(close), number(volume)
    created = int(timestamp(row['created'])//60)*60
    fills = [t['attributes'] for t in trades]
    times = [(timestamp(t['block_timestamp']), t) for t in fills]
    result = {}
    for minutes in WINDOWS:
        start = max(end-minutes*60, created)
        slots = list(range(start, end, 60))
        if not slots or any(at not in bars for at in slots):
            continue
        opening = bars[start][0]
        covered = len(times) < 300 or min(at for at, _ in times) <= start
        buys = [t.get('tx_from_address') for at, t in times if start <= at < end
                and t.get('to_token_address') == row['mint'] and not t.get('is_anomalous')]
        result[minutes] = dict(volumeUsd=sum(bars[at][2] for at in slots),
                               changePct=100*(bars[slots[-1]][1]/opening-1) if opening else None,
                               uniqueBuyers=len(set(buys)) if covered and all(buys) else None,
                               observedMinutes=len(slots))
    return result


def rank_complete_windows(records, end):
    for record in records:
        # Even the first candle of a pool can cover only part of a minute.
        first_full = ceil(timestamp(record['row']['created'])/60)*60
        record['earliest30mAt'] = first_full+1800
        record['ranks'] = {}
    for minutes in WINDOWS:
        ranked = []
        for record in records:
            window = record['windows'].get(minutes, {})
            if (record['earliest30mAt']-1800 <= end-60*minutes
                    and window.get('observedMinutes') == minutes and window.get('volumeUsd', 0) > 0):
                ranked.append(record)
        ranked.sort(key=lambda r: (-r['windows'][minutes]['volumeUsd'], r['row']['mint']))
        for rank, record in enumerate(ranked[:10], 1):
            record['ranks'][minutes] = rank


def market_reader():
    next_request = 0
    def fetch(url, max_age):
        nonlocal next_request
        for attempt in range(3):
            if url.startswith(GT):
                time.sleep(max(0, next_request-time.monotonic()))
                next_request = time.monotonic()+3
            try:
                return get(url, max_age)
            except HTTPError as exc:
                wait = (exc.headers or {}).get('Retry-After', '60')
                if exc.code != 429 or attempt == 2 or not wait.isdigit() or int(wait) > 180:
                    raise
                time.sleep(max(5, int(wait)))
    return fetch


def scan(emit, fetch=None, quote=spot_quote, now=time.time):
    if fetch is None:
        fetch = market_reader()
    end = int(now()//60)*60
    records = []
    for row in sample(end, fetch, emit):
        path = f"{GT}/pools/{row['pool']}"
        result = dict(row=row, windows={}, ranks={}, reasons=[])
        records.append(result)
        try:
            candles = fetch(path+f'/ohlcv/minute?aggregate=1&currency=usd&limit=60'
                            f'&include_empty_intervals=true&before_timestamp={end}', 120)
            trades = fetch(path+'/trades', 120)['data']
            result['windows'] = metrics(row, candles['data']['attributes']['ohlcv_list'], trades, end)
        except ERRORS as exc:
            if isinstance(exc, HTTPError) and exc.code == 429:
                raise
            result['reasons'].append('marketDataUnavailable')
    rank_complete_windows(records, end)
    selected = []
    for record in records:
        row, ranks, reasons = record['row'], record['ranks'], record['reasons']
        if 5 not in ranks or 30 not in ranks:
            reasons.append('outsidePairedTopTen')
        if record['earliest30mAt'] > end:
            reasons.append('shortHistory')
        elif record['windows'].get(30, {}).get('observedMinutes') != 30:
            reasons.append('missing30mData')
        if ranks:
            try:
                qty = quote(USDC, row['mint'], SIZE)
                resale = quote(row['mint'], USDC, qty)
                record.update(quoteAt=int(now()), quantity=qty, netResaleUsdc=(resale-2*FEE)/UNIT)
                if resale-2*FEE < SIZE*.95:
                    reasons.append('roundTripCost')
            except ERRORS as exc:
                if isinstance(exc, HTTPError) and exc.code == 429:
                    raise
                reasons.append('quoteUnavailable')
        if not reasons:
            selected.append((ranks[5], row))
    for record in records:
        emit('scannerCandidate', asOf=end, **record)
    emit('scannerSummary', asOf=end, sampled=len(records), qualified=len(selected),
         scope='Jupiter discovery intersecting GeckoTerminal first pools, three new-pool pages and the available trending feed; deepest sampled pool per mint')
    return [row for _, row in sorted(selected, key=lambda item: item[0])]
